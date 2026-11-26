// backend/tests/rag_unified_qa.test.js
// Сквозной E2E-тест Фазы 2: pgvector HNSW + ONNX multilingual-e5-small + Единая база знаний
// (Документы + Материалы проектов + Вложения почты) + Extractive QA + Ближайший вариант + RBAC

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const searchQueue = require('../utils/search_queue');

const BASE_URL = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';

async function reqJson(endpoint, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

async function runUnifiedRagQaTests() {
  console.log('\n===============================================================');
  console.log('🧠 E2E ТЕСТ ФАЗЫ 2: PGVECTOR + ONNX + EXTRACTIVE QA + 3 ИСТОЧНИКА');
  console.log('===============================================================');

  const createdDocIds = [];
  const createdMatIds = [];
  const createdFiles = [];

  try {
    // 1. Логин админа и обычного сотрудника
    const adminLogin = await reqJson('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@docflow.local', password: 'admin123' }
    });
    assert.strictEqual(adminLogin.status, 200);
    const adminToken = adminLogin.data.token;

    const userLogin = await reqJson('/api/auth/login', {
      method: 'POST',
      body: { email: 'ivanov@docflow.local', password: 'Test1234!' }
    });
    assert.strictEqual(userLogin.status, 200);
    const userToken = userLogin.data.token;

    // 2. Проверка Gzip сжатия на GET /js/app.js
    const gzipCheck = await fetch(`${BASE_URL}/js/app.js`, {
      headers: { 'Accept-Encoding': 'gzip' }
    });
    assert.strictEqual(gzipCheck.status, 200);
    const enc = gzipCheck.headers.get('content-encoding') || '';
    console.log(`  ✓ 1. HTTP Gzip/Deflate сжатие для статики: content-encoding="${enc}"`);
    assert.ok(enc.includes('gzip') || enc.includes('deflate'), 'Статика должна отдаваться со сжатием');

    // 3. Проверка статуса ONNX-эмбеддера и единой базы знаний
    const statusRes = await reqJson('/api/search/status', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.data.embedder?.ready, true, 'ONNX модель должна быть загружена');
    assert.strictEqual(statusRes.data.embedder?.dim, 384, 'Размерность вектора должна быть 384');
    console.log(`  ✓ 2. ONNX модель "${statusRes.data.embedder.model}" (384-dim) готова; чанков в базе: ${statusRes.data.totalChunks}`);

    // 4. Создаём тестовый ДОКУМЕНТ (договор поставки серверов)
    const uploadsDir = path.join(__dirname, '../../uploads');
    const docFile = path.join(uploadsDir, `rag-test-contract-${Date.now()}.txt`);
    const docBody = [
      'ДОГОВОР ПОСТАВКИ СЕРВЕРНОГО ОБОРУДОВАНИЯ №42-П',
      '',
      '1. Предмет договора',
      'Поставщик ООО «Вектор» обязуется поставить Заказчику ПАО «Альфа» серверное оборудование общей стоимостью 4 500 000 рублей с учётом НДС.',
      '',
      '2. Сроки и оплата',
      'Срок поставки серверного оборудования составляет 14 рабочих дней с даты подписания спецификации. Предоплата составляет 50% в течение 5 банковских дней.',
      '',
      '3. Ответственность сторон',
      'В случае просрочки поставки оборудования Поставщик выплачивает неустойку в размере 0,1% от суммы договора за каждый день просрочки.'
    ].join('\n');
    fs.writeFileSync(docFile, docBody, 'utf8');
    createdFiles.push(docFile);

    const docIns = await db.query(`
      INSERT INTO documents (title, file_name, file_type, file_size, file_path, category, created_by, is_public)
      VALUES ($1, $2, 'txt', $3, $4, 'Договоры', 1, true)
      RETURNING id
    `, ['Договор поставки серверов ООО Вектор №42-П.txt', path.basename(docFile), Buffer.byteLength(docBody), docFile]);
    const docId = docIns.rows[0].id;
    createdDocIds.push(docId);

    // 5. Создаём тестовый МАТЕРИАЛ ПРОЕКТА (регламент бэкапов)
    const projRes = await db.query('SELECT id, direction_id FROM projects ORDER BY id ASC LIMIT 1');
    assert.ok(projRes.rows.length > 0, 'Нужен хотя бы 1 проект в БД');
    const projId = projRes.rows[0].id;
    const dirId = projRes.rows[0].direction_id;

    const matFile = path.join(uploadsDir, `rag-test-backup-${Date.now()}.txt`);
    const matBody = [
      'РЕГЛАМЕНТ РЕЗЕРВНОГО КОПИРОВАНИЯ И ВОССТАНОВЛЕНИЯ',
      '',
      '1. Периодичность копирования',
      'Автоматическое резервное копирование базы данных PostgreSQL выполняется каждые 6 часов с сохранением зашифрованных архивов в хранилище MinIO S3.',
      '',
      '2. Срок хранения архивов',
      'Ежедневные дампы хранятся 30 календарных дней, ежемесячные контрольные точки — 12 месяцев.'
    ].join('\n');
    fs.writeFileSync(matFile, matBody, 'utf8');
    createdFiles.push(matFile);

    const matIns = await db.query(`
      INSERT INTO project_materials (project_id, direction_id, title, description, material_type, status, version, file_name, file_type, file_size, file_path, author_id)
      VALUES ($1, $2, $3, $4, 'РЕГЛАМЕНТ', 'APPROVED', '1.0', $5, 'txt', $6, $7, 1)
      RETURNING id
    `, [projId, dirId, 'Регламент резервного копирования PostgreSQL', 'Политика бэкапов и S3', path.basename(matFile), Buffer.byteLength(matBody), matFile]);
    const matId = matIns.rows[0].id;
    createdMatIds.push(matId);

    // Индексируем оба тестовых файла напрямую через SearchQueue
    await searchQueue.processSource('document', docId, docFile, 'txt');
    await searchQueue.processSource('project_material', matId, matFile, 'txt');
    console.log(`  ✓ 3. Проиндексированы тестовый документ #${docId} и материал проекта #${matId} в pgvector`);

    // 6. ТЕСТ А: Семантический Extractive QA по синонимам ("штраф за задержку доставки серверов" -> "неустойку 0,1%")
    const tAsk1 = Date.now();
    const ask1 = await reqJson('/api/ai/ask', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { question: 'Какой штраф предусмотрен за задержку доставки серверов?' }
    });
    const ask1Ms = Date.now() - tAsk1;
    assert.strictEqual(ask1.status, 200);
    assert.strictEqual(ask1.data.mode, 'rag_extractive', `Ожидался rag_extractive, получено: ${ask1.data.mode}`);
    assert.strictEqual(ask1.data.isFallbackNearest, false);
    assert.ok(ask1.data.answer.includes('0,1%') || ask1.data.answer.includes('неустойку'), `Ответ должен содержать цитату про неустойку 0,1%. Получено:\n${ask1.data.answer}`);
    assert.ok(ask1.data.sources.some(s => s.source_type === 'document' && s.source_id === docId), 'Первоисточником должен быть документ №42-П');
    console.log(`  ✓ 4. Extractive QA (синонимы -> Документ) за ${ask1Ms} мс: точная цитата про 0,1% неустойку найдена!`);

    // 7. ТЕСТ Б: Семантический Extractive QA по МАТЕРИАЛУ ПРОЕКТА ("как часто делаются бэкапы базы данных?")
    const ask2 = await reqJson('/api/ai/ask', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { question: 'Как часто делаются бэкапы базы данных и куда они сохраняются?' }
    });
    assert.strictEqual(ask2.status, 200);
    assert.strictEqual(ask2.data.mode, 'rag_extractive');
    assert.ok(ask2.data.answer.includes('6 часов') || ask2.data.answer.includes('MinIO'), `Ответ должен содержать 6 часов / MinIO. Получено:\n${ask2.data.answer}`);
    assert.ok(ask2.data.sources.some(s => s.source_type === 'project_material' && s.source_id === matId), 'Первоисточником должен быть материал проекта');
    console.log('  ✓ 5. Extractive QA (Материал проекта): найдена цитата «каждые 6 часов ... MinIO S3»!');

    // 8. ТЕСТ В: Почтовое вложение + СТРОГАЯ ИЗОЛЯЦИЯ ПОЧТЫ между пользователями
    const mailAttCountRes = await db.query("SELECT COUNT(*)::int AS cnt FROM knowledge_chunks WHERE source_type = 'mail_attachment'");
    if (mailAttCountRes.rows[0].cnt > 0) {
      const askMailAdmin = await reqJson('/api/ai/ask', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { question: 'Какие магистерские программы указаны в списках ИВТ САУ ПИ?' }
      });
      assert.strictEqual(askMailAdmin.status, 200);
      assert.ok(askMailAdmin.data.sources.some(s => s.source_type === 'mail_attachment'), 'Админ должен находить своё почтовое вложение PDF');

      const askMailOther = await reqJson('/api/ai/ask', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
        body: { question: 'Какие магистерские программы указаны в списках ИВТ САУ ПИ?' }
      });
      assert.strictEqual(askMailOther.status, 200);
      assert.ok(!askMailOther.data.sources.some(s => s.source_type === 'mail_attachment'), 'Другой пользователь НЕ должен видеть чужое почтовое вложение!');
      console.log('  ✓ 6. Почтовое вложение PDF найдено владельцем и строго скрыто от других пользователей!');
    }

    // 9. ТЕСТ Г: Нерелевантный запрос -> режим "БЛИЖАЙШИЙ ВАРИАНТ" (требование пользователя!)
    const askNearest = await reqJson('/api/ai/ask', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { question: 'Рецепт приготовления домашнего яблочного пирога с корицей и мёдом' }
    });
    assert.strictEqual(askNearest.status, 200);
    assert.strictEqual(askNearest.data.mode, 'rag_nearest_fallback', `Ожидался rag_nearest_fallback, получено: ${askNearest.data.mode}`);
    assert.strictEqual(askNearest.data.isFallbackNearest, true);
    assert.ok(askNearest.data.sources.length >= 1, 'Даже при отсутствии совпадений должен возвращаться ближайший вариант!');
    assert.ok(askNearest.data.answer.includes('наиболее близкий вариант'), 'Ответ должен явно пояснять, что показан ближайший вариант');
    console.log(`  ✓ 7. Fallback "ближайший вариант" сработал корректно (источников: ${askNearest.data.sources.length}, ближайший: «${askNearest.data.sources[0].title}»)`);

    // 10. ТЕСТ Д: Умный поиск с include_qa=true + фильтр source_type
    const searchQaRes = await reqJson(`/api/search?q=${encodeURIComponent('бэкапы базы данных')}&source_type=project_material&include_qa=true`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(searchQaRes.status, 200);
    assert.ok(Array.isArray(searchQaRes.data.results) && searchQaRes.data.results.length >= 1);
    assert.ok(searchQaRes.data.results.every(r => r.source_type === 'project_material'), 'Фильтр source_type=project_material должен возвращать только материалы');
    assert.ok(searchQaRes.data.qa && searchQaRes.data.qa.answer, 'include_qa=true должен возвращать блок Extractive QA');
    console.log('  ✓ 8. /api/search?source_type=project_material&include_qa=true работает корректно!');

    console.log('===============================================================');
    console.log('🎉 ВСЕ E2E-ТЕСТЫ PGVECTOR + ONNX + EXTRACTIVE QA ПРОЙДЕНЫ!');
    console.log('===============================================================\n');
  } finally {
    // Гарантированная очистка временных записей и файлов
    for (const id of createdDocIds) {
      await db.query("DELETE FROM knowledge_chunks WHERE source_type = 'document' AND source_id = $1", [id]).catch(() => {});
      await db.query('DELETE FROM document_chunks WHERE document_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM documents WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of createdMatIds) {
      await db.query("DELETE FROM knowledge_chunks WHERE source_type = 'project_material' AND source_id = $1", [id]).catch(() => {});
      await db.query('DELETE FROM project_materials WHERE id = $1', [id]).catch(() => {});
    }
    for (const f of createdFiles) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (e) {}
      }
    }
  }
}

module.exports = { runUnifiedRagQaTests };

if (require.main === module) {
  runUnifiedRagQaTests()
    .then(async () => { await db.pool.end().catch(() => {}); process.exit(0); })
    .catch(async (err) => { console.error('❌ E2E RAG TEST FAILED:', err); await db.pool.end().catch(() => {}); process.exit(1); });
}
