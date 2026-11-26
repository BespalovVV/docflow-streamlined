// backend/utils/text_extractor.js
// Асинхронный высокоточный извлекатель текста с сохранением структуры (DOCX, XLSX, PPTX, PDF, TXT, MD, CSV, HTML, RTF)

const fs = require('fs');
const path = require('path');

let mammoth = null;
let ExcelJS = null;
let pdfParse = null;
let AdmZip = null;

try { mammoth = require('mammoth'); } catch (e) {}
try { ExcelJS = require('exceljs'); } catch (e) {}
try { pdfParse = require('pdf-parse'); } catch (e) {}
try { AdmZip = require('adm-zip'); } catch (e) {}

const decUtf8Strict = new TextDecoder('utf-8', { fatal: true });
const dec1251 = new TextDecoder('windows-1251');

function decodeXmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function normalizeExtractedText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 1. DOCX — mammoth (корректный ZIP Central Directory + таблицы + абзацы + XML-сущности) с fallback на AdmZip
async function extractFromDocx(buffer) {
  if (mammoth) {
    try {
      const res = await mammoth.extractRawText({ buffer });
      const clean = normalizeExtractedText(res.value || '');
      if (clean) {
        return { text: clean, sections: null, isScanned: false };
      }
    } catch (err) {
      console.warn('[TextExtractor] mammoth warning, trying AdmZip fallback:', err.message);
    }
  }

  if (AdmZip) {
    try {
      const zip = new AdmZip(buffer);
      const xmlEntries = zip.getEntries().filter(e =>
        /^word\/(document|header\d*|footer\d*|footnotes|comments)\.xml$/i.test(e.entryName)
      );
      const paragraphs = [];
      for (const entry of xmlEntries) {
        const xml = entry.getData().toString('utf8');
        const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
        let pMatch;
        while ((pMatch = pRegex.exec(xml)) !== null) {
          const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi;
          const pieces = [];
          let tMatch;
          while ((tMatch = tRegex.exec(pMatch[1])) !== null) {
            pieces.push(decodeXmlEntities(tMatch[1]));
          }
          const line = pieces.join('').trim();
          if (line) paragraphs.push(line);
        }
      }
      const text = normalizeExtractedText(paragraphs.join('\n\n'));
      return { text, sections: null, isScanned: false };
    } catch (e) {
      console.warn('[TextExtractor] DOCX AdmZip fallback error:', e.message);
    }
  }

  return { text: '', sections: null, isScanned: false };
}

// 2. XLSX / XLS — ExcelJS: сохраняет все листы, числа, даты, формулы и привязку "Заголовок: Значение"
function formatCellValue(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if (val instanceof Date) {
      return val.toLocaleDateString('ru-RU');
    }
    if (val.result !== undefined && val.result !== null) {
      return formatCellValue(val.result);
    }
    if (Array.isArray(val.richText)) {
      return val.richText.map(rt => rt.text || '').join('');
    }
    if (val.text !== undefined) {
      return String(val.text);
    }
    if (val.hyperlink) {
      return val.text || val.hyperlink;
    }
    return '';
  }
  return String(val).trim();
}

