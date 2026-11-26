const { pool, createSampleDocx } = require('./index');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

async function runSeed() {
  const client = await pool.connect();
  try {
    console.log('[Seed Script] Resetting PostgreSQL database and running seed script...');

    // Run schema.sql
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);

    // Truncate tables
    await client.query('TRUNCATE conference_participants, mail_messages, tasks, documents, conferences, projects, users RESTART IDENTITY CASCADE;');

    const adminHash = await bcrypt.hash('admin123', 10);
    const userHash = await bcrypt.hash('user123', 10);

    // Seed users
    await client.query(`
      INSERT INTO users (id, email, password_hash, full_name, role, department) VALUES
      (1, 'admin@docflow.local', $1, 'Администратор Системы', 'ADMIN', 'Управление'),
      (2, 'ivanov@docflow.local', $2, 'Иван Иванов', 'USER', 'Отдел разработки'),
      (3, 'petrova@docflow.local', $2, 'Анна Петрова', 'USER', 'Юридический отдел'),
      (4, 'sidorov@docflow.local', $2, 'Алексей Сидоров', 'USER', 'Отдел разработки'),
      (5, 'kuznetsova@docflow.local', $2, 'Елена Кузнецова', 'USER', 'Бухгалтерия'),
      (6, 'smirnov@docflow.local', $2, 'Дмитрий Смирнов', 'USER', 'Отдел продаж'),
      (7, 'vlasova@docflow.local', $2, 'Ольга Власова', 'USER', 'HR и кадры'),
      (8, 'morozov@docflow.local', $2, 'Сергей Морозов', 'USER', 'Инфраструктура и DevOps'),
      (9, 'popova@docflow.local', $2, 'Мария Попова', 'USER', 'Дизайн и UX'),
      (10, 'kozlov@docflow.local', $2, 'Михаил Козлов', 'USER', 'Финансовый отдел'),
      (11, 'novikova@docflow.local', $2, 'Екатерина Новикова', 'USER', 'Маркетинг'),
      (12, 'volkov@docflow.local', $2, 'Артем Волков', 'USER', 'Отдел тестирования QA')
    `, [adminHash, userHash]);
    await client.query("SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))");

    // Seed projects
    await client.query(`
      INSERT INTO projects (id, title, description, git_url, status, start_date, end_date) VALUES
      (1, 'Платформа Документооборота v2', 'Обновленный модуль онлайн-редактирования и аналитики задач', 'https://github.com/docflow/core-service.git', 'ACTIVE', '2026-09-01', '2026-12-31'),
      (2, 'Модернизация регламентов юридического отдела', 'Пересмотр внутренних инструкций и согласование шаблонов документов', '', 'ACTIVE', '2026-08-15', '2026-10-15')
    `);
    await client.query("SELECT setval('projects_id_seq', (SELECT MAX(id) FROM projects))");

    // Seed tasks
    await client.query(`
      INSERT INTO tasks (id, project_id, title, description, priority, status, deadline, assignee_id, creator_id) VALUES
      (1, 1, 'Настройка интеграции ONLYOFFICE Docs API', 'Проверить работу обратных вызовов сохранения и токенов JWT', 'HIGH', 'IN_PROGRESS', NOW() + INTERVAL '3 days', 2, 1),
      (2, 2, 'Подготовка проекта юридического соглашения', 'Составить стандартную форму договора поставки оборудования', 'MEDIUM', 'TODO', NOW() + INTERVAL '5 days', 3, 1),
      (3, NULL, 'Обновить квалификационные сертификаты сотрудника', 'Автономная задача: загрузить сканы документов в личный профиль', 'LOW', 'TODO', NOW() + INTERVAL '7 days', 2, 1)
    `);
    await client.query("SELECT setval('tasks_id_seq', (SELECT MAX(id) FROM tasks))");

    // Seed conferences
    await client.query(`
      INSERT INTO conferences (id, title, description, start_time, end_time, location_or_link, created_by) VALUES
      (1, 'Стратегический комитет по архитектуре платформы', 'Обсуждение единой точки входа, перехода на PostgreSQL и интеграции ONLYOFFICE', NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 2 hours', 'https://meet.docflow.local/arch-review', 1)
    `);
    await client.query("SELECT setval('conferences_id_seq', (SELECT MAX(id) FROM conferences))");

    // Seed conference participants
    await client.query(`
      INSERT INTO conference_participants (conference_id, user_id) VALUES (1, 1), (1, 2), (1, 3)
    `);

    // Seed mail
    await client.query(`
      INSERT INTO mail_messages (id, user_id, folder, sender_name, sender_email, subject, preview, body, is_read) VALUES
      (1, 1, 'inbox', 'Алексей Смирнов', 'smirnov@partner.ru', 'Согласование спецификации по проекту Alpha', 'Приветствую! Высылаю обновленную спецификацию для ознакомления.', 'Приветствую!\n\nВысылаю обновленную спецификацию по проекту Alpha. Прошу проверить разделы 3 и 4 и дать обратную связь до конца недели.\n\nС уважением,\nАлексей', false),
      (2, 1, 'inbox', 'IT Поддержка', 'support@docflow.local', 'Плановое обслуживание серверов ONLYOFFICE', 'Уведомляем о проведении профилактических работ в субботу в 22:00.', 'Уважаемые коллеги!\n\nВ субботу в 22:00 будут проводиться плановые работы по обновлению сервера ONLYOFFICE Docs. Возможны кратковременные перерывы в работе онлайн-редакторов.\n\nКоманда IT', true)
    `);
    await client.query("SELECT setval('mail_messages_id_seq', (SELECT MAX(id) FROM mail_messages))");

    // Sample valid binary docx file
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const sampleDocPath = path.join(uploadsDir, 'sample-spec.docx');
    createSampleDocx(sampleDocPath);
    const stats = fs.statSync(sampleDocPath);

    await client.query(`
      INSERT INTO documents (id, title, file_name, file_type, file_size, file_path, category, created_by) VALUES
      (1, 'Техническое задание на платформу.docx', 'sample-spec.docx', 'docx', $1, $2, 'Спецификации', 1)
    `, [stats.size, sampleDocPath]);
    await client.query("SELECT setval('documents_id_seq', (SELECT MAX(id) FROM documents))");

    console.log('[Seed Script] Database successfully reset and seeded!');
  } catch (err) {
    console.error('[Seed Script] Error seeding database:', err);
  } finally {
    client.release();
    pool.end();
  }
}

runSeed();
