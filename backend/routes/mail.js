const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const db = require('../db');
const storage = require('../storage');
const searchQueue = require('../utils/search_queue');
const multer = require('multer');
const { encrypt, decrypt } = require('../utils/crypto');
const { authenticateToken } = require('../middleware/auth');
const { fixFilenameEncoding, getExtensionFromMime, ensureFileExtension } = require('../utils/encoding');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const mailStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const cleanOriginal = fixFilenameEncoding(file.originalname);
    let ext = path.extname(cleanOriginal).toLowerCase();
    if (!ext && file.mimetype) {
      ext = getExtensionFromMime(file.mimetype);
    }
    if (!ext) ext = '.bin';
    cb(null, 'mail-att-' + uniqueSuffix + ext);
  }
});
const mailUpload = multer({
  storage: mailStorage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// GET /api/mail/recipients/suggest?q=admi - Autocomplete email suggestions
router.get('/recipients/suggest', authenticateToken, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const usersRes = await db.query(`
      SELECT id, full_name, email, department
      FROM users
      WHERE email ILIKE $1 OR full_name ILIKE $1
      ORDER BY full_name ASC
      LIMIT 12
    `, [`%${q}%`]);

    const prevRes = await db.query(`
      SELECT DISTINCT recipient_email
      FROM mail_messages
      WHERE user_id = $1 AND recipient_email ILIKE $2
      LIMIT 6
    `, [req.user.id, `%${q}%`]);

    const suggestions = [...usersRes.rows];
    prevRes.rows.forEach(p => {
      if (p.recipient_email && !suggestions.some(s => s.email.toLowerCase() === p.recipient_email.toLowerCase())) {
        suggestions.push({
          id: null,
          full_name: p.recipient_email.split('@')[0],
          email: p.recipient_email,
          department: 'Ранее использованный'
        });
      }
    });

    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mail/settings - Get user mail settings
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT user_id, email, imap_host, imap_port, imap_tls, smtp_host, smtp_port, smtp_tls, updated_at FROM user_mail_settings WHERE user_id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.json({ configured: false, settings: null });
    }
    res.json({ configured: true, settings: result.rows[0] });
  } catch (err) {
    console.error('Error fetching mail settings:', err);
    res.status(500).json({ error: 'Ошибка сервера при получении настроек почты' });
  }
});

