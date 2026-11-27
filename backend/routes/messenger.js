const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const storage = require('../storage');
const { authenticateToken } = require('../middleware/auth');
const { messengerUpload, UPLOADS_DIR } = require('../middleware/upload');
const { fixFilenameEncoding, getExtensionFromMime } = require('../utils/encoding');
const documentsRouter = require('./documents');

// Server-Sent Events (SSE) Client Registry indexed by userId for O(1) DM delivery
const sseClients = new Set();
const sseClientsByUser = new Map();

function registerSseClient(client) {
  sseClients.add(client);
  const uid = parseInt(client.userId, 10);
  if (!sseClientsByUser.has(uid)) sseClientsByUser.set(uid, new Set());
  sseClientsByUser.get(uid).add(client);
}

function unregisterSseClient(client) {
  sseClients.delete(client);
  const uid = parseInt(client.userId, 10);
  const userSet = sseClientsByUser.get(uid);
  if (userSet) {
    userSet.delete(client);
    if (userSet.size === 0) sseClientsByUser.delete(uid);
  }
}

function safeWriteSse(client, raw) {
  try {
    client.res.write(raw);
  } catch (e) {
    unregisterSseClient(client);
  }
}

function broadcastMessengerEvent(eventData) {
  const raw = `data: ${JSON.stringify(eventData)}\n\n`;
  if (eventData.type === 'new_message' && eventData.message && eventData.message.recipient_id) {
    const m = eventData.message;
    const recipientIds = new Set([parseInt(m.recipient_id, 10), parseInt(m.sender_id, 10)]);
    for (const uid of recipientIds) {
      const targets = sseClientsByUser.get(uid);
      if (targets) {
        for (const client of targets) safeWriteSse(client, raw);
      }
    }
    return;
  }
  // Публичный канал или системное событие
  for (const client of sseClients) {
    safeWriteSse(client, raw);
  }
}