async function extractFromXlsx(buffer) {
  if (ExcelJS) {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sections = [];
      const fullParts = [];

      workbook.eachSheet((worksheet) => {
        const sheetName = worksheet.name || 'Лист';
        const rows = [];
        let headers = null;

        worksheet.eachRow({ includeEmpty: false }, (row) => {
          const vals = [];
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            vals[colNumber - 1] = formatCellValue(cell.value);
          });
          // Очищаем хвостовые пустые ячейки
          while (vals.length > 0 && !vals[vals.length - 1]) vals.pop();
          const nonEmpty = vals.filter(Boolean);
          if (nonEmpty.length === 0) return;

          if (!headers && nonEmpty.length >= 2 && nonEmpty.every(v => v.length < 80 && isNaN(Number(v.replace(/\s+/g, ''))))) {
            headers = vals.map(v => v || '');
            rows.push(nonEmpty.join(' | '));
          } else if (headers) {
            const pairs = [];
            for (let i = 0; i < vals.length; i++) {
              const v = vals[i];
              if (!v) continue;
              const h = headers[i];
              pairs.push(h ? `${h}: ${v}` : v);
            }
            if (pairs.length > 0) rows.push(pairs.join(' | '));
          } else {
            rows.push(nonEmpty.join(' | '));
          }
        });

        if (rows.length > 0) {
          const sheetText = normalizeExtractedText(rows.join('\n'));
          sections.push({ label: `Лист: ${sheetName}`, text: sheetText });
          fullParts.push(`[Лист: ${sheetName}]\n${sheetText}`);
        }
      });

      return {
        text: normalizeExtractedText(fullParts.join('\n\n')),
        sections: sections.length > 0 ? sections : null,
        isScanned: false
      };
    } catch (err) {
      console.warn('[TextExtractor] ExcelJS warning, trying AdmZip fallback:', err.message);
    }
  }

  // Fallback через AdmZip (sharedStrings.xml)
  if (AdmZip) {
    try {
      const zip = new AdmZip(buffer);
      const entry = zip.getEntry('xl/sharedStrings.xml');
      if (entry) {
        const xml = entry.getData().toString('utf8');
        const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
        const strings = [];
        let m;
        while ((m = tRegex.exec(xml)) !== null) {
          const val = decodeXmlEntities(m[1].replace(/<[^>]+>/g, '')).trim();
          if (val) strings.push(val);
        }
        return { text: normalizeExtractedText(strings.join(' | ')), sections: null, isScanned: false };
      }
    } catch (e) {}
  }

  return { text: '', sections: null, isScanned: false };
}

// 3. PPTX — AdmZip с числовой сортировкой слайдов и декодированием XML
async function extractFromPptx(buffer) {
  if (!AdmZip) return { text: '', sections: null, isScanned: false };
  try {
    const zip = new AdmZip(buffer);
    const slideEntries = zip
      .getEntries()
      .filter(e => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
      .sort((a, b) => {
        const na = parseInt(a.entryName.match(/slide(\d+)\.xml/i)[1], 10);
        const nb = parseInt(b.entryName.match(/slide(\d+)\.xml/i)[1], 10);
        return na - nb;
      });

    const sections = [];
    const fullParts = [];

    for (const entry of slideEntries) {
      const slideNum = entry.entryName.match(/slide(\d+)\.xml/i)[1];
      const xml = entry.getData().toString('utf8');
      const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi;
      const lines = [];
      let pm;
      while ((pm = pRegex.exec(xml)) !== null) {
        const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi;
        const parts = [];
        let tm;
        while ((tm = tRegex.exec(pm[1])) !== null) {
          parts.push(decodeXmlEntities(tm[1]));
        }
        const line = parts.join('').trim();
        if (line) lines.push(line);
      }

      if (lines.length > 0) {
        const slideText = normalizeExtractedText(lines.join('\n'));
        sections.push({ label: `Слайд ${slideNum}`, text: slideText });
        fullParts.push(`[Слайд ${slideNum}]\n${slideText}`);
      }
    }

    return {
      text: normalizeExtractedText(fullParts.join('\n\n')),
      sections: sections.length > 0 ? sections : null,
      isScanned: false
    };
  } catch (err) {
    console.warn('[TextExtractor] PPTX extraction warning:', err.message);
    return { text: '', sections: null, isScanned: false };
  }
}

// 4. PDF — pdf-parse (PDF.js) с постраничным разделением и детекцией сканов
async function extractFromPdf(buffer) {
  if (!pdfParse) return { text: '', sections: null, isScanned: false };
  try {
    const pageTexts = [];
    const options = {
      pagerender: async (pageData) => {
        const textContent = await pageData.getTextContent({
          normalizeWhitespace: false,
          disableCombineTextItems: false
        });
        let lastY = null;
        let text = '';
        for (const item of textContent.items) {
          const y = item.transform ? item.transform[5] : null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
            text += '\n';
          } else if (text && !text.endsWith(' ') && !text.endsWith('\n') && item.str && !item.str.startsWith(' ')) {
            text += ' ';
          }
          text += item.str || '';
          lastY = y;
        }
        const cleanPage = normalizeExtractedText(text);
        pageTexts.push(cleanPage);
        return cleanPage;
      }
    };

    const data = await pdfParse(buffer, options);
    const sections = [];
    const nonEmptyPages = [];
    pageTexts.forEach((pText, idx) => {
      if (pText && pText.length > 0) {
        sections.push({ label: `Стр. ${idx + 1}`, text: pText });
        nonEmptyPages.push(pText);
      }
    });

    const fullText = normalizeExtractedText(nonEmptyPages.length > 0 ? nonEmptyPages.join('\n\n') : (data.text || ''));
    const isScanned = Boolean((data.numpages || 0) > 0 && fullText.length < 25);

    return {
      text: fullText,
      sections: sections.length > 0 ? sections : null,
      isScanned
    };
  } catch (err) {
    console.warn('[TextExtractor] PDF parse warning:', err.message);
    return { text: '', sections: null, isScanned: false };
  }
}

