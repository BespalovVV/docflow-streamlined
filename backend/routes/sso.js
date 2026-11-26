const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, authenticateToken, authenticateTokenOptional } = require('../middleware/auth');
const { appCache } = require('../utils/cache');
const authRouter = require('./auth');

const router = express.Router();

const PROVIDER_LABSPACE = 'labspace';
const CODE_TTL_MS = 60 * 1000;
const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const OPAQUE_VALUE = /^[A-Za-z0-9_-]{32,128}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{32,256}$/;

function getSsoConfig() {
  const labspaceUrlRaw = (process.env.SSO_LABSPACE_URL || '').trim();
  const labspaceUrl = labspaceUrlRaw.replace(/\/+$/, '');
  const labspaceInternalUrl = ((process.env.SSO_LABSPACE_INTERNAL_URL || '').trim() || labspaceUrl).replace(/\/+$/, '');
  const labspaceClientSecret = process.env.SSO_LABSPACE_CLIENT_SECRET || '';
  const docflowClientSecret = process.env.SSO_DOCFLOW_CLIENT_SECRET || '';
  return {
    labspaceUrlRaw,
    labspaceUrl,
    labspaceInternalUrl,
    labspaceClientSecret,
    docflowClientSecret
  };
}

function isValidSsoOrigin(rawUrl) {
  if (!rawUrl || /\s/.test(rawUrl)) return false;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    return false;
  }
  const allowHttp = process.env.SSO_ALLOW_HTTP === '1';
  const validProtocol = parsed.protocol === 'https:' || (allowHttp && parsed.protocol === 'http:');
  if (!validProtocol) return false;
  if (!parsed.hostname || parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;
  if (parsed.pathname && parsed.pathname !== '/') return false;
  return true;
}

function isSsoConfigured() {
  const cfg = getSsoConfig();
  if (!isValidSsoOrigin(cfg.labspaceUrlRaw)) return false;
  if (!SECRET_RE.test(cfg.labspaceClientSecret) || !SECRET_RE.test(cfg.docflowClientSecret)) {
    return false;
  }
  return cfg.labspaceClientSecret !== cfg.docflowClientSecret;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'ascii').digest('hex');
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function parseCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return '';
  const parts = raw.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch (e) {
        return '';
      }
    }
  }
  return '';
}

function cookieOptions(req, maxAgeMs) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && req.secure,
    sameSite: 'lax',
    maxAge: maxAgeMs,
    path: '/'
  };
}

function browserRedirect(res, baseUrl, params = null) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (params && Object.keys(params).length > 0) {
    const qs = new URLSearchParams(params).toString();
    return res.redirect(302, `${baseUrl}?${qs}`);
  }
  return res.redirect(302, baseUrl);
}

// GET /api/sso/config
router.get('/config', (req, res) => {
  const cfg = getSsoConfig();
  const enabled = isSsoConfigured();
  res.json({
    enabled,
    mode: 'authorization_code',
    labspaceUrl: enabled ? cfg.labspaceUrl : '',
    labspaceLoginUrl: enabled ? `${cfg.labspaceUrl}/accounts/sso/login/` : ''
  });
});

// GET /api/sso/login - Инициировать вход в DocFlow через LabSpace (DocFlow -> LabSpace authorize)
router.get('/login', (req, res) => {
  if (!isSsoConfigured()) {
    return res.status(404).end();
  }

  const cfg = getSsoConfig();
  const state = crypto.randomBytes(32).toString('base64url');
  appCache.set(`sso_in_state:${sha256Hex(state)}`, { createdAt: Date.now() }, ATTEMPT_TTL_MS);
  res.cookie('docflow_sso_state', state, cookieOptions(req, ATTEMPT_TTL_MS));
  return browserRedirect(res, `${cfg.labspaceUrl}/accounts/sso/authorize/`, { state });
});

