// backend/middleware/compression.js
// HTTP-сжатие (gzip/deflate) с безопасным исключением SSE-потоков и бинарных файлов

let expressCompression = null;
try {
  expressCompression = require('compression');
} catch (e) {
  // Будет активно автоматически после установки npm-пакета compression
}

function createCompressionMiddleware() {
  if (!expressCompression) {
    return (req, res, next) => next();
  }

  return expressCompression({
    threshold: 1024,
    level: 6,
    filter: (req, res) => {
      // Никогда не сжимаем и не буферизуем Server-Sent Events (SSE)
      if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
        return false;
      }
      if (req.path && (req.path.includes('/stream') || req.path.startsWith('/onlyoffice'))) {
        return false;
      }
      const ct = String(res.getHeader('Content-Type') || '');
      if (ct.includes('text/event-stream')) {
        return false;
      }
      return expressCompression.filter(req, res);
    }
  });
}

module.exports = { createCompressionMiddleware };
