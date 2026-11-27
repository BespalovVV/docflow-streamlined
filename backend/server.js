require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const storage = require('./storage');
const { authenticateToken, authenticateTokenOptional } = require('./middleware/auth');
const { UPLOADS_DIR } = require('./middleware/upload');
const { createCompressionMiddleware } = require('./middleware/compression');
const {
  onlyofficeProxyMiddleware,
  handleWebSocketUpgrade,
  checkOnlyofficeHealth
} = require('./utils/onlyoffice_proxy');
const { getSubordinateUserIds } = require('./utils/hierarchy');

let serverInstance = null;

// Graceful process shutdown handler
function gracefulShutdown(signal, exitCode = 0) {
  console.log(`[DocFlow Server] Received ${signal}. Starting graceful shutdown...`);
  if (serverInstance) {
    serverInstance.close(async () => {
      console.log('[DocFlow Server] HTTP server closed.');
      try {
        await db.pool.end();
        console.log('[DocFlow Server] Database pool closed.');
      } catch (e) {}
      process.exit(exitCode);
    });
    setTimeout(() => {
      console.error('[DocFlow Server] Forcefully shutting down after timeout');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(exitCode);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM', 0));
process.on('SIGINT', () => gracefulShutdown('SIGINT', 0));
process.on('uncaughtException', (err) => {
  console.error('[DocFlow Server] Uncaught Exception:', err);
  // Do not crash server on recoverable network, socket or stream disconnects
  const ignorableCodes = ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'ERR_STREAM_PREMATURE_CLOSE'];
  if (err && (ignorableCodes.includes(err.code) || err.message?.includes('socket') || err.message?.includes('stream'))) {
    console.warn('[DocFlow Server] Recovered from network/stream socket exception, keeping server alive.');
    return;
  }
  gracefulShutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[DocFlow Server] Unhandled Promise Rejection:', reason);
});

const app = express();
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');

// Core Middleware
app.set('trust proxy', 1);

const allowedOriginsSet = new Set(
  String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);
for (const envUrl of [process.env.SSO_LABSPACE_URL, process.env.ONLYOFFICE_PUBLIC_URL, process.env.APP_PUBLIC_URL]) {
  if (envUrl) {
    try { allowedOriginsSet.add(new URL(envUrl).origin); } catch (e) {}
  }
}

app.use(cors({
  origin: (origin, callback) => {
    // Same-origin / server-to-server / curl without Origin header
    if (!origin) return callback(null, true);
    if (allowedOriginsSet.has(origin)) return callback(null, true);
    if (process.env.NODE_ENV !== 'production') {
      try {
        const u = new URL(origin);
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
          return callback(null, true);
        }
      } catch (e) {}
    }
    return callback(new Error('CORS: источник не разрешён политикой безопасности'), false);
  },
  credentials: true
}));

// ONLYOFFICE reverse proxy must sit BEFORE body parsers to stream raw payloads cleanly
app.use(onlyofficeProxyMiddleware);

// HTTP Gzip/Deflate Compression (excludes SSE streams & ONLYOFFICE)
app.use(createCompressionMiddleware());

// Baseline HTTP Security Headers (Nosniff, SameOrigin frame, XSS protection, CSP)
const onlyofficeCspOrigin = (() => {
  try {
    return process.env.ONLYOFFICE_PUBLIC_URL ? new URL(process.env.ONLYOFFICE_PUBLIC_URL).origin : '';
  } catch (e) { return ''; }
})();
const cspScriptSrc = ["'self'", "'unsafe-inline'", onlyofficeCspOrigin].filter(Boolean).join(' ');
const cspFrameSrc = ["'self'", 'blob:', onlyofficeCspOrigin].filter(Boolean).join(' ');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; script-src ${cspScriptSrc}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-src ${cspFrameSrc}; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`
  );
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.includes(`${path.sep}assets${path.sep}`) || filePath.endsWith('.svg')) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      // JS/CSS имеют query-версионирование (?v=...), но при этом ETag 304 даёт мгновенную ревалидацию
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

const SAFE_INLINE_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico']);

function sendProtectedUpload(res, safePath, filename) {
  const ext = path.extname(filename).toLowerCase();
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!SAFE_INLINE_IMAGE_EXTS.has(ext)) {
    const asciiFallback = path.basename(filename).replace(/[^\x20-\x7E]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiFallback}"`);
  }
  return res.sendFile(safePath);
}

