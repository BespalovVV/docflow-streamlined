// backend/services/ragService.js
// Единый автономный Hybrid RAG + Extractive QA движок (pgvector HNSW + Russian FTS + pg_trgm + ONNX multilingual-e5-small)
// Объединяет Документы + Материалы проектов + Вложения почты со строгим Pre-Filter RBAC
// и гарантированным возвратом ближайшего варианта при отсутствии точных совпадений.

const db = require('../db');
const { getSubordinateUserIds } = require('../utils/hierarchy');
const {
  embedText,
  embedBatch,
  toPgVector,
  cosineSimilarity,
  tokenize,
  stemRussian,
  STOPWORDS
} = require('../utils/embedder');

// Калиброванные пороги для Xenova/multilingual-e5-small (L2-normalized cosine similarity)
// Подтверждено живым бенчмарком: релевантные пары 0.836-0.866, смежный шум 0.780-0.788, чужие темы ~0.736
const HIGH_VEC_THRESHOLD = 0.835;
const MEDIUM_VEC_THRESHOLD = 0.812;
const TRGM_MATCH_THRESHOLD = 0.34;

const SOURCE_META = {
  document: { label: 'Документ', icon: '📄' },
  project_material: { label: 'Материал проекта', icon: '🧭' },
  mail_attachment: { label: 'Вложение почты', icon: '📧' }
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Разбиение текста чанка на отдельные осмысленные предложения / строки таблиц для Extractive QA
 */
function splitIntoSentences(text) {
  if (!text) return [];
  const rawLines = String(text)
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean);

  const sentences = [];
  for (const line of rawLines) {
    // Табличная строка (из Excel / Markdown) — оставляем целиком как факт
    if (line.includes(' | ') && line.length <= 360) {
      sentences.push(line);
      continue;
    }
    const parts = line.split(/(?<=[.!?…])\s+(?=[А-ЯЁA-Z0-9«"(])/);
    for (const p of parts) {
      const clean = p.trim();
      if (clean.length >= 15) {
        if (clean.length > 420) {
          // Слишком длинное предложение режем по запятым/точкам с запятой
          const sub = clean.split(/(?<=[;:])\s+/).map(s => s.trim()).filter(s => s.length >= 15);
          sentences.push(...(sub.length > 0 ? sub : [clean.slice(0, 420)]));
        } else {
          sentences.push(clean);
        }
      }
    }
  }
  return sentences;
}

/**
 * Извлечение значимых ключевых слов и стеммов из пользовательского вопроса
 */
function extractQueryTerms(query) {
  const clean = String(query || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s_-]/g, ' ')
    .trim();

  const words = clean.split(/\s+/).filter(w => w.length >= 2 && !STOPWORDS.has(w));
  const stems = [];
  const seen = new Set();

  for (const w of words) {
    const stem = /[а-я]/i.test(w) ? stemRussian(w) : w.replace(/(ing|ed|es|s)$/i, '');
    if (stem.length >= 2 && !seen.has(stem)) {
      seen.add(stem);
      stems.push({ raw: w, stem });
    }
  }
  return stems;
}

/**
 * Оценка лексического пересечения (доля терминов вопроса, найденных в тексте)
 */
function computeLexicalOverlap(queryTerms, text) {
  if (!queryTerms || queryTerms.length === 0 || !text) return 0;
  const textLower = String(text).toLowerCase().replace(/ё/g, 'е');
  let hits = 0;
  for (const t of queryTerms) {
    if (textLower.includes(t.raw) || (t.stem.length >= 3 && textLower.includes(t.stem))) {
      hits++;
    }
  }
  return hits / queryTerms.length;
}

/**
 * Безопасная HTML-подсветка ключевых слов вопроса в фрагменте текста (защита от Stored XSS)
 */
function buildHighlightedSnippet(rawText, queryTerms, maxLen = 280) {
  if (!rawText) return '';
  let text = String(rawText).replace(/\s+/g, ' ').trim();

  // Центрируем окно сниппета вокруг первого найденного термина вопроса
  if (text.length > maxLen && queryTerms.length > 0) {
    const lower = text.toLowerCase().replace(/ё/g, 'е');
    let bestPos = -1;
    for (const t of queryTerms) {
      const idx = lower.indexOf(t.stem.length >= 3 ? t.stem : t.raw);
      if (idx !== -1 && (bestPos === -1 || idx < bestPos)) {
        bestPos = idx;
      }
    }
    if (bestPos > 60) {
      const start = Math.max(0, bestPos - 70);
      const end = Math.min(text.length, start + maxLen);
      text = (start > 0 ? '... ' : '') + text.slice(start, end).trim() + (end < text.length ? ' ...' : '');
    } else {
      text = text.slice(0, maxLen).trim() + ' ...';
    }
  } else if (text.length > maxLen) {
    text = text.slice(0, maxLen).trim() + ' ...';
  }

  // Сначала полностью экранируем HTML — защита от Stored XSS
  let safeHtml = escapeHtml(text);

  // Затем аккуратно оборачиваем совпавшие слова в <mark>
  const highlightTokens = queryTerms
    .map(t => t.stem.length >= 3 ? t.stem : t.raw)
    .filter(tok => tok.length >= 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);

  if (highlightTokens.length > 0) {
    const escapedPatterns = highlightTokens.map(tok => tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`([a-zA-Zа-яА-ЯёЁ0-9_-]*(?:${escapedPatterns.join('|')})[a-zA-Zа-яА-ЯёЁ0-9_-]*)`, 'gi');
    safeHtml = safeHtml.replace(regex, '<mark>$1</mark>');
  }

  return safeHtml;
}

/**
 * Построение безопасного OR-tsquery из значимых терминов вопроса для Russian FTS
 */
function buildOrTsQueryText(queryTerms) {
  const safeWords = queryTerms
    .map(t => t.raw.replace(/[^a-zа-я0-9]/gi, ''))
    .filter(w => w.length >= 2)
    .slice(0, 12);
  if (safeWords.length === 0) return '';
  return safeWords.join(' | ');
}

/**
 * Формирование безопасных URL для открытия/скачивания источника
 */
function buildSourceUrls(row) {
  if (row.source_type === 'document') {
    return {
      openUrl: `/editor.html?id=${row.source_id}`,
      downloadUrl: `/api/documents/download/${row.source_id}`,
      actionType: 'open_document'
    };
  }
  if (row.source_type === 'project_material') {
    return {
      openUrl: `#materials`,
      downloadUrl: `/api/materials/download/${row.source_id}`,
      actionType: 'download_material'
    };
  }
  if (row.source_type === 'mail_attachment') {
    return {
      openUrl: `#mail`,
      downloadUrl: `/api/mail/attachments/${row.source_id}/download`,
      actionType: 'download_mail_attachment'
    };
  }
  return { openUrl: '#search', downloadUrl: null, actionType: 'open_search' };
}

/**
 * ЕДИНЫЙ ГИБРИДНЫЙ ПОИСК ПО ВСЕЙ БАЗЕ ЗНАНИЙ (Документы + Материалы + Вложения почты)
 * со строгим Pre-Filter ACL и pgvector HNSW + FTS + pg_trgm + Fallback Nearest Neighbor.
 */
async function searchKnowledge(rawQuery, user, options = {}) {
  const cleanQuery = String(rawQuery || '').trim();
  if (!cleanQuery) {
    return {
      query: '',
      items: [],
      topChunks: [],
      isFallbackNearest: false,
      confidence: 'none',
      totalAccessibleSources: 0
    };
  }

  const limit = Math.min(Math.max(parseInt(options.limit || '12', 10), 1), 50);
  const category = (options.category || '').trim();
  const requestedTypes = Array.isArray(options.sourceTypes) && options.sourceTypes.length > 0
    ? options.sourceTypes
    : ['document', 'project_material', 'mail_attachment'];

  const isAdmin = user.role === 'ADMIN' || user.role_code === 'admin';
  const userId = parseInt(user.id, 10);
  const subordinateIds = !isAdmin ? await getSubordinateUserIds(userId) : [];
  const allowedOwnerIds = !isAdmin ? [userId, ...subordinateIds] : [];

  const queryTerms = extractQueryTerms(cleanQuery);
  const orTsQuery = buildOrTsQueryText(queryTerms);

  // Генерация 384-dim ONNX эмбеддинга вопроса с префиксом "query: "
  const queryVector = await embedText(cleanQuery, 'query');
  const queryVecStr = toPgVector(queryVector);

  // Параметры:
  // $1 = userId (int)
  // $2 = allowedOwnerIds (int[])
  // $3 = isAdmin (boolean)
  // $4 = requestedTypes (text[])
  // $5 = category (text, '' если без фильтра)
  // $6 = queryVecStr (text -> vector(384))
  // $7 = cleanQuery (text)
  // $8 = orTsQuery (text)
  const catFilter = (category && category !== 'all' && category !== 'ALL' && category !== 'Все документы') ? category : '';

  const allowedCteSql = `
    WITH allowed_sources AS (
      -- 1. Документы (RBAC + иерархия + document_permissions + is_public)
      SELECT
        'document'::varchar AS source_type,
        d.id AS source_id,
        d.title AS src_title,
        d.file_name,
        d.file_type,
        d.file_size,
        COALESCE(d.category, 'Общие') AS category,
        COALESCE(d.is_public, FALSE) AS is_public,
        d.created_by AS owner_id,
        COALESCE(u.full_name, 'Не указан') AS author_name,
        d.updated_at AS updated_at,
        NULL::int AS project_id,
        NULL::varchar AS project_title,
        NULL::int AS mail_id,
        NULL::varchar AS mail_subject
      FROM documents d
      LEFT JOIN users u ON d.created_by = u.id
      WHERE 'document' = ANY($4::text[])
        AND ($5 = '' OR d.category = $5)
        AND (
          $3::boolean = TRUE
          OR d.created_by = ANY($2::int[])
          OR d.is_public = TRUE
          OR EXISTS (
            SELECT 1 FROM document_permissions dp
            WHERE dp.document_id = d.id AND dp.user_id = $1
          )
        )

      UNION ALL

      -- 2. Материалы проектов (Админ, автор материала или участник проекта/руководитель)
      SELECT
        'project_material'::varchar AS source_type,
        pm.id AS source_id,
        pm.title AS src_title,
        pm.file_name,
        pm.file_type,
        COALESCE(pm.file_size, 0) AS file_size,
        COALESCE(dir.name, pm.material_type, 'Материалы') AS category,
        FALSE AS is_public,
        pm.author_id AS owner_id,
        COALESCE(u.full_name, 'Не указан') AS author_name,
        COALESCE(pm.updated_at, pm.created_at) AS updated_at,
        pm.project_id,
        p.title AS project_title,
        NULL::int AS mail_id,
        NULL::varchar AS mail_subject
      FROM project_materials pm
      LEFT JOIN projects p ON pm.project_id = p.id
      LEFT JOIN directions dir ON dir.id = COALESCE(pm.direction_id, p.direction_id)
      LEFT JOIN users u ON pm.author_id = u.id
      WHERE 'project_material' = ANY($4::text[])
        AND ($5 = '' OR dir.name = $5 OR pm.material_type = $5)
        AND (
          $3::boolean = TRUE
          OR pm.author_id = ANY($2::int[])
          OR EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.project_id = pm.project_id
              AND (t.assignee_id = ANY($2::int[]) OR t.creator_id = ANY($2::int[]))
          )
        )

      UNION ALL

      -- 3. Вложения почты (СТРОГО личный ящик текущего пользователя user_id = $1)
      SELECT
        'mail_attachment'::varchar AS source_type,
        ma.id AS source_id,
        (ma.file_name || ' — ' || COALESCE(mm.subject, 'Без темы'))::varchar AS src_title,
        ma.file_name,
        COALESCE(NULLIF(regexp_replace(lower(ma.file_name), '^.*\\.', ''), lower(ma.file_name)), ma.file_type, 'file') AS file_type,
        COALESCE(ma.file_size, 0) AS file_size,
        'Почта'::varchar AS category,
        FALSE AS is_public,
        mm.user_id AS owner_id,
        COALESCE(mm.sender_name, mm.sender_email, 'Почта') AS author_name,
        COALESCE(mm.created_at, ma.created_at) AS updated_at,
        NULL::int AS project_id,
        NULL::varchar AS project_title,
        mm.id AS mail_id,
        mm.subject AS mail_subject
      FROM mail_attachments ma
      JOIN mail_messages mm ON ma.mail_id = mm.id
      WHERE 'mail_attachment' = ANY($4::text[])
        AND ($5 = '' OR $5 = 'Почта')
        AND mm.user_id = $1
    ),
    vec_hits AS (
      SELECT
        kc.id AS chunk_id,
        (1.0 - (kc.embedding <=> $6::vector(384)))::float8 AS vec_score,
        ROW_NUMBER() OVER (ORDER BY kc.embedding <=> $6::vector(384) ASC) AS vec_rank
      FROM knowledge_chunks kc
      JOIN allowed_sources als
        ON als.source_type = kc.source_type AND als.source_id = kc.source_id
      WHERE kc.embedding IS NOT NULL
      ORDER BY kc.embedding <=> $6::vector(384) ASC
      LIMIT 40
    ),
    fts_hits AS (
      SELECT
        kc.id AS chunk_id,
        (
          COALESCE(ts_rank_cd(kc.tsv, plainto_tsquery('russian', $7)), 0) * 2.5 +
          CASE WHEN $8 != '' THEN COALESCE(ts_rank(kc.tsv, to_tsquery('russian', $8)), 0) ELSE 0 END
        )::float8 AS fts_score,
        ROW_NUMBER() OVER (
          ORDER BY (
            COALESCE(ts_rank_cd(kc.tsv, plainto_tsquery('russian', $7)), 0) * 2.5 +
            CASE WHEN $8 != '' THEN COALESCE(ts_rank(kc.tsv, to_tsquery('russian', $8)), 0) ELSE 0 END
          ) DESC
        ) AS fts_rank
      FROM knowledge_chunks kc
      JOIN allowed_sources als
        ON als.source_type = kc.source_type AND als.source_id = kc.source_id
      WHERE (
        kc.tsv @@ plainto_tsquery('russian', $7)
        OR ($8 != '' AND kc.tsv @@ to_tsquery('russian', $8))
      )
      LIMIT 40
    ),
    trgm_hits AS (
      SELECT
        kc.id AS chunk_id,
        GREATEST(
          COALESCE(word_similarity($7, kc.title), 0),
          COALESCE(word_similarity($7, kc.content), 0)
        )::float8 AS trgm_score,
        ROW_NUMBER() OVER (
          ORDER BY GREATEST(
            COALESCE(word_similarity($7, kc.title), 0),
            COALESCE(word_similarity($7, kc.content), 0)
          ) DESC
        ) AS trgm_rank
      FROM knowledge_chunks kc
      JOIN allowed_sources als
        ON als.source_type = kc.source_type AND als.source_id = kc.source_id
      WHERE word_similarity($7, kc.title) > 0.25
         OR word_similarity($7, kc.content) > 0.25
      LIMIT 30
    ),
    candidate_ids AS (
      SELECT chunk_id FROM vec_hits
      UNION
      SELECT chunk_id FROM fts_hits
      UNION
      SELECT chunk_id FROM trgm_hits
    )
    SELECT
      kc.id AS chunk_id,
      kc.source_type,
      kc.source_id,
      kc.chunk_index,
      kc.title AS chunk_title,
      kc.section_label,
      kc.content,
      kc.contextual_content,
      kc.metadata,
      als.src_title AS title,
      als.file_name,
      als.file_type,
      als.file_size,
      als.category,
      als.is_public,
      als.owner_id,
      als.author_name,
      als.updated_at,
      als.project_id,
      als.project_title,
      als.mail_id,
      als.mail_subject,
      COALESCE(v.vec_score, CASE WHEN kc.embedding IS NOT NULL THEN (1.0 - (kc.embedding <=> $6::vector(384)))::float8 ELSE 0.0 END) AS vec_score,
      v.vec_rank,
      COALESCE(f.fts_score, 0.0) AS fts_score,
      f.fts_rank,
      COALESCE(tg.trgm_score, 0.0) AS trgm_score,
      tg.trgm_rank
    FROM candidate_ids c
    JOIN knowledge_chunks kc ON kc.id = c.chunk_id
    JOIN allowed_sources als ON als.source_type = kc.source_type AND als.source_id = kc.source_id
    LEFT JOIN vec_hits v ON v.chunk_id = c.chunk_id
    LEFT JOIN fts_hits f ON f.chunk_id = c.chunk_id
    LEFT JOIN trgm_hits tg ON tg.chunk_id = c.chunk_id
  `;

  const params = [
    userId,
    allowedOwnerIds,
    isAdmin,
    requestedTypes,
    catFilter,
    queryVecStr,
    cleanQuery,
    orTsQuery
  ];

  let rows = [];
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // Включаем iterative_scan pgvector 0.8+ чтобы HNSW с RBAC-фильтром никогда не возвращал недозаполненный топ
    await client.query("SET LOCAL hnsw.iterative_scan = 'strict_order'").catch(() => {});
    await client.query("SET LOCAL hnsw.ef_search = 80").catch(() => {});
    const res = await client.query(allowedCteSql, params);
    rows = res.rows;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[RagService] Hybrid SQL error:', err.message);
    throw err;
  } finally {
    client.release();
  }

  // Если база знаний пуста или не нашлось вообще чанков — возвращаем пустой ответ
  if (rows.length === 0) {
    return {
      query: cleanQuery,
      queryVector,
      queryTerms,
      items: [],
      topChunks: [],
      isFallbackNearest: false,
      confidence: 'none'
    };
  }

  // Взвешенный RRF + оценка уверенности каждого чанка
  const RRF_K = 45;
  const scoredChunks = rows.map(row => {
    const vecScore = Number(row.vec_score || 0);
    const ftsScore = Number(row.fts_score || 0);
    const trgmScore = Number(row.trgm_score || 0);
    const isTitleOnly = Boolean(row.metadata && row.metadata.is_title_only);
    const lexOverlap = computeLexicalOverlap(queryTerms, `${row.title} ${row.content}`);
    const titleOverlap = computeLexicalOverlap(queryTerms, row.title);

    let rrf = 0;
    if (row.vec_rank) rrf += 1.45 / (RRF_K + Number(row.vec_rank));
    if (row.fts_rank) rrf += 1.30 / (RRF_K + Number(row.fts_rank));
    if (row.trgm_rank) rrf += 0.75 / (RRF_K + Number(row.trgm_rank));

    // Учитываем абсолютное косинусное сходство (критично для отделения реального совпадения от далёкого соседа)
    const absSemanticBoost = Math.max(0, vecScore - 0.72) * 0.28;
    const exactLexBoost = (lexOverlap >= 0.5 ? 0.025 : 0) + (titleOverlap >= 0.5 ? 0.015 : 0);
    // Лёгкий штраф для пустых метаданных без текста, если есть полноценные документы с текстом
    const emptyPenalty = isTitleOnly && lexOverlap < 0.4 ? -0.012 : 0;

    const totalScore = rrf + absSemanticBoost + exactLexBoost + emptyPenalty;

    const hasLexicalHit = ftsScore > 0 || trgmScore >= TRGM_MATCH_THRESHOLD || lexOverlap >= 0.34;
    const hasHighSemanticHit = vecScore >= HIGH_VEC_THRESHOLD;
    const hasMediumSemanticHit = vecScore >= MEDIUM_VEC_THRESHOLD && (!isTitleOnly || titleOverlap >= 0.25);

    const isConfident = hasLexicalHit || hasHighSemanticHit || hasMediumSemanticHit;

    let matchType = 'nearest';
    if (hasLexicalHit && (hasHighSemanticHit || hasMediumSemanticHit)) {
      matchType = 'hybrid';
    } else if (hasLexicalHit) {
      matchType = 'keyword';
    } else if (hasHighSemanticHit || hasMediumSemanticHit) {
      matchType = 'semantic';
    }

    return {
      ...row,
      vecScore,
      ftsScore,
      trgmScore,
      lexOverlap,
      isTitleOnly,
      isConfident,
      matchType,
      totalScore
    };
  });

  scoredChunks.sort((a, b) => b.totalScore - a.totalScore);

  const confidentChunks = scoredChunks.filter(c => c.isConfident);
  const isFallbackNearest = confidentChunks.length === 0;

  // Если точных/уверенных совпадений нет — берём ближайшие по смыслу варианты из pgvector (требование пользователя!)
  const workingChunks = isFallbackNearest
    ? [...scoredChunks].sort((a, b) => b.vecScore - a.vecScore).slice(0, Math.min(limit, 5))
    : confidentChunks;

  // Дедупликация по источнику (берём лучший чанк на каждый source_type:source_id — фикс бага RRF из аудита!)
  const sourceMap = new Map();
  for (const ch of workingChunks) {
    const key = `${ch.source_type}:${ch.source_id}`;
    if (!sourceMap.has(key)) {
      const urls = buildSourceUrls(ch);
      const srcInfo = SOURCE_META[ch.source_type] || SOURCE_META.document;
      let snippetHtml = buildHighlightedSnippet(ch.content, queryTerms, 260);
      if (ch.isTitleOnly) {
        snippetHtml = `${snippetHtml} <span style="opacity: 0.65; font-size: 11px;">(📷 скан/поиск по названию)</span>`;
      }
      sourceMap.set(key, {
        id: ch.source_id,
        source_type: ch.source_type,
        source_label: srcInfo.label,
        source_icon: srcInfo.icon,
        title: ch.title,
        file_name: ch.file_name,
        file_type: ch.file_type,
        file_size: ch.file_size,
        category: ch.category || 'Общие',
        is_public: Boolean(ch.is_public),
        author_name: ch.author_name || 'Не указан',
        updated_at: ch.updated_at,
        project_id: ch.project_id,
        project_title: ch.project_title,
        mail_id: ch.mail_id,
        mail_subject: ch.mail_subject,
        section: ch.section_label || '',
        snippet: snippetHtml,
        rawChunkContent: ch.content,
        similarity: Number(ch.vecScore.toFixed(4)),
        score: Number(ch.totalScore.toFixed(5)),
        matchType: isFallbackNearest ? 'nearest' : ch.matchType,
        isNearestFallback: isFallbackNearest,
        openUrl: urls.openUrl,
        downloadUrl: urls.downloadUrl,
        actionType: urls.actionType
      });
    }
  }

  const items = Array.from(sourceMap.values()).slice(0, limit);

  // Топ чанков для Extractive QA (максимум 2 чанка с одного источника для разнообразия контекста)
  const topChunks = [];
  const perSourceCount = new Map();
  for (const ch of workingChunks) {
    const key = `${ch.source_type}:${ch.source_id}`;
    const cnt = perSourceCount.get(key) || 0;
    if (cnt >= 2) continue;
    perSourceCount.set(key, cnt + 1);
    topChunks.push(ch);
    if (topChunks.length >= 6) break;
  }

  let confidence = 'fallback_nearest';
  if (!isFallbackNearest) {
    const best = workingChunks[0];
    if (best.vecScore >= HIGH_VEC_THRESHOLD || best.ftsScore > 0.1 || best.lexOverlap >= 0.5) {
      confidence = 'high';
    } else {
      confidence = 'medium';
    }
  }

  return {
    query: cleanQuery,
    queryVector,
    queryTerms,
    items,
    topChunks,
    isFallbackNearest,
    confidence
  };
}

/**
 * АВТОНОМНЫЙ EXTRACTIVE QA (без LLM-ключа):
 * Находит самые точные предложения-ответы в Top-чанках через пакетный ONNX scoring + фактографический буст.
 * Если совпадений нет — честно и наглядно показывает ближайший вариант по смыслу.
 */
async function answerQuestion(question, user, options = {}) {
  const searchRes = await searchKnowledge(question, user, {
    limit: options.limit || 6,
    sourceTypes: options.sourceTypes
  });

  const { queryVector, queryTerms, topChunks, items, isFallbackNearest, confidence } = searchRes;

  if (!items || items.length === 0) {
    return {
      answer: '📂 В доступной вам базе знаний (документы, материалы проектов и вложения почты) пока нет проиндексированных файлов. Загрузите документ или запустите индексацию.',
      mode: 'rag_empty',
      confidence: 'none',
      isFallbackNearest: false,
      sources: [],
      suggestedAction: {
        type: 'open_documents',
        label: '📄 Перейти в хранилище документов'
      }
    };
  }

  // Детекция целевого аспекта вопроса для точного Extractive QA
  const qLower = question.toLowerCase();
  const asksPenalty = /штраф|неустойк|пен[яи]|просроч|задержк|санкц|ответственност/i.test(qLower);
  const asksMoney = /сумм|стоимост|цен[ауеы]|бюджет|сколько стоит|аванс|предоплат|суточн|оклад|размер.*выплат/i.test(qLower);
  const asksTime = /срок|когда|дата|график|периодич|как часто|расписан/i.test(qLower);
  const asksPersonOrOrg = /кто|ответствен|руководител|директор|подпис|контрагент|поставщик|заказчик|исполнител|автор/i.test(qLower);

  // Собираем предложения-кандидаты из лучших 4 чанков (исключая чистые заголовки разделов без фактов)
  const candidateSentences = [];
  const candidateChunks = topChunks.slice(0, 4);

  for (const ch of candidateChunks) {
    const sents = splitIntoSentences(ch.content).filter(s => {
      // Отбрасываем короткие строки-заголовки вроде "1. Предмет договора", если в чанке есть нормальные предложения
      return !(s.length < 65 && /^(\d+\.|раздел|глава|статья)\s+/i.test(s) && !/[.!?]$/.test(s));
    });
    if (sents.length === 0 && ch.content) {
      candidateSentences.push({
        text: ch.content.slice(0, 320),
        chunk: ch,
        sentIdx: 0,
        allSents: [ch.content.slice(0, 320)]
      });
    } else {
      sents.slice(0, 10).forEach((s, idx) => {
        candidateSentences.push({
          text: s,
          chunk: ch,
          sentIdx: idx,
          allSents: sents
        });
      });
    }
    if (candidateSentences.length >= 24) break;
  }

  // Пакетный ONNX скоринг предложений-кандидатов (~30-60 мс на CPU!)
  let bestQuotes = [];
  if (candidateSentences.length > 0 && queryVector) {
    // Передаём в ONNX контекст раздела + предложение, чтобы местоимения и контекст темы считывались точнее
    const sentInputsForOnnx = candidateSentences.map(c =>
      c.chunk.section_label ? `${c.chunk.section_label}. ${c.text}` : c.text
    );
    const sentVecs = await embedBatch(sentInputsForOnnx, 'passage', 12);

    const scoredSents = candidateSentences.map((c, idx) => {
      const semSim = cosineSimilarity(queryVector, sentVecs[idx]);
      // Нормализуем E5 cosine similarity из рабочего диапазона [0.72..0.92] в [0..1],
      // чтобы семантика нейросети доминировала над случайным совпадением одного слова
      const semNorm = Math.max(0, Math.min(1.2, (semSim - 0.72) / 0.20));
      const chunkNorm = Math.max(0, Math.min(1.2, (c.chunk.vecScore - 0.72) / 0.20));
      const lex = computeLexicalOverlap(queryTerms, c.text);

      let aspectBoost = 0;
      if (asksPenalty && /(неустойк|штраф|пен[яию]|просрочк|санкц|ответствен|%\s*от|процент)/i.test(c.text)) {
        aspectBoost += 0.14;
      }
      if (asksMoney && /(\d+[\s.,]?\d*\s*(руб|₽|тыс|млн|%)|аванс|предоплат|стоимост|суточн|сумм)/i.test(c.text)) {
        aspectBoost += 0.10;
      }
      if (asksTime && /(\d+\s*(раб|календар|банков)?\s*(дн|день|час|недел|месяц|год)|кажд\w+\s+\d+|20\d{2}|\d{2}\.\d{2}\.\d{4}|по\s+(понедельн|вторник|сред|четверг|пятниц))/i.test(c.text)) {
        aspectBoost += 0.10;
      }
      if (asksPersonOrOrg && /(ООО|ПАО|АО|ИП|[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+|директор|руководител|менеджер|инженер)/i.test(c.text)) {
        aspectBoost += 0.08;
      }

      const finalScore = semNorm * 0.65 + chunkNorm * 0.20 + lex * 0.15 + aspectBoost;
      return { ...c, semSim, lex, finalScore };
    });

    scoredSents.sort((a, b) => b.finalScore - a.finalScore);

    // Берём до 3 лучших неповторяющихся цитат (макс. 2 из одного источника)
    const usedSources = new Map();
    const usedTexts = new Set();

    for (const s of scoredSents) {
      const srcKey = `${s.chunk.source_type}:${s.chunk.source_id}`;
      if ((usedSources.get(srcKey) || 0) >= 2) continue;
      const normKey = s.text.toLowerCase().slice(0, 70);
      if (usedTexts.has(normKey)) continue;

      // Если предложение короткое (<90 симв.), добавляем следующее соседнее предложение для полноты ответа
      let quoteText = s.text;
      if (quoteText.length < 90 && s.sentIdx + 1 < s.allSents.length) {
        quoteText = `${quoteText} ${s.allSents[s.sentIdx + 1]}`;
      }
      if (quoteText.length > 420) {
        quoteText = quoteText.slice(0, 417).trim() + '...';
      }

      usedSources.set(srcKey, (usedSources.get(srcKey) || 0) + 1);
      usedTexts.add(normKey);
      bestQuotes.push({
        text: quoteText,
        semSim: s.semSim,
        chunk: s.chunk
      });

      if (bestQuotes.length >= (isFallbackNearest ? 2 : 3)) break;
    }
  }

  // Формируем список источников с нумерацией [1], [2], [3]
  const sourceIndexMap = new Map();
  const sources = [];

  const registerSource = (ch, quoteExcerpt) => {
    const key = `${ch.source_type}:${ch.source_id}`;
    if (sourceIndexMap.has(key)) {
      return sourceIndexMap.get(key);
    }
    const idx = sources.length + 1;
    const urls = buildSourceUrls(ch);
    const meta = SOURCE_META[ch.source_type] || SOURCE_META.document;
    const simPercent = Math.round(Math.max(0, Math.min(1, ch.vecScore)) * 100);

    sources.push({
      index: idx,
      source_type: ch.source_type,
      source_label: meta.label,
      source_icon: meta.icon,
      source_id: ch.source_id,
      title: ch.title,
      section: ch.section_label || '',
      category: ch.category || '',
      project_title: ch.project_title || '',
      mail_subject: ch.mail_subject || '',
      author_name: ch.author_name || '',
      excerpt: quoteExcerpt || ch.content.slice(0, 220),
      similarity: Number(ch.vecScore.toFixed(4)),
      similarityPercent: simPercent,
      matchType: isFallbackNearest ? 'nearest' : ch.matchType,
      openUrl: urls.openUrl,
      downloadUrl: urls.downloadUrl,
      actionType: urls.actionType
    });
    sourceIndexMap.set(key, idx);
    return idx;
  };

  let answerLines = [];

  if (isFallbackNearest) {
    // РЕЖИМ «ЕСЛИ НЕ НАЙДЕНО СОВПАДЕНИЙ — ПОКАЗАТЬ БЛИЖАЙШИЙ ВАРИАНТ»
    answerLines.push('🔎 **Точных совпадений в базе знаний не найдено.**');
    answerLines.push('Показываю **наиболее близкий вариант** по смыслу среди доступных вам файлов:\n');

    const topNearest = bestQuotes.length > 0 ? bestQuotes : topChunks.slice(0, 2).map(ch => ({
      text: ch.content.slice(0, 260),
      semSim: ch.vecScore,
      chunk: ch
    }));

    topNearest.forEach((q) => {
      const srcIdx = registerSource(q.chunk, q.text);
      const srcMeta = SOURCE_META[q.chunk.source_type] || SOURCE_META.document;
      const sectionStr = q.chunk.section_label ? ` (${q.chunk.section_label})` : '';
      const pct = Math.round(Math.max(0, Math.min(1, q.chunk.vecScore)) * 100);
      answerLines.push(`[${srcIdx}] ${srcMeta.icon} **${q.chunk.title}**${sectionStr} — близость ~${pct}%:`);
      answerLines.push(`«${q.text}»\n`);
    });

    answerLines.push('💡 *Попробуйте уточнить ключевые слова или проверьте, загружен ли нужный файл в Документы, Материалы проектов или Почту.*');
  } else {
    // УВЕРЕННЫЙ ОТВЕТ (EXTRACTIVE QA ПО ЦИТАТАМ)
    const headerIcon = confidence === 'high' ? '✨' : '📑';
    answerLines.push(`${headerIcon} **Найден ответ по содержимому базы знаний:**\n`);

    bestQuotes.forEach((q) => {
      const srcIdx = registerSource(q.chunk, q.text);
      const srcMeta = SOURCE_META[q.chunk.source_type] || SOURCE_META.document;
      const sectionStr = q.chunk.section_label ? ` • ${q.chunk.section_label}` : '';
      answerLines.push(`• «${q.text}»`);
      answerLines.push(`  — **[${srcIdx}] ${srcMeta.icon} ${q.chunk.title}**${sectionStr}\n`);
    });

    // Добавляем дополнительные релевантные документы, если их больше, чем вошло в цитаты
    for (const item of items.slice(0, 4)) {
      const key = `${item.source_type}:${item.id}`;
      if (!sourceIndexMap.has(key) && sources.length < 4) {
        const fakeChunk = {
          source_type: item.source_type,
          source_id: item.id,
          title: item.title,
          section_label: item.section,
          category: item.category,
          project_title: item.project_title,
          mail_subject: item.mail_subject,
          author_name: item.author_name,
          content: item.rawChunkContent || '',
          vecScore: item.similarity,
          matchType: item.matchType
        };
        registerSource(fakeChunk, (item.rawChunkContent || '').slice(0, 200));
      }
    }
  }

  const primarySource = sources[0] || null;
  let suggestedAction = null;
  if (primarySource) {
    if (primarySource.source_type === 'document') {
      suggestedAction = {
        type: 'open_document',
        label: `📄 Открыть «${primarySource.title.slice(0, 38)}»`,
        doc_id: primarySource.source_id,
        url: primarySource.openUrl
      };
    } else if (primarySource.source_type === 'project_material') {
      suggestedAction = {
        type: 'download_file',
        label: `🧭 Скачать материал «${primarySource.title.slice(0, 34)}»`,
        url: primarySource.downloadUrl
      };
    } else if (primarySource.source_type === 'mail_attachment') {
      suggestedAction = {
        type: 'download_file',
        label: `📧 Скачать вложение «${primarySource.title.slice(0, 34)}»`,
        url: primarySource.downloadUrl
      };
    }
  }

  return {
    answer: answerLines.join('\n').trim(),
    mode: isFallbackNearest ? 'rag_nearest_fallback' : 'rag_extractive',
    confidence,
    isFallbackNearest,
    sources,
    suggestedAction
  };
}

module.exports = {
  searchKnowledge,
  answerQuestion,
  extractQueryTerms,
  buildHighlightedSnippet,
  HIGH_VEC_THRESHOLD,
  MEDIUM_VEC_THRESHOLD
};
