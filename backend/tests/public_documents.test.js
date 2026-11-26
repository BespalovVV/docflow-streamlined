// backend/tests/public_documents.test.js
const assert = require('assert');
const db = require('../db');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

const BASE_URL = process.env.TEST_APP_URL || 'http://localhost:3000';

async function apiRequest(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  let body = options.body;
  if (body && typeof body === 'object') {
    body = JSON.stringify(body);
  }

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body
  });

  const contentType = res.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }

  return {
    status: res.status,
    ok: res.ok,
    data,
    headers: res.headers
  };
}

async function runPublicDocumentsTests() {
  console.log('\n--- ТЕСТИРОВАНИЕ ОБЩЕДОСТУПНЫХ ДОКУМЕНТОВ (IS_PUBLIC) ---');

  // Ensure test users exist in DB
  const userARes = await db.query("SELECT id, email, role FROM users WHERE email = 'user_author@test.local'");
  let userAId;
  if (userARes.rows.length === 0) {
    const ins = await db.query(`
      INSERT INTO users (email, password_hash, full_name, role, department, position)
      VALUES ('user_author@test.local', 'hash', 'Автор Общедоступный', 'USER', 'ИТ', 'Разработчик')
      RETURNING id
    `);
    userAId = ins.rows[0].id;
  } else {
    userAId = userARes.rows[0].id;
  }

  const userBRes = await db.query("SELECT id, email, role FROM users WHERE email = 'user_viewer@test.local'");
  let userBId;
  if (userBRes.rows.length === 0) {
    const ins = await db.query(`
      INSERT INTO users (email, password_hash, full_name, role, department, position)
      VALUES ('user_viewer@test.local', 'hash', 'Зритель Тестовый', 'USER', 'Бухгалтерия', 'Специалист')
      RETURNING id
    `);
    userBId = ins.rows[0].id;
  } else {
    userBId = userBRes.rows[0].id;
  }

  const tokenA = generateToken({ id: userAId, email: 'user_author@test.local', role: 'USER' });
  const tokenB = generateToken({ id: userBId, email: 'user_viewer@test.local', role: 'USER' });

  // 1. User A creates a public document
  const createPubRes = await apiRequest('/api/documents/create', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: {
      title: 'Общедоступный регламент компании',
      type: 'docx',
      category: 'Приказы',
      is_public: true
    }
  });

  assert.strictEqual(createPubRes.status, 201, 'Документ должен быть создан со статусом 201');
  const pubDoc = createPubRes.data;
  assert.strictEqual(pubDoc.is_public, true, 'is_public должен быть true');
  console.log('  ✓ 1. Пользователь А успешно создал общедоступный документ');

  // 2. User A creates a private document
  const createPrivRes = await apiRequest('/api/documents/create', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: {
      title: 'Секретная записка автора А',
      type: 'docx',
      category: 'Личное',
      is_public: false
    }
  });

  assert.strictEqual(createPrivRes.status, 201);
  const privDoc = createPrivRes.data;
  assert.strictEqual(privDoc.is_public, false, 'is_public должен быть false');
  console.log('  ✓ 2. Пользователь А успешно создал приватный документ');

  // 3. User B requests document list
  const listBRes = await apiRequest('/api/documents', {
    headers: { Authorization: `Bearer ${tokenB}` }
  });

  assert.strictEqual(listBRes.status, 200);
  const docsForB = listBRes.data;

  const foundPub = docsForB.find(d => d.id === pubDoc.id);
  const foundPriv = docsForB.find(d => d.id === privDoc.id);

  assert.ok(foundPub, 'Пользователь Б должен видеть общедоступный документ пользователя А');
  assert.strictEqual(foundPub.user_access_level, 'PUBLIC', 'Уровень доступа для не-владельца должен быть PUBLIC');
  assert.strictEqual(foundPriv, undefined, 'Пользователь Б НЕ должен видеть приватный документ пользователя А');
  console.log('  ✓ 3. Пользователь Б видит общедоступный документ (уровень PUBLIC), но приватный документ скрыт');

  // 4. User B requests ONLYOFFICE config for public doc
  const configBRes = await apiRequest(`/api/documents/${pubDoc.id}/onlyoffice-config`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });

  assert.strictEqual(configBRes.status, 200, 'Должен возвращаться конфиг ONLYOFFICE');
  assert.strictEqual(configBRes.data.editorConfig.mode, 'view', 'Для PUBLIC документов режим должен быть view (чтение)');
  assert.strictEqual(configBRes.data.document.permissions.edit, false, 'Право edit должно быть false для сторонних пользователей');
  console.log('  ✓ 4. Конфиг ONLYOFFICE для общедоступного документа открывается в безопасном режиме только для чтения');

  // 5. User B tries to modify or delete public doc (should fail 403)
  const patchRes = await apiRequest(`/api/documents/${pubDoc.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenB}` },
    body: { title: 'Попытка взлома названия' }
  });

  assert.strictEqual(patchRes.status, 403, 'Чужой пользователь не может изменять общедоступный документ');

  const deleteRes = await apiRequest(`/api/documents/${pubDoc.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenB}` }
  });

  assert.strictEqual(deleteRes.status, 403, 'Чужой пользователь не может удалять общедоступный документ');
  console.log('  ✓ 5. Сторонний пользователь не может изменять или удалять чужой общедоступный документ (403)');

  // 6. User A toggles public status
  const toggleRes = await apiRequest(`/api/documents/${pubDoc.id}/toggle-public`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` }
  });

  assert.strictEqual(toggleRes.status, 200);
  assert.strictEqual(toggleRes.data.is_public, false, 'После переключения документ стал приватным');

  // Now User B should no longer see it
  const listBAfterRes = await apiRequest('/api/documents', {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  const foundPubAfter = listBAfterRes.data.find(d => d.id === pubDoc.id);
  assert.strictEqual(foundPubAfter, undefined, 'После отзыва общедоступности документ скрылся из списка Пользователя Б');
  console.log('  ✓ 6. Быстрое переключение toggle-public успешно меняет приватность документа');

  // Clean up test documents
  await db.query('DELETE FROM documents WHERE id IN ($1, $2)', [pubDoc.id, privDoc.id]);
  console.log('  ✓ Очистка тестовых данных завершена');
}

module.exports = { runPublicDocumentsTests };

if (require.main === module) {
  runPublicDocumentsTests()
    .then(() => {
      console.log('✅ Все тесты общедоступных документов пройдены успешно!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Ошибка в тестах:', err);
      process.exit(1);
    });
}