// GET /api/sso/labspace - Выдать одноразовый code для LabSpace (с проверкой state) или начать вход в LabSpace
router.get('/labspace', authenticateTokenOptional, async (req, res) => {
  if (!isSsoConfigured()) {
    if (req.query.mode === 'json') {
      return res.status(404).json({ error: 'SSO не настроен' });
    }
    return res.status(404).end();
  }

  const cfg = getSsoConfig();
  const resume = req.query.resume === '1';
  const queryState = String(req.query.state || '').trim();
  const cookieOutState = parseCookie(req, 'docflow_sso_out_state');
  const state = queryState || (resume ? cookieOutState : '');

  // Кнопка "LabSpace" внутри шапки DocFlow (без state): отправляем на старт входа LabSpace,
  // чтобы LabSpace сам создал state в своей браузерной сессии и вернул браузер сюда.
  if (!state) {
    const startUrl = `${cfg.labspaceUrl}/accounts/sso/login/`;
    if (req.query.mode === 'json') {
      return res.json({ redirectUrl: startUrl });
    }
    return browserRedirect(res, startUrl);
  }

  if (!OPAQUE_VALUE.test(state)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  if (!req.user) {
    res.cookie('docflow_sso_out_state', state, cookieOptions(req, ATTEMPT_TTL_MS));
    return browserRedirect(res, '/', { sso_authorize: '1' });
  }

  try {
    const userRes = await db.query(
      'SELECT id, email, totp_enabled FROM users WHERE id = $1',
      [req.user.id]
    );
    if (userRes.rows.length === 0) {
      return res.status(403).json({ error: 'access_denied' });
    }
    const user = userRes.rows[0];
    if (!user.totp_enabled) {
      return res.status(403).json({ error: 'access_denied' });
    }

    res.clearCookie('docflow_sso_out_state', { path: '/' });

    const code = crypto.randomBytes(32).toString('base64url');
    appCache.set(
      `sso_out_code:${sha256Hex(code)}`,
      {
        state,
        userId: user.id,
        sub: String(user.id),
        email: user.email,
        amr: ['totp']
      },
      CODE_TTL_MS
    );

    return browserRedirect(res, `${cfg.labspaceUrl}/accounts/sso/callback/`, { code, state });
  } catch (err) {
    console.error('[SSO] Authorize for LabSpace error:', err);
    return browserRedirect(res, '/', { sso_error: 'Ошибка формирования кода сквозного входа' });
  }
});

// POST /api/sso/code/exchange - Серверный обмен одноразового authorization code (вызывается сервером LabSpace)
router.post('/code/exchange', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isSsoConfigured()) {
    return res.status(404).end();
  }

  const cfg = getSsoConfig();
  const expectedAuth = `Bearer ${cfg.labspaceClientSecret}`;
  if (!constantTimeEqual(req.headers.authorization || '', expectedAuth)) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  const code = String(req.body?.code || '');
  const state = String(req.body?.state || '');
  if (!OPAQUE_VALUE.test(code) || !OPAQUE_VALUE.test(state)) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  const cacheKey = `sso_out_code:${sha256Hex(code)}`;
  const record = appCache.get(cacheKey);
  if (!record || !constantTimeEqual(record.state, state)) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  // Атомарное одноразовое погашение кода
  appCache.delete(cacheKey);

  try {
    const userRes = await db.query(
      'SELECT id, email, totp_enabled FROM users WHERE id = $1',
      [record.userId]
    );
    if (userRes.rows.length === 0 || !userRes.rows[0].totp_enabled) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    const user = userRes.rows[0];
    return res.json({
      sub: String(user.id),
      email: user.email,
      amr: ['totp']
    });
  } catch (err) {
    console.error('[SSO] Code exchange DB lookup error:', err);
    return res.status(400).json({ error: 'invalid_grant' });
  }
});

