// backend/tests/two_factor_auth.test.js
// Сквозное тестирование обязательной двухфакторной аутентификации (2FA TOTP + резервные коды)
const assert = require('assert');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { generateTotp } = require('../utils/totp');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

async function apiJson(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function runTests() {
  console.log('=== [2FA E2E Test] Запуск проверки обязательной 2FA ===');
  const suffix = Date.now();
  const userEmail = `twofa_user_${suffix}@docflow.local`;
  const adminEmail = `twofa_admin_${suffix}@docflow.local`;
  const testPass = 'Strong2FATest!1';
  let userId = null;
  let adminId = null;

  try {
    const passHash = await bcrypt.hash(testPass, 10);

    const userIns = await db.query(
      `INSERT INTO users (email, password_hash, full_name, role, department, position)
       VALUES ($1, $2, $3, 'USER', 'QA', 'Инженер') RETURNING id`,
      [userEmail, passHash, 'Тестов 2FA Пользователь']
    );
    userId = userIns.rows[0].id;

    const adminIns = await db.query(
      `INSERT INTO users (email, password_hash, full_name, role, department, position)
       VALUES ($1, $2, $3, 'ADMIN', 'ИБ', 'Администратор') RETURNING id`,
      [adminEmail, passHash, 'Тестов 2FA Администратор']
    );
    adminId = adminIns.rows[0].id;

    // 1. Первый вход пользователя без настроенной 2FA -> требует QR-настройку
    const login1 = await apiJson('/api/auth/login', {
      method: 'POST',
      body: { email: userEmail, password: testPass }
    });
    assert.strictEqual(login1.status, 200, `Ожидался 200 на login, получен ${login1.status}`);
    assert.strictEqual(login1.data.requires2FASetup, true, 'При первом входе должен требоваться requires2FASetup');
    assert.ok(login1.data.preAuthToken, 'Должен выдаваться preAuthToken');
    assert.ok(!login1.data.token, 'Полноценный JWT не должен выдаваться до настройки 2FA');
    assert.ok(String(login1.data.qrDataUrl || '').startsWith('data:image/png;base64,'), 'QR-код должен быть PNG Data URL');
    assert.ok(login1.data.manualSecret && login1.data.manualSecret.length >= 16, 'Должен присутствовать Base32 секрет');
    console.log('✅ 1. Первый вход возвращает requires2FASetup, QR PNG и ручной секрет (без JWT)');

    const secret = login1.data.manualSecret;
    const setupToken = login1.data.preAuthToken;

    // 2. Попытка обойти 2FA и обратиться к API с preAuthToken -> 403
    const bypassAttempt = await apiJson('/api/documents', { token: setupToken });
    assert.strictEqual(bypassAttempt.status, 403, `preAuthToken не должен пускать в API (получен ${bypassAttempt.status})`);
    console.log('✅ 2. Временный preAuthToken отклоняется в защищённых роутах (HTTP 403)');

    // 3. Неверный код на подтверждении настройки -> 401
    const badConfirm = await apiJson('/api/auth/2fa/confirm-setup', {
      method: 'POST',
      body: { preAuthToken: setupToken, code: '000000' }
    });
    // На случай редкого совпадения случайного секрета с 000000 проверим 999999 если вдруг 200
    if (badConfirm.status === 200) {
      throw new Error('Маловероятное совпадение тестового кода 000000');
    }
    assert.strictEqual(badConfirm.status, 401, 'Неверный TOTP должен отклоняться со статусом 401');
    console.log('✅ 3. Неверный 6-значный код отклонён при активации 2FA');

    // 4. Верный TOTP-код активирует 2FA, выдаёт JWT и 8 резервных кодов
    const baseTs = Date.now();
    const setupTotp = generateTotp(secret, baseTs);
    const goodConfirm = await apiJson('/api/auth/2fa/confirm-setup', {
      method: 'POST',
      body: { preAuthToken: setupToken, code: setupTotp }
    });
    assert.strictEqual(goodConfirm.status, 200, `Ожидался 200 на confirm-setup: ${JSON.stringify(goodConfirm.data)}`);
    assert.ok(goodConfirm.data.token, 'Должен выдаться полноценный JWT');
    assert.strictEqual(goodConfirm.data.user.totp_enabled, true);
    assert.ok(Array.isArray(goodConfirm.data.backupCodes) && goodConfirm.data.backupCodes.length === 8, 'Должно выдаться 8 резервных кодов');
    console.log('✅ 4. Подтверждение 2FA активирует защиту, выдаёт JWT и 8 резервных кодов');

    // 5. Проверка /api/auth/me с полноценным токеном
    const meRes = await apiJson('/api/auth/me', { token: goodConfirm.data.token });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.totp_enabled, true);
    assert.strictEqual(meRes.data.backup_codes_remaining, 8);
    console.log('✅ 5. GET /api/auth/me отражает totp_enabled=true и 8 резервных кодов');

    // 6. Повторный вход -> requires2FA: true (без выдачи токена)
    const login2 = await apiJson('/api/auth/login', {
      method: 'POST',
      body: { email: userEmail, password: testPass }
    });
    assert.strictEqual(login2.status, 200);
    assert.strictEqual(login2.data.requires2FA, true, 'Повторный вход должен требовать 2FA-код');
    assert.ok(login2.data.preAuthToken);
    assert.ok(!login2.data.token);
    console.log('✅ 6. Повторный вход запрашивает 2FA (requires2FA=true)');

    // 7. Защита от replay: тот же код, использованный на шаге 4, должен быть отклонён
    const replayRes = await apiJson('/api/auth/2fa/verify', {
      method: 'POST',
      body: { preAuthToken: login2.data.preAuthToken, code: setupTotp }
    });
    assert.strictEqual(replayRes.status, 401, 'Повторное использование того же TOTP-кода должно блокироваться');
    console.log('✅ 7. Replay-защита блокирует повторный ввод использованного TOTP-кода');

    // 8. Вход по одноразовому резервному коду
    const backupCode0 = goodConfirm.data.backupCodes[0];
    const backupVerify = await apiJson('/api/auth/2fa/verify', {
      method: 'POST',
      body: { preAuthToken: login2.data.preAuthToken, code: backupCode0 }
    });
    assert.strictEqual(backupVerify.status, 200, `Ожидался 200 по резервному коду: ${JSON.stringify(backupVerify.data)}`);
    assert.ok(backupVerify.data.token);
    assert.strictEqual(backupVerify.data.usedBackupCode, true);
    assert.strictEqual(backupVerify.data.remainingBackupCodes, 7);
    console.log('✅ 8. Вход по резервному коду успешен, остаток уменьшился с 8 до 7');

    // 9. Повторное использование того же резервного кода должно отклоняться
    const login3 = await apiJson('/api/auth/login', {
      method: 'POST',
      body: { email: userEmail, password: testPass }
    });
    const backupReuse = await apiJson('/api/auth/2fa/verify', {
      method: 'POST',
      body: { preAuthToken: login3.data.preAuthToken, code: backupCode0 }
    });
    assert.strictEqual(backupReuse.status, 401, 'Одноразовый резервный код нельзя использовать дважды');
    console.log('✅ 9. Повторное использование резервного кода заблокировано');

    // 10. Подтверждаем настройку 2FA для тестового админа и сбрасываем 2FA у тестового пользователя
    const adminLogin = await apiJson('/api/auth/login', {
      method: 'POST',
      body: { email: adminEmail, password: testPass }
    });
    assert.strictEqual(adminLogin.data.requires2FASetup, true);
    const adminTotp = generateTotp(adminLogin.data.manualSecret, Date.now());
    const adminConfirm = await apiJson('/api/auth/2fa/confirm-setup', {
      method: 'POST',
      body: { preAuthToken: adminLogin.data.preAuthToken, code: adminTotp }
    });
    assert.strictEqual(adminConfirm.status, 200);
    const adminToken = adminConfirm.data.token;

    const resetRes = await apiJson(`/api/users/${userId}/reset-2fa`, {
      method: 'POST',
      token: adminToken
    });
    assert.strictEqual(resetRes.status, 200, `Сброс 2FA должен вернуть 200: ${JSON.stringify(resetRes.data)}`);

    // После сброса следующий вход снова требует первичной настройки по QR
    const loginAfterReset = await apiJson('/api/auth/login', {
      method: 'POST',
      body: { email: userEmail, password: testPass }
    });
    assert.strictEqual(loginAfterReset.status, 200);
    assert.strictEqual(loginAfterReset.data.requires2FASetup, true, 'После сброса админом пользователь снова проходит QR-настройку');
    console.log('✅ 10. Аварийный сброс 2FA администратором работает корректно');

    console.log('=== [2FA E2E Test] ВСЕ 10 ПРОВЕРОК ПРОЙДЕНЫ УСПЕШНО ===');
  } finally {
    if (userId) {
      await db.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    }
    if (adminId) {
      await db.query('DELETE FROM users WHERE id = $1', [adminId]).catch(() => {});
    }
    await db.pool.end().catch(() => {});
  }
}

runTests().catch((err) => {
  console.error('❌ [2FA E2E Test] Провал:', err);
  process.exit(1);
});