// SECURE PROTECTED UPLOADS HANDLER (RBAC, INDEXED LOOKUP, DEFAULT-DENY & MINIO FALLBACK)
app.get('/uploads/:filename', authenticateTokenOptional, async (req, res) => {
  try {
    const rawFilename = path.basename(req.params.filename);
    const uploadsRoot = path.resolve(UPLOADS_DIR);
    const safePath = path.resolve(UPLOADS_DIR, rawFilename);

    if (!safePath.startsWith(uploadsRoot + path.sep)) {
      return res.status(403).json({ error: 'Недопустимый путь к файлу' });
    }

    if (!fs.existsSync(safePath)) {
      // Пробуем восстановить файл из MinIO S3 (documents -> messenger -> materials)
      let recovered = await storage.downloadFile(`documents/${rawFilename}`, safePath);
      if (!recovered) recovered = await storage.downloadFile(`messenger/${rawFilename}`, safePath);
      if (!recovered) recovered = await storage.downloadFile(`materials/${rawFilename}`, safePath);
      if (!recovered || !fs.existsSync(safePath)) {
        return res.status(404).json({ error: 'Файл не найден' });
      }
    }

    // 1. Аватары и брендинг открыты (только безопасные растровые/иконочные форматы)
    if (
      (rawFilename.startsWith('avatar-') || rawFilename.startsWith('logo-') || rawFilename.startsWith('icon-')) &&
      SAFE_INLINE_IMAGE_EXTS.has(path.extname(rawFilename).toLowerCase())
    ) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return sendProtectedUpload(res, safePath, rawFilename);
    }

    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Требуется авторизация для доступа к файлу' });
    }

    // 2. Администратор имеет полный доступ
    if (user.role === 'ADMIN' || user.role_code === 'admin') {
      return sendProtectedUpload(res, safePath, rawFilename);
    }

    // 3. Документы (индексированный поиск по file_name, без leading-wildcard Seq Scan)
    const docRes = await db.query(
      'SELECT id, created_by, is_public FROM documents WHERE file_name = $1 OR file_path = $2 LIMIT 1',
      [rawFilename, safePath]
    );

    if (docRes.rows.length > 0) {
      const doc = docRes.rows[0];
      if (doc.is_public) {
        return sendProtectedUpload(res, safePath, rawFilename);
      }
      if (parseInt(doc.created_by, 10) === parseInt(user.id, 10)) {
        return sendProtectedUpload(res, safePath, rawFilename);
      }
      const subIds = await getSubordinateUserIds(user.id);
      if (subIds.includes(parseInt(doc.created_by, 10))) {
        return sendProtectedUpload(res, safePath, rawFilename);
      }
      const permCheck = await db.query(
        'SELECT 1 FROM document_permissions WHERE document_id = $1 AND user_id = $2 LIMIT 1',
        [doc.id, user.id]
      );
      if (permCheck.rows.length > 0) {
        return sendProtectedUpload(res, safePath, rawFilename);
      }
      return res.status(403).json({ error: 'Отказано в доступе к документу' });
    }

    // 4. Почтовые вложения (индексированный поиск по file_path)
    const mailAttPathAlt = path.join(UPLOADS_DIR, 'mail_attachments', rawFilename);
    const mailAttRes = await db.query(`
      SELECT m.user_id 
      FROM mail_attachments ma
      JOIN mail_messages m ON ma.mail_id = m.id
      WHERE ma.file_path = $1 OR ma.file_path = $2
      LIMIT 1
    `, [safePath, mailAttPathAlt]);

    if (mailAttRes.rows.length > 0) {
      if (parseInt(mailAttRes.rows[0].user_id, 10) === parseInt(user.id, 10)) {
        return sendProtectedUpload(res, safePath, rawFilename);
      }
      return res.status(403).json({ error: 'Отказано в доступе к вложению' });
    }

    // 5. Мессенджер (сначала индекс по attachment_url, затем JSONB @>)
    const uploadUrl = `/uploads/${rawFilename}`;
    const chatRes = await db.query(`
      SELECT sender_id, recipient_id, channel 
      FROM chat_messages 
      WHERE attachment_url = $1
         OR attachments @> jsonb_build_array(jsonb_build_object('url', $1::text))
      LIMIT 10
    `, [uploadUrl]);

    if (chatRes.rows.length > 0) {
      const isChannel = chatRes.rows.some(c => Boolean(c.channel));
      if (isChannel) {
        return sendProtectedUpload(res, safePath, rawFilename);
      }

      const canAccess = chatRes.rows.some(c =>
        parseInt(c.sender_id, 10) === parseInt(user.id, 10) ||
        parseInt(c.recipient_id, 10) === parseInt(user.id, 10)
      );
      if (canAccess) {
        return sendProtectedUpload(res, safePath, rawFilename);
      }
      return res.status(403).json({ error: 'Отказано в доступе к файлу чата' });
    }

    // 6. Материалы проектов (только участники проекта, автор материала или руководитель)
    const matRes = await db.query(`
      SELECT pm.project_id, pm.author_id
      FROM project_materials pm
      WHERE pm.file_path = $1 OR pm.file_name = $2
      LIMIT 1
    `, [safePath, rawFilename]);

    if (matRes.rows.length > 0) {
      const mat = matRes.rows[0];
      const subIds = await getSubordinateUserIds(user.id);
      const allowedIds = [parseInt(user.id, 10), ...subIds];
      if (mat.author_id && allowedIds.includes(parseInt(mat.author_id, 10))) {
        return sendProtectedUpload(res, safePath, rawFilename);
      }
      const projMember = await db.query(`
        SELECT 1 FROM projects p
        LEFT JOIN directions d ON d.id = p.direction_id
        WHERE p.id = $1 AND (
          p.manager_id = ANY($2::int[])
          OR d.manager_id = ANY($2::int[])
          OR EXISTS (
            SELECT 1 FROM tasks t WHERE t.project_id = p.id AND (t.assignee_id = ANY($2::int[]) OR t.creator_id = ANY($2::int[]))
          )
        )
        LIMIT 1
      `, [mat.project_id, allowedIds]);
      if (projMember.rows.length > 0) {
        return sendProtectedUpload(res, safePath, rawFilename);
      }
      return res.status(403).json({ error: 'Отказано в доступе к материалу проекта' });
    }

    // Default-Deny: незарегистрированные в БД файлы не отдаются
    return res.status(403).json({ error: 'Отказано в доступе к файлу' });
  } catch (err) {
    console.error('[Uploads Guard] Error:', err);
    res.status(500).json({ error: 'Ошибка проверки доступа к файлу' });
  }
});

