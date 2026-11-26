// backend/db/clean_data.js
const fs = require('fs');
const path = require('path');
const db = require('./index');
const storage = require('../storage');

async function cleanAllDataExceptMailAndAdmin() {
  console.log('===============================================================');
  console.log('🧹 [WIPE] Очистка сохраненных данных (кроме почты и администратора)...');
  console.log('===============================================================');

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // 1. Почта: гарантируем привязку всех почтовых сообщений к администратору (user_id = 1)
    const mailCountBefore = await client.query('SELECT count(*) FROM mail_messages');
    await client.query('UPDATE mail_messages SET user_id = 1 WHERE user_id != 1');
    const mailCountAfter = await client.query('SELECT count(*) FROM mail_messages');
    console.log(`✉️ Сохранено почтовых сообщений: ${mailCountAfter.rows[0].count} (было: ${mailCountBefore.rows[0].count})`);

    // 2. Документы: полная очистка чанков, прав и документов
    await client.query('DELETE FROM document_chunks');
    await client.query('DELETE FROM document_permissions');
    await client.query('DELETE FROM documents');
    await client.query("SELECT setval('documents_id_seq', 1, false)").catch(() => {});
    await client.query("SELECT setval('document_chunks_id_seq', 1, false)").catch(() => {});
    await client.query("SELECT setval('document_permissions_id_seq', 1, false)").catch(() => {});
    console.log('📄 Реестр документов, чанков и прав доступа полностью очищен');

    // 3. Папки документов: оставляем стандартные системные категории
    await client.query("DELETE FROM document_folders WHERE name NOT IN ('Общие', 'Договоры', 'Приказы', 'Отчеты', 'Спецификации', 'Проекты')");
    await client.query('UPDATE document_folders SET created_by = 1');
    console.log('📁 Каталог папок сброшен к системным стандартам');

    // 4. Задачи: полная очистка
    await client.query('DELETE FROM tasks');
    await client.query("SELECT setval('tasks_id_seq', 1, false)").catch(() => {});
    console.log('📋 Реестр задач и подзадач полностью очищен');

    // 5. Проекты и проектные материалы: полная очистка
    await client.query('DELETE FROM project_materials');
    await client.query('DELETE FROM projects');
    await client.query("SELECT setval('projects_id_seq', 1, false)").catch(() => {});
    await client.query("SELECT setval('project_materials_id_seq', 1, false)").catch(() => {});
    console.log('📁 Проекты и материалы проектов полностью очищены');

    // 6. Направления: сброс ответственных на администратора
    await client.query('UPDATE directions SET manager_id = 1');
    console.log('🧭 Направления компании сохранены, руководителем назначен Администратор');

    // 7. Совещания и календарные события: полная очистка
    await client.query('DELETE FROM conference_participants');
    await client.query('DELETE FROM conferences');
    await client.query("SELECT setval('conferences_id_seq', 1, false)").catch(() => {});
    console.log('🤝 Конференции и совещания полностью очищены');

    // 8. Корпоративный мессенджер: полная очистка сообщений
    await client.query('DELETE FROM chat_messages');
    await client.query("SELECT setval('chat_messages_id_seq', 1, false)").catch(() => {});
    console.log('💬 История сообщений и вложений мессенджера полностью очищена');

    // 9. Пользователи: удаляем всех пользователей, кроме администратора (id: 1)
    await client.query('DELETE FROM user_mail_settings WHERE user_id != 1').catch(() => {});
    await client.query('DELETE FROM users WHERE id != 1');
    await client.query(`
      UPDATE users 
      SET role = 'ADMIN', 
          role_id = (SELECT id FROM roles WHERE code = 'admin') 
      WHERE id = 1
    `);
    await client.query("SELECT setval('users_id_seq', 1, true)").catch(() => {});
    console.log('👤 Учетные записи: сохранен только Администратор (admin@docflow.local, id: 1)');

    await client.query('COMMIT');

    // 10. Очистка файлового хранилища на диске (uploads) и MinIO (кроме почтовых вложений)
    const uploadsDir = path.resolve(__dirname, '../../uploads');
    const mailAttRes = await db.query('SELECT file_path FROM mail_attachments');
    const mailFileNames = new Set(mailAttRes.rows.map(r => path.basename(r.file_path)));

    console.log(`📎 Защищено почтовых файлов-вложений: ${mailFileNames.size}`);

    if (fs.existsSync(uploadsDir)) {
      const allFiles = fs.readdirSync(uploadsDir);
      let deletedFilesCount = 0;

      for (const fileName of allFiles) {
        // Пропускаем системные логотипы, аватары, иконки и почтовые вложения
        if (fileName.startsWith('avatar-') || fileName.startsWith('logo-') || fileName.startsWith('icon-') || fileName.startsWith('favicon')) {
          continue;
        }
        if (mailFileNames.has(fileName)) {
          continue;
        }

        const fullPath = path.join(uploadsDir, fileName);
        try {
          if (fs.statSync(fullPath).isFile()) {
            fs.unlinkSync(fullPath);
            deletedFilesCount++;
            // Попытка удаления из MinIO
            storage.deleteObject(`documents/${fileName}`).catch(() => {});
            storage.deleteObject(`messenger/${fileName}`).catch(() => {});
            storage.deleteObject(`materials/${fileName}`).catch(() => {});
          }
        } catch (e) {
          console.warn(`[Cleanup Warning] Не удалось удалить файл ${fileName}:`, e.message);
        }
      }

      console.log(`🗑️ Удалено временных и тестовых файлов с диска: ${deletedFilesCount}`);
    }

    console.log('===============================================================');
    console.log('🎉 ВСЕ ДАННЫЕ УСПЕШНО ОЧИЩЕНЫ! СОХРАНЕНЫ ТОЛЬКО ПОЧТА И АДМИНИСТРАТОР.');
    console.log('===============================================================');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка при очистке данных:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  cleanAllDataExceptMailAndAdmin()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { cleanAllDataExceptMailAndAdmin };
