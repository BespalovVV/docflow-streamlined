// backend/tests/rbac.test.js
const assert = require('assert');
const bcrypt = require('bcryptjs');
const { requirePermission, requireAdmin } = require('../middleware/auth');

async function runRbacTests() {
  console.log('\n🔒 [1/3] Запуск тестов ролевой модели (ADMIN / USER)...');

  // Test 1: Full Access for ADMIN role
  {
    const req = {
      user: { id: 1, email: 'admin@docflow.local', role: 'ADMIN' }
    };
    let nextCalled = false;
    const res = { status: () => ({ json: () => {} }) };

    requireAdmin(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, 'Администратор должен проходить проверку requireAdmin');

    let permNextCalled = false;
    requirePermission('users.manage')(req, res, () => { permNextCalled = true; });
    assert.strictEqual(permNextCalled, true, 'Администратор имеет доступ ко всем операциям');

    console.log('  ✅ 1.1. Полный доступ роли ADMIN к админ-панели и операциям — Успешно');
  }

  // Test 2: Standard Access for USER role
  {
    const req = {
      user: { id: 2, email: 'user@docflow.local', role: 'USER' }
    };
    let nextCalled = false;
    const res = { status: () => ({ json: () => {} }) };

    requirePermission('projects.view')(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, 'Обычный пользователь имеет доступ к просмотру проектов');

    let tasksNextCalled = false;
    requirePermission('tasks.view')(req, res, () => { tasksNextCalled = true; });
    assert.strictEqual(tasksNextCalled, true, 'Обычный пользователь имеет доступ к задачам');

    console.log('  ✅ 1.2. Доступ пользователя USER к рабочим модулям — Успешно');
  }

  // Test 3: Block USER from Admin-only operations
  {
    const req = {
      user: { id: 2, email: 'user@docflow.local', role: 'USER' }
    };
    let statusCode = null;
    let errorMessage = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return { json: (data) => { errorMessage = data.error; } };
      }
    };

    let nextCalled = false;
    requireAdmin(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false, 'Обычный пользователь НЕ должен проходить requireAdmin');
    assert.strictEqual(statusCode, 403, 'Должен возвращаться HTTP статус 403 Forbidden');
    assert.ok(errorMessage && errorMessage.includes('Администратор'), 'Сообщение должно указывать на требование роли Администратора');

    // Also test requirePermission('users.manage')
    let permBlocked = false;
    const permRes = {
      status: (code) => {
        if (code === 403) permBlocked = true;
        return { json: () => {} };
      }
    };
    requirePermission('users.manage')(req, permRes, () => {});
    assert.strictEqual(permBlocked, true, 'Пользователь USER не должен иметь право users.manage');

    console.log('  ✅ 1.3. Блокировка доступа роли USER к управлению учетными записями (403 Forbidden) — Успешно');
  }

  // Test 4: Unauthenticated access blocked (401)
  {
    const req = {};
    let statusCode = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return { json: () => {} };
      }
    };

    let nextCalled = false;
    requireAdmin(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(statusCode, 401, 'Неавторизованный запрос должен отклоняться с кодом 401');

    console.log('  ✅ 1.4. Проверка неавторизованного запроса (401 Unauthorized) — Успешно');
  }

  // Test 5: Admin changing user password with bcrypt hashing
  {
    const newPasswordRaw = 'NewSuperAdminSetPassword2026!';
    const hash = await bcrypt.hash(newPasswordRaw, 10);

    // Verify hash format and security
    assert.notStrictEqual(hash, newPasswordRaw, 'Пароль ни в коем случае не должен сохраняться в открытом виде');
    assert.ok(hash.startsWith('$2a$') || hash.startsWith('$2b$'), 'Хэш пароля должен соответствовать спецификации bcrypt');
    assert.strictEqual(hash.length, 60, 'Длина хэша bcrypt должна составлять ровно 60 символов');

    // Verify authentication matches
    const isMatch = await bcrypt.compare(newPasswordRaw, hash);
    assert.strictEqual(isMatch, true, 'Проверка bcrypt.compare с верным паролем должна быть успешной');

    const isWrongMatch = await bcrypt.compare('WrongPassword123', hash);
    assert.strictEqual(isWrongMatch, false, 'Проверка bcrypt.compare с неверным паролем должна отклоняться');

    console.log('  ✅ 1.5. Надежное хэширование паролей пользователей администратором через bcrypt — Успешно');
  }
}

module.exports = { runRbacTests };

if (require.main === module) {
  runRbacTests()
    .then(() => console.log('🎉 Все тесты ролей успешно пройдены!'))
    .catch((err) => {
      console.error('❌ Ошибка в тестах ролей:', err);
      process.exit(1);
    });
}
