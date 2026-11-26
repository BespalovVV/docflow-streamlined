// backend/tests/directions_and_materials.test.js
const assert = require('assert');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

async function runDirectionsAndMaterialsTests() {
  console.log('\n===============================================================');
  console.log('🧭 ТЕСТИРОВАНИЕ 3-УРОВНЕВОГО ПОДРАЗДЕЛЕНИЯ:');
  console.log('   (Направление -> Проект -> Материал)');
  console.log('===============================================================');

  const adminToken = jwt.sign({
    id: 1,
    email: 'admin@docflow.local',
    role: 'ADMIN',
    role_code: 'admin',
    full_name: 'Администратор Системы'
  }, JWT_SECRET, { expiresIn: '1h' });

  let testDirectionId = null;
  let testProjectId = null;
  let testMaterialId = null;

  try {
    // 1. Проверка существования сидированных направлений
    console.log('  Проверка реестра направлений...');
    const dirRes = await db.query(`
      SELECT d.*, COUNT(p.id)::int as prj_count
      FROM directions d
      LEFT JOIN projects p ON p.direction_id = d.id
      GROUP BY d.id
      ORDER BY d.id ASC
    `);
    assert(dirRes.rows.length >= 1, 'Должно быть как минимум 1 направление в системе');
    console.log(`  ✅ 1.1. Получено направлений в БД: ${dirRes.rows.length} — Успешно`);

    // 2. Создание нового тестового направления (Уровень 1)
    console.log('  Создание тестового направления (Уровень 1)...');
    const newDir = await db.query(`
      INSERT INTO directions (name, code, description, icon, color, manager_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      'Тестовое Направление Автоматизации',
      'TEST_AUTO',
      'Направление для валидации 3-уровневой структуры',
      '🤖',
      '#ec4899',
      1,
      'ACTIVE'
    ]);
    assert(newDir.rows.length === 1, 'Направление должно быть создано');
    testDirectionId = newDir.rows[0].id;
    console.log(`  ✅ 1.2. Создано направление ID: ${testDirectionId} («${newDir.rows[0].name}») — Успешно`);

    // 3. Создание проекта внутри направления (Уровень 2)
    console.log('  Создание проекта внутри направления (Уровень 2)...');
    const newProj = await db.query(`
      INSERT INTO projects (title, description, status, direction_id, start_date, end_date)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      'Проект Валидации Иерархии',
      'Тестовый проект уровня 2',
      'ACTIVE',
      testDirectionId,
      '2026-10-01',
      '2026-12-31'
    ]);
    assert(newProj.rows.length === 1, 'Проект должен быть создан');
    testProjectId = newProj.rows[0].id;
    assert.strictEqual(newProj.rows[0].direction_id, testDirectionId, 'Проект должен ссылаться на направление');
    console.log(`  ✅ 1.3. Создан проект ID: ${testProjectId} («${newProj.rows[0].title}») в направлении ${testDirectionId} — Успешно`);

    // 4. Добавление материала к проекту (Уровень 3)
    console.log('  Добавление проектного материала (Уровень 3)...');
    const newMat = await db.query(`
      INSERT INTO project_materials
        (project_id, direction_id, title, description, material_type, status, version, file_name, file_type, file_size, file_path, author_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      testProjectId,
      testDirectionId,
      'Тестовое техническое задание на валидатор',
      'Подробная спецификация требований к тестовому стенду',
      'СПЕЦИФИКАЦИЯ',
      'APPROVED',
      '1.0',
      'test-material-spec.docx',
      'docx',
      1024,
      '/tmp/test-material-spec.docx',
      1
    ]);
    assert(newMat.rows.length === 1, 'Материал должен быть создан');
    testMaterialId = newMat.rows[0].id;
    assert.strictEqual(newMat.rows[0].project_id, testProjectId, 'Материал должен быть привязан к проекту');
    assert.strictEqual(newMat.rows[0].direction_id, testDirectionId, 'Материал должен быть привязан к направлению');
    console.log(`  ✅ 1.4. Создан материал ID: ${testMaterialId} («${newMat.rows[0].title}», v${newMat.rows[0].version}) — Успешно`);

    // 5. Проверка сквозной иерархической выборки
    console.log('  Проверка целостности сквозной выборки (Направление -> Проект -> Материал)...');
    const hierarchyRes = await db.query(`
      SELECT d.name AS direction_name,
             p.title AS project_title,
             pm.title AS material_title,
             pm.version AS material_version
      FROM directions d
      JOIN projects p ON p.direction_id = d.id
      JOIN project_materials pm ON pm.project_id = p.id
      WHERE d.id = $1 AND p.id = $2 AND pm.id = $3
    `, [testDirectionId, testProjectId, testMaterialId]);

    assert.strictEqual(hierarchyRes.rows.length, 1, 'Иерархическая связь должна быть неразрывна');
    const row = hierarchyRes.rows[0];
    assert.strictEqual(row.direction_name, 'Тестовое Направление Автоматизации');
    assert.strictEqual(row.project_title, 'Проект Валидации Иерархии');
    assert.strictEqual(row.material_title, 'Тестовое техническое задание на валидатор');
    console.log(`  ✅ 1.5. Иерархия валидна: [${row.direction_name}] -> [${row.project_title}] -> [${row.material_title}] — Успешно`);

    // 6. Обновление метаданных материала (версионирование и статус)
    console.log('  Проверка обновления версии и статуса материала...');
    const updateRes = await db.query(`
      UPDATE project_materials
      SET version = '2.0', status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING version, status
    `, [testMaterialId]);
    assert.strictEqual(updateRes.rows[0].version, '2.0');
    assert.strictEqual(updateRes.rows[0].status, 'ARCHIVED');
    console.log('  ✅ 1.6. Обновление статуса (ARCHIVED) и версии (v2.0) — Успешно');

  } finally {
    // Гарантированная очистка тестовых записей (ОТКАТ)
    console.log('  🧹 Запуск гарантированного отката тестовых записей подразделения...');
    if (testMaterialId) {
      await db.query('DELETE FROM project_materials WHERE id = $1', [testMaterialId]).catch(() => {});
    }
    if (testProjectId) {
      await db.query('DELETE FROM tasks WHERE project_id = $1', [testProjectId]).catch(() => {});
      await db.query('DELETE FROM projects WHERE id = $1', [testProjectId]).catch(() => {});
    }
    if (testDirectionId) {
      await db.query('DELETE FROM directions WHERE id = $1', [testDirectionId]).catch(() => {});
    }
    console.log('  ✅ 1.7. Откат тестовых изменений в БД завершен.');
  }

  console.log('===============================================================');
  console.log('🎉 ТЕСТИРОВАНИЕ 3-УРОВНЕВОГО ПОДРАЗДЕЛЕНИЯ УСПЕШНО ПРОЙДЕНО!');
  console.log('===============================================================\n');
}

module.exports = { runDirectionsAndMaterialsTests };
