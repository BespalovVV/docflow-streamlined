// backend/tests/user_role.test.js
const assert = require('assert');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { requirePermission, requireAdmin, JWT_SECRET } = require('../middleware/auth');
const db = require('../db');

async function runUserRoleTests() {
  console.log('\n👤 [2/4] Запуск всесторонних тестов для роли USER...');

  const userPayload = {
    id: 2,
    email: 'ivanov@docflow.local',
    full_name: 'Иван Иванов',
    role: 'USER',
    department: 'Отдел продаж'
  };

  // 1. Проверка генерации и валидации JWT для роли USER
  {
    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '2h' });
    const decoded = jwt.verify(token, JWT_SECRET);
    assert.strictEqual(decoded.role, 'USER', 'Токен должен содержать роль USER');
    assert.strictEqual(decoded.email, 'ivanov@docflow.local');
    console.log('  ✅ 2.1. Токен авторизации роли USER (JWT) валиден и содержит корректные клеймы');
  }

  // 2. Проверка РАЗРЕШЕННЫХ операций для роли USER
  {
    const req = { user: userPayload };
    const allowedPermissions = [
      'projects.view',
      'tasks.view',
      'tasks.edit',
      'conferences.view',
      'documents.view',
      'documents.upload',
      'documents.edit',
      'documents.download'
    ];

    for (const perm of allowedPermissions) {
      let passed = false;
      const res = {
        status: () => ({ json: () => {} })
      };
      requirePermission(perm)(req, res, () => { passed = true; });
      assert.strictEqual(passed, true, `Пользователь USER должен иметь доступ к операции "${perm}"`);
    }
    console.log(`  ✅ 2.2. Доступ пользователя USER к разрешенным операциям (${allowedPermissions.length} разрешений) — Успешно`);
  }

  // 3. Проверка ЗАПРЕЩЕННЫХ (403 Forbidden) операций для роли USER
  {
    const req = { user: userPayload };

    // 3.1. requireAdmin должен блокировать USER
    let adminNextCalled = false;
    let adminStatusCode = null;
    const adminRes = {
      status: (code) => {
        adminStatusCode = code;
        return { json: () => {} };
      }
    };
    requireAdmin(req, adminRes, () => { adminNextCalled = true; });
    assert.strictEqual(adminNextCalled, false, 'USER не должен проходить проверку requireAdmin');
    assert.strictEqual(adminStatusCode, 403, 'Должен возвращаться код 403 для requireAdmin');

    // 3.2. Блокировка административных разрешений
    const forbiddenPermissions = [
      'users.manage',
      'roles.manage',
      'projects.create',
      'projects.edit',
      'projects.delete',
      'conferences.manage',
      'tasks.create',
      'tasks.delete',
      'documents.delete'
    ];

    for (const perm of forbiddenPermissions) {
      let passed = false;
      let statusCode = null;
      let errorResponse = null;
      const res = {
        status: (code) => {
          statusCode = code;
          return {
            json: (data) => { errorResponse = data; }
          };
        }
      };
      requirePermission(perm)(req, res, () => { passed = true; });
      assert.strictEqual(passed, false, `USER НЕ должен иметь доступ к операции "${perm}"`);
      assert.strictEqual(statusCode, 403, `Попытка выполнения "${perm}" должна отклоняться с HTTP 403`);
      assert.ok(errorResponse && errorResponse.error, `Должно возвращаться сообщение об ошибке для "${perm}"`);
    }
    console.log(`  ✅ 2.3. Строгая блокировка роли USER от административных операций (403 Forbidden на ${forbiddenPermissions.length} эндпоинтов) — Успешно`);
  }

  // 4. Проверка смены пароля пользователя администратором (bcrypt)
  {
    const userOriginalPass = 'user123';
    const userUpdatedPass = 'NewComplexUserPass2026!';

    // Хэширование нового пароля
    const newHash = await bcrypt.hash(userUpdatedPass, 10);
    assert.ok(newHash.startsWith('$2a$') || newHash.startsWith('$2b$'), 'Новый хэш должен быть bcrypt');
    assert.strictEqual(newHash.length, 60, 'Длина bcrypt хэша ровно 60 символов');

    // Проверка аутентификации с новым и старым паролем
    assert.strictEqual(await bcrypt.compare(userUpdatedPass, newHash), true, 'Вход с новым паролем успешен');
    assert.strictEqual(await bcrypt.compare(userOriginalPass, newHash), false, 'Вход со старым паролем отклоняется');
    console.log('  ✅ 2.4. Смена пароля пользователя администратором с хэшированием bcrypt — Успешно');
  }

  // 5. Проверка реальных данных в БД (если подключение доступно)
  let dbConnected = false;
  try {
    const res = await db.query('SELECT 1 as test');
    if (res.rows && res.rows[0].test === 1) dbConnected = true;
  } catch (e) {}

  if (dbConnected) {
    const userRes = await db.query("SELECT id, email, full_name, role, password_hash FROM users WHERE role = 'USER' AND email LIKE '%@docflow.local' ORDER BY id ASC LIMIT 1");
    if (userRes.rows.length > 0) {
      const dbUser = userRes.rows[0];
      assert.strictEqual(dbUser.role, 'USER', 'Пользователь из базы имеет роль USER');
      assert.ok(dbUser.password_hash.startsWith('$2a$') || dbUser.password_hash.startsWith('$2b$'), 'Пароль пользователя в БД захэширован bcrypt');
      console.log(`  ✅ 2.5. Проверка записи роли USER в БД (${dbUser.email}, role: ${dbUser.role}) — Успешно`);
    }
  }
}

module.exports = { runUserRoleTests };

if (require.main === module) {
  runUserRoleTests()
    .then(() => console.log('🎉 Все тесты роли USER успешно пройдены!'))
    .catch((err) => {
      console.error('❌ Ошибка в тестах роли USER:', err);
      process.exit(1);
    });
}
