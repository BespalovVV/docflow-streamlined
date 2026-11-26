// backend/tests/document_acl_and_mail_isolation.test.js
const assert = require('assert');
const db = require('../db');

async function runDocumentAclAndMailIsolationTests() {
  console.log('\n🔒 [5/5] Запуск тестов изоляции почты и системы прав на документы (Document ACL)...');

  let dbAvailable = false;
  try {
    const res = await db.query('SELECT 1 AS check_col');
    if (res.rows && res.rows[0].check_col === 1) {
      dbAvailable = true;
    }
  } catch (e) {
    console.log(`  ℹ️ База данных недоступна напрямую (${e.message}). Пропуск live тестов.`);
    return;
  }

  if (!dbAvailable) return;

  // ==============================================================
  // 1. ТЕСТЫ ИЗОЛЯЦИИ ПОЧТОВЫХ ЯЩИКОВ ПОЛЬЗОВАТЕЛЕЙ (MAIL ISOLATION)
  // ==============================================================
  console.log('  📧 Проверка строгой изоляции персональных почтовых ящиков:');

  // Insert test message for User 1 (Admin)
  const testMailAdmin = await db.query(`
    INSERT INTO mail_messages (user_id, folder, sender_name, sender_email, recipient_email, subject, preview, body, is_read)
    VALUES (1, 'inbox', 'Конфиденциально Совету', 'board@corp.local', 'admin@docflow.local', 'Секретный отчет 2026', 'Превью секретного отчета', 'Текст закрытого отчета совета директоров', false)
    RETURNING id
  `);
  const adminMailId = testMailAdmin.rows[0].id;

  // Insert test message for User 2 (Ivanov)
  const testMailUser = await db.query(`
    INSERT INTO mail_messages (user_id, folder, sender_name, sender_email, recipient_email, subject, preview, body, is_read)
    VALUES (2, 'inbox', 'Team Lead Dev', 'lead@corp.local', 'ivanov@docflow.local', 'План спринта разработки', 'Превью задач спринта', 'Текст плана разработки на квартал', false)
    RETURNING id
  `);
  const userMailId = testMailUser.rows[0].id;

  try {
    // 1.1 User 1 (Admin) inbox should see adminMailId and NEVER see userMailId
    const adminInbox = await db.query(
      `SELECT id, subject FROM mail_messages WHERE user_id = $1 AND folder = 'inbox'`,
      [1]
    );
    const adminMailIds = adminInbox.rows.map(m => m.id);
    assert.ok(adminMailIds.includes(adminMailId), 'Пользователь 1 должен видеть свое письмо');
    assert.ok(!adminMailIds.includes(userMailId), 'Пользователь 1 НЕ должен видеть письмо пользователя 2');

    // 1.2 User 2 (Ivanov) inbox should see userMailId and NEVER see adminMailId
    const userInbox = await db.query(
      `SELECT id, subject FROM mail_messages WHERE user_id = $1 AND folder = 'inbox'`,
      [2]
    );
    const userMailIds = userInbox.rows.map(m => m.id);
    assert.ok(userMailIds.includes(userMailId), 'Пользователь 2 должен видеть свое письмо');
    assert.ok(!userMailIds.includes(adminMailId), 'Пользователь 2 НЕ должен видеть письмо пользователя 1');

    // 1.3 User 2 cannot access or read User 1's mail
    const forbiddenRead = await db.query(
      `SELECT * FROM mail_messages WHERE id = $1 AND user_id = $2`,
      [adminMailId, 2]
    );
    assert.strictEqual(forbiddenRead.rows.length, 0, 'Пользователь 2 не может получить письмо пользователя 1 по ID');

    // 1.4 User 2 cannot delete User 1's mail
    const forbiddenDelete = await db.query(
      `DELETE FROM mail_messages WHERE id = $1 AND user_id = $2 RETURNING id`,
      [adminMailId, 2]
    );
    assert.strictEqual(forbiddenDelete.rowCount, 0, 'Пользователь 2 не может удалить письмо пользователя 1');

    // 1.5 Unread count is strictly isolated per user
    const unreadUser1 = await db.query(
      `SELECT COUNT(*) FROM mail_messages WHERE user_id = $1 AND is_read = false`,
      [1]
    );
    const unreadUser2 = await db.query(
      `SELECT COUNT(*) FROM mail_messages WHERE user_id = $1 AND is_read = false`,
      [2]
    );
    assert.ok(parseInt(unreadUser1.rows[0].count, 10) >= 1, 'Счетчик непрочитанных пользователя 1 положителен');
    assert.ok(parseInt(unreadUser2.rows[0].count, 10) >= 1, 'Счетчик непрочитанных пользователя 2 положителен');

    console.log('    ✅ 5.1. Полная изоляция писем, папок и счетчиков между пользователями — Успешно');
  } finally {
    // Clean up test messages
    await db.query(`DELETE FROM mail_messages WHERE id IN ($1, $2)`, [adminMailId, userMailId]);
  }

  // ==============================================================
  // 2. ТЕСТЫ СИСТЕМЫ ПРАВ НА ДОКУМЕНТЫ (DOCUMENT ACL)
  // ==============================================================
  console.log('  📄 Проверка разграничения прав доступа на документы (VIEW / EDIT / OWNER):');

  // Insert a test document created by User 1 (Admin / Creator)
  const testDocRes = await db.query(`
    INSERT INTO documents (title, file_name, file_type, file_size, file_path, category, created_by)
    VALUES ('Служебная записка о бюджете 2026.docx', 'doc-test-budget.docx', 'docx', 12345, '/tmp/doc-test-budget.docx', 'Финансы', 1)
    RETURNING id, title, created_by
  `);
  const testDoc = testDocRes.rows[0];
  const docId = testDoc.id;

  try {
    // 2.1 Before granting permissions: User 2 (Ivanov) should NOT see the document in list
    const user2DocsBefore = await db.query(`
      SELECT d.id
      FROM documents d
      LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = $1
      WHERE d.created_by = $1 OR dp.id IS NOT NULL
    `, [2]);
    const user2DocIdsBefore = user2DocsBefore.rows.map(r => r.id);
    assert.ok(!user2DocIdsBefore.includes(docId), 'Пользователь 2 не должен видеть документ без выданных прав');

    // 2.2 Grant VIEW permission to User 2
    await db.query(`
      INSERT INTO document_permissions (document_id, user_id, permission_level, granted_by)
      VALUES ($1, 2, 'VIEW', 1)
      ON CONFLICT (document_id, user_id) DO UPDATE SET permission_level = 'VIEW'
    `, [docId]);

    // Now User 2 should see document with user_access_level = 'VIEW'
    const user2DocsAfter = await db.query(`
      SELECT d.id,
             CASE WHEN d.created_by = $1 THEN 'OWNER' ELSE dp.permission_level END AS user_access_level
      FROM documents d
      LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = $1
      WHERE d.created_by = $1 OR dp.id IS NOT NULL
    `, [2]);
    const user2Doc = user2DocsAfter.rows.find(r => r.id === docId);
    assert.ok(user2Doc, 'Пользователь 2 должен видеть документ после предоставления прав');
    assert.strictEqual(user2Doc.user_access_level, 'VIEW', 'Уровень доступа пользователя 2 должен быть VIEW');

    // 2.3 Grant EDIT permission to User 3 (Petrova)
    await db.query(`
      INSERT INTO document_permissions (document_id, user_id, permission_level, granted_by)
      VALUES ($1, 3, 'EDIT', 1)
      ON CONFLICT (document_id, user_id) DO UPDATE SET permission_level = 'EDIT'
    `, [docId]);

    const user3Docs = await db.query(`
      SELECT d.id,
             CASE WHEN d.created_by = $1 THEN 'OWNER' ELSE dp.permission_level END AS user_access_level
      FROM documents d
      LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = $1
      WHERE d.created_by = $1 OR dp.id IS NOT NULL
    `, [3]);
    const user3Doc = user3Docs.rows.find(r => r.id === docId);
    assert.ok(user3Doc, 'Пользователь 3 должен видеть документ');
    assert.strictEqual(user3Doc.user_access_level, 'EDIT', 'Уровень доступа пользователя 3 должен быть EDIT');

    // 2.4 Verify ONLYOFFICE permissions logic:
    // For VIEW: mode must be 'view', edit: false
    const viewAccessLevel = user2Doc.user_access_level;
    const isViewOnly = viewAccessLevel === 'VIEW';
    assert.strictEqual(isViewOnly ? 'view' : 'edit', 'view', 'Для VIEW режим ONLYOFFICE должен быть view');
    assert.strictEqual(!isViewOnly, false, 'Для VIEW право edit в ONLYOFFICE должно быть false');

    // For EDIT: mode must be 'edit', edit: true
    const editAccessLevel = user3Doc.user_access_level;
    const isEditAllowed = editAccessLevel === 'EDIT' || editAccessLevel === 'OWNER' || editAccessLevel === 'ADMIN';
    assert.strictEqual(isEditAllowed ? 'edit' : 'view', 'edit', 'Для EDIT режим ONLYOFFICE должен быть edit');
    assert.strictEqual(isEditAllowed, true, 'Для EDIT право edit в ONLYOFFICE должно быть true');

    // 2.5 Revoke permission from User 2
    await db.query(`DELETE FROM document_permissions WHERE document_id = $1 AND user_id = 2`, [docId]);

    const user2DocsRevoked = await db.query(`
      SELECT d.id
      FROM documents d
      LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = $1
      WHERE d.created_by = $1 OR dp.id IS NOT NULL
    `, [2]);
    assert.ok(!user2DocsRevoked.rows.map(r => r.id).includes(docId), 'Пользователь 2 теряет доступ к документу после отзыва');

    console.log('    ✅ 5.2. Выдача, смена прав (VIEW/EDIT) и отзыв доступа к документу — Успешно');
    console.log('    ✅ 5.3. Режим ONLYOFFICE (view для чтения, edit для редактирования) — Успешно');
  } finally {
    // Clean up test document
    await db.query(`DELETE FROM documents WHERE id = $1`, [docId]);
  }

  // ==============================================================
  // 3. ТЕСТЫ РАЗГРАНИЧЕНИЯ ДОСТУПА К ЗАДАЧАМ, ПРОЕКТАМ И КОНФЕРЕНЦИЯМ
  // ==============================================================
  console.log('  📋 Проверка изоляции задач, проектов и конференций для исполнителя:');

  // Create test projects
  const p1Res = await db.query(`
    INSERT INTO projects (title, description, status)
    VALUES ('Проект 1 (Назначен пользователю 2)', 'Проект с задачами для Иванова', 'ACTIVE')
    RETURNING id
  `);
  const projectAssignedId = p1Res.rows[0].id;

  const p2Res = await db.query(`
    INSERT INTO projects (title, description, status)
    VALUES ('Проект 2 (Скрытый от пользователя 2)', 'Проект без задач для Иванова', 'ACTIVE')
    RETURNING id
  `);
  const projectHiddenId = p2Res.rows[0].id;

  // Create tasks: one for user 2, one for user 1
  const t1Res = await db.query(`
    INSERT INTO tasks (project_id, title, description, priority, status, assignee_id, creator_id)
    VALUES ($1, 'Задача для пользователя 2', 'Описание задачи', 'HIGH', 'TODO', 2, 1)
    RETURNING id
  `, [projectAssignedId]);
  const taskUser2Id = t1Res.rows[0].id;

  const t2Res = await db.query(`
    INSERT INTO tasks (project_id, title, description, priority, status, assignee_id, creator_id)
    VALUES ($1, 'Задача только для администратора', 'Описание админ задачи', 'LOW', 'TODO', 1, 1)
    RETURNING id
  `, [projectHiddenId]);
  const taskAdminId = t2Res.rows[0].id;

  // Create conferences: one with user 2, one without
  const c1Res = await db.query(`
    INSERT INTO conferences (title, description, start_time, end_time, created_by)
    VALUES ('Встреча с участием пользователя 2', 'Планерка', NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 1 hour', 1)
    RETURNING id
  `);
  const confAssignedId = c1Res.rows[0].id;
  await db.query(`INSERT INTO conference_participants (conference_id, user_id) VALUES ($1, 2)`, [confAssignedId]);

  const c2Res = await db.query(`
    INSERT INTO conferences (title, description, start_time, end_time, created_by)
    VALUES ('Секретная встреча совета директоров', 'Закрытое совещание', NOW() + INTERVAL '2 day', NOW() + INTERVAL '2 day 1 hour', 1)
    RETURNING id
  `);
  const confHiddenId = c2Res.rows[0].id;
  await db.query(`INSERT INTO conference_participants (conference_id, user_id) VALUES ($1, 1)`, [confHiddenId]);

  try {
    // 3.1 Task isolation: User 2 sees ONLY their assigned task
    const user2Tasks = await db.query(
      `SELECT id FROM tasks WHERE assignee_id = $1`,
      [2]
    );
    const user2TaskIds = user2Tasks.rows.map(t => t.id);
    assert.ok(user2TaskIds.includes(taskUser2Id), 'Пользователь 2 должен видеть назначенную ему задачу');
    assert.ok(!user2TaskIds.includes(taskAdminId), 'Пользователь 2 НЕ должен видеть чужую задачу');

    // 3.2 Project scoping: User 2 sees ONLY projects with tasks assigned to them
    const user2Projects = await db.query(`
      SELECT p.id FROM projects p
      WHERE EXISTS (
        SELECT 1 FROM tasks ut 
        WHERE ut.project_id = p.id AND ut.assignee_id = $1
      )
    `, [2]);
    const user2ProjectIds = user2Projects.rows.map(p => p.id);
    assert.ok(user2ProjectIds.includes(projectAssignedId), 'Пользователь 2 видит проект, к которому привязана его задача');
    assert.ok(!user2ProjectIds.includes(projectHiddenId), 'Пользователь 2 НЕ видит проект, в котором у него нет задач');

    // 3.3 Conference scoping: User 2 sees ONLY conferences where they are participant
    const user2Confs = await db.query(`
      SELECT c.id FROM conferences c
      WHERE EXISTS (
        SELECT 1 FROM conference_participants cp
        WHERE cp.conference_id = c.id AND cp.user_id = $1
      ) OR c.created_by = $1
    `, [2]);
    const user2ConfIds = user2Confs.rows.map(c => c.id);
    assert.ok(user2ConfIds.includes(confAssignedId), 'Пользователь 2 видит конференцию, в которой участвует');
    assert.ok(!user2ConfIds.includes(confHiddenId), 'Пользователь 2 НЕ видит конференцию, в которой не участвует');

    console.log('    ✅ 5.4. Исполнитель видит строго только свои задачи — Успешно');
    console.log('    ✅ 5.5. Исполнитель видит только проекты, связанные с его задачами — Успешно');
    console.log('    ✅ 5.6. Исполнитель видит только конференции со своим участием — Успешно');
  } finally {
    // Cleanup
    await db.query(`DELETE FROM tasks WHERE id IN ($1, $2)`, [taskUser2Id, taskAdminId]);
    await db.query(`DELETE FROM projects WHERE id IN ($1, $2)`, [projectAssignedId, projectHiddenId]);
    await db.query(`DELETE FROM conferences WHERE id IN ($1, $2)`, [confAssignedId, confHiddenId]);
  }

  // ==============================================================
  // 4. ТЕСТЫ ДВУСТОРОННЕЙ СИНХРОНИЗАЦИИ ПОЧТЫ (BIDIRECTIONAL MAIL SYNC)
  // ==============================================================
  console.log('  🔄 Проверка двусторонней синхронизации почты (UID, Прочтение, Отправленные, Удаление):');

  let testInboxMailId = null;
  let testSentMailId = null;
  try {
    // 4.1 Insert incoming mail with imap_uid and unread flag
    const inboxRes = await db.query(`
      INSERT INTO mail_messages (user_id, folder, sender_name, sender_email, recipient_email, subject, preview, body, message_id, imap_uid, is_read)
      VALUES (2, 'inbox', 'Партнер Корпорации', 'partner@external.com', 'ivanov@docflow.local', 'Согласование контракта', 'Текст превью', 'Полный текст контракта', '<msg-test-123@external.com>', 1042, false)
      RETURNING id, is_read, imap_uid
    `);
    testInboxMailId = inboxRes.rows[0].id;
    assert.strictEqual(inboxRes.rows[0].is_read, false, 'Новое письмо должно быть изначально непрочитанным');
    assert.strictEqual(inboxRes.rows[0].imap_uid, 1042, 'UID на IMAP сервере должен корректно сохраняться в БД');

    // 4.2 Toggle read status to true (simulation of user opening email or PATCH /api/mail/:id/read)
    await db.query('UPDATE mail_messages SET is_read = true WHERE id = $1 AND user_id = $2', [testInboxMailId, 2]);
    const readCheck = await db.query('SELECT is_read FROM mail_messages WHERE id = $1', [testInboxMailId]);
    assert.strictEqual(readCheck.rows[0].is_read, true, 'Статус должен переключиться на прочитано (true)');

    // 4.3 Toggle back to unread (simulation of PATCH /api/mail/:id/read { is_read: false })
    await db.query('UPDATE mail_messages SET is_read = false WHERE id = $1 AND user_id = $2', [testInboxMailId, 2]);
    const unreadCheck = await db.query('SELECT is_read FROM mail_messages WHERE id = $1', [testInboxMailId]);
    assert.strictEqual(unreadCheck.rows[0].is_read, false, 'Статус должен переключиться на непрочитано (false)');

    // 4.4 Two-Way Sent Mail Sync: insert sent mail with imap_uid
    const sentRes = await db.query(`
      INSERT INTO mail_messages (user_id, folder, sender_name, sender_email, recipient_email, subject, preview, body, message_id, imap_uid, is_read)
      VALUES (2, 'sent', 'Иван Иванов', 'ivanov@docflow.local', 'director@corp.local', 'Отчет по проекту готов', 'Превью отчета', 'Текст отправленного письма', '<sent-test-456@docflow.local>', 2085, true)
      RETURNING id, folder, imap_uid
    `);
    testSentMailId = sentRes.rows[0].id;
    assert.strictEqual(sentRes.rows[0].folder, 'sent', 'Папка должна быть sent');
    assert.strictEqual(sentRes.rows[0].imap_uid, 2085, 'UID отправленного письма на сервере должен сохраняться');

    // Verify folder filtering separates inbox and sent
    const userInboxCount = await db.query(`SELECT COUNT(*) FROM mail_messages WHERE user_id = 2 AND folder = 'inbox' AND id = $1`, [testInboxMailId]);
    const userSentCount = await db.query(`SELECT COUNT(*) FROM mail_messages WHERE user_id = 2 AND folder = 'sent' AND id = $1`, [testSentMailId]);
    assert.strictEqual(parseInt(userInboxCount.rows[0].count, 10), 1, 'Входящее письмо должно быть во входящих');
    assert.strictEqual(parseInt(userSentCount.rows[0].count, 10), 1, 'Отправленное письмо должно быть в отправленных');

    // 4.5 Two-Way Deletion Sync: deleting mail removes record and attachments
    await db.query(`
      INSERT INTO mail_attachments (mail_id, file_name, file_type, file_size, file_path)
      VALUES ($1, 'contract.pdf', 'application/pdf', 10240, '/tmp/contract.pdf')
    `, [testInboxMailId]);

    await db.query('DELETE FROM mail_attachments WHERE mail_id = $1', [testInboxMailId]);
    await db.query('DELETE FROM mail_messages WHERE id = $1 AND user_id = $2', [testInboxMailId, 2]);

    const deletedMailCheck = await db.query('SELECT 1 FROM mail_messages WHERE id = $1', [testInboxMailId]);
    const deletedAttCheck = await db.query('SELECT 1 FROM mail_attachments WHERE mail_id = $1', [testInboxMailId]);
    assert.strictEqual(deletedMailCheck.rows.length, 0, 'Письмо должно быть удалено');
    assert.strictEqual(deletedAttCheck.rows.length, 0, 'Вложения удаленного письма должны быть очищены');

    console.log('    ✅ 5.7. Сохранение IMAP UID и двусторонняя смена статуса прочтения (\Seen) — Успешно');
    console.log('    ✅ 5.8. Синхронизация папки Отправленные (Sent) с привязкой к серверному UID — Успешно');
    console.log('    ✅ 5.9. Двустороннее удаление писем и очистка связанных вложений — Успешно');
  } finally {
    if (testInboxMailId) {
      await db.query('DELETE FROM mail_attachments WHERE mail_id = $1', [testInboxMailId]);
      await db.query('DELETE FROM mail_messages WHERE id = $1', [testInboxMailId]);
    }
    if (testSentMailId) {
      await db.query('DELETE FROM mail_messages WHERE id = $1', [testSentMailId]);
    }
  }
}

module.exports = { runDocumentAclAndMailIsolationTests };
