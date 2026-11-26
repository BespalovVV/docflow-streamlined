// backend/utils/encoding.js
/**
 * Утилита корректного декодирования кодировок UTF-8 и устранения кракозябр (Mojibake).
 * Возникает когда multipart/form-data (Multer/Busboy) или заголовки декодируются как Windows-1252 / ISO-8859-1 вместо UTF-8.
 */

// Таблица перевода расширенных символов Windows-1252 (коды 0x80 - 0x9F) в исходные байты
const CP1252_TO_BYTE = {
  8364: 0x80, // €
  8218: 0x82, // ‚
  402:  0x83, // ƒ
  8222: 0x84, // „
  8230: 0x85, // …
  8224: 0x86, // †
  8225: 0x87, // ‡
  710:  0x88, // ˆ
  8240: 0x89, // ‰
  352:  0x8A, // Š
  8249: 0x8B, // ‹
  338:  0x8C, // Œ
  381:  0x8E, // Ž
  8216: 0x91, // ‘
  8217: 0x92, // ’
  8220: 0x93, // “
  8221: 0x94, // ”
  8226: 0x95, // •
  8211: 0x96, // –
  8212: 0x97, // —
  732:  0x98, // ˜
  8482: 0x99, // ™
  353:  0x9A, // š
  8250: 0x9B, // ›
  339:  0x9C, // œ
  382:  0x9E, // ž
  376:  0x9F  // Ÿ
};

function fixFilenameEncoding(name) {
  if (!name || typeof name !== 'string') return name;

  // Обработка префикса вложений мессенджера (например: "📎 Ð´Ð¾ÐºÑƒÐ¼ÐµÐ½Ñ‚Ð¸ÐºÑ Ñ‹.docx")
  if (name.startsWith('📎 ')) {
    return '📎 ' + fixFilenameEncoding(name.slice(2).trim());
  }

  // Если в строке уже есть правильные русские символы кириллицы UTF-8 (\u0400-\u04FF),
  // и нет характерных кракозябр (Ð, Ñ), строка уже в порядке.
  if (/[\u0400-\u04FF]/.test(name) && !/[ÐÑ]/.test(name)) {
    return name;
  }

  // Проверка на кракозябры Windows-1252 / latin1 (маркеры Ð, Ñ и др.)
  if (/[ÐÑ]/.test(name)) {
    try {
      const bytes = [];
      let canDecode = true;
      for (let i = 0; i < name.length; i++) {
        const code = name.charCodeAt(i);
        if (code in CP1252_TO_BYTE) {
          bytes.push(CP1252_TO_BYTE[code]);
        } else if (code <= 255) {
          bytes.push(code);
        } else {
          canDecode = false;
          break;
        }
      }
      if (canDecode) {
        const candidate = Buffer.from(bytes).toString('utf8');
        if (candidate && !candidate.includes('\uFFFD') && /[\u0400-\u04FF]/.test(candidate)) {
          return candidate;
        }
      }
    } catch (e) {}
  }

  // Резервный вариант: стандартное latin1 декодирование
  let allLatin1 = true;
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) > 255) {
      allLatin1 = false;
      break;
    }
  }
  if (allLatin1) {
    try {
      const candidate = Buffer.from(name, 'latin1').toString('utf8');
      if (candidate && !candidate.includes('\uFFFD') && /[\u0400-\u04FF]/.test(candidate)) {
        return candidate;
      }
    } catch (e) {}
  }

  return name;
}

const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'text/markdown': '.md',
  'application/rtf': '.rtf',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/x-tar': '.tar',
  'application/gzip': '.gz',
  'application/json': '.json',
  'application/xml': '.xml',
  'text/xml': '.xml'
};

const pathModule = require('path');

function getExtensionFromMime(mime) {
  if (!mime || typeof mime !== 'string') return '';
  const clean = mime.toLowerCase().split(';')[0].trim();
  return MIME_TO_EXT[clean] || '';
}

function ensureFileExtension(filename, fallbackExt = '', mime = '') {
  let name = fixFilenameEncoding(filename || '');
  if (!name) name = 'file';

  const ext = pathModule.extname(name);
  if (ext) return name;

  let extToAdd = fallbackExt ? (fallbackExt.startsWith('.') ? fallbackExt : '.' + fallbackExt) : '';
  if (!extToAdd && mime) {
    extToAdd = getExtensionFromMime(mime);
  }
  if (!extToAdd) extToAdd = '.bin';

  return name + extToAdd.toLowerCase();
}

module.exports = {
  fixFilenameEncoding,
  getExtensionFromMime,
  ensureFileExtension
};