// GET /api/messenger/stream - Server-Sent Events (SSE) stream for real-time messages
router.get('/stream', authenticateToken, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const client = {
    id: `${req.user.id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    userId: parseInt(req.user.id, 10),
    res
  };
  registerSseClient(client);

  res.write(`data: ${JSON.stringify({ type: 'connected', userId: req.user.id })}\n\n`);

  const heartbeatTimer = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch (e) {
      clearInterval(heartbeatTimer);
      unregisterSseClient(client);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    unregisterSseClient(client);
  });
});

// GET /api/messenger/conversations - Active (non-empty) direct chats with last messages
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const queryText = `
      SELECT 
        u.id, 
        u.full_name, 
        u.email, 
        u.department, 
        u.role,
        last_msg.message AS last_message,
        last_msg.attachment_name AS last_attachment_name,
        last_msg.attachment_url AS last_attachment_url,
        last_msg.attachments AS last_attachments,
        last_msg.created_at AS last_message_at,
        last_msg.sender_id AS last_sender_id
      FROM (
        SELECT 
          CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS other_user_id,
          MAX(id) AS last_msg_id
        FROM chat_messages
        WHERE (sender_id = $1 AND recipient_id IS NOT NULL)
           OR (recipient_id = $1)
        GROUP BY other_user_id
      ) active_chats
      JOIN users u ON u.id = active_chats.other_user_id
      JOIN chat_messages last_msg ON last_msg.id = active_chats.last_msg_id
      ORDER BY last_msg.created_at DESC
    `;
    const result = await db.query(queryText, [currentUserId]);
    for (const conv of result.rows) {
      if (conv.last_attachment_name) {
        conv.last_attachment_name = fixFilenameEncoding(conv.last_attachment_name);
      }
      if (conv.last_attachments && Array.isArray(conv.last_attachments)) {
        conv.last_attachments = conv.last_attachments.map(att => ({
          ...att,
          name: fixFilenameEncoding(att.name)
        }));
      }
    }
    res.json(result.rows);
  } catch (err) {
    console.error('Messenger fetch conversations error:', err);
    res.status(500).json({ error: 'Ошибка загрузки списка диалогов' });
  }
});

// GET /api/messenger/messages?channel=general OR ?recipient_id=2 (&before_id=...&limit=...)
router.get('/messages', authenticateToken, async (req, res) => {
  try {
    const { channel, recipient_id, before_id } = req.query;
    const msgLimit = Math.min(Math.max(parseInt(req.query.limit || '200', 10) || 200, 1), 500);
    const beforeIdNum = before_id ? parseInt(before_id, 10) : null;
    let queryText = '';
    let params = [];

    if (recipient_id) {
      const otherId = parseInt(recipient_id, 10);
      params = [req.user.id, otherId];
      let beforeCond = '';
      if (beforeIdNum && !isNaN(beforeIdNum)) {
        params.push(beforeIdNum);
        beforeCond = ` AND cm.id < $${params.length}`;
      }
      params.push(msgLimit);
      queryText = `
        SELECT * FROM (
          SELECT cm.*,
                 s.full_name AS sender_name, s.email AS sender_email, s.department AS sender_department,
                 r.full_name AS recipient_name, r.email AS recipient_email
          FROM chat_messages cm
          JOIN users s ON cm.sender_id = s.id
          LEFT JOIN users r ON cm.recipient_id = r.id
          WHERE ((cm.sender_id = $1 AND cm.recipient_id = $2)
             OR (cm.sender_id = $2 AND cm.recipient_id = $1))
             ${beforeCond}
          ORDER BY cm.created_at DESC, cm.id DESC
          LIMIT $${params.length}
        ) recent
        ORDER BY recent.created_at ASC, recent.id ASC
      `;
    } else {
      const channelName = channel || 'general';
      params = [channelName];
      let beforeCond = '';
      if (beforeIdNum && !isNaN(beforeIdNum)) {
        params.push(beforeIdNum);
        beforeCond = ` AND cm.id < $${params.length}`;
      }
      params.push(msgLimit);
      queryText = `
        SELECT * FROM (
          SELECT cm.*,
                 s.full_name AS sender_name, s.email AS sender_email, s.department AS sender_department
          FROM chat_messages cm
          JOIN users s ON cm.sender_id = s.id
          WHERE cm.channel = $1 AND cm.recipient_id IS NULL
            ${beforeCond}
          ORDER BY cm.created_at DESC, cm.id DESC
          LIMIT $${params.length}
        ) recent
        ORDER BY recent.created_at ASC, recent.id ASC
      `;
    }

    const result = await db.query(queryText, params);
    for (const m of result.rows) {
      if (m.attachment_name) {
        m.attachment_name = fixFilenameEncoding(m.attachment_name);
      }
      if (m.attachments && Array.isArray(m.attachments) && m.attachments.length > 0) {
        m.attachments = m.attachments.map(att => ({
          ...att,
          name: fixFilenameEncoding(att.name)
        }));
      } else if (m.attachment_url) {
        m.attachments = [{
          url: m.attachment_url,
          name: fixFilenameEncoding(m.attachment_name || 'Вложение'),
          size: m.attachment_size || 0,
          type: m.attachment_type || 'application/octet-stream'
        }];
      } else {
        m.attachments = [];
      }
    }

    res.json(result.rows);
  } catch (err) {
    console.error('Messenger fetch messages error:', err);
    res.status(500).json({ error: 'Ошибка загрузки сообщений' });
  }
});

// POST /api/messenger/messages - Send message with multiple attachments
router.post('/messages', authenticateToken, messengerUpload, async (req, res) => {
  try {
    const { channel, recipient_id } = req.body;
    const rawMessage = req.body.message || req.body.content || req.body.text || '';
    const message = typeof rawMessage === 'string' ? rawMessage : String(rawMessage);
    const rawFiles = req.files || (req.file ? [req.file] : []);
    const seen = new Set();
    const uploadedFiles = [];
    for (const f of rawFiles) {
      const key = `${f.originalname}_${f.size}`;
      if (!seen.has(key)) {
        seen.add(key);
        uploadedFiles.push(f);
      }
    }

    let extraAttachments = [];
    if (req.body.attachments_json) {
      let parsed = null;
      try {
        parsed = JSON.parse(req.body.attachments_json);
      } catch (e) {
        parsed = null;
      }
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const docId = parseInt(item && item.docId, 10);
          if (!isNaN(docId) && docId > 0) {
            const access = await documentsRouter.getDocumentAccess(docId, req.user);
            if (!access.doc || !access.canView) {
              return res.status(403).json({ error: 'У вас нет прав на отправку указанного документа' });
            }
            extraAttachments.push({
              docId: access.doc.id,
              name: access.doc.title,
              size: access.doc.file_size || 0,
              type: 'docflow_document',
              url: `/api/documents/download/${access.doc.id}`
            });
          }
        }
      }
    }

    const attachments = [
      ...uploadedFiles.map(f => {
        const cleanName = fixFilenameEncoding(f.originalname);
        return {
          url: `/uploads/${f.filename}`,
          name: cleanName,
          size: f.size,
          type: f.mimetype
        };
      }),
      ...extraAttachments
    ];

    if ((!message || !message.trim()) && attachments.length === 0) {
      return res.status(400).json({ error: 'Сообщение или файлы не могут быть пустыми' });
    }

    const firstAtt = attachments[0] || null;
    const attachmentUrl = firstAtt ? firstAtt.url : null;
    const attachmentName = firstAtt ? firstAtt.name : null;
    const attachmentSize = firstAtt ? firstAtt.size : null;
    const attachmentType = firstAtt ? firstAtt.type : null;

    const targetRecipientId = recipient_id ? parseInt(recipient_id, 10) : null;
    const channelName = targetRecipientId ? null : (channel || 'general');

    if (!targetRecipientId) {
      if (channelName !== 'general') {
        return res.status(403).json({ error: 'Доступен только общий канал объявлений' });
      }
      const isAdmin = req.user.role === 'ADMIN' || req.user.role_code === 'admin';
      if (!isAdmin) {
        return res.status(403).json({ error: 'В общий канал могут писать только администраторы' });
      }
    }
    const msgText = (message || '').trim() || attachments.map(a => `📎 ${a.name}`).join(', ');

    const result = await db.query(`
      INSERT INTO chat_messages (sender_id, recipient_id, channel, message, attachment_url, attachment_name, attachment_size, attachment_type, attachments, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *
    `, [req.user.id, targetRecipientId, channelName, msgText, attachmentUrl, attachmentName, attachmentSize, attachmentType, JSON.stringify(attachments)]);

    const msg = result.rows[0];
    msg.attachments = attachments;
    msg.sender_name = req.user.full_name;
    msg.sender_email = req.user.email;
    msg.sender_department = req.user.department;

    for (const f of uploadedFiles) {
      storage.uploadFile(`messenger/${f.filename}`, f.path).catch(e => console.warn('[MinIO Messenger Sync Warning]:', e.message));
    }

    // Broadcast in real-time to active SSE clients
    try {
      broadcastMessengerEvent({ type: 'new_message', message: msg });
    } catch (sseErr) {
      console.warn('[Messenger SSE Broadcast Error]:', sseErr.message);
    }

    res.status(201).json(msg);
  } catch (err) {
    console.error('Messenger send message error:', err);
    res.status(500).json({ error: 'Ошибка отправки сообщения: ' + err.message });
  }
});

// GET /api/messenger/download - Secure download of chat attachment with participant check
router.get('/download', authenticateToken, async (req, res) => {
  try {
    const rawUrl = req.query.url || req.query.file;
    if (!rawUrl) return res.status(400).send('Требуется параметр файла');

    let relativePath = String(rawUrl).replace(/^\/?uploads\//, '');
    const uploadsRoot = path.resolve(UPLOADS_DIR);
    const safePath = path.resolve(UPLOADS_DIR, path.basename(relativePath));

    if (!safePath.startsWith(uploadsRoot + path.sep)) {
      return res.status(403).send('Отказано в доступе: некорректный путь');
    }

    // Проверка прав доступа к вложению мессенджера (админ, публичный канал или участник DM; default-deny)
    const isAdmin = req.user.role === 'ADMIN' || req.user.role_code === 'admin';
    if (!isAdmin) {
      const uploadUrl = `/uploads/${path.basename(safePath)}`;
      const msgRes = await db.query(`
        SELECT sender_id, recipient_id, channel
        FROM chat_messages
        WHERE attachment_url = $1
           OR attachments @> jsonb_build_array(jsonb_build_object('url', $1::text))
        LIMIT 10
      `, [uploadUrl]);

      if (msgRes.rows.length === 0) {
        return res.status(403).send('Отказано в доступе к файлу');
      }

      const isChannel = msgRes.rows.some(c => Boolean(c.channel));
      const isParticipant = msgRes.rows.some(c =>
        parseInt(c.sender_id, 10) === parseInt(req.user.id, 10) ||
        parseInt(c.recipient_id, 10) === parseInt(req.user.id, 10)
      );
      if (!isChannel && !isParticipant) {
        return res.status(403).send('Отказано в доступе к вложению чужого диалога');
      }
    }

    if (!fs.existsSync(safePath)) {
      const recovered = await storage.downloadFile(`messenger/${path.basename(safePath)}`, safePath);
      if (!recovered || !fs.existsSync(safePath)) {
        return res.status(404).send('Файл не найден');
      }
    }

    let requestedName = req.query.name ? fixFilenameEncoding(req.query.name) : path.basename(safePath);
    let currentExt = path.extname(requestedName).toLowerCase();
    const diskExt = path.extname(safePath).toLowerCase();

    if (!currentExt && diskExt) {
      requestedName += diskExt;
      currentExt = diskExt;
    }

    if (!currentExt) {
      const mimeExt = getExtensionFromMime(req.query.type) || '.dat';
      requestedName += mimeExt;
    }

    const encodedName = encodeURIComponent(requestedName);
    const asciiFallback = requestedName.replace(/[^\x20-\x7E]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`);
    res.download(safePath, requestedName);
  } catch (err) {
    console.error('Messenger download error:', err);
    res.status(500).send('Ошибка при скачивании файла');
  }
});

module.exports = router;
