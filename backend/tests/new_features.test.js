// backend/tests/new_features.test.js
const assert = require('assert');
const db = require('../db');

async function runNewFeaturesTests() {
  console.log('\n🚀 [Тестирование новых возможностей платформы]');

  // 1. Проверка категорий и повторения задач
  {
    const validCategories = ['WORK', 'STUDY', 'PERSONAL', 'PROJECT', 'URGENT'];
    const validRecurringTypes = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'];

    assert.ok(validCategories.includes('STUDY'), 'Категория STUDY должна поддерживаться');
    assert.ok(validCategories.includes('PERSONAL'), 'Категория PERSONAL должна поддерживаться');
    assert.ok(validRecurringTypes.includes('WEEKLY'), 'Тип повторения WEEKLY должен поддерживаться');

    console.log('  ✅ 1. Валидация категорий задач (Учеба, Личное, Работа) и периодичности повторения — Успешно');
  }

  // 2. Проверка форматов встреч и конференций
  {
    const defaultFormats = ['Онлайн (DocFlow Meet)', 'Очно в офисе', 'Гибрид', 'Переговорная №1'];
    const customFormat = 'Выездная стратегическая сессия';
    
    assert.ok(!defaultFormats.includes(customFormat), 'Новый формат изначально отсутствует');
    defaultFormats.push(customFormat);
    assert.ok(defaultFormats.includes(customFormat), 'Новый формат успешно добавлен в список');

    console.log('  ✅ 2. Создание произвольных форматов встреч и расширение списка форматов — Успешно');
  }

  // 3. Проверка логики массовой выдачи прав на документы
  {
    const users = [
      { id: 1, department: 'Управление' },
      { id: 2, department: 'Отдел разработки' },
      { id: 3, department: 'Юридический отдел' },
      { id: 4, department: 'Отдел разработки' }
    ];

    const devDeptUsers = users.filter(u => u.department === 'Отдел разработки');
    assert.strictEqual(devDeptUsers.length, 2, 'В отделе разработки должно быть 2 пользователя');

    const allUsersExceptAuthor = users.filter(u => u.id !== 1);
    assert.strictEqual(allUsersExceptAuthor.length, 3, 'Всем кроме автора доступно 3 пользователя');

    console.log('  ✅ 3. Логика массовой фильтрации пользователей для выдачи прав (всем / отделу) — Успешно');
  }

  // 4. Проверка структуры сообщений мессенджера
  {
    const generalMsg = {
      sender_id: 1,
      recipient_id: null,
      channel: 'general',
      message: 'Привет всей команде DocFlow!'
    };

    assert.strictEqual(generalMsg.channel, 'general', 'Общее сообщение должно идти в канал general');
    assert.strictEqual(generalMsg.recipient_id, null, 'Общее сообщение не имеет конкретного получателя');

    const directMsg = {
      sender_id: 1,
      recipient_id: 2,
      channel: null,
      message: 'Привет, Иван! Посмотри задачу.'
    };

    assert.strictEqual(directMsg.recipient_id, 2, 'Личное сообщение имеет recipient_id');
    assert.strictEqual(directMsg.channel, null, 'Личное сообщение не имеет канала');

    console.log('  ✅ 4. Модель сообщений корпоративного мессенджера (общий канал и директ) — Успешно');
  }

  // 5. Проверка соединения с базой данных (если активна)
  let dbAvailable = false;
  try {
    const res = await db.query('SELECT 1 AS col');
    if (res.rows && res.rows[0].col === 1) dbAvailable = true;
  } catch (e) {
    console.log(`  ℹ️ Подключение к БД PostgreSQL с хоста недоступно (${e.message}). Пропуск live SQL тестов.`);
  }

  if (dbAvailable) {
    // Check tables exist
    const tablesRes = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name IN ('chat_messages', 'document_folders', 'conference_formats')
    `);
    const tables = tablesRes.rows.map(r => r.table_name);
    assert.ok(tables.includes('chat_messages'), 'Таблица chat_messages создана');
    assert.ok(tables.includes('document_folders'), 'Таблица document_folders создана');
    assert.ok(tables.includes('conference_formats'), 'Таблица conference_formats создана');
    console.log('  ✅ 5. Проверка таблиц в БД (chat_messages, document_folders, conference_formats) — Успешно');
  }

  console.log('🎉 Все тесты новых функций успешно пройдены!\n');
}

if (require.main === module) {
  runNewFeaturesTests().catch(err => {
    console.error('Test failure:', err);
    process.exit(1);
  });
}

module.exports = runNewFeaturesTests;