// POST /api/mail/settings - Save & test mail settings
router.post('/settings', authenticateToken, async (req, res) => {
  try {
    const { email, password, imap_host, imap_port, imap_tls = true, smtp_host, smtp_port, smtp_tls = true } = req.body;
    if (!email || !password || !imap_host || !smtp_host) {
      return res.status(400).json({ error: 'Заполните email, пароль/пароль приложения, серверы IMAP и SMTP' });
    }

    const imapPortNum = parseInt(imap_port || 993, 10);
    const smtpPortNum = parseInt(smtp_port || 465, 10);

    // Test IMAP Connection with tight timeouts to prevent hanging
    const client = new ImapFlow({
      host: imap_host,
      port: imapPortNum,
      secure: imap_tls,
      auth: { user: email, pass: password },
      logger: false,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
    client.on('error', (err) => {
      console.warn('[ImapFlow Test Client error caught]:', err.message);
    });

    try {
      await client.connect();
      await client.logout();
    } catch (imapErr) {
      return res.status(400).json({ error: `Ошибка подключения IMAP: ${imapErr.message}. Проверьте сервер, порт и пароль приложения.` });
    }

    // Test SMTP Connection with tight timeouts
    const transporter = nodemailer.createTransport({
      host: smtp_host,
      port: smtpPortNum,
      secure: smtp_tls,
      auth: { user: email, pass: password },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000
    });

    try {
      await transporter.verify();
    } catch (smtpErr) {
      return res.status(400).json({ error: `Ошибка подключения SMTP: ${smtpErr.message}. Проверьте сервер и порт SMTP.` });
    }

    // Encrypt password before saving to DB
    const encryptedPassword = encrypt(password);

    // Upsert user_mail_settings
    await db.query(`
      INSERT INTO user_mail_settings (user_id, email, password, imap_host, imap_port, imap_tls, smtp_host, smtp_port, smtp_tls, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        email = EXCLUDED.email,
        password = EXCLUDED.password,
        imap_host = EXCLUDED.imap_host,
        imap_port = EXCLUDED.imap_port,
        imap_tls = EXCLUDED.imap_tls,
        smtp_host = EXCLUDED.smtp_host,
        smtp_port = EXCLUDED.smtp_port,
        smtp_tls = EXCLUDED.smtp_tls,
        updated_at = NOW()
    `, [req.user.id, email, encryptedPassword, imap_host, imapPortNum, imap_tls, smtp_host, smtpPortNum, smtp_tls]);

    res.json({ message: 'Настройки почты успешно проверены и сохранены!' });
  } catch (err) {
    console.error('Error saving mail settings:', err);
    res.status(500).json({ error: 'Ошибка сервера при сохранении настроек: ' + err.message });
  }
});

// Helper to embed inline CID attachments (logos, icons) into HTML
function embedCidAttachments(html, attachments) {
  if (!html || typeof html !== 'string' || !attachments || attachments.length === 0) return html;
  let result = html;

  for (const att of attachments) {
    if (att.contentId && att.content) {
      const cleanCid = String(att.contentId).replace(/^<|>$/g, '');
      const mimeType = att.contentType || 'image/png';
      const base64Data = Buffer.isBuffer(att.content) ? att.content.toString('base64') : '';
      if (base64Data) {
        const dataUri = `data:${mimeType};base64,${base64Data}`;
        const regex = new RegExp(`cid:<?${cleanCid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>?`, 'gi');
        result = result.replace(regex, dataUri);
      }
    }
  }

  return result;
}

// Helper to detect promotional, marketing, or bulk newsletter emails
function isPromotionalOrBulkMail(parsed, senderEmail = '', senderName = '', subject = '') {
  const emailLower = (senderEmail || '').toLowerCase();
  const nameLower = (senderName || '').toLowerCase();
  const subjLower = (subject || '').toLowerCase();

  // 1. Check RFC bulk/list headers
  if (parsed.headers) {
    if (parsed.headers.get('list-unsubscribe') || parsed.headers.get('list-id')) return true;
    const precedence = String(parsed.headers.get('precedence') || '').toLowerCase();
    if (precedence === 'bulk' || precedence === 'list' || precedence === 'junk') return true;
    if (parsed.headers.get('x-campaign') || parsed.headers.get('x-mailgun-campaign-id') || parsed.headers.get('x-sendgrid-id')) return true;
  }

  // 2. Filter auto-mailers & newsletter sender addresses
  const promoKeywords = [
    'no-reply', 'noreply', 'do-not-reply', 'donotreply', 'promo', 'news', 'newsletter',
    'marketing', 'digest', 'subscribe', 'skidka', 'sale@', 'offers@', 'discount',
    'акци', 'рассылк', 'новости@', 'reklama', 'advertising'
  ];

  for (const kw of promoKeywords) {
    if (emailLower.includes(kw) || nameLower.includes(kw)) {
      return true;
    }
  }

  // 3. Subject marketing keywords
  const promoSubjectKeywords = ['акци', 'распродаж', 'спецпредложени', 'купон', 'промокод', '% скидк'];
  for (const kw of promoSubjectKeywords) {
    if (subjLower.includes(kw)) return true;
  }

  return false;
}

// IMAP Client Factory with explicit network safety timeouts
function getImapClient(s) {
  const realPassword = decrypt(s.password);
  const client = new ImapFlow({
    host: s.imap_host,
    port: s.imap_port,
    secure: s.imap_tls,
    auth: { user: s.email, pass: realPassword },
    logger: false,
    emitLogs: false,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000
  });
  // Prevent unhandled error events (like dropped TCP sockets, COMPRESS or NoConnection) from crashing the server
  client.on('error', (err) => {
    console.warn('[ImapFlow Client error caught]:', err.message);
  });
  return client;
}

// Auto-discover system folders (INBOX, Sent, Trash)
async function resolveMailboxes(client) {
  let inboxPath = 'INBOX';
  let sentPath = null;
  let trashPath = null;

  try {
    const list = await client.list();
    if (Array.isArray(list)) {
      for (const box of list) {
        const name = (box.name || '').toLowerCase();
        const path = box.path;
        const specialUse = (box.specialUse || '').toLowerCase();

        // Inbox
        if (specialUse === '\\inbox' || name === 'inbox' || name === 'входящие') {
          inboxPath = path;
        }
        // Sent
        if (!sentPath && (specialUse === '\\sent' || /^(sent|отправлен|sent items|sent messages)/i.test(name))) {
          sentPath = path;
        }
        // Trash
        if (!trashPath && (specialUse === '\\trash' || /^(trash|корзин|удален|deleted|bin)/i.test(name))) {
          trashPath = path;
        }
      }
    }
  } catch (err) {
    console.warn('[MailSync] Error resolving mailbox list:', err.message);
  }

  // Fallbacks if not auto-detected
  if (!sentPath) sentPath = 'Sent';
  if (!trashPath) trashPath = 'Trash';

  return { inboxPath, sentPath, trashPath };
}

// Helper for syncing read/unread flags to IMAP server
async function syncFlagToImap(userId, folder, imapUid, flags, add = true) {
  if (!imapUid) return;
  try {
    const settingsRes = await db.query('SELECT * FROM user_mail_settings WHERE user_id = $1', [userId]);
    if (settingsRes.rows.length === 0) return;
    const s = settingsRes.rows[0];
    const client = getImapClient(s);
    await client.connect();

    try {
      const { inboxPath, sentPath } = await resolveMailboxes(client);
      const targetFolder = (folder === 'sent') ? sentPath : inboxPath;
      const lock = await client.getMailboxLock(targetFolder);
      try {
        if (add) {
          await client.messageFlagsAdd([imapUid], flags, { uid: true });
        } else {
          await client.messageFlagsRemove([imapUid], flags, { uid: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
  } catch (err) {
    console.warn(`[syncFlagToImap] Failed to sync flags ${flags} for UID ${imapUid}:`, err.message);
  }
}

// Helper for deleting or moving messages to Trash on IMAP server
async function deleteFromImap(userId, folder, imapUid) {
  if (!imapUid) return;
  try {
    const settingsRes = await db.query('SELECT * FROM user_mail_settings WHERE user_id = $1', [userId]);
    if (settingsRes.rows.length === 0) return;
    const s = settingsRes.rows[0];
    const client = getImapClient(s);
    await client.connect();

    try {
      const { inboxPath, sentPath, trashPath } = await resolveMailboxes(client);
      const targetFolder = (folder === 'sent') ? sentPath : inboxPath;
      const lock = await client.getMailboxLock(targetFolder);
      try {
        let moved = false;
        if (trashPath && trashPath !== targetFolder) {
          try {
            await client.messageMove([imapUid], trashPath, { uid: true });
            moved = true;
          } catch (mErr) {
            // Server may not support move or trash folder not writable
          }
        }
        if (!moved) {
          await client.messageDelete([imapUid], { uid: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
  } catch (err) {
    console.warn(`[deleteFromImap] Failed to delete UID ${imapUid} from IMAP:`, err.message);
  }
}

// Helper to append sent email to IMAP Sent mailbox
async function appendToImapSent(userId, rawMime, flags = ['\\Seen']) {
  try {
    const settingsRes = await db.query('SELECT * FROM user_mail_settings WHERE user_id = $1', [userId]);
    if (settingsRes.rows.length === 0) return null;
    const s = settingsRes.rows[0];
    const client = getImapClient(s);
    await client.connect();

    try {
      const { sentPath } = await resolveMailboxes(client);
      if (sentPath) {
        const lock = await client.getMailboxLock(sentPath);
        try {
          const res = await client.append(sentPath, rawMime, flags);
          return res?.uid || null;
        } finally {
          lock.release();
        }
      }
    } finally {
      await client.logout().catch(() => {});
    }
  } catch (err) {
    console.warn('[appendToImapSent] Failed to append sent message to IMAP:', err.message);
  }
  return null;
}

// In-flight sync mutex per user to prevent concurrent parallel sync sessions
const activeUserSyncs = new Map();

// Synchronize a specific mailbox folder (INBOX or Sent)
async function syncMailboxFolder(client, folderPath, dbFolder, userId, s, limit = 50, mailUploadDir) {
  let newMessagesCount = 0;
  let lock;
  try {
    lock = await client.getMailboxLock(folderPath);
  } catch (lockErr) {
    console.warn(`[MailSync] Cannot lock folder "${folderPath}":`, lockErr.message);
    return 0;
  }

  try {
    const status = await client.status(folderPath, { messages: true });
    const totalMessages = status.messages || 0;

    // Загружаем локальные метаданные БЕЗ тяжёлого поля body и список ранее пропущенных промо-UID
    const [existingRes, skippedRes] = await Promise.all([
      db.query(
        'SELECT id, message_id, imap_uid, is_read, COALESCE(has_html, TRUE) AS has_html FROM mail_messages WHERE user_id = $1 AND folder = $2',
        [userId, dbFolder]
      ),
      db.query(
        'SELECT imap_uid FROM mail_skipped_uids WHERE user_id = $1 AND folder = $2',
        [userId, dbFolder]
      ).catch(() => ({ rows: [] }))
    ]);

    const skippedUidsSet = new Set(skippedRes.rows.map(r => r.imap_uid));

    // Step 1: Two-Way Deletion Sync — проверяем только диапазон локально закэшированных UID, а не весь ящик из 50000 писем
    const localUids = existingRes.rows.map(r => r.imap_uid).filter(Boolean);
    if (localUids.length > 0) {
      let serverUidsSet = null;
      try {
        if (totalMessages === 0) {
          serverUidsSet = new Set();
        } else {
          const minUid = Math.min(...localUids);
          const maxUid = Math.max(...localUids);
          const serverUids = await client.search({ uid: `${minUid}:${maxUid}` }, { uid: true });
          if (Array.isArray(serverUids)) {
            serverUidsSet = new Set(serverUids);
          }
        }
      } catch (sErr) {
        console.warn(`[MailSync] UID range search error in ${folderPath}:`, sErr.message);
      }

      if (serverUidsSet !== null) {
        const deletedIds = existingRes.rows
          .filter(r => r.imap_uid && !serverUidsSet.has(r.imap_uid))
          .map(r => r.id);

        if (deletedIds.length > 0) {
          console.log(`[MailSync] Purging ${deletedIds.length} locally cached emails (folder: ${dbFolder}) deleted on server`);
          const attRows = await db.query('SELECT id FROM mail_attachments WHERE mail_id = ANY($1::int[])', [deletedIds]);
          const delAttIds = attRows.rows.map(a => a.id);
          if (delAttIds.length > 0) {
            await db.query("DELETE FROM knowledge_chunks WHERE source_type = 'mail_attachment' AND source_id = ANY($1::int[])", [delAttIds]).catch(() => {});
          }
          await db.query('DELETE FROM mail_attachments WHERE mail_id = ANY($1::int[])', [deletedIds]);
          await db.query('DELETE FROM mail_messages WHERE id = ANY($1::int[])', [deletedIds]);
        }
      }
    }

    if (totalMessages > 0) {
      const startSeq = Math.max(1, totalMessages - limit + 1);
      const range = `${startSeq}:${totalMessages}`;

      const existingMapByUid = new Map();
      const existingMapByMsgId = new Map();
      const needsHtmlUpdateSet = new Set();

      for (const r of existingRes.rows) {
        if (r.imap_uid) existingMapByUid.set(r.imap_uid, r);
        if (r.message_id) existingMapByMsgId.set(r.message_id, r);
        if (r.has_html === false) {
          needsHtmlUpdateSet.add(r.id);
        }
      }

      const messagesToFetch = [];
      const plannedUids = new Set();

      // Step 2: Fetch IMAP envelopes with flags (read/unread) and UIDs
      for await (let msg of client.fetch(range, { envelope: true, uid: true, flags: true })) {
        if (!msg.uid) continue;
        if (plannedUids.has(msg.uid) || skippedUidsSet.has(msg.uid)) continue;

        const messageId = msg.envelope?.messageId || `msg_${msg.seq}_${msg.uid}`;
        const isSeen = (dbFolder === 'sent') ? true : Boolean(msg.flags && msg.flags.has('\\Seen'));

        const existing = existingMapByUid.get(msg.uid) || existingMapByMsgId.get(messageId);

        if (existing) {
          // Bidirectional Read/Unread Sync (Server -> Local)
          if (existing.is_read !== isSeen || existing.imap_uid !== msg.uid) {
            await db.query(
              'UPDATE mail_messages SET is_read = $1, imap_uid = $2 WHERE id = $3',
              [isSeen, msg.uid, existing.id]
            );
          }
          if (needsHtmlUpdateSet.has(existing.id)) {
            plannedUids.add(msg.uid);
            messagesToFetch.push({
              seq: msg.seq,
              uid: msg.uid,
              envelope: msg.envelope,
              messageId,
              isSeen,
              isUpdate: true,
              existingId: existing.id
            });
          }
        } else {
          plannedUids.add(msg.uid);
          messagesToFetch.push({
            seq: msg.seq,
            uid: msg.uid,
            envelope: msg.envelope,
            messageId,
            isSeen,
            isUpdate: false,
            existingId: null
          });
        }
      }

      // Step 3: Batch-fetch message contents in pipelined groups of 10 (eliminates N serial RTTs)
      const metaByUid = new Map(messagesToFetch.map(it => [it.uid, it]));
      const BATCH_SIZE = 10;
      for (let i = 0; i < messagesToFetch.length; i += BATCH_SIZE) {
        const batch = messagesToFetch.slice(i, i + BATCH_SIZE);
        const uidRangeStr = batch.map(it => it.uid).join(',');

        try {
          for await (const msgData of client.fetch(uidRangeStr, { source: true, uid: true }, { uid: true })) {
            const item = metaByUid.get(msgData.uid);
            if (!item || !msgData.source) continue;

            try {
              const parsed = await simpleParser(msgData.source);
              const messageId = parsed.messageId || item.messageId;

              let body = '';
              if (typeof parsed.html === 'string' && parsed.html.trim().length > 0) {
                body = parsed.html;
              } else if (typeof parsed.textAsHtml === 'string' && parsed.textAsHtml.trim().length > 0) {
                body = parsed.textAsHtml;
              } else if (typeof parsed.text === 'string' && parsed.text.trim().length > 0) {
                body = parsed.text;
              }

              if (body && parsed.attachments && parsed.attachments.length > 0) {
                body = embedCidAttachments(body, parsed.attachments);
              }

              const hasHtml = Boolean(body && /<[a-z][\s\S]*>/i.test(body.trim()));
              const senderName = parsed.from?.value[0]?.name || parsed.from?.text || (dbFolder === 'sent' ? 'Вы' : 'Неизвестный');
              const senderEmail = parsed.from?.value[0]?.address || (dbFolder === 'sent' ? s.email : 'unknown@domain.com');
              const recipientEmail = parsed.to?.value[0]?.address || parsed.to?.text || s.email;
              const subject = parsed.subject || '(Без темы)';
              const rawTextForPreview = (parsed.text || body).replace(/<[^>]+>/g, ' ');
              const preview = rawTextForPreview.substring(0, 150).replace(/[\r\n]+/g, ' ').trim();
              const createdAt = parsed.date || new Date();

              // Skip promotional/bulk newsletters and REMEMBER their UID so they are never re-downloaded
              if (dbFolder === 'inbox' && isPromotionalOrBulkMail(parsed, senderEmail, senderName, subject)) {
                await db.query(
                  'INSERT INTO mail_skipped_uids (user_id, folder, imap_uid) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                  [userId, dbFolder, item.uid]
                ).catch(() => {});
                skippedUidsSet.add(item.uid);
                console.log(`[MailSync] Skipped & cached promotional UID ${item.uid}: "${subject}" from ${senderEmail}`);
                continue;
              }

              let insertedMailId = item.existingId;

              if (item.isUpdate && insertedMailId) {
                await db.query(`
                  UPDATE mail_messages 
                  SET body = $1, preview = $2, subject = $3, is_read = $4, imap_uid = $5, has_html = $6
                  WHERE id = $7
                `, [body, preview, subject, item.isSeen, item.uid, hasHtml, insertedMailId]);
              } else {
                const insRes = await db.query(`
                  INSERT INTO mail_messages (user_id, folder, sender_name, sender_email, recipient_email, subject, preview, body, message_id, imap_uid, is_read, has_html, created_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                  ON CONFLICT (user_id, folder, imap_uid) WHERE imap_uid IS NOT NULL
                  DO UPDATE SET is_read = EXCLUDED.is_read,
                                has_html = EXCLUDED.has_html,
                                body = COALESCE(NULLIF(EXCLUDED.body, ''), mail_messages.body),
                                preview = COALESCE(NULLIF(EXCLUDED.preview, ''), mail_messages.preview)
                  RETURNING id, (xmax = 0) AS is_new
                `, [userId, dbFolder, senderName, senderEmail, recipientEmail, subject, preview, body, messageId, item.uid, item.isSeen, hasHtml, createdAt]);

                if (insRes.rows.length > 0) {
                  insertedMailId = insRes.rows[0].id;
                  if (insRes.rows[0].is_new) {
                    newMessagesCount++;
                  }
                  existingMapByUid.set(item.uid, { id: insertedMailId, message_id: messageId, imap_uid: item.uid });
                }
              }

              // Process attachments asynchronously
              if (insertedMailId && parsed.attachments && parsed.attachments.length > 0) {
                for (const att of parsed.attachments) {
                  if (att.filename && !att.related) {
                    const safeFileName = `${Date.now()}_${att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                    const filePath = path.join(mailUploadDir, safeFileName);
                    if (att.content && Buffer.isBuffer(att.content)) {
                      await fs.promises.writeFile(filePath, att.content);
                      const attIns = await db.query(`
                        INSERT INTO mail_attachments (mail_id, file_name, file_type, file_size, file_path)
                        VALUES ($1, $2, $3, $4, $5)
                        RETURNING id
                      `, [insertedMailId, att.filename, att.contentType || 'application/octet-stream', att.size || att.content.length, filePath]);

                      if (attIns.rows[0] && typeof searchQueue.enqueueSource === 'function') {
                        const attExt = path.extname(att.filename).replace('.', '').toLowerCase() || getExtensionFromMime(att.contentType).replace('.', '');
                        searchQueue.enqueueSource('mail_attachment', attIns.rows[0].id, filePath, attExt);
                      }
                    }
                  }
                }
              }
            } catch (msgErr) {
              console.error(`[MailSync] Error parsing message uid ${item.uid}:`, msgErr.message);
            }
          }
        } catch (batchErr) {
          console.error(`[MailSync] Batch fetch error (${uidRangeStr}):`, batchErr.message);
        }
      }
    }
  } finally {
    if (lock) lock.release();
  }

  return newMessagesCount;
}

// High-performance IMAP mail sync supporting INBOX and SENT with two-way read/delete sync
async function performMailSync(userId, limit = 50) {
  // Concurrency Guard: Reuse ongoing sync promise if one is already running for this user
  if (activeUserSyncs.has(userId)) {
    console.log(`[MailSync] Sync for user ${userId} is already running in background, joining existing session.`);
    return activeUserSyncs.get(userId);
  }

  const syncPromise = (async () => {
    const settingsRes = await db.query('SELECT * FROM user_mail_settings WHERE user_id = $1', [userId]);
    if (settingsRes.rows.length === 0) {
      return { success: false, configured: false, error: 'Почтовый аккаунт не настроен. Нажмите "⚙️ Настройки почты" для входа.' };
    }

    const s = settingsRes.rows[0];
    const client = getImapClient(s);

    try {
      await client.connect();
    } catch (connErr) {
      let helpMsg = connErr.message;
      if (s.imap_host.includes('yandex')) {
        helpMsg += ' (Для Яндекс Почты включите IMAP в настройках и используйте Пароль приложения)';
      } else if (s.imap_host.includes('mail.ru')) {
        helpMsg += ' (Для Mail.ru используйте Пароль для внешних приложений)';
      } else if (s.imap_host.includes('gmail')) {
        helpMsg += ' (Для Gmail используйте Пароль приложения)';
      }
      throw new Error(`Ошибка подключения IMAP (${s.imap_host}): ${helpMsg}`);
    }

    let newMessagesCount = 0;
    try {
      const { inboxPath, sentPath } = await resolveMailboxes(client);
      const mailUploadDir = path.join(__dirname, '../../uploads/mail_attachments');
      if (!fs.existsSync(mailUploadDir)) fs.mkdirSync(mailUploadDir, { recursive: true });

      // 1. Sync INBOX folder
      if (inboxPath) {
        const inboxCount = await syncMailboxFolder(client, inboxPath, 'inbox', userId, s, limit, mailUploadDir);
        newMessagesCount += inboxCount;
      }

      // 2. Sync SENT folder (bidirectional sent mail from phone/webmail)
      if (sentPath) {
        await syncMailboxFolder(client, sentPath, 'sent', userId, s, limit, mailUploadDir);
      }
    } finally {
      await client.logout().catch(() => {});
    }

    return { success: true, configured: true, newMessagesCount };
  })();

  activeUserSyncs.set(userId, syncPromise);
  try {
    return await syncPromise;
  } finally {
    activeUserSyncs.delete(userId);
  }
}


// Background Mail Worker
let isAutoSyncActive = false;
async function autoSyncAllUsersMail() {
  if (isAutoSyncActive) return;
  isAutoSyncActive = true;
  try {
    const usersRes = await db.query('SELECT DISTINCT user_id FROM user_mail_settings');
    for (const row of usersRes.rows) {
      try {
        await performMailSync(row.user_id, 50);
      } catch (err) {
        // Silent catch for background errors
      }
    }
  } catch (err) {
    console.error('[AutoMailSync Worker] Global error:', err.message);
  } finally {
    isAutoSyncActive = false;
  }
}

function startMailAutoSyncWorker(intervalMs = 90000) {
  setTimeout(() => {
    autoSyncAllUsersMail();
    setInterval(autoSyncAllUsersMail, intervalMs);
  }, 5000);
}

// POST /api/mail/sync - Fetch latest emails via IMAP
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.body.limit || req.query.limit || 100, 10);
    const result = await performMailSync(req.user.id, limit);
    if (!result.configured) {
      return res.status(400).json({ error: result.error });
    }
    const newCount = result.newMessagesCount || 0;
    res.json({
      message: newCount > 0 ? `Загружено новых писем: ${newCount}` : 'Новых писем нет',
      newCount: newCount
    });
  } catch (err) {
    console.error('Error syncing mail via IMAP:', err);
    res.status(500).json({ error: 'Ошибка синхронизации почты: ' + err.message });
  }
});

// GET /api/mail/unread-count - Lightweight unread counter for sidebar badge polling
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const [settingsRes, unreadRes] = await Promise.all([
      db.query('SELECT 1 FROM user_mail_settings WHERE user_id = $1 LIMIT 1', [req.user.id]),
      db.query(
        `SELECT COUNT(*)::int AS cnt FROM mail_messages WHERE user_id = $1 AND folder = 'inbox' AND is_read = false`,
        [req.user.id]
      )
    ]);
    res.json({
      configured: settingsRes.rows.length > 0,
      unreadCount: unreadRes.rows[0]?.cnt || 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка получения счетчика писем' });
  }
});

// GET /api/mail - List messages for logged user (with real SQL pagination)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { folder = 'inbox', search = '' } = req.query;
    const page = parseInt(req.query.page, 10);
    const limit = parseInt(req.query.limit, 10);
    const usePagination = !isNaN(page) && !isNaN(limit) && page > 0 && limit > 0;
    const safeLimit = usePagination ? Math.min(limit, 200) : null;
    const offset = usePagination ? (page - 1) * safeLimit : 0;

    let queryText = `
      SELECT id, folder, sender_name, sender_email, recipient_email, subject, preview, is_read, created_at
             ${usePagination ? ', COUNT(*) OVER()::int AS _total_count' : ''}
      FROM mail_messages
      WHERE user_id = $1 AND folder = $2
    `;
    const queryParams = [req.user.id, folder];

    if (search && search.trim()) {
      queryText += ` AND (subject ILIKE $3 OR sender_name ILIKE $3 OR preview ILIKE $3 OR recipient_email ILIKE $3)`;
      queryParams.push(`%${search.trim()}%`);
    }

    queryText += ` ORDER BY created_at DESC`;
    if (usePagination) {
      queryParams.push(safeLimit, offset);
      queryText += ` LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`;
    }

    const [settingsCheck, result, unreadRes] = await Promise.all([
      db.query('SELECT 1 FROM user_mail_settings WHERE user_id = $1 LIMIT 1', [req.user.id]),
      db.query(queryText, queryParams),
      db.query(
        `SELECT COUNT(*)::int AS cnt FROM mail_messages WHERE user_id = $1 AND folder = 'inbox' AND is_read = false`,
        [req.user.id]
      )
    ]);

    const rows = result.rows;
    let total = rows.length;
    if (usePagination) {
      total = rows.length > 0 ? rows[0]._total_count : 0;
      for (const r of rows) delete r._total_count;
    }

    res.json({
      configured: settingsCheck.rows.length > 0,
      messages: rows,
      total,
      page: usePagination ? page : 1,
      unreadCount: unreadRes.rows[0]?.cnt || 0
    });
  } catch (err) {
    console.error('Error fetching mail:', err);
    res.status(500).json({ error: 'Ошибка сервера при загрузке почты' });
  }
});

// GET /api/mail/:id - Get single mail message with attachments
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const mailIdNum = parseInt(id, 10);
    if (isNaN(mailIdNum)) {
      return res.status(400).json({ error: 'Некорректный идентификатор письма' });
    }

    const result = await db.query('SELECT * FROM mail_messages WHERE id = $1 AND user_id = $2', [mailIdNum, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Письмо не найдено' });
    }

    // Mark as read locally and sync to IMAP
    const mail = result.rows[0];
    if (!mail.is_read) {
      await db.query('UPDATE mail_messages SET is_read = true WHERE id = $1 AND user_id = $2', [mailIdNum, req.user.id]);
      mail.is_read = true;
      if (mail.imap_uid) {
        syncFlagToImap(req.user.id, mail.folder, mail.imap_uid, ['\\Seen'], true);
      }
    }

    // Attach downloaded attachments list
    const attRes = await db.query('SELECT id, file_name, file_type, file_size FROM mail_attachments WHERE mail_id = $1', [mailIdNum]);
    mail.attachments = attRes.rows;

    res.json(mail);
  } catch (err) {
    console.error('Error reading mail:', err);
    res.status(500).json({ error: 'Ошибка сервера при чтении письма' });
  }
});

// PATCH /api/mail/:id/read - Toggle or set read/unread status with IMAP sync
router.patch('/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_read } = req.body;
    const mailIdNum = parseInt(id, 10);
    if (isNaN(mailIdNum)) return res.status(400).json({ error: 'Некорректный ID письма' });

    const mailRes = await db.query('SELECT id, folder, imap_uid, is_read FROM mail_messages WHERE id = $1 AND user_id = $2', [mailIdNum, req.user.id]);
    if (mailRes.rows.length === 0) return res.status(404).json({ error: 'Письмо не найдено' });

    const mail = mailRes.rows[0];
    let newIsRead = typeof is_read === 'boolean' ? is_read : !mail.is_read;
    if (mail.folder === 'sent') {
      newIsRead = true; // Отправленные письма всегда считаются прочитанными
    }

    await db.query('UPDATE mail_messages SET is_read = $1 WHERE id = $2 AND user_id = $3', [newIsRead, mailIdNum, req.user.id]);

    if (mail.imap_uid) {
      syncFlagToImap(req.user.id, mail.folder, mail.imap_uid, ['\\Seen'], newIsRead);
    }

    const unreadRes = await db.query("SELECT COUNT(*) FROM mail_messages WHERE user_id = $1 AND folder = 'inbox' AND is_read = false", [req.user.id]);
    res.json({
      message: newIsRead ? 'Письмо отмечено как прочитанное' : 'Письмо отмечено как непрочитанное',
      is_read: newIsRead,
      unreadCount: parseInt(unreadRes.rows[0].count || 0, 10)
    });
  } catch (err) {
    console.error('Error toggling read status:', err);
    res.status(500).json({ error: 'Ошибка сервера при смене статуса прочтения' });
  }
});

// GET /api/mail/attachments/:id/download - Secure download attachment
router.get('/attachments/:id/download', authenticateToken, async (req, res) => {
  try {
    const attId = parseInt(req.params.id, 10);
    if (isNaN(attId)) return res.status(400).json({ error: 'Некорректный ID вложения' });

    const attRes = await db.query(`
      SELECT ma.file_name, ma.file_path, ma.file_type 
      FROM mail_attachments ma
      JOIN mail_messages m ON ma.mail_id = m.id
      WHERE ma.id = $1 AND m.user_id = $2
    `, [attId, req.user.id]);

    if (attRes.rows.length === 0) {
      return res.status(404).json({ error: 'Вложение не найдено' });
    }

    const att = attRes.rows[0];
    if (!fs.existsSync(att.file_path)) {
      return res.status(404).json({ error: 'Файл вложения не найден на сервере' });
    }

    let downloadName = fixFilenameEncoding(att.file_name || 'attachment');
    let ext = path.extname(downloadName).toLowerCase();
    if (!ext) {
      const pathExt = path.extname(att.file_path || '').toLowerCase();
      if (pathExt) {
        downloadName += pathExt;
      } else if (att.file_type) {
        const mimeExt = getExtensionFromMime(att.file_type);
        if (mimeExt) downloadName += mimeExt;
      }
    }

    const encodedName = encodeURIComponent(downloadName);
    const asciiFallback = downloadName.replace(/[^\x20-\x7E]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`);
    res.download(att.file_path, downloadName);
  } catch (err) {
    console.error('Error downloading attachment:', err);
    res.status(500).json({ error: 'Ошибка при скачивании вложения' });
  }
});

// POST /api/mail/attachments/:id/import - Import mail attachment to Documents module
router.post('/attachments/:id/import', authenticateToken, async (req, res) => {
  try {
    const attId = parseInt(req.params.id, 10);
    if (isNaN(attId)) return res.status(400).json({ error: 'Некорректный ID вложения' });

    const attRes = await db.query(`
      SELECT ma.file_name, ma.file_path, ma.file_type, ma.file_size, m.subject 
      FROM mail_attachments ma
      JOIN mail_messages m ON ma.mail_id = m.id
      WHERE ma.id = $1 AND m.user_id = $2
    `, [attId, req.user.id]);

    if (attRes.rows.length === 0) {
      return res.status(404).json({ error: 'Вложение не найдено' });
    }

    const att = attRes.rows[0];
    if (!fs.existsSync(att.file_path)) {
      return res.status(404).json({ error: 'Файл вложения не найден на сервере' });
    }

    // Copy attachment to main Documents uploads directory
    const docsUploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(docsUploadDir)) fs.mkdirSync(docsUploadDir, { recursive: true });

    const newDocFileName = `doc-mail-import-${Date.now()}_${att.file_name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const newDocFilePath = path.join(docsUploadDir, newDocFileName);
    fs.copyFileSync(att.file_path, newDocFilePath);

    const cleanName = fixFilenameEncoding(att.file_name);
    const title = cleanName || `Документ из письма (${att.subject || 'без темы'})`;
    const ext = path.extname(cleanName).replace('.', '').toLowerCase() || 'bin';

    const insDoc = await db.query(`
      INSERT INTO documents (title, file_name, file_type, file_size, file_path, category, created_by)
      VALUES ($1, $2, $3, $4, $5, 'Почта', $6)
      RETURNING id, title
    `, [title, newDocFileName, ext, att.file_size || 0, newDocFilePath, req.user.id]);

    storage.uploadFile(`documents/${newDocFileName}`, newDocFilePath).catch(() => {});
    searchQueue.enqueue(insDoc.rows[0].id, newDocFilePath, ext, { sourceType: 'document', immediateFts: true });

    res.status(201).json({
      message: `Вложение "${att.file_name}" успешно импортировано в систему Документов!`,
      document: insDoc.rows[0]
    });
  } catch (err) {
    console.error('Error importing attachment:', err);
    res.status(500).json({ error: 'Ошибка сервера при импорте вложения' });
  }
});

// POST /api/mail/send - Send mail via SMTP (with attachments) and sync copy to IMAP Sent mailbox
router.post('/send', authenticateToken, mailUpload.array('attachments', 10), async (req, res) => {
  try {
    const to_email = req.body.to_email || req.body.to;
    const subject = req.body.subject;
    const body = req.body.body || '';
    const files = req.files || [];

    if (!to_email || !subject || (!body && files.length === 0)) {
      return res.status(400).json({ error: 'Заполните получателя, тему и текст письма или прикрепите файлы' });
    }

    const preview = (body || (files.length > 0 ? `[Вложено файлов: ${files.length}]` : '')).substring(0, 120);

    // Format attachments for Nodemailer
    const mailAttachments = files.map(f => ({
      filename: fixFilenameEncoding(f.originalname),
      path: f.path,
      contentType: f.mimetype
    }));

    // Check if user has SMTP settings configured
    const settingsRes = await db.query('SELECT * FROM user_mail_settings WHERE user_id = $1', [req.user.id]);
    let realMailSent = false;
    let senderEmail = req.user.email;
    let appendUid = null;

    if (settingsRes.rows.length > 0) {
      const s = settingsRes.rows[0];
      senderEmail = s.email;
      const realPassword = decrypt(s.password);
      const transporter = nodemailer.createTransport({
        host: s.smtp_host,
        port: s.smtp_port,
        secure: s.smtp_tls,
        auth: { user: s.email, pass: realPassword },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000
      });

      try {
        await transporter.sendMail({
          from: `"${req.user.full_name}" <${s.email}>`,
          to: to_email,
          subject: subject,
          text: body,
          attachments: mailAttachments
        });
        realMailSent = true;
      } catch (smtpErr) {
        console.warn('SMTP send error:', smtpErr.message);
      }

      // Two-Way Sent Mail Sync: append copy to IMAP Sent folder
      const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2)}@docflow.local>`;
      const dateRfc = new Date().toUTCString();
      const rawMime = [
        `From: "${req.user.full_name}" <${senderEmail}>`,
        `To: ${to_email}`,
        `Subject: ${subject}`,
        `Date: ${dateRfc}`,
        `Message-ID: ${messageId}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=UTF-8`,
        `Content-Transfer-Encoding: 8bit`,
        ``,
        body
      ].join('\r\n');

      try {
        appendUid = await appendToImapSent(req.user.id, Buffer.from(rawMime, 'utf8'), ['\\Seen']);
      } catch (appErr) {
        console.warn('Could not append to IMAP Sent folder:', appErr.message);
      }
    }

    const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2)}@docflow.local>`;

    // Save into sent folder for current user with imap_uid
    const insMsgRes = await db.query(`
      INSERT INTO mail_messages (user_id, folder, sender_name, sender_email, recipient_email, subject, preview, body, message_id, imap_uid, is_read, created_at)
      VALUES ($1, 'sent', $2, $3, $4, $5, $6, $7, $8, $9, true, NOW())
      ON CONFLICT (user_id, folder, imap_uid) WHERE imap_uid IS NOT NULL
      DO NOTHING
      RETURNING id
    `, [req.user.id, req.user.full_name, senderEmail, to_email, subject, preview, body, messageId, appendUid]);

    const sentMailId = insMsgRes.rows[0].id;

    // Save attached files into mail_attachments for Sent folder display & download + index into RAG
    for (const f of files) {
      const cleanName = fixFilenameEncoding(f.originalname);
      const attRes = await db.query(`
        INSERT INTO mail_attachments (mail_id, file_name, file_type, file_size, file_path, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id
      `, [sentMailId, cleanName, f.mimetype || 'application/octet-stream', f.size, f.path]);
      if (attRes.rows[0]) {
        const ext = path.extname(cleanName).replace('.', '').toLowerCase() || getExtensionFromMime(f.mimetype).replace('.', '');
        searchQueue.enqueueSource('mail_attachment', attRes.rows[0].id, f.path, ext);
      }
    }

    res.status(201).json({
      message: realMailSent 
        ? 'Письмо успешно отправлено через SMTP и сохранено в "Отправленные" на сервере!' 
        : 'Письмо сохранено в папку "Отправленные" (Почтовый сервер SMTP не подключен)',
      mail_id: sentMailId
    });
  } catch (err) {
    console.error('Error sending mail:', err);
    res.status(500).json({ error: 'Ошибка при отправке письма: ' + err.message });
  }
});

// DELETE /api/mail/:id - Delete mail message with two-way IMAP sync (move to Trash / expunge)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const mailIdNum = parseInt(id, 10);
    if (isNaN(mailIdNum)) return res.status(400).json({ error: 'Некорректный ID письма' });

    const mailRes = await db.query('SELECT id, folder, imap_uid FROM mail_messages WHERE id = $1 AND user_id = $2', [mailIdNum, req.user.id]);
    if (mailRes.rows.length === 0) {
      return res.status(404).json({ error: 'Письмо не найдено или доступ запрещен' });
    }

    const mail = mailRes.rows[0];

    // Two-Way Deletion Sync: move to Trash or delete on IMAP server
    if (mail.imap_uid) {
      deleteFromImap(req.user.id, mail.folder, mail.imap_uid);
    }

    const attIdsRes = await db.query('SELECT id FROM mail_attachments WHERE mail_id = $1', [mail.id]);
    const attIds = attIdsRes.rows.map(r => r.id);
    if (attIds.length > 0) {
      await db.query("DELETE FROM knowledge_chunks WHERE source_type = 'mail_attachment' AND source_id = ANY($1::int[])", [attIds]).catch(() => {});
    }
    await db.query('DELETE FROM mail_attachments WHERE mail_id = $1', [mail.id]);
    await db.query('DELETE FROM mail_messages WHERE id = $1 AND user_id = $2', [mail.id, req.user.id]);

    res.json({ message: 'Письмо успешно удалено' });
  } catch (err) {
    console.error('Error deleting mail:', err);
    res.status(500).json({ error: 'Ошибка сервера при удалении письма' });
  }
});

router.performMailSync = performMailSync;
router.startMailAutoSyncWorker = startMailAutoSyncWorker;

module.exports = router;
