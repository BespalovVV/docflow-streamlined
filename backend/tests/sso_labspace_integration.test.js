/**
 * Интеграционный тест двустороннего SSO (DocFlow <-> LabSpace)
 * Проверяет соответствие протоколу одноразового кода в LabSpace-v2-DocFlow-SSO/labspace/accounts/sso.py.
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const OPAQUE_RE = /^[A-Za-z0-9_-]{32,128}$/;

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function run() {
  // 1. Локальный HTTP-мок LabSpace (имитирует /accounts/sso/code/exchange/ из accounts/sso.py)
  const expectedDocflowSecret = crypto.randomBytes(32).toString('base64url');
  const expectedLabspaceSecret = crypto.randomBytes(32).toString('base64url');
  const labspaceCodes = new Map();

  const labspaceMock = express();
  labspaceMock.use(express.urlencoded({ extended: false }));
  labspaceMock.post('/accounts/sso/code/exchange/', (req, res) => {
    const expectedAuth = `Bearer ${expectedDocflowSecret}`;
    if (req.headers.authorization !== expectedAuth) {
      return res.status(401).json({ error: 'invalid_client' });
    }
    const { code, state } = req.body || {};
    const rec = labspaceCodes.get(code);
    if (!rec || rec.state !== state) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    labspaceCodes.delete(code);
    return res.json({ sub: rec.sub, email: rec.email, amr: ['totp'] });
  });

  const mockSrv = await startServer(labspaceMock);

  // Сохраняем исходные env
  const prevEnv = {
    SSO_LABSPACE_URL: process.env.SSO_LABSPACE_URL,
    SSO_LABSPACE_INTERNAL_URL: process.env.SSO_LABSPACE_INTERNAL_URL,
    SSO_LABSPACE_CLIENT_SECRET: process.env.SSO_LABSPACE_CLIENT_SECRET,
    SSO_DOCFLOW_CLIENT_SECRET: process.env.SSO_DOCFLOW_CLIENT_SECRET,
    SSO_ALLOW_HTTP: process.env.SSO_ALLOW_HTTP
  };

  let docflowSrv = null;
  let createdAdminId = null;

  try {
    // Настраиваем env до подключения роутера
    process.env.SSO_LABSPACE_URL = 'https://labspace.example.test';
    process.env.SSO_LABSPACE_INTERNAL_URL = mockSrv.baseUrl;
    process.env.SSO_LABSPACE_CLIENT_SECRET = expectedLabspaceSecret;
    process.env.SSO_DOCFLOW_CLIENT_SECRET = expectedDocflowSecret;
    delete process.env.SSO_ALLOW_HTTP;

    const ssoRouter = require('../routes/sso');
    const docflowApp = express();
    docflowApp.use(express.json());
    docflowApp.use(express.urlencoded({ extended: true }));
    docflowApp.use('/api/sso', ssoRouter);
    docflowSrv = await startServer(docflowApp);

    // Проверка конфигурации: неполная / http без SSO_ALLOW_HTTP должна отключать SSO
    process.env.SSO_LABSPACE_URL = 'http://labspace.example.test';
    let r = await fetch(`${docflowSrv.baseUrl}/api/sso/config`);
    let j = await r.json();
    assert.equal(j.enabled, false, 'HTTP без SSO_ALLOW_HTTP должен отключаться');

    // Проверка одинаковых секретов — должно быть отключено
    process.env.SSO_LABSPACE_URL = 'https://labspace.example.test';
    process.env.SSO_DOCFLOW_CLIENT_SECRET = expectedLabspaceSecret;
    r = await fetch(`${docflowSrv.baseUrl}/api/sso/config`);
    j = await r.json();
    assert.equal(j.enabled, false, 'Одинаковые секреты должны отключать SSO');

    // Возвращаем корректную пару секретов
    process.env.SSO_DOCFLOW_CLIENT_SECRET = expectedDocflowSecret;
    r = await fetch(`${docflowSrv.baseUrl}/api/sso/config`);
    j = await r.json();
    assert.equal(j.enabled, true, 'При корректной конфигурации SSO должно быть включено');
    assert.equal(j.mode, 'authorization_code');
    assert.equal(j.labspaceLoginUrl, 'https://labspace.example.test/accounts/sso/login/');

    // Находим пользователя с totp_enabled=true (или временно включаем у первого админа и вернём после теста)
    const userQ = await db.query('SELECT id, email, role, full_name, totp_enabled FROM users ORDER BY id ASC LIMIT 1');
    assert.ok(userQ.rows.length > 0, 'В БД должен быть хотя бы 1 пользователь для теста');
    const testUser = userQ.rows[0];
    const origTotp = Boolean(testUser.totp_enabled);
    if (!origTotp) {
      await db.query('UPDATE users SET totp_enabled = TRUE WHERE id = $1', [testUser.id]);
      createdAdminId = testUser.id;
    }

    const userToken = jwt.sign(
      { id: testUser.id, email: testUser.email, role: testUser.role, full_name: testUser.full_name },
      JWT_SECRET,
      { expiresIn: '5m' }
    );

    // 2. Сценарий: вход в LabSpace (LabSpace -> DocFlow /api/sso/labspace?state=... -> LabSpace /accounts/sso/callback -> DocFlow POST /api/sso/code/exchange)
    const lsState = crypto.randomBytes(32).toString('base64url');
    const authRes = await fetch(`${docflowSrv.baseUrl}/api/sso/labspace?state=${encodeURIComponent(lsState)}`, {
      headers: { Authorization: `Bearer ${userToken}` },
      redirect: 'manual'
    });
    assert.equal(authRes.status, 302, 'Должен быть редирект 302 на callback LabSpace');
    const loc = authRes.headers.get('location');
    assert.ok(loc && loc.startsWith('https://labspace.example.test/accounts/sso/callback/?'), `Неожиданный Location: ${loc}`);
    const cbUrl = new URL(loc);
    const issuedCode = cbUrl.searchParams.get('code');
    const returnedState = cbUrl.searchParams.get('state');
    assert.equal(returnedState, lsState, 'State должен совпадать');
    assert.match(issuedCode, OPAQUE_RE, 'Выданный code должен быть URL-safe 32-128 символов');

    // Неверный Bearer секрет -> 401 invalid_client
    const badClientRes = await fetch(`${docflowSrv.baseUrl}/api/sso/code/exchange`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wrong_secret_value_12345678901234567890',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ code: issuedCode, state: lsState }).toString()
    });
    assert.equal(badClientRes.status, 401);
    assert.equal((await badClientRes.json()).error, 'invalid_client');

    // Неверный state -> 400 invalid_grant
    const badStateExchange = await fetch(`${docflowSrv.baseUrl}/api/sso/code/exchange`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${expectedLabspaceSecret}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ code: issuedCode, state: crypto.randomBytes(32).toString('base64url') }).toString()
    });
    assert.equal(badStateExchange.status, 400);
    assert.equal((await badStateExchange.json()).error, 'invalid_grant');

    // Успешный обмен -> 200 { sub, email, amr: ['totp'] }
    const okExchange = await fetch(`${docflowSrv.baseUrl}/api/sso/code/exchange`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${expectedLabspaceSecret}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ code: issuedCode, state: lsState }).toString()
    });
    assert.equal(okExchange.status, 200);
    const okPayload = await okExchange.json();
    assert.equal(okPayload.sub, String(testUser.id));
    assert.equal(okPayload.email, testUser.email);
    assert.deepEqual(okPayload.amr, ['totp']);

    // Повторное использование того же кода -> 400 invalid_grant (атомарное погашение)
    const replayRes = await fetch(`${docflowSrv.baseUrl}/api/sso/code/exchange`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${expectedLabspaceSecret}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ code: issuedCode, state: lsState }).toString()
    });
    assert.equal(replayRes.status, 400);
    assert.equal((await replayRes.json()).error, 'invalid_grant');

    // 3. Сценарий: вход в DocFlow (DocFlow /api/sso/login -> LabSpace authorize -> DocFlow /api/sso/callback -> LabSpace POST /accounts/sso/code/exchange/)
    const loginRes = await fetch(`${docflowSrv.baseUrl}/api/sso/login`, { redirect: 'manual' });
    assert.equal(loginRes.status, 302);
    const setCookie = loginRes.headers.get('set-cookie') || '';
    const cookieMatch = setCookie.match(/docflow_sso_state=([^;]+)/);
    assert.ok(cookieMatch, 'Должна установиться cookie docflow_sso_state');
    const docflowStateCookie = `docflow_sso_state=${cookieMatch[1]}`;
    const authorizeLoc = new URL(loginRes.headers.get('location'));
    assert.equal(authorizeLoc.pathname, '/accounts/sso/authorize/');
    const dfState = authorizeLoc.searchParams.get('state');
    assert.match(dfState, OPAQUE_RE);

    // Имитация выдачи кода со стороны LabSpace
    const mockLabspaceCode = crypto.randomBytes(32).toString('base64url');
    labspaceCodes.set(mockLabspaceCode, {
      state: dfState,
      sub: 'ls_test_user_999',
      email: 'labspace_user@example.test'
    });

    const dfCallbackRes = await fetch(
      `${docflowSrv.baseUrl}/api/sso/callback?code=${encodeURIComponent(mockLabspaceCode)}&state=${encodeURIComponent(dfState)}`,
      {
        headers: { Cookie: docflowStateCookie },
        redirect: 'manual'
      }
    );
    assert.equal(dfCallbackRes.status, 302);
    const dfRedirect = new URL(dfCallbackRes.headers.get('location'), 'https://docflow.example.test');
    assert.ok(
      dfRedirect.searchParams.has('sso_link') || dfRedirect.searchParams.has('sso_code'),
      `Ожидался sso_link или sso_code в редиректе: ${dfRedirect.toString()}`
    );
    assert.equal(labspaceCodes.size, 0, 'Код на стороне LabSpace должен быть погашен');

    console.log('SSO_LABSPACE_INTEGRATION_OK: all checks passed');
  } finally {
    if (createdAdminId) {
      await db.query('UPDATE users SET totp_enabled = FALSE WHERE id = $1', [createdAdminId]).catch(() => {});
    }
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (docflowSrv) await stopServer(docflowSrv.server);
    await stopServer(mockSrv.server);
    await db.pool.end().catch(() => {});
  }
}

run().catch((err) => {
  console.error('SSO_TEST_FAILED:', err);
  process.exit(1);
});
