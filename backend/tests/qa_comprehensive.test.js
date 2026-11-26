const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');
const { extractTextFromFile, extractFromPdf, extractFromPlainText } = require('../utils/text_extractor');
const { chunkText } = require('../utils/chunker');
const { generateEmbedding, cosineSimilarity } = require('../utils/embedder');
const searchQueue = require('../utils/search_queue');

const BASE_URL = process.env.TEST_APP_URL || 'http://localhost:3000';

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

async function apiRequest(endpoint, options = {}) {
  const url = encodeURI(`${BASE_URL}${endpoint}`);
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

  return { status: res.status, ok: res.ok, data };
}

async function runComprehensiveQATests() {
  console.log('\n===============================================================');
  console.log('🧪 [QA SUITE] ГЛУБОКОЕ ТЕСТИРОВАНИЕ ПОИСКА, БЕЗОПАСНОСТИ И RAG');
  console.log('===============================================================');

  // --- 1. Подготовка тестовых учетных записей для матрицы доступа ---
  // Пользователь А: Сотрудник ИТ отдела
  let userA = (await db.query("SELECT id FROM users WHERE email = 'qa_employee_a@test.local'")).rows[0];
  if (!userA) {
    const r = await db.query(`
      INSERT INTO users (email, password_hash, full_name, role, department, position)
      VALUES ('qa_employee_a@test.local', 'hash', 'Алексей Тестовый (ИТ)', 'USER', 'ИТ', 'Инженер')
      RETURNING id
    `);
    userA = r.rows[0];
  }

  // Руководитель ИТ отдела (начальник Пользователя А)
  let bossIT = (await db.query("SELECT id FROM users WHERE email = 'qa_boss_it@test.local'")).rows[0];
  if (!bossIT) {
    const r = await db.query(`
      INSERT INTO users (email, password_hash, full_name, role, department, position)
      VALUES ('qa_boss_it@test.local', 'hash', 'Иван Начальство (ИТ)', 'USER', 'ИТ', 'Руководитель ИТ')
      RETURNING id
    `);
    bossIT = r.rows[0];
  }
  // Назначаем руководителя
  await db.query('UPDATE users SET manager_id = $1 WHERE id = $2', [bossIT.id, userA.id]);

  // Руководитель Финансового отдела (чужой руководитель)
  let bossFinance = (await db.query("SELECT id FROM users WHERE email = 'qa_boss_fin@test.local'")).rows[0];
  if (!bossFinance) {
    const r = await db.query(`
      INSERT INTO users (email, password_hash, full_name, role, department, position)
      VALUES ('qa_boss_fin@test.local', 'hash', 'Ольга Бухгалтерия (Фин)', 'USER', 'Финансы', 'Главбух')
      RETURNING id
    `);
    bossFinance = r.rows[0];
  }

  // Сторонний сотрудник
  let userB = (await db.query("SELECT id FROM users WHERE email = 'qa_employee_b@test.local'")).rows[0];
  if (!userB) {
    const r = await db.query(`
      INSERT INTO users (email, password_hash, full_name, role, department, position)
      VALUES ('qa_employee_b@test.local', 'hash', 'Борис Сторонний (Кадры)', 'USER', 'Кадры', 'Рекрутер')
      RETURNING id
    `);
    userB = r.rows[0];
  }

  const tokenA = generateToken({ id: userA.id, email: 'qa_employee_a@test.local', role: 'USER' });
  const tokenBossIT = generateToken({ id: bossIT.id, email: 'qa_boss_it@test.local', role: 'USER' });
  const tokenBossFin = generateToken({ id: bossFinance.id, email: 'qa_boss_fin@test.local', role: 'USER' });
  const tokenB = generateToken({ id: userB.id, email: 'qa_employee_b@test.local', role: 'USER' });

  console.log('✅ 1. Матрица тестовых ролей и пользователей инициализирована');

  // --- 2. Тестирование устойчивости экстрактора текста к повреждениям ---
  console.log('\n[Блок 1: Устойчивость текстового экстрактора к аномальным данным]');
  
  // 2.1 Пустой буфер
  const emptyRes = extractFromPlainText(Buffer.alloc(0));
  assert.strictEqual(emptyRes, '', 'Пустой буфер возвращает пустую строку');
  console.log('  ✓ 2.1. Пустой буфер обрабатывается без исключений');

  // 2.2 Поврежденный бинарный буфер (псевдо-PDF с битыми заголовками)
  const corruptPdf = Buffer.from('%PDF-1.7\nstream\n\x00\xFF\xAA\xBB\xCC\xDDendstream\n%%EOF');
  const corruptPdfRes = extractFromPdf(corruptPdf);
  assert.strictEqual(corruptPdfRes, '', 'Поврежденный PDF возвращает пустую строку, не выбрасывая ошибку');
  console.log('  ✓ 2.2. Битый/поврежденный PDF не роняет процесс и возвращает чистый результат');

  // 2.3 Сканированный PDF без текста не выдает бинарный шум
  const mockScanPdf = Buffer.from(
    '%PDF-1.7\n1 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode >>\nstream\n' +
    ',01444 22222222222222222 456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz\nendstream\nendobj\n%%EOF'
  );
  const scanRes = extractFromPdf(mockScanPdf);
  assert.strictEqual(scanRes, '', 'Графический скан без текстового слоя не должен отдавать бинарные заголовки или байты JPEG');
  console.log('  ✓ 2.3. Изоляция бинарных данных: сканы JPEG не загрязняют поисковый индекс');

  // 2.4 Декодирование русских строк в CP1251
  // Строка "Регламент" в CP1251 octal: \320\345\343\353\340\354\345\355\362
  const octalSample = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nstream\nBT /F1 12 Tf (\\320\\345\\343\\353\\340\\354\\345\\355\\362) Tj ET\nendstream\nendobj\n');
  const octalRes = extractFromPdf(octalSample);
  assert.ok(octalRes.includes('Регламент'), `Октальные CP1251 строки должны декодироваться в русский текст, получено: "${octalRes}"`);
  console.log('  ✓ 2.4. Восьмеричные CP1251/WinAnsi строки успешно декодированы в кириллицу');

  // --- 3. Тестирование граничных случаев поискового API ---
  console.log('\n[Блок 2: Граничные случаи и защита от инъекций в Поисковом API]');

  // 3.1 Пустой запрос
  const emptySearch = await apiRequest('/api/search?q=', { headers: { Authorization: `Bearer ${tokenA}` } });
  assert.strictEqual(emptySearch.status, 200);
  assert.deepStrictEqual(emptySearch.data, [], 'Пустой запрос возвращает пустой массив');
  console.log('  ✓ 3.1. Пустой запрос q="" корректно возвращает []');

  // 3.2 Запрос из одних пробелов
  const spaceSearch = await apiRequest('/api/search?q=%20%20%20', { headers: { Authorization: `Bearer ${tokenA}` } });
  assert.strictEqual(spaceSearch.status, 200);
  assert.deepStrictEqual(spaceSearch.data, [], 'Запрос из пробелов возвращает []');
  console.log('  ✓ 3.2. Запрос из одних пробелов возвращает []');

  // 3.3 SQL-инъекция и спецсимволы
  const sqlInjectionQuery = "' OR '1'='1' -- /* <script>alert(1)</script> */";
  const sqlRes = await apiRequest(`/api/search?q=${encodeURIComponent(sqlInjectionQuery)}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(sqlRes.status, 200, 'Запрос с кавычками и SQL-конструкциями должен безопасно отрабатывать (200 OK)');
  assert.ok(Array.isArray(sqlRes.data), 'Ответ должен быть массивом');
  console.log('  ✓ 3.3. Защита от SQL-инъекций и XSS: специальные символы экранированы параметризацией');

  // 3.4 Поиск по wildcard спецсимволам SQL (%) и (_)
  const wildcardRes = await apiRequest('/api/search?q=%25%20_%20%25', { headers: { Authorization: `Bearer ${tokenA}` } });
  assert.strictEqual(wildcardRes.status, 200);
  console.log('  ✓ 3.4. SQL Wildcards (% и _) не ломают регулярный поиск');

  // 3.5 Сверхдлинный запрос (> 500 символов)
  const longQuery = 'договор поставки оборудования '.repeat(20);
  const longRes = await apiRequest(`/api/search?q=${encodeURIComponent(longQuery)}`, { headers: { Authorization: `Bearer ${tokenA}` } });
  assert.strictEqual(longRes.status, 200);
  console.log('  ✓ 3.5. Сверхдлинный запрос (> 500 символов) успешно обработан без сбоев стека');

  // 3.6 Несуществующее слово
  const nonexistent = await apiRequest('/api/search?q=несуществующийтермин987654321', { headers: { Authorization: `Bearer ${tokenA}` } });
  assert.strictEqual(nonexistent.status, 200);
  assert.strictEqual(nonexistent.data.length, 0, 'По несуществующему слову должно быть 0 результатов');
  console.log('  ✓ 3.6. Поиск по несуществующему термину возвращает 0 результатов');

  // --- 4. Тестирование безопасности RBAC и динамической приватности ---
  console.log('\n[Блок 3: Тестирование безопасности RBAC, иерархии и переключения is_public]');

  // Создаем секретный документ Пользователем А
  const secretKey = 'СЕКРЕТ_КВАНТОВОГО_ЯДРА_2026';
  const docCreate = await apiRequest('/api/documents/create', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: {
      title: 'Секретный проект квантового ядра 2026',
      type: 'txt',
      category: 'ИТ разработки',
      is_public: false
    }
  });
  assert.strictEqual(docCreate.status, 201);
  const secretDoc = docCreate.data;

  // Записываем секретный текст в файл и индексируем
  const uploadsDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const localSecretPath = (secretDoc.file_path && fs.existsSync(secretDoc.file_path))
    ? secretDoc.file_path
    : path.join(uploadsDir, secretDoc.file_name);
  fs.writeFileSync(localSecretPath, `Совершенно секретно. В рамках разработки используется ключ ${secretKey}. Доступ третьим лицам строго запрещен.`);
  await searchQueue.indexFastFts(secretDoc.id, localSecretPath, 'txt');
  await searchQueue.processDocument(secretDoc.id, localSecretPath, 'txt');

  // 4.1 Автор видит свой приватный документ в поиске
  const searchA = await apiRequest(`/api/search?q=${encodeURIComponent(secretKey)}`, { headers: { Authorization: `Bearer ${tokenA}` } });
  assert.ok(searchA.data.some(d => d.id === secretDoc.id), 'Автор должен находить свой приватный документ');
  console.log('  ✓ 4.1. Автор успешно находит свой приватный документ');

  // 4.2 Руководитель ИТ видит приватный документ подчиненного (Пользователя А)
  const searchBossIT = await apiRequest(`/api/search?q=${encodeURIComponent(secretKey)}`, { headers: { Authorization: `Bearer ${tokenBossIT}` } });
  assert.ok(searchBossIT.data.some(d => d.id === secretDoc.id), 'Прямой руководитель видит документы подчиненного');
  console.log('  ✓ 4.2. Прямой руководитель ИТ видит приватный документ подчиненного');

  // 4.3 Чужой руководитель (Финансы) НЕ видит приватный документ сотрудника другого отдела
  const searchBossFin = await apiRequest(`/api/search?q=${encodeURIComponent(secretKey)}`, { headers: { Authorization: `Bearer ${tokenBossFin}` } });
  assert.ok(!searchBossFin.data.some(d => d.id === secretDoc.id), 'Чужой руководитель НЕ должен видеть документ другого отдела');
  console.log('  ✓ 4.3. Строгая изоляция отделов: руководитель Финансов НЕ видит приватный документ ИТ');

  // 4.4 Сторонний пользователь Б НЕ видит чужой приватный документ
  const searchB1 = await apiRequest(`/api/search?q=${encodeURIComponent(secretKey)}`, { headers: { Authorization: `Bearer ${tokenB}` } });
  assert.ok(!searchB1.data.some(d => d.id === secretDoc.id), 'Сторонний пользователь НЕ должен видеть приватный документ');
  console.log('  ✓ 4.4. Сторонний пользователь НЕ видит чужой приватный документ в выдаче');

  // 4.5 Автор делает документ ОБЩЕДОСТУПНЫМ (toggle-public -> true)
  const toggleToPublic = await apiRequest(`/api/documents/${secretDoc.id}/toggle-public`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(toggleToPublic.status, 200);
  assert.strictEqual(toggleToPublic.data.is_public, true);

  // Теперь Пользователь Б СРАЗУ видит его в поиске!
  const searchB2 = await apiRequest(`/api/search?q=${encodeURIComponent(secretKey)}`, { headers: { Authorization: `Bearer ${tokenB}` } });
  const foundPub = searchB2.data.find(d => d.id === secretDoc.id);
  assert.ok(foundPub, 'После включения is_public сторонний пользователь должен находить документ');
  assert.strictEqual(foundPub.is_public, true);
  console.log('  ✓ 4.5. Динамическая видимость: после toggle-public документ мгновенно доступен Пользователю Б');

  // 4.6 Защита ONLYOFFICE для общедоступного документа
  const ooConfig = await apiRequest(`/api/documents/${secretDoc.id}/onlyoffice-config`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(ooConfig.status, 200);
  assert.strictEqual(ooConfig.data.editorConfig.mode, 'view', 'Для общедоступного документа режим строго view');
  assert.strictEqual(ooConfig.data.document.permissions.edit, false, 'Редактирование строго запрещено');
  console.log('  ✓ 4.6. Безопасность ONLYOFFICE: общедоступный документ открывается сторонним пользователем только для чтения');

  // 4.7 Попытка несанкционированного изменения/удаления общедоступного документа
  const tryDelete = await apiRequest(`/api/documents/${secretDoc.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(tryDelete.status, 403, 'Удаление чужого общедоступного документа должно блокироваться с кодом 403');
  console.log('  ✓ 4.7. Блокировка удаления чужого общедоступного документа (403 Forbidden)');

  // 4.8 Автор отзывает общедоступность (toggle-public -> false)
  const toggleToPrivate = await apiRequest(`/api/documents/${secretDoc.id}/toggle-public`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(toggleToPrivate.status, 200);
  assert.strictEqual(toggleToPrivate.data.is_public, false);

  // Пользователь Б больше НЕ видит его
  const searchB3 = await apiRequest(`/api/search?q=${encodeURIComponent(secretKey)}`, { headers: { Authorization: `Bearer ${tokenB}` } });
  assert.ok(!searchB3.data.some(d => d.id === secretDoc.id), 'После отзыва общедоступности документ скрылся из поиска Пользователя Б');
  console.log('  ✓ 4.8. Мгновенный отзыв доступа: документ снова скрыт от сторонних лиц');

  // Очистка тестового документа
  await db.query('DELETE FROM documents WHERE id = $1', [secretDoc.id]);

  // --- 5. Замер быстродействия и производительности (Benchmark) ---
  console.log('\n[Блок 4: Замер производительности и SLA отклика]');

  // 5.1 Замер скорости генерации эмбеддинга
  const embedStart = performance.now();
  for (let i = 0; i < 100; i++) {
    generateEmbedding('Договор оказания консультационных и информационных услуг по внедрению систем управления');
  }
  const embedDurationMs = (performance.now() - embedStart) / 100;
  assert.ok(embedDurationMs < 1.0, `Генерация эмбеддинга должна занимать < 1 мс, получено: ${embedDurationMs.toFixed(3)} мс`);
  console.log(`  ✓ 5.1. Скорость инференса эмбеддера: ${embedDurationMs.toFixed(3)} мс на документ (SLA < 1.0 мс)`);

  // 5.2 Замер скорости API гибридного поиска (с прогревом соединения)
  await apiRequest('/api/search?q=тест', { headers: { Authorization: `Bearer ${tokenA}` } });
  const searchStart = performance.now();
  const perfSearch = await apiRequest('/api/search?q=регламент', { headers: { Authorization: `Bearer ${tokenA}` } });
  const searchDurationMs = performance.now() - searchStart;
  assert.strictEqual(perfSearch.status, 200);
  assert.ok(searchDurationMs < 150.0, `Поисковый API должен отвечать < 150 мс, получено: ${searchDurationMs.toFixed(1)} мс`);
  console.log(`  ✓ 5.2. Скорость ответа API гибридного поиска: ${searchDurationMs.toFixed(1)} мс (SLA < 150 мс)`);

  console.log('\n===============================================================');
  console.log('🎉 ВСЕ ПРОВЕРКИ QA-СЬЮТА УСПЕШНО ПРОЙДЕНЫ БЕЗ ЕДИНОЙ ОШИБКИ!');
  console.log('===============================================================');
}

module.exports = { runComprehensiveQATests };

if (require.main === module) {
  runComprehensiveQATests()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Ошибка в QA тестах:', err);
      process.exit(1);
    });
}
