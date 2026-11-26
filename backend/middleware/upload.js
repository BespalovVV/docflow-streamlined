const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { fixFilenameEncoding, getExtensionFromMime } = require('../utils/encoding');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Broad Corporate Formats Whitelist & Executable Blacklist
const ALLOWED_EXTENSIONS = new Set([
  // Documents & Office
  '.pdf', '.doc', '.docx', '.docm', '.dotx', '.dotm',
  '.xls', '.xlsx', '.xlsm', '.xltx', '.xltm',
  '.ppt', '.pptx', '.pptm', '.potx', '.potm', '.ppsx',
  '.odt', '.ods', '.odp', '.odg',
  '.rtf', '.txt', '.csv', '.tsv',
  '.md', '.markdown', '.epub', '.djvu', '.xps',
  // Structured data & configs
  '.json', '.xml', '.yaml', '.yml', '.sql', '.log',
  // Images & Vector graphics
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif',
  // Audio & Video
  '.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm',
  // Archives & Compressed
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'
]);

const FORBIDDEN_EXTENSIONS = new Set([
  '.exe', '.sh', '.bat', '.cmd', '.js', '.mjs', '.php', '.py', '.vbs', '.dll', '.bin', '.com', '.scr', '.msi'
]);

// Secure Multer Storage for Document Uploads with Clean UTF-8 Cyrillic & Guaranteed Extension Support
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const cleanOriginal = fixFilenameEncoding(file.originalname);
    let ext = path.extname(cleanOriginal).toLowerCase();
    if (!ext && file.mimetype) {
      ext = getExtensionFromMime(file.mimetype);
    }
    if (!ext) ext = '.bin';
    cb(null, 'doc-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    const cleanOriginal = fixFilenameEncoding(file.originalname);
    let ext = path.extname(cleanOriginal).toLowerCase();
    if (!ext && file.mimetype) {
      ext = getExtensionFromMime(file.mimetype);
    }
    if (FORBIDDEN_EXTENSIONS.has(ext)) {
      return cb(new Error(`Загрузка исполняемых файлов "${ext}" запрещена в целях безопасности.`));
    }
    cb(null, true);
  }
});

// Dedicated Multer for Messenger: Supports Multiple Files simultaneously
const messengerUpload = multer({
  storage: diskStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const cleanOriginal = fixFilenameEncoding(file.originalname);
    let ext = path.extname(cleanOriginal).toLowerCase();
    if (!ext && file.mimetype) {
      ext = getExtensionFromMime(file.mimetype);
    }
    if (FORBIDDEN_EXTENSIONS.has(ext)) {
      return cb(new Error(`Загрузка исполняемых файлов "${ext}" запрещена в целях безопасности.`));
    }
    cb(null, true);
  }
}).any();

module.exports = {
  UPLOADS_DIR,
  ALLOWED_EXTENSIONS,
  FORBIDDEN_EXTENSIONS,
  diskStorage,
  upload,
  messengerUpload
};
