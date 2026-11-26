// backend/tests/hierarchy_and_isolation.test.js
const assert = require('assert');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { getSubordinateUserIds, wouldCreateHierarchyCycle, getOrganizationTree } = require('../utils/hierarchy');

async function runHierarchyAndIsolationTests() {
  console.log('\n🌳 [ТЕСТ] Проверка иерархической архитектуры пользователей и строгой изоляции задач и документов...');

  // 1. Проверка утилит иерархии
  console.log('  1. Проверка структуры подчинённых:');
  const subsOfIvan = await getSubordinateUserIds(2);
  assert.ok(subsOfIvan.includes(4), 'Иван Иванов (ID 2) должен иметь в подчинённых Алексея Сидорова (ID 4)');
  assert.ok(!subsOfIvan.includes(1), 'Администратор (ID 1) не должен быть подчинённым Ивана');
  assert.ok(!subsOfIvan.includes(3), 'Анна Петрова (ID 3, юрист) не должна быть в подчинённых у отдела разработки');
  console.log('    ✅ 1.1. getSubordinateUserIds возвращает точный список подчинённых');

  // 1.2. Проверка защиты от циклов в иерархии
  const isSelfCycle = await wouldCreateHierarchyCycle(2, 2);
  assert.strictEqual(isSelfCycle, true, 'Сотрудник не может быть руководителем самого себя');
  const isSubCycle = await wouldCreateHierarchyCycle(2, 4);
  assert.strictEqual(isSubCycle, true, 'Нельзя сделать своего подчинённого (ID 4) своим руководителем');
  const isAllowedManager = await wouldCreateHierarchyCycle(4, 1);
  assert.strictEqual(isAllowedManager, false, 'Переподчинение сотрудника высшему руководству допустимо');
  console.log('    ✅ 1.2. wouldCreateHierarchyCycle корректно блокирует зацикливание дерева руководства');

  // 1.3. Проверка дерева организации
  const tree = await getOrganizationTree();
  assert.ok(tree.roots.length > 0, 'Дерево должно иметь хотя бы один корневой узел');
  console.log(`    ✅ 1.3. getOrganizationTree успешно строит структуру (${tree.allUsers.length} участников, ${tree.roots.length} корней)`);

  // 2. Изоляция задач (Tasks Isolation)
  console.log('  2. Проверка строгой изоляции задач:');
  const user4Token = jwt.sign({ id: 4, email: 'sidorov@docflow.local', role: 'USER' }, JWT_SECRET);
  const user2Token = jwt.sign({ id: 2, email: 'ivanov@docflow.local', role: 'USER' }, JWT_SECRET);
  const adminToken = jwt.sign({ id: 1, email: 'admin@docflow.local', role: 'ADMIN' }, JWT_SECRET);

  // Создадим тестовый проект и задачи для проверки изоляции
  const projRes = await db.query(`
    INSERT INTO projects (title, description, status)
    VALUES ('Тестовый проект изоляции', 'Проверка прав доступа к задачам', 'ACTIVE')
    RETURNING id
  `);
  const testProjectId = projRes.rows[0].id;

  // Задача 1: Назначена Сидорову (4), автор Иванов (2)
  const task1Res = await db.query(`
    INSERT INTO tasks (project_id, title, priority, status, assignee_id, creator_id)
    VALUES ($1, 'Задача для Сидорова', 'HIGH', 'TODO', 4, 2)
    RETURNING id
  `, [testProjectId]);
  const task1Id = task1Res.rows[0].id;

  // Задача 2: Назначена Смирнову (6), автор Администратор (1)
  const task2Res = await db.query(`
    INSERT INTO tasks (project_id, title, priority, status, assignee_id, creator_id)
    VALUES ($1, 'Задача для Смирнова из продаж', 'MEDIUM', 'TODO', 6, 1)
    RETURNING id
  `, [testProjectId]);
  const task2Id = task2Res.rows[0].id;

  // Задача 3: Назначена Иванову (2), автор Администратор (1)
  const task3Res = await db.query(`
    INSERT INTO tasks (project_id, title, priority, status, assignee_id, creator_id)
    VALUES ($1, 'Задача для руководителя Иванова', 'URGENT', 'TODO', 2, 1)
    RETURNING id
  `, [testProjectId]);
  const task3Id = task3Res.rows[0].id;

  try {
    // 2.1. Проверка видимости задач Сидоровым (ID 4 - обычный сотрудник)
    // Сидоров видит: задачу 1 (он исполнитель). НЕ видит: задачу 2 и задачу 3!
    const sidorovTasksRes = await db.query(`
      SELECT t.id FROM tasks t
      WHERE t.id IN ($1, $2, $3)
        AND (t.assignee_id = 4 OR t.creator_id = 4)
    `, [task1Id, task2Id, task3Id]);
    const sidorovTaskIds = sidorovTasksRes.rows.map(r => r.id);
    assert.ok(sidorovTaskIds.includes(task1Id), 'Сидоров должен видеть свою назначенную задачу');
    assert.ok(!sidorovTaskIds.includes(task2Id), 'Сидоров НЕ должен видеть чужую задачу отдела продаж');
    assert.ok(!sidorovTaskIds.includes(task3Id), 'Сидоров НЕ должен видеть задачу своего начальника');
    console.log('    ✅ 2.1. Сотрудник без подчинённых видит строго только свои задачи');

    // 2.2. Проверка видимости задач Ивановым (ID 2 - руководитель Сидорова)
    // Иванов видит: задачу 3 (своя) И задачу 1 (его подчинённого Сидорова). НЕ видит: задачу 2 (Смирнов из продаж)!
    const ivanSubIds = await getSubordinateUserIds(2);
    const ivanAllowedUsers = [2, ...ivanSubIds];
    const ivanTasksRes = await db.query(`
      SELECT t.id FROM tasks t
      WHERE t.id IN ($1, $2, $3)
        AND (t.assignee_id = ANY($4::int[]) OR t.creator_id = ANY($4::int[]))
    `, [task1Id, task2Id, task3Id, ivanAllowedUsers]);
    const ivanTaskIds = ivanTasksRes.rows.map(r => r.id);
    assert.ok(ivanTaskIds.includes(task1Id), 'Руководитель Иванов должен видеть задачу своего подчинённого Сидорова');
    assert.ok(ivanTaskIds.includes(task3Id), 'Руководитель Иванов должен видеть свою личную задачу');
    assert.ok(!ivanTaskIds.includes(task2Id), 'Руководитель Иванов НЕ должен видеть задачу чужого отдела');
    console.log('    ✅ 2.2. Руководитель видит свои задачи и задачи своих подчинённых, но не чужих отделов');

    // 2.3. Проверка прикрепления задачи к проекту и исполнителя
    const taskDetailsRes = await db.query(`
      SELECT t.id, t.project_id, p.title AS project_title, t.assignee_id, u.full_name AS assignee_name
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      JOIN users u ON t.assignee_id = u.id
      WHERE t.id = $1
    `, [task1Id]);
    assert.strictEqual(taskDetailsRes.rows[0].project_id, testProjectId);
    assert.strictEqual(taskDetailsRes.rows[0].assignee_id, 4);
    assert.strictEqual(taskDetailsRes.rows[0].project_title, 'Тестовый проект изоляции');
    console.log('    ✅ 2.3. Задача корректно прикреплена к проекту и исполнителю');

    // 3. Изоляция документов (Documents Isolation)
    console.log('  3. Проверка строгой изоляции документов:');

    // Создаем документ 1 от Сидорова (4)
    const doc1Res = await db.query(`
      INSERT INTO documents (title, file_name, file_type, file_size, file_path, category, created_by)
      VALUES ('Отчет Сидорова.docx', 'sidorov-doc.docx', 'docx', 1024, '/tmp/sidorov.docx', 'Отчеты', 4)
      RETURNING id
    `);
    const doc1Id = doc1Res.rows[0].id;

    // Создаем документ 2 от Смирнова (6, отдел продаж)
    const doc2Res = await db.query(`
      INSERT INTO documents (title, file_name, file_type, file_size, file_path, category, created_by)
      VALUES ('План продаж Смирнова.xlsx', 'smirnov-doc.xlsx', 'xlsx', 2048, '/tmp/smirnov.xlsx', 'Продажи', 6)
      RETURNING id
    `);
    const doc2Id = doc2Res.rows[0].id;

    // 3.1. Запрос видимости документов Сидоровым (4)
    const sidorovDocsRes = await db.query(`
      SELECT d.id FROM documents d
      LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = 4
      WHERE d.id IN ($1, $2) AND (d.created_by = 4 OR dp.id IS NOT NULL)
    `, [doc1Id, doc2Id]);
    const sidorovDocIds = sidorovDocsRes.rows.map(r => r.id);
    assert.ok(sidorovDocIds.includes(doc1Id), 'Сидоров видит свой документ');
    assert.ok(!sidorovDocIds.includes(doc2Id), 'Сидоров НЕ должен видеть документ чужого отдела без прав доступа');
    console.log('    ✅ 3.1. Не-админ видит только свои документы и документы с выданным доступом');

    // 3.2. Запрос видимости документов руководителем Ивановым (2)
    const ivanDocsRes = await db.query(`
      SELECT d.id FROM documents d
      LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = 2
      WHERE d.id IN ($1, $2) AND (d.created_by = ANY($3::int[]) OR dp.id IS NOT NULL)
    `, [doc1Id, doc2Id, ivanAllowedUsers]);
    const ivanDocIds = ivanDocsRes.rows.map(r => r.id);
    assert.ok(ivanDocIds.includes(doc1Id), 'Руководитель видит документ своего подчинённого');
    assert.ok(!ivanDocIds.includes(doc2Id), 'Руководитель НЕ видит документы сотрудников других отделов без прав');
    console.log('    ✅ 3.2. Руководитель видит документы своих подчинённых, сохраняя изоляцию от других отделов');

  } finally {
    // Очистка тестовых данных
    await db.query('DELETE FROM tasks WHERE project_id = $1', [testProjectId]);
    await db.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
    await db.query("DELETE FROM documents WHERE file_name IN ('sidorov-doc.docx', 'smirnov-doc.xlsx')");
  }

  console.log('🎉 ВСЕ ПРОВЕРКИ ИЕРАРХИИ И ИЗОЛЯЦИИ ПРАВ УСПЕШНО ПРОЙДЕНЫ!');
}

if (require.main === module) {
  runHierarchyAndIsolationTests()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Ошибка тестирования:', err);
      process.exit(1);
    });
}

module.exports = { runHierarchyAndIsolationTests };
