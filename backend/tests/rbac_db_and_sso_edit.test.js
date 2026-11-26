/**
 * Проверка прав ADMIN/USER на уровнях БД (триггеры PostgreSQL), API (Express routes)
 * и стабильности SSO после редактирования профиля/email пользователя.
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../db');
const { JWT_SECRET, invalidateUserCache } = require('../middleware/auth');

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function run() {
  await db.initDb();

  // 1. Проверка триггеров целостности на уровне PostgreSQL (в транзакции с SAVEPOINT/ROLLBACK)
  const adminRes = await db.query("SELECT id, email, full_name, role, totp_enabled FROM users WHERE role = 'ADMIN' ORDER BY id ASC LIMIT 2");
  assert.ok(adminRes.rows.length >= 1, 'Должен существовать хотя бы 1 ADMIN');
  const mainAdmin = adminRes.rows[0];
  const secondAdmin = adminRes.rows[1] || null;

  await db.withTransaction(async (client) => {
    // 1.1 Понижение роли ADMIN напрямую в БД запрещено
    await client.query('SAVEPOINT sp_demote');
    await assert.rejects(
      client.query("UPDATE users SET role = 'USER' WHERE id = $1", [mainAdmin.id]),
      (err) => err.code === '42501',
      'Триггер БД должен блокировать понижение роли ADMIN -> USER'
    );
    await client.query('ROLLBACK TO SAVEPOINT sp_demote');

    // 1.2 Изменение id пользователя напрямую в БД запрещено
    await client.query('SAVEPOINT sp_chg_id');
    await assert.rejects(
      client.query('UPDATE users SET id = $1 WHERE id = $2', [999991, mainAdmin.id]),
      (err) => err.code === '42501',
      'Триггер БД должен блокировать изменение users.id'
    );
    await client.query('ROLLBACK TO SAVEPOINT sp_chg_id');

    // 1.3 Удаление ADMIN напрямую в БД запрещено
    await client.query('SAVEPOINT sp_del_admin');
    await assert.rejects(
      client.query('DELETE FROM users WHERE id = $1', [mainAdmin.id]),
      (err) => err.code === '42501',
      'Триггер БД должен блокировать DELETE учётной записи ADMIN'
    );
    await client.query('ROLLBACK TO SAVEPOINT sp_del_admin');

    // 1.4 Изменение владельца sso_links.user_id напрямую в БД запрещено
    await client.query('SAVEPOINT sp_sso_owner');
    const linkCheck = await client.query('SELECT id FROM sso_links WHERE user_id = $1 LIMIT 1', [mainAdmin.id]);
    if (linkCheck.rows.length > 0) {
      const otherUser = await client.query("SELECT id FROM users WHERE role = 'USER' LIMIT 1");
      if (otherUser.rows.length > 0) {
        await assert.rejects(
          client.query('UPDATE sso_links SET user_id = $1 WHERE id = $2', [otherUser.rows[0].id, linkCheck.rows[0].id]),
          (err) => err.code === '42501',
          'Триггер БД должен блокировать смену user_id у существующей sso_links записи'
        );
      }
    }
    await client.query('ROLLBACK TO SAVEPOINT sp_sso_owner');

    // 1.5 Чек-ограничение роли на некорректное значение
    await client.query('SAVEPOINT sp_bad_role');
    await assert.rejects(
      client.query("UPDATE users SET role = 'SUPERROOT' WHERE id = $1", [mainAdmin.id]),
      (err) => err.code === '23514' || err.code === '42501',
      'CHECK constraint должен запрещать неизвестные роли'
    );
    await client.query('ROLLBACK TO SAVEPOINT sp_bad_role');
  });
  console.log('  ✅ 1. Уровень БД (PostgreSQL триггеры и CHECK): все инварианты защищены');

  // 2. Проверка уровня API (Express) и сохранности SSO после редактирования
  const prevEnv = {
    SSO_LABSPACE_URL: process.env.SSO_LABSPACE_URL,
    SSO_LABSPACE_CLIENT_SECRET: process.env.SSO_LABSPACE_CLIENT_SECRET,
    SSO_DOCFLOW_CLIENT_SECRET: process.env.SSO_DOCFLOW_CLIENT_SECRET
  };
  const s1 = crypto.randomBytes(32).toString('base64url');
  const s2 = crypto.randomBytes(32).toString('base64url');
  process.env.SSO_LABSPACE_URL = 'https://labspace.example.test';
  process.env.SSO_LABSPACE_CLIENT_SECRET = s1;
  process.env.SSO_DOCFLOW_CLIENT_SECRET = s2;

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/users', require('../routes/users'));
  app.use('/api/conferences', require('../routes/conferences'));
  app.use('/api/sso', require('../routes/sso'));
  const srv = await startServer(app);

  const regularUserRes = await db.query("SELECT id, email, role, full_name FROM users WHERE role = 'USER' ORDER BY id ASC LIMIT 1");
  const regularUser = regularUserRes.rows[0];
  const userToken = jwt.sign({ id: regularUser.id, email: regularUser.email, role: 'USER', full_name: regularUser.full_name }, JWT_SECRET, { expiresIn: '5m' });
  const adminToken = jwt.sign({ id: mainAdmin.id, email: mainAdmin.email, role: 'ADMIN', full_name: mainAdmin.full_name }, JWT_SECRET, { expiresIn: '5m' });

  const origEmail = mainAdmin.email;
  const origTotp = Boolean(mainAdmin.totp_enabled);

  try {
    // 2.1 USER блокируется (403) на всех административных маршрутах
    const userBlockedChecks = [
      ['/api/users/stats', 'GET', null],
      ['/api/users', 'POST', { email: 'x@test.local', password: '123', full_name: 'X' }],
      [`/api/users/${regularUser.id}`, 'PATCH', { role: 'ADMIN' }],
      [`/api/users/${mainAdmin.id}`, 'DELETE', null],
      [`/api/users/${regularUser.id}/reset-2fa`, 'POST', null],
      ['/api/conferences/formats', 'POST', { name: 'ForbiddenFormat' }],
      ['/api/sso/admin/link', 'POST', { user_id: regularUser.id, external_user_id: '9999' }]
    ];
    for (const [url, method, body] of userBlockedChecks) {
      const r = await fetch(`${srv.baseUrl}${url}`, {
        method,
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      });
      assert.equal(r.status, 403, `USER должен получать 403 на ${method} ${url}, получено ${r.status}`);
    }

    // 2.2 ADMIN не может понизить себя до USER
    const demoteSelf = await fetch(`${srv.baseUrl}/api/users/${mainAdmin.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'USER' })
    });
    assert.equal(demoteSelf.status, 403, 'ADMIN не должен иметь права понизить свою роль до USER');

    // 2.3 ADMIN не может удалить себя или другого ADMIN, и не может сбросить 2FA для ADMIN
    const delSelf = await fetch(`${srv.baseUrl}/api/users/${mainAdmin.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(delSelf.status, 403);

    const resetSelf2fa = await fetch(`${srv.baseUrl}/api/users/${mainAdmin.id}/reset-2fa`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(resetSelf2fa.status, 403);

    if (secondAdmin) {
      const demoteOther = await fetch(`${srv.baseUrl}/api/users/${secondAdmin.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'USER' })
      });
      assert.equal(demoteOther.status, 403, 'ADMIN не должен понижать другого ADMIN до USER');

      const delOther = await fetch(`${srv.baseUrl}/api/users/${secondAdmin.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(delOther.status, 403, 'ADMIN не должен удалять другого ADMIN');
    }

    // 2.4 ADMIN может сменить себе email; id, totp_enabled и работа SSO сохраняются
    if (!origTotp) {
      await db.query('UPDATE users SET totp_enabled = TRUE WHERE id = $1', [mainAdmin.id]);
    }
    const newEmail = `admin.updated.${Date.now()}@docflow.local`;
    const updSelf = await fetch(`${srv.baseUrl}/api/users/${mainAdmin.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail, full_name: mainAdmin.full_name, role: 'ADMIN' })
    });
    assert.equal(updSelf.status, 200, 'ADMIN должен успешно сменить собственный email');
    const updJson = await updSelf.json();
    assert.equal(updJson.id, mainAdmin.id, 'Идентификатор пользователя (id) не должен меняться');
    assert.equal(updJson.email, newEmail);
    assert.equal(updJson.role, 'ADMIN');
    assert.equal(Boolean(updJson.totp_enabled), true);
    assert.ok(updJson.refreshedToken, 'При редактировании себя должен выдаваться обновлённый JWT');

    // Проверяем, что сразу после смены email работает SSO-авторизация и обмен кодов (sub остаётся прежним, email новый)
    const state = crypto.randomBytes(32).toString('base64url');
    const ssoAuthRes = await fetch(`${srv.baseUrl}/api/sso/labspace?state=${encodeURIComponent(state)}`, {
      headers: { Authorization: `Bearer ${updJson.refreshedToken}` },
      redirect: 'manual'
    });
    assert.equal(ssoAuthRes.status, 302, 'SSO-редирект должен работать после смены email');
    const cbUrl = new URL(ssoAuthRes.headers.get('location'));
    const code = cbUrl.searchParams.get('code');

    const exchRes = await fetch(`${srv.baseUrl}/api/sso/code/exchange`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${s1}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ code, state }).toString()
    });
    assert.equal(exchRes.status, 200);
    const exchPayload = await exchRes.json();
    assert.equal(exchPayload.sub, String(mainAdmin.id), 'SSO sub (стабильный ID) обязан остаться неизменным');
    assert.equal(exchPayload.email, newEmail, 'SSO должен отдавать обновлённый email');

    console.log('  ✅ 2. Уровень API (ADMIN/USER защита, смена собственного email, непрерывность SSO): все проверки пройдены');
  } finally {
    await db.query('UPDATE users SET email = $1, totp_enabled = $2 WHERE id = $3', [origEmail, origTotp, mainAdmin.id]).catch(() => {});
    invalidateUserCache(mainAdmin.id);
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await new Promise((r) => srv.server.close(r));
    await db.pool.end().catch(() => {});
  }
}

run().catch((err) => {
  console.error('❌ RBAC/SSO test failed:', err);
  process.exit(1);
});