// Healthcheck
app.get('/api/health', async (req, res) => {
  try {
    const dbOk = await db.query('SELECT 1');
    const ooHealth = await checkOnlyofficeHealth();
    res.json({
      status: 'UP',
      uptime: process.uptime(),
      timestamp: new Date(),
      services: {
        database: dbOk ? 'CONNECTED' : 'DISCONNECTED',
        storage: 'CONNECTED',
        onlyoffice: ooHealth.ok ? 'HEALTHY' : 'UNAVAILABLE'
      },
      onlyoffice: ooHealth
    });
  } catch (err) {
    res.status(503).json({ status: 'DOWN', error: err.message });
  }
});

// Dedicated ONLYOFFICE Healthcheck Endpoint (DEF-01)
app.get('/api/documents/onlyoffice-health', async (req, res) => {
  const health = await checkOnlyofficeHealth();
  res.status(health.ok ? 200 : 503).json(health);
});

// Permissions Catalog Endpoint
app.get('/api/permissions', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM permissions ORDER BY category ASC, id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки справочника прав' });
  }
});

// Modular Routes Registration
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sso', require('./routes/sso'));
app.use('/api/users', require('./routes/users'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/directions', require('./routes/directions'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/conferences', require('./routes/conferences'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/messenger', require('./routes/messenger'));
app.use('/api/search', require('./routes/search'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/ai', require('./routes/ai'));

// Mail Router & Background Synchronization Worker
const mailRouter = require('./routes/mail');
app.use('/api/mail', mailRouter);
if (mailRouter.startMailAutoSyncWorker) {
  mailRouter.startMailAutoSyncWorker(90000);
}

// Fallback for API 404
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API эндпоинт ${req.method} ${req.path} не найден` });
});

// Centralized Express Error Handler
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  console.error(`[Express Error] [${req.method} ${req.path}]:`, err.message || err);
  const safeMessage = (status >= 500 && process.env.NODE_ENV === 'production')
    ? 'Внутренняя ошибка сервера'
    : (err.message || 'Внутренняя ошибка сервера');
  res.status(status).json({
    error: safeMessage,
    code: err.code || 'INTERNAL_ERROR'
  });
});

// SPA Index Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Boot Server & Connect to DB & S3 Storage
async function startServer() {
  try {
    let retries = 10;
    while (retries > 0) {
      try {
        await db.initDb();
        await storage.initStorage();
        break;
      } catch (err) {
        console.log(`[DB/Storage] Waiting for database & storage connection... Retries left: ${retries}`);
        retries--;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Фоновый прогрев ONNX-эмбеддера (384-dim multilingual-e5-small) и индексация всей базы знаний
    const searchQueue = require('./utils/search_queue');
    const { initEmbedder } = require('./utils/embedder');
    setTimeout(async () => {
      try {
        await initEmbedder();
      } catch (e) {}
      searchQueue.indexAllUnindexed();
    }, 2000);

    serverInstance = app.listen(PORT, '0.0.0.0', () => {
      console.log(`====================================================`);
      console.log(`🚀 DocFlow Streamlined Server running on port ${PORT}`);
      console.log(`📍 Web Portal: http://localhost:${PORT}`);
      console.log(`====================================================`);
    });
    serverInstance.on('upgrade', handleWebSocketUpgrade);
  } catch (err) {
    console.error('Fatal startup error:', err);
  }
}

startServer();

module.exports = app;
