// backend/utils/chunker.js
// Structure-Aware + Contextual Chunking для точного Hybrid RAG и Extractive QA

/**
 * Определяет, является ли строка заголовком раздела (например: "1. Предмет договора", "РАЗДЕЛ 2.", "# Описание")
 */
function detectHeading(line) {
  const trimmed = (line || '').trim();
  if (!trimmed || trimmed.length > 110 || trimmed.length < 3) return null;
  if (/^#{1,4}\s+.+/.test(trimmed)) return trimmed.replace(/^#+\s+/, '').trim();
  if (/^(раздел|глава|статья|пункт|приложение)\s+[0-9ivxIVX]+/i.test(trimmed)) return trimmed;
  if (/^\d+(\.\d+)?\.?\s+[А-ЯЁA-Z][^\n]{2,90}$/.test(trimmed) && !/[.;,]$/.test(trimmed)) return trimmed;
  // Короткая строка ЗАГЛАВНЫМИ БУКВАМИ
  const letters = trimmed.replace(/[^А-ЯЁA-Zа-яёa-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase() && !/[.;]$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Безопасное дробление сверхдлинного фрагмента на окна по словам (для таблиц/текстов без точек)
 */
function splitByWordWindow(text, maxWords, overlapWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [text.trim()];
  const step = Math.max(1, maxWords - overlapWords);
  const parts = [];
  for (let i = 0; i < words.length; i += step) {
    const slice = words.slice(i, i + maxWords);
    if (slice.length > 0) parts.push(slice.join(' '));
    if (i + maxWords >= words.length) break;
  }
  return parts;
}

/**
 * Формирование контекстного префикса чанка (Contextual Retrieval)
 */
function buildContextualContent(content, { title = '', sourceLabel = 'Документ', metaLine = '', sectionLabel = '' } = {}) {
  const headerParts = [];
  if (title) headerParts.push(`${sourceLabel}: ${title}`);
  if (metaLine) headerParts.push(metaLine);
  if (sectionLabel) headerParts.push(`Раздел: ${sectionLabel}`);
  if (headerParts.length === 0) return content;
  return `[${headerParts.join(' | ')}]\n${content}`;
}

/**
 * Чанкует один смысловой блок/секцию с сохранением абзацев, строк таблиц и перекрытием.
 */
function chunkSection(text, options, startChunkIndex, sectionLabelOverride) {
  const maxWords = options.maxWords || 260;
  const overlapWords = Math.min(options.overlap || 45, Math.floor(maxWords / 3));

  const rawBlocks = text
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(Boolean);

  const chunks = [];
  let currentBlocks = [];
  let currentWordCount = 0;
  let activeSection = sectionLabelOverride || '';
  let chunkIndex = startChunkIndex;

  const flushChunk = () => {
    if (currentBlocks.length === 0) return;
    const content = currentBlocks.join('\n\n').trim();
    if (!content) {
      currentBlocks = [];
      currentWordCount = 0;
      return;
    }
    const words = content.split(/\s+/).filter(Boolean);
    chunks.push({
      chunkIndex: chunkIndex++,
      content,
      contextualContent: buildContextualContent(content, {
        title: options.title,
        sourceLabel: options.sourceLabel,
        metaLine: options.metaLine,
        sectionLabel: activeSection
      }),
      sectionLabel: activeSection,
      wordCount: words.length
    });

    // Перекрытие: сохраняем хвост из последних overlapWords слов
    if (overlapWords > 0 && words.length > overlapWords) {
      const tailText = words.slice(-overlapWords).join(' ');
      currentBlocks = [tailText];
      currentWordCount = overlapWords;
    } else {
      currentBlocks = [];
      currentWordCount = 0;
    }
  };

  for (const block of rawBlocks) {
    // Проверяем первую строку блока на заголовок раздела (если не задана явная секция вроде "Лист: Бюджет")
    const lines = block.split('\n');
    const maybeHeading = !sectionLabelOverride ? detectHeading(lines[0]) : null;
    if (maybeHeading) {
      // На каждом новом разделе документа (>= 20 слов в предыдущем) фиксируем чистую смысловую границу чанка
      if (currentWordCount >= 20) {
        flushChunk();
        // При смене раздела не тащим хвост предыдущего раздела в новый
        currentBlocks = [];
        currentWordCount = 0;
        activeSection = maybeHeading;
      } else if (!activeSection) {
        activeSection = maybeHeading;
      }
    }

    const blockWords = block.split(/\s+/).filter(Boolean);

    if (blockWords.length <= maxWords) {
      if (currentWordCount + blockWords.length > maxWords && currentBlocks.length > 0) {
        flushChunk();
      }
      currentBlocks.push(block);
      currentWordCount += blockWords.length;
    } else {
      // Длинный абзац или таблица: бьём по строкам (если таблица/список) или по предложениям
      const isMultiLine = lines.length >= 3;
      const units = isMultiLine
        ? lines.map(l => l.trim()).filter(Boolean)
        : block.split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);

      for (const unit of units) {
        const uWords = unit.split(/\s+/).filter(Boolean);
        if (uWords.length > maxWords) {
          // Сверхдлинное предложение без знаков препинания — режем окном слов
          const subWindows = splitByWordWindow(unit, maxWords, overlapWords);
          for (const win of subWindows) {
            if (currentWordCount > 0) flushChunk();
            const wCount = win.split(/\s+/).filter(Boolean).length;
            currentBlocks.push(win);
            currentWordCount += wCount;
            if (currentWordCount >= maxWords) flushChunk();
          }
        } else {
          if (currentWordCount + uWords.length > maxWords && currentBlocks.length > 0) {
            flushChunk();
          }
          currentBlocks.push(unit);
          currentWordCount += uWords.length;
        }
      }
    }
  }

  // Сбрасываем остаток (если он не является чисто дублем хвоста перекрытия)
  if (currentBlocks.length > 0) {
    const content = currentBlocks.join('\n\n').trim();
    const words = content.split(/\s+/).filter(Boolean);
    const isJustOverlapTail = chunks.length > 0 && words.length <= overlapWords + 2 && chunks[chunks.length - 1].content.endsWith(content);
    if (!isJustOverlapTail && content) {
      chunks.push({
        chunkIndex: chunkIndex++,
        content,
        contextualContent: buildContextualContent(content, {
          title: options.title,
          sourceLabel: options.sourceLabel,
          metaLine: options.metaLine,
          sectionLabel: activeSection
        }),
        sectionLabel: activeSection,
        wordCount: words.length
      });
    }
  }

  return { chunks, nextChunkIndex: chunkIndex };
}

/**
 * Основная функция семантического чанкинга текста документа.
 * Сохраняет полную обратную совместимость: chunkText(text, { maxWords, overlap }).
 */
function chunkText(text, options = {}) {
  const sections = Array.isArray(options.sections) && options.sections.length > 0 ? options.sections : null;
  const allChunks = [];
  let nextIdx = 0;

  if (sections) {
    for (const sec of sections) {
      if (!sec || !sec.text || !sec.text.trim()) continue;
      const res = chunkSection(sec.text.trim(), options, nextIdx, sec.label || '');
      allChunks.push(...res.chunks);
      nextIdx = res.nextChunkIndex;
    }
  } else if (text && typeof text === 'string' && text.trim()) {
    const res = chunkSection(text.trim(), options, 0, '');
    allChunks.push(...res.chunks);
  }

  if (allChunks.length === 0 && text && typeof text === 'string' && text.trim()) {
    const clean = text.trim();
    allChunks.push({
      chunkIndex: 0,
      content: clean,
      contextualContent: buildContextualContent(clean, options),
      sectionLabel: '',
      wordCount: clean.split(/\s+/).filter(Boolean).length
    });
  }

  return allChunks;
}

module.exports = {
  chunkText,
  buildContextualContent
};