// GET /api/sso/callback - Callback при входе в DocFlow через LabSpace (?code=...&state=...)
router.get('/callback', async (req, res) => {
  if (!isSsoConfigured()) {
    return res.status(404).end();
  }

  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  const cookieState = parseCookie(req, 'docflow_sso_state');
  res.clearCookie('docflow_sso_state', { path: '/' });

  if (!OPAQUE_VALUE.test(code) || !OPAQUE_VALUE.test(state) || !cookieState || !constantTimeEqual(cookieState, state)) {
    return browserRedirect(res, '/', { sso_error: 'Недействительное состояние SSO (state). Повторите вход.' });
  }

  const stateCacheKey = `sso_in_state:${sha256Hex(state)}`;
  if (!appCache.get(stateCacheKey)) {
    return browserRedirect(res, '/', { sso_error: 'Срок попытки входа истёк. Повторите вход.' });
  }
  appCache.delete(stateCacheKey);

  let payload;
  try {
    const cfg = getSsoConfig();
    const formBody = new URLSearchParams({ code, state }).toString();
    const resp = await fetch(`${cfg.labspaceInternalUrl}/accounts/sso/code/exchange/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.docflowClientSecret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: formBody,
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });

    const rawText = await resp.text();
    if (resp.status !== 200 || Buffer.byteLength(rawText, 'utf8') > 8192) {
      return browserRedirect(res, '/', { sso_error: 'Не удалось подтвердить код авторизации на стороне LabSpace.' });
    }
    payload = JSON.parse(rawText);
  } catch (err) {
    console.error('[SSO] LabSpace back-channel exchange failed');
    return browserRedirect(res, '/', { sso_error: 'Не удалось связаться с LabSpace для завершения входа.' });
  }

  const externalId = payload && typeof payload.sub === 'string' ? payload.sub : '';
  if (!externalId || externalId.length > 128 || externalId !== externalId.trim()) {
    return browserRedirect(res, '/', { sso_error: 'Некорректный идентификатор пользователя от LabSpace.' });
  }

  const externalEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';

  try {
    const linkRes = await db.query(
      `SELECT l.id AS link_id, l.user_id
       FROM sso_links l
       WHERE l.provider = $1 AND l.external_user_id = $2`,
      [PROVIDER_LABSPACE, externalId]
    );

    if (linkRes.rows.length > 0) {
      const userId = linkRes.rows[0].user_id;
      const userRes = await db.query(`${authRouter.USER_WITH_ROLE_SQL} WHERE u.id = $1`, [userId]);
      if (userRes.rows.length === 0) {
        return browserRedirect(res, '/', { sso_error: 'Привязанный пользователь DocFlow не найден.' });
      }
      const user = userRes.rows[0];
      if (externalEmail) {
        await db.query('UPDATE sso_links SET external_email = $1 WHERE id = $2', [externalEmail, linkRes.rows[0].link_id]).catch(() => {});
      }

      const { token, tokenPayload } = authRouter.issueSessionToken(req, res, user);
      const exchangeCode = crypto.randomBytes(24).toString('hex');
      appCache.set(
        `sso_exchange:${exchangeCode}`,
        { token, user: { ...tokenPayload, totp_enabled: Boolean(user.totp_enabled) } },
        30 * 1000
      );
      return browserRedirect(res, '/', { sso_code: exchangeCode });
    }

    const linkToken = jwt.sign(
      {
        purpose: 'sso_link',
        provider: PROVIDER_LABSPACE,
        external_user_id: externalId,
        email: externalEmail
      },
      JWT_SECRET,
      { expiresIn: '10m' }
    );
    return browserRedirect(res, '/', { sso_link: linkToken });
  } catch (err) {
    console.error('[SSO] Callback DB error:', err);
    return browserRedirect(res, '/', { sso_error: 'Ошибка обработки сквозного входа.' });
  }
});

// POST /api/sso/exchange - Обмен внутреннего одноразового кода браузера на JWT-сессию DocFlow
router.post('/exchange', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const code = String(req.body?.code || '').trim();
  if (!code) {
    return res.status(400).json({ error: 'Отсутствует код обмена SSO' });
  }
  const cacheKey = `sso_exchange:${code}`;
  const sessionData = appCache.get(cacheKey);
  if (!sessionData) {
    return res.status(401).json({ error: 'Код сквозного входа устарел или уже использован' });
  }
  appCache.delete(cacheKey);
  return res.json(sessionData);
});

// POST /api/sso/link - Привязать внешний аккаунт к текущему авторизованному пользователю DocFlow
router.post('/link', authenticateToken, async (req, res) => {
  const linkToken = String(req.body?.linkToken || '').trim();
  if (!linkToken) {
    return res.status(400).json({ error: 'Отсутствует токен привязки' });
  }

  let decoded;
  try {
    decoded = jwt.verify(linkToken, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Срок действия ссылки привязки истёк. Повторите переход.' });
  }

  if (decoded.purpose !== 'sso_link' || !decoded.provider || !decoded.external_user_id) {
    return res.status(400).json({ error: 'Некорректный токен привязки аккаунта' });
  }

  try {
    const conflict = await db.query(
      'SELECT user_id FROM sso_links WHERE provider = $1 AND external_user_id = $2',
      [decoded.provider, String(decoded.external_user_id)]
    );
    if (conflict.rows.length > 0 && conflict.rows[0].user_id !== req.user.id) {
      return res.status(409).json({ error: 'Этот аккаунт LabSpace уже привязан к другому пользователю DocFlow' });
    }

    await db.query(
      `INSERT INTO sso_links (user_id, provider, external_user_id, external_email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, provider)
       DO UPDATE SET external_user_id = EXCLUDED.external_user_id, external_email = EXCLUDED.external_email`,
      [req.user.id, decoded.provider, String(decoded.external_user_id), String(decoded.email || '').slice(0, 255)]
    );

    return res.json({ success: true, provider: decoded.provider, external_user_id: String(decoded.external_user_id) });
  } catch (err) {
    console.error('[SSO] Link save error:', err);
    return res.status(500).json({ error: 'Ошибка сохранения привязки аккаунта' });
  }
});

// POST /api/sso/admin/link - Привязка администратором вручную
router.post('/admin/link', authenticateToken, async (req, res) => {
  if ((req.user.role || '').toUpperCase() !== 'ADMIN') {
    return res.status(403).json({ error: 'Требуются права администратора' });
  }
  const userId = parseInt(req.body?.user_id, 10);
  const externalUserId = String(req.body?.external_user_id || '').trim();
  const provider = String(req.body?.provider || PROVIDER_LABSPACE).trim();
  const externalEmail = String(req.body?.external_email || '').trim().toLowerCase();

  if (!userId || !externalUserId) {
    return res.status(400).json({ error: 'Укажите user_id и external_user_id' });
  }

  try {
    await db.query(
      `INSERT INTO sso_links (user_id, provider, external_user_id, external_email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, provider)
       DO UPDATE SET external_user_id = EXCLUDED.external_user_id, external_email = EXCLUDED.external_email`,
      [userId, provider, externalUserId, externalEmail.slice(0, 255)]
    );
    return res.json({ success: true });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Указанный внешний ID уже привязан к другому пользователю' });
    }
    console.error('[SSO] Admin link error:', err);
    return res.status(500).json({ error: 'Ошибка привязки аккаунта' });
  }
});

module.exports = router;
