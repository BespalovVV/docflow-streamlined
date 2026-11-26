// backend/tests/search.test.js
const assert = require('assert');
const db = require('../db');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');
const { extractTextFromFile, extractFromPlainText } = require('../utils/text_extractor');
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

  return {
    status: res.status,
    ok: res.ok,
    data
  };
}

async function runSearchTests() {
  console.log('\n--- ТЕСТИРОВАНИЕ СВЕРХЛЕГКОВЕСНОГО УМНОГО ПОИСКА И RAG ---');

  // 1. Test Text Extractor unit
  const sampleBuf = Buffer.from('Положение об оплате труда и премировании работников за 2026 год.', 'utf8');
  const plainExtracted = extractFromPlainText(sampleBuf);
  assert.ok(plainExtracted.includes('Положение об оплате труда'), 'Текст должен корректно извлекаться из буфера');
  console.log('  ✓ 1. Модуль text_extractor успешно извлекает текст');

  // 2. Test Chunker unit
  const longText = 'Параграф первый о правилах безопасности в офисе. '.repeat(40) + '\n\n' +
                   'Параграф второй о регламенте командировок и суточных. '.repeat(40);
  const chunks = chunkText(longText, { maxWords: 100, overlap: 20 });
  assert.ok(chunks.length >= 2, 'Длинный текст должен разбиваться минимум на 2 чанка');
  assert.ok(chunks[0].wordCount > 0, 'Чанк должен содержать слова');
  console.log(`  ✓ 2. Модуль chunker разбил текст на ${chunks.length} семантических чанков с перекрытием`);

  // 3. Test Embedder unit
  const vec1 = generateEmbedding('Договор поставки промышленного оборудования');
  const vec2 = generateEmbedding('Соглашение о закупке станков и техники');
  const vec3 = generateEmbedding('Рецепт приготовления яблочного пирога');

  assert.strictEqual(vec1.length, 128, 'Вектор должен иметь размерность 128');
  const simRelated = cosineSimilarity(vec1, vec2);
  const simUnrelated = cosineSimilarity(vec1, vec3);

  assert.ok(simRelated > simUnrelated, `Смысловое сходство тематических текстов (${simRelated.toFixed(3)}) должно быть выше посторонних (${simUnrelated.toFixed(3)})`);
  console.log(`  ✓ 3. Модуль embedder: вектор 128-dim, сходство по теме=${simRelated.toFixed(3)} vs чужое=${simUnrelated.toFixed(3)}`);

  // Ensure test users
  const authorRes = await db.query("SELECT id FROM users WHERE email = 'user_author@test.local'");
  const authorId = authorRes.rows[0].id;
  const viewerRes = await db.query("SELECT id FROM users WHERE email = 'user_viewer@test.local'");
  const viewerId = viewerRes.rows[0].id;

  const authorToken = generateToken({ id: authorId, email: 'user_author@test.local', role: 'USER' });
  const viewerToken = generateToken({ id: viewerId, email: 'user_viewer@test.local', role: 'USER' });

  // 4. Create document with unique text and test fast FTS + indexing
  const docCreateRes = await apiRequest('/api/documents/create', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authorToken}` },
    body: {
      title: 'Регламент командировок и компенсации суточных 2026',
      type: 'txt',
      category: 'Приказы',
      is_public: true
    }
  });

  assert.strictEqual(docCreateRes.status, 201);
  const testDoc = docCreateRes.data;

  // Write searchable content to file and trigger indexing
  const fs = require('fs');
  const path = require('path');
  const uploadsDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const localFilePath = (testDoc.file_path && fs.existsSync(testDoc.file_path)) 
    ? testDoc.file_path 
    : path.join(uploadsDir, testDoc.file_name);
  fs.writeFileSync(localFilePath, 'Настоящий регламент определяет порядок выплаты суточных в размере трех тысяч рублей за каждый день служебной командировки сотрудника компании.');

  // Run fast FTS indexer
  await searchQueue.indexFastFts(testDoc.id, localFilePath, 'txt');
  await searchQueue.processDocument(testDoc.id, localFilePath, 'txt');

  // Verify indexed in DB
  const dbCheck = await db.query('SELECT content_text, content_tsv, indexed_at FROM documents WHERE id = $1', [testDoc.id]);
  assert.ok(dbCheck.rows[0].content_text.includes('суточных'), 'content_text должен быть сохранен в БД');
  assert.ok(dbCheck.rows[0].indexed_at !== null, 'indexed_at должен быть выставлен');
  console.log('  ✓ 4. Мгновенная индексация FTS и семантических чанков в БД подтверждена');

  // 5. Test search query via API
  const searchRes = await apiRequest('/api/search?q=командировки суточных', {
    headers: { Authorization: `Bearer ${authorToken}` }
  });

  assert.strictEqual(searchRes.status, 200);
  const results = searchRes.data;
  assert.ok(Array.isArray(results), 'Результаты поиска должны быть массивом');
  const found = results.find(r => r.id === testDoc.id);
  if (!found) {
    console.log('DEBUG: Search failed to find doc #', testDoc.id, 'Query: "командировки суточных". Results returned:', results.map(r => ({ id: r.id, title: r.title, score: r.score })));
  }
  assert.ok(found, 'Документ должен быть найден по словам "командировки суточных"');
  assert.ok(found.snippet, 'Результат должен содержать сниппет с цитатой');
  console.log(`  ✓ 5. Поисковый запрос "/api/search?q=командировки суточных" успешно нашел документ #${found.id} со сниппетом`);

  // 6. Test RBAC: viewer can see public document in search, but not private
  const searchViewerRes = await apiRequest('/api/search?q=суточных', {
    headers: { Authorization: `Bearer ${viewerToken}` }
  });
  assert.strictEqual(searchViewerRes.status, 200);
  const foundViewer = searchViewerRes.data.find(r => r.id === testDoc.id);
  assert.ok(foundViewer, 'Посторонний пользователь видит общедоступный документ в поиске');

  // Toggle to private
  await apiRequest(`/api/documents/${testDoc.id}/toggle-public`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authorToken}` }
  });

  // Now viewer must NOT see it in search
  const searchViewerAfterRes = await apiRequest('/api/search?q=суточных', {
    headers: { Authorization: `Bearer ${viewerToken}` }
  });
  const foundAfter = searchViewerAfterRes.data.find(r => r.id === testDoc.id);
  assert.strictEqual(foundAfter, undefined, 'Приватный документ стороннего автора не возвращается в поиске');
  console.log('  ✓ 6. Строгая RBAC изоляция в поиске подтверждена: приватные документы скрыты, общедоступные доступны');

  // 7. Test /api/search/status endpoint
  const statusRes = await apiRequest('/api/search/status', {
    headers: { Authorization: `Bearer ${authorToken}` }
  });
  assert.strictEqual(statusRes.status, 200);
  assert.ok(typeof statusRes.data.totalDocuments === 'number', 'totalDocuments должен быть числом');
  assert.ok(typeof statusRes.data.indexedDocuments === 'number', 'indexedDocuments должен быть числом');
  console.log(`  ✓ 7. Статус индексатора: ${statusRes.data.indexedDocuments}/${statusRes.data.totalDocuments} документов проиндексировано`);

  // Clean up
  await db.query('DELETE FROM documents WHERE id = $1', [testDoc.id]);
  if (fs.existsSync(testDoc.file_path)) {
    try { fs.unlinkSync(testDoc.file_path); } catch (e) {}
  }
  console.log('  ✓ Очистка тестовых данных завершена');
}

module.exports = { runSearchTests };

if (require.main === module) {
  runSearchTests()
    .then(() => {
      console.log('✅ Все тесты умного поиска пройдены успешно!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Ошибка в тестах поиска:', err);
      process.exit(1);
    });
}