// 5. Plain text, Markdown, CSV, JSON, XML, HTML, RTF
function extractFromPlainText(buffer) {
  try {
    if (!buffer || buffer.length === 0) return '';
    let str = '';
    try {
      str = decUtf8Strict.decode(buffer);
    } catch (e) {
      str = dec1251.decode(buffer);
    }

    // Удаление BOM
    if (str.charCodeAt(0) === 0xFEFF) str = str.slice(1);

    // Очистка HTML/XML тегов при наличии
    if (/<(html|body|div|p|span|table|script|style)\b/i.test(str)) {
      str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
      str = str.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
      str = str.replace(/<\/(p|div|tr|li|h[1-6]|br)>/gi, '\n');
      str = str.replace(/<[^>]+>/g, ' ');
      str = decodeXmlEntities(str);
    }

    // Базовая очистка RTF управляющих слов
    if (str.trim().startsWith('{\\rtf')) {
      str = str
        .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => dec1251.decode(Uint8Array.from([parseInt(hex, 16)])))
        .replace(/\\[a-z]+\d*\s?/gi, ' ')
        .replace(/[{}]/g, ' ');
    }

    return normalizeExtractedText(str);
  } catch (e) {
    return '';
  }
}

/**
 * Основная асинхронная функция извлечения текста из файла.
 * Не блокирует главный Event Loop при чтении с диска.
 */
async function extractTextFromFile(filePath, fileType) {
  if (!filePath) {
    return { text: '', wordCount: 0, sections: null, isScanned: false, error: 'Не указан путь к файлу' };
  }

  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch (e) {
    return { text: '', wordCount: 0, sections: null, isScanned: false, error: 'Файл не найден' };
  }

  try {
    const buffer = await fs.promises.readFile(filePath);
    const ext = (fileType || path.extname(filePath)).replace('.', '').toLowerCase();

    let result = { text: '', sections: null, isScanned: false };

    if (['docx', 'doc'].includes(ext)) {
      result = await extractFromDocx(buffer);
    } else if (['xlsx', 'xls', 'ods'].includes(ext)) {
      result = await extractFromXlsx(buffer);
    } else if (['pptx', 'ppt', 'odp'].includes(ext)) {
      result = await extractFromPptx(buffer);
    } else if (ext === 'pdf') {
      result = await extractFromPdf(buffer);
    } else if (['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'rtf', 'yaml', 'yml', 'sql', 'log'].includes(ext)) {
      result = { text: extractFromPlainText(buffer), sections: null, isScanned: false };
    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'mp3', 'mp4', 'wav', 'zip', 'rar', '7z'].includes(ext)) {
      // Бинарные медиа/архивы не парсим как сырой текст (избегаем бинарного мусора)
      result = { text: '', sections: null, isScanned: true };
    } else {
      result = { text: extractFromPlainText(buffer), sections: null, isScanned: false };
    }

    const cleanText = normalizeExtractedText(result.text || '');
    const wordCount = cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0;

    return {
      text: cleanText,
      wordCount,
      sections: result.sections || null,
      isScanned: Boolean(result.isScanned),
      error: null
    };
  } catch (err) {
    console.error(`[TextExtractor] Error extracting text from ${filePath}:`, err.message);
    return { text: '', wordCount: 0, sections: null, isScanned: false, error: err.message };
  }
}

module.exports = {
  extractTextFromFile,
  extractFromDocx,
  extractFromXlsx,
  extractFromPptx,
  extractFromPlainText,
  extractFromPdf
};
