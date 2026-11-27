const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { fixFilenameEncoding, getExtensionFromMime } = require('../utils/encoding');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Broad Corporate Formats Whitelist & Executable/Active-Content Blacklist
const ALLOWED_EXTENSIONS = new Set([
  // Documents & Office
  '.pdf', '.doc', '.docx', '.docm', '.dotx', '.dotm',
  '.xls', '.xlsx', '.xlsm', '.xltx', '.xltm',
  '.ppt', '.pptx', '.pptm', '.potx', '.potm', '.ppsx',
  '.odt', '.ods', '.odp', '.odg',
  '.rtf', '.txt', '.csv', '.tsv',
  '.md', '.markdown', '.epub', '.djvu', '.xps',
  // Structured data & configs (no HTML/SVG active scripts)
  '.json', '.xml', '.yaml', '.yml', '.sql', '.log',
  // Raster Images & Icons (SVG исключён из-за риска Stored XSS)
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff', '.tif',
  // Audio & Video
  '.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm',
  // Archives & Compressed
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'
]);

const FORBIDDEN_EXTENSIONS = new Set([
  '.exe', '.sh', '.bat', '.cmd', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
  '.php', '.py', '.rb', '.pl', '.vbs', '.vbe', '.ps1', '.psm1',
  '.dll', '.so', '.dylib', '.bin', '.com', '.scr', '.msi', '.jar',
  '.html', '.htm', '.xhtml', '.shtml', '.phtml', '.hta', '.svg', '.svgz'
]);

function secureFileFilter(req, file, cb) {
  const cleanOriginal = fixFilenameEncoding(file.originalname || '');
  let ext = path.extname(cleanOriginal).toLowerCase();
  if (!ext && file.mimetype) {
    ext = getExtensionFromMime(file.mimetype);
  }
  if (!ext || FORBIDDEN_EXTENSIONS.has(ext) || !ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`Загрузка файлов типа "${ext || 'unknown'}" запрещена в целях безопасности.`));
  }
  cb(null, true);
}

// Secure Multer Storage for Document Uploads with Clean UTF-8 Cyrillic & Guaranteed Extension Support
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const cleanOriginal = fixFilenameEncoding(file.originalname || '');
    let ext = path.extname(cleanOriginal).toLowerCase();
    if (!ext && file.mimetype) {
      ext = getExtensionFromMime(file.mimetype);
    }
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) ext = '.txt';
    cb(null, 'doc-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: secureFileFilter
});

// Dedicated Multer for Messenger: Supports Multiple Files simultaneously
const messengerUpload = multer({
  storage: diskStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: secureFileFilter
}).any();

module.exports = {
  UPLOADS_DIR,
  ALLOWED_EXTENSIONS,
  FORBIDDEN_EXTENSIONS,
  secureFileFilter,
  diskStorage,
  upload,
  messengerUpload
};
