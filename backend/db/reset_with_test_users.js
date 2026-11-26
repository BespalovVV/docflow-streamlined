// backend/db/reset_with_test_users.js
// Полный сброс БД: удаляет всё кроме администратора + создаёт 5 тестовых пользователей

const { pool } = require('./index');
const bcrypt = require('bcryptjs');

async function resetWithTestUsers() {
  const client = await pool.connect();
  try {
    console.log('='.repeat(60));
    console.log('🧹 ПОЛНЫЙ СБРОС БАЗЫ ДАННЫХ');
    console.log('='.repeat(60));

    await client.query('BEGIN');

    // 1. Очистка всех данных (кроме системных ролей и разрешений)
    await client.query('DELETE FROM chat_messages');
    await client.query('DELETE FROM conference_participants');
    await client.query('DELETE FROM conferences');
    await client.query('DELETE FROM project_materials');
    await client.query('DELETE FROM tasks');
    await client.query('DELETE FROM projects');
    await client.query('DELETE FROM directions');
    await client.query('DELETE FROM document_chunks');
    await client.query('DELETE FROM document_permissions');
    await client.query('DELETE FROM documents');
    await client.query('DELETE FROM mail_attachments');
    await client.query('DELETE FROM mail_messages');
    await client.query('DELETE FROM user_mail_settings WHERE user_id != 1').catch(() => {});

    // Удалить всех пользователей кроме администратора
    await client.query('DELETE FROM users WHERE id != 1');

    // Сбросить последовательности
    const seqs = [
      'chat_messages_id_seq',
      'conferences_id_seq',
      'project_materials_id_seq',
      'tasks_id_seq',
      'projects_id_seq',
      'directions_id_seq',
      'document_chunks_id_seq',
      'document_permissions_id_seq',
      'documents_id_seq',
      'mail_messages_id_seq',
    ];
    for (const seq of seqs) {
      await client.query(`SELECT setval('${seq}', 1, false)`).catch(() => {});
    }
    await client.query("SELECT setval('users_id_seq', 1, true)").catch(() => {});

    console.log('✅ Все данные удалены, администратор сохранён');

    // 2. Хэш пароля для тестовых пользователей
    const testPassword = 'Test1234!';
    const hash = await bcrypt.hash(testPassword, 10);

    // 3. Создать 5 тестовых пользователей
    const testUsers = [
      { email: 'ivanov@docflow.local',    full_name: 'Иван Иванов',      department: 'Отдел разработки',  position: 'Ведущий разработчик' },
      { email: 'petrova@docflow.local',   full_name: 'Анна Петрова',      department: 'Юридический отдел', position: 'Юрист' },
      { email: 'sidorov@docflow.local',   full_name: 'Алексей Сидоров',   department: 'Бухгалтерия',       position: 'Бухгалтер' },
      { email: 'kuznetsova@docflow.local',full_name: 'Елена Кузнецова',   department: 'Маркетинг',         position: 'Маркетолог' },
      { email: 'smirnov@docflow.local',   full_name: 'Дмитрий Смирнов',   department: 'Отдел продаж',      position: 'Менеджер по продажам' },
    ];

    for (const u of testUsers) {
      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, department, position)
         VALUES ($1, $2, $3, 'USER', $4, $5)`,
        [u.email, hash, u.full_name, u.department, u.position]
      );
    }
    await client.query("SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))");

    // 4. Убедиться что администратор корректный
    await client.query(`
      UPDATE users SET role = 'ADMIN', department = 'Управление', position = 'Системный администратор'
      WHERE id = 1
    `);

    await client.query('COMMIT');

    console.log('');
    console.log('='.repeat(60));
    console.log('✅ ТЕСТОВЫЕ ПОЛЬЗОВАТЕЛИ СОЗДАНЫ');
    console.log('='.repeat(60));
    console.log('');
    console.log('👤 Администратор:');
    console.log('   Email: admin@docflow.local');
    console.log('   Пароль: admin123');
    console.log('');
    console.log('👥 Тестовые пользователи (пароль для всех: Test1234!):');
    testUsers.forEach((u, i) => {
      console.log(`   ${i + 1}. ${u.full_name} — ${u.email}`);
    });
    console.log('');
    console.log('='.repeat(60));

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Ошибка сброса БД:', err);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

resetWithTestUsers()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
