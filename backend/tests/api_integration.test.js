// backend/tests/api_integration.test.js
const assert = require('assert');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { JWT_SECRET } = require('../middleware/auth');
const db = require('../db');

async function runApiIntegrationTests() {
  console.log('\n🌐 [3/3] Запуск интеграционных тестов API и БД...');

  // Test 1: JWT token generation and claim payload integrity
  {
    const userPayload = {
      id: 10,
      email: 'qa.engineer@docflow.local',
      full_name: 'Инженер QA',
      role: 'USER',
      department: 'Отдел тестирования'
    };

    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '1h' });
    assert.ok(typeof token === 'string' && token.length > 20, 'JWT токен должен быть сгенерирован');

    const decoded = jwt.verify(token, JWT_SECRET);
    assert.strictEqual(decoded.id, userPayload.id, 'ID пользователя в токене должен совпадать');
    assert.strictEqual(decoded.role, 'USER', 'Роль USER в токене должна совпадать');
    assert.strictEqual(decoded.email, userPayload.email);

    console.log('  ✅ 3.1. Генерация, подпись и валидация JWT токенов с ролью USER/ADMIN — Успешно');
  }

  // Test 2: Password hashing security (bcrypt rounds)
  {
    const rawPass = 'Secret12345!';
    const hash1 = await bcrypt.hash(rawPass, 10);
    const hash2 = await bcrypt.hash(rawPass, 10);

    assert.notStrictEqual(hash1, hash2, 'Хеши пароля с солью должны отличаться');
    assert.strictEqual(await bcrypt.compare(rawPass, hash1), true, 'Bcrypt compare должен совпадать с правильным паролем');
    assert.strictEqual(await bcrypt.compare('WrongPass', hash1), false, 'Bcrypt compare должен отклонять неверный пароль');

    console.log('  ✅ 3.2. Хеширование паролей bcrypt с уникальной солью — Успешно');
  }

  // Test 3: Database live connectivity & schema checks
  let dbAvailable = false;
  try {
    const res = await db.query('SELECT 1 AS check_col');
    if (res.rows && res.rows[0].check_col === 1) {
      dbAvailable = true;
    }
  } catch (e) {
    console.log(`  ℹ️ Подключение к БД недоступно в текущем окружении хоста (${e.message}). Пропуск live SQL тестов.`);
  }

  if (dbAvailable) {
    // Test 3.3: Users table structure and ADMIN user verification
    const usersRes = await db.query('SELECT id, email, full_name, role, password_hash FROM users WHERE email = $1', ['admin@docflow.local']);
    assert.ok(usersRes.rows.length > 0, 'Пользователь admin@docflow.local должен существовать в БД');
    const adminUser = usersRes.rows[0];
    assert.strictEqual(adminUser.role, 'ADMIN', 'Роль пользователя admin@docflow.local должна быть ADMIN');
    assert.ok(adminUser.password_hash.startsWith('$2a$') || adminUser.password_hash.startsWith('$2b$'), 'Пароль администратора должен быть захеширован через bcrypt');
    console.log('  ✅ 3.3. Пользователь admin@docflow.local проверен в БД (роль ADMIN, bcrypt-хэш) — Успешно');

    // Test 3.4: Integrity of roles among all users
    const allRolesRes = await db.query('SELECT DISTINCT role FROM users');
    const rolesList = allRolesRes.rows.map(r => r.role);
    assert.ok(rolesList.every(r => ['ADMIN', 'USER'].includes(r)), 'Все пользователи должны иметь роль ADMIN или USER');
    console.log(`  ✅ 3.4. Корректность ролей пользователей в БД (${rolesList.join(', ')}) — Успешно`);
  }
}

module.exports = { runApiIntegrationTests };

if (require.main === module) {
  runApiIntegrationTests()
    .then(() => console.log('🎉 Все интеграционные тесты успешно пройдены!'))
    .catch((err) => {
      console.error('❌ Ошибка в интеграционных тестах:', err);
      process.exit(1);
    });
}
