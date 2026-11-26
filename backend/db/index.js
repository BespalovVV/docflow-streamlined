const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5439', 10),
  user: process.env.PGUSER || 'docflow',
  password: process.env.PGPASSWORD || 'docflow_secure_pass',
  database: process.env.PGDATABASE || 'docflow_db',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Guard against uncaught exceptions when idle database clients drop
pool.on('error', (err) => {
  console.error('[PostgreSQL Pool Error] Unexpected error on idle client:', err.message);
});

// 100% Valid OpenXML DOCX File Binary (Base64)
const VALID_DOCX_BASE64 = `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`;

function createSampleDocx(filePath) {
  const buf = Buffer.from(VALID_DOCX_BASE64.replace(/\s+/g, ''), 'base64');
  fs.writeFileSync(filePath, buf);
}

async function initDb() {
  const client = await pool.connect();
  try {
    console.log('[PostgreSQL] Connected to database. Verifying schema & seed data...');

    // Run versioned migrations
    try {
      const { runMigrations } = require('./migrate');
      await runMigrations();
    } catch (migErr) {
      console.warn('[PostgreSQL] Migration runner notice:', migErr.message);
    }

    await client.query('ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS imap_uid INT').catch(() => {});
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);
    await client.query('ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS message_id VARCHAR(500)').catch(() => {});
    await client.query('ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(255)').catch(() => {});
    await client.query('ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS imap_uid INT').catch(() => {});
    await client.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT \'WORK\'').catch(() => {});
    await client.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE').catch(() => {});
    await client.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_type VARCHAR(50) DEFAULT \'NONE\'').catch(() => {});
    await client.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_until TIMESTAMP WITH TIME ZONE').catch(() => {});
    await client.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_interval INT DEFAULT 1').catch(() => {});
    await client.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_days VARCHAR(50) DEFAULT NULL').catch(() => {});
    await client.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_exceptions TEXT[] DEFAULT ARRAY[]::TEXT[]').catch(() => {});
    await client.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS series_id INT DEFAULT NULL').catch(() => {});
    await client.query('ALTER TABLE conferences ADD COLUMN IF NOT EXISTS meeting_format VARCHAR(100) DEFAULT \'Онлайн\'').catch(() => {});
    await client.query('ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT \'[]\'::jsonb').catch(() => {});

    // Автоматическое устранение кракозябр (Mojibake) в ранее сохраненных записях
    try {
      const { fixFilenameEncoding } = require('../utils/encoding');
      const chatRows = await client.query("SELECT id, message, attachment_name FROM chat_messages WHERE attachment_name ~ '[ÐÑ]' OR message ~ '[ÐÑ]'");
      for (const r of chatRows.rows) {
        const fixedName = fixFilenameEncoding(r.attachment_name);
        const fixedMsg = fixFilenameEncoding(r.message);
        await client.query('UPDATE chat_messages SET attachment_name = $1, message = $2 WHERE id = $3', [fixedName, fixedMsg, r.id]);
      }
      const docRows = await client.query("SELECT id, title FROM documents WHERE title ~ '[ÐÑ]'");
      for (const r of docRows.rows) {
        const fixedTitle = fixFilenameEncoding(r.title);
        await client.query('UPDATE documents SET title = $1 WHERE id = $2', [fixedTitle, r.id]);
      }
    } catch (e) {
      console.warn('[DB Mojibake Cleanup Notice]:', e.message);
    }

    // Seed default conference formats
    const defaultFormats = ['Онлайн', 'Очно в офисе', 'Гибрид', 'Переговорная комната 1', 'Конференц-зал'];
    for (const fmt of defaultFormats) {
      await client.query('INSERT INTO conference_formats (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [fmt]);
    }

    // Seed default document folders
    const defaultFolders = ['Общие', 'Договоры', 'Приказы', 'Отчеты', 'Спецификации', 'Проекты'];
    for (const fld of defaultFolders) {
      const existing = await client.query('SELECT id FROM document_folders WHERE name = $1', [fld]);
      if (existing.rows.length === 0) {
        await client.query('INSERT INTO document_folders (name) VALUES ($1)', [fld]);
      }
    }

    await client.query('CREATE INDEX IF NOT EXISTS idx_mail_messages_user_folder_uid ON mail_messages(user_id, folder, imap_uid)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_permissions (
        id SERIAL PRIMARY KEY,
        document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission_level VARCHAR(20) NOT NULL DEFAULT 'VIEW',
        granted_by INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (document_id, user_id)
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_doc_perm_user ON document_permissions(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_doc_perm_doc ON document_permissions(document_id)');

    // Default Permissions Catalog
    const defaultPermissions = [
      ['documents.view', 'Документы', 'Просмотр документов', 'Доступ к просмотру реестра документов'],
      ['documents.upload', 'Документы', 'Загрузка документов', 'Возможность загружать новые файлы в систему'],
      ['documents.download', 'Документы', 'Скачивание файлов', 'Возможность скачивать оригиналы файлов на ПК'],
      ['documents.edit', 'Документы', 'Редактирование документов', 'Редактирование в ONLYOFFICE и изменение параметров'],
      ['documents.delete', 'Документы', 'Удаление документов', 'Безвозвратное удаление документов из системы'],
      ['projects.view', 'Проекты', 'Просмотр проектов', 'Просмотр каталога проектов и аналитики'],
      ['projects.create', 'Проекты', 'Создание проектов', 'Создание новых проектных направлений'],
      ['projects.edit', 'Проекты', 'Редактирование проектов', 'Изменение параметров, сроков и описаний проектов'],
      ['projects.delete', 'Проекты', 'Удаление проектов', 'Удаление проектов из системы'],
      ['tasks.view', 'Задачи', 'Просмотр задач', 'Просмотр канбан-доски и списка задач'],
      ['tasks.create', 'Задачи', 'Постановка задач', 'Создание новых задач сотрудникам'],
      ['tasks.edit_status', 'Задачи', 'Смена статусов задач', 'Перевод задач в IN_PROGRESS и DONE'],
      ['tasks.edit_all', 'Задачи', 'Редактирование любых задач', 'Изменение названий, дедлайнов и исполнителей'],
      ['tasks.delete', 'Задачи', 'Удаление задач', 'Удаление задач из системы'],
      ['conferences.view', 'Конференции', 'Просмотр собраний', 'Просмотр совещаний и календаря'],
      ['conferences.manage', 'Конференции', 'Управление конференциями', 'Создание, редактирование и удаление собраний'],
      ['users.view', 'Участники', 'Просмотр участников', 'Доступ к справочнику сотрудников'],
      ['users.manage', 'Участники', 'Управление пользователями', 'Создание, изменение и блокировка сотрудников'],
      ['roles.manage', 'Участники', 'Управление ролями и правами', 'Создание ролей и настройка матрицы доступа'],
      ['mail.use', 'Почта', 'Корпоративная почта', 'Синхронизация IMAP/SMTP и отправка писем'],
      ['directions.view', 'Направления', 'Просмотр направлений', 'Доступ к просмотру реестра направлений'],
      ['directions.manage', 'Направления', 'Управление направлениями', 'Создание и редактирование направлений компании'],
      ['materials.view', 'Материалы', 'Просмотр материалов проектов', 'Доступ к проектным материалам и спецификациям'],
      ['materials.upload', 'Материалы', 'Загрузка материалов', 'Добавление и версионирование проектных материалов'],
      ['materials.delete', 'Материалы', 'Удаление материалов', 'Удаление материалов из проектов']
    ];

    for (const [code, cat, name, desc] of defaultPermissions) {
      await client.query(`
        INSERT INTO permissions (code, category, name, description)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (code) DO UPDATE SET category = EXCLUDED.category, name = EXCLUDED.name, description = EXCLUDED.description
      `, [code, cat, name, desc]);
    }

    // Default System Roles
    await client.query(`
      INSERT INTO roles (code, name, description, is_system) VALUES
      ('admin', 'Администратор', 'Полный доступ ко всей системе и управлению ролями', true),
      ('manager', 'Руководитель проектов', 'Управление проектами, задачами, совещаниями и документами', false),
      ('employee', 'Сотрудник', 'Стандартная рабочая роль: задачи, документы и почта', false),
      ('viewer', 'Наблюдатель', 'Режим только для чтения без права изменений', false)
      ON CONFLICT (code) DO NOTHING
    `);

    // Assign default permissions to roles
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r, permissions p
      WHERE r.code = 'admin'
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r, permissions p
      WHERE r.code = 'manager' AND p.code IN (
        'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
        'tasks.view', 'tasks.create', 'tasks.edit_status', 'tasks.edit_all', 'tasks.delete',
        'conferences.view', 'conferences.manage',
        'documents.view', 'documents.upload', 'documents.download', 'documents.edit',
        'users.view', 'mail.use',
        'directions.view', 'directions.manage', 'materials.view', 'materials.upload', 'materials.delete'
      )
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r, permissions p
      WHERE r.code = 'employee' AND p.code IN (
        'projects.view',
        'tasks.view', 'tasks.create', 'tasks.edit_status',
        'conferences.view',
        'documents.view', 'documents.upload', 'documents.download',
        'users.view', 'mail.use',
        'directions.view', 'materials.view', 'materials.upload'
      )
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r, permissions p
      WHERE r.code = 'viewer' AND p.code IN (
        'projects.view', 'tasks.view', 'conferences.view', 'documents.view', 'users.view',
        'directions.view', 'materials.view'
      )
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `);

    const adminHash = await bcrypt.hash('admin123', 10);

    await client.query(`
      INSERT INTO users (id, email, password_hash, full_name, role, department) VALUES
      (1, 'admin@docflow.local', $1, 'Администратор Системы', 'ADMIN', 'Управление')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash]);
    await client.query("SELECT setval('users_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1))");

    // Sync users with roles
    await client.query(`
      UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'admin')
      WHERE (role = 'ADMIN' OR email = 'admin@docflow.local') AND (role_id IS NULL OR role_id != (SELECT id FROM roles WHERE code = 'admin'))
    `);
    await client.query(`
      UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'employee')
      WHERE role_id IS NULL
    `);

    // Ensure Test Users from TEST_USERS.txt exist and have correct passwords and hierarchy
    try {
      const adminHash = await bcrypt.hash('admin123', 10);
      const testHash = await bcrypt.hash('Test1234!', 10);

      await client.query(`
        INSERT INTO users (email, password_hash, full_name, role, department, position) VALUES
        ('admin@docflow.local', $1, 'Администратор Системы', 'ADMIN', 'Управление', 'Системный администратор'),
        ('ivanov@docflow.local', $2, 'Иван Иванов', 'USER', 'Отдел разработки', 'Ведущий разработчик'),
        ('petrova@docflow.local', $2, 'Анна Петрова', 'USER', 'Юридический отдел', 'Юрист'),
        ('sidorov@docflow.local', $2, 'Алексей Сидоров', 'USER', 'Бухгалтерия', 'Бухгалтер'),
        ('kuznetsova@docflow.local', $2, 'Елена Кузнецова', 'USER', 'Маркетинг', 'Маркетолог'),
        ('smirnov@docflow.local', $2, 'Дмитрий Смирнов', 'USER', 'Отдел продаж', 'Менеджер по продажам')
        ON CONFLICT (email) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          role = EXCLUDED.role,
          department = EXCLUDED.department,
          position = EXCLUDED.position;
      `, [adminHash, testHash]);

      await client.query(`
        UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'admin') WHERE role = 'ADMIN';
        UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'employee') WHERE role = 'USER' AND role_id IS NULL;
        UPDATE users SET manager_id = 1 WHERE id != 1 AND manager_id IS NULL;
      `);
      console.log('[PostgreSQL] ✅ Verified 6 standard test users from TEST_USERS.txt');
    } catch (errUsers) {
      console.warn('[PostgreSQL] Notice during test users verification:', errUsers.message);
    }

    // Check if database needs seeding
    const res = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(res.rows[0].count, 10) <= 6) {
      console.log('[PostgreSQL] Seeding initial sample data...');
      
      const adminHash = await bcrypt.hash('admin123', 10);
      const userHash = await bcrypt.hash('user123', 10);

      // Insert default seed users
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
        ON CONFLICT (email) DO NOTHING
      `, [adminHash, userHash]);

      await client.query("SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))");

      // Insert default projects
      await client.query(`
        INSERT INTO projects (id, title, description, git_url, status, start_date, end_date) VALUES
        (1, 'Платформа Документооборота v2', 'Обновленный модуль онлайн-редактирования и аналитики задач', 'https://github.com/docflow/core-service.git', 'ACTIVE', '2026-09-01', '2026-12-31'),
        (2, 'Модернизация регламентов юридического отдела', 'Пересмотр внутренних инструкций и согласование шаблонов документов', '', 'ACTIVE', '2026-08-15', '2026-10-15')
      `);
      await client.query("SELECT setval('projects_id_seq', (SELECT MAX(id) FROM projects))");

      // Insert default tasks
      await client.query(`
        INSERT INTO tasks (id, project_id, title, description, priority, status, deadline, assignee_id, creator_id) VALUES
        (1, 1, 'Настройка интеграции ONLYOFFICE Docs API', 'Проверить работу обратных вызовов сохранения и токенов JWT', 'HIGH', 'IN_PROGRESS', NOW() + INTERVAL '3 days', 2, 1),
        (2, 2, 'Подготовка проекта юридического соглашения', 'Составить стандартную форму договора поставки оборудования', 'MEDIUM', 'TODO', NOW() + INTERVAL '5 days', 3, 1),
        (3, NULL, 'Обновить квалификационные сертификаты сотрудника', 'Автономная задача: загрузить сканы документов в личный профиль', 'LOW', 'TODO', NOW() + INTERVAL '7 days', 2, 1)
      `);
      await client.query("SELECT setval('tasks_id_seq', (SELECT MAX(id) FROM tasks))");

      // Insert default conferences
      await client.query(`
        INSERT INTO conferences (id, title, description, start_time, end_time, location_or_link, created_by) VALUES
        (1, 'Стратегический комитет по архитектуре платформы', 'Обсуждение единой точки входа, перехода на PostgreSQL и интеграции ONLYOFFICE', NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 2 hours', 'https://meet.docflow.local/arch-review', 1)
      `);
      await client.query("SELECT setval('conferences_id_seq', (SELECT MAX(id) FROM conferences))");

      // Insert conference participants
      await client.query(`
        INSERT INTO conference_participants (conference_id, user_id) VALUES (1, 1), (1, 2), (1, 3)
      `);

      // Insert mail messages
      await client.query(`
        INSERT INTO mail_messages (id, user_id, folder, sender_name, sender_email, recipient_email, subject, preview, body, is_read) VALUES
        (1, 1, 'inbox', 'Алексей Смирнов', 'smirnov@partner.ru', 'admin@docflow.local', 'Согласование спецификации по проекту Alpha', 'Приветствую! Высылаю обновленную спецификацию для ознакомления.', 'Приветствую!\n\nВысылаю обновленную спецификацию по проекту Alpha. Прошу проверить разделы 3 и 4 и дать обратную связь до конца недели.\n\nС уважением,\nАлексей', false),
        (2, 1, 'inbox', 'IT Поддержка', 'support@docflow.local', 'admin@docflow.local', 'Плановое обслуживание серверов ONLYOFFICE', 'Уведомляем о проведении профилактических работ в субботу в 22:00.', 'Уважаемые коллеги!\n\nВ субботу в 22:00 будут проводиться плановые работы по обновлению сервера ONLYOFFICE Docs. Возможны кратковременные перерывы в работе онлайн-редакторов.\n\nКоманда IT', true)
      `);
      await client.query("SELECT setval('mail_messages_id_seq', (SELECT MAX(id) FROM mail_messages))");

      // Valid binary DOCX document
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

      console.log('[PostgreSQL] Database seeding successfully completed.');
    } else {
      console.log('[PostgreSQL] Database schema ready with existing records.');
    }

    // Ensure default directions & project materials exist
    try {
      const dirCount = await client.query('SELECT COUNT(*) FROM directions');
      if (parseInt(dirCount.rows[0].count, 10) === 0) {
        console.log('[PostgreSQL] Seeding 3-level directions, projects and materials...');
        
        // 1. Directions
        await client.query(`
          INSERT INTO directions (id, name, code, description, icon, color, manager_id) VALUES
          (1, 'Информационные технологии и цифровизация', 'IT', 'Архитектура веб-платформы, онлайн-редакторы, безопасность и корпоративный мессенджер', '💻', '#3b82f6', 1),
          (2, 'Производство, НИОКР и инженерия', 'RND', 'Проектирование аппаратных комплексов, схемотехника, прототипирование и автоматизация', '⚙️', '#10b981', 1),
          (3, 'Юриспруденция, аудит и комплаенс', 'LEGAL', 'Правовая экспертиза договоров, регламенты, комплаенс-аудит и корпоративные стандарты', '⚖️', '#8b5cf6', 1)
          ON CONFLICT (id) DO NOTHING
        `);
        await client.query("SELECT setval('directions_id_seq', (SELECT MAX(id) FROM directions))");

        // Link existing projects
        await client.query('UPDATE projects SET direction_id = 1 WHERE id = 1');
        await client.query('UPDATE projects SET direction_id = 3 WHERE id = 2');

        // Add sample project in Direction 2
        const projRes = await client.query(`
          INSERT INTO projects (title, description, status, direction_id, start_date, end_date)
          VALUES ('Автоматизация производственной линии', 'Разработка микроконтроллерных модулей и сборочной линии', 'ACTIVE', 2, '2026-10-01', '2027-03-31')
          RETURNING id
        `);
        const proj2Id = projRes.rows[0]?.id;

        // Sample materials files
        const uploadsDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

        const matFile1 = path.join(uploadsDir, 'material-spec-it.docx');
        const matFile2 = path.join(uploadsDir, 'material-schema-rnd.docx');
        const matFile3 = path.join(uploadsDir, 'material-nda-legal.docx');
        createSampleDocx(matFile1);
        createSampleDocx(matFile2);
        createSampleDocx(matFile3);

        const s1 = fs.statSync(matFile1).size;
        const s2 = fs.statSync(matFile2).size;
        const s3 = fs.statSync(matFile3).size;

        const checkProj1 = await client.query('SELECT id FROM projects WHERE id = 1');
        if (checkProj1.rows.length > 0) {
          await client.query(`
            INSERT INTO project_materials (project_id, direction_id, title, description, material_type, status, version, file_name, file_type, file_size, file_path, author_id) VALUES
            (1, 1, 'Архитектурное описание DocFlow Core v2', 'Полная спецификация сервисов, базы данных и сокетных протоколов', 'СПЕЦИФИКАЦИЯ', 'APPROVED', '2.1', 'material-spec-it.docx', 'docx', $1, $2, 1),
            (1, 1, 'Регламент со-редактирования документов ONLYOFFICE', 'Правила блокировок, forcesave и коллаборации пользователей', 'РЕГЛАМЕНТ', 'APPROVED', '1.3', 'material-spec-it.docx', 'docx', $1, $2, 2),
            (${proj2Id || 1}, 2, 'Принципиальная схема управляющего контроллера', 'Сборочные чертежи и спецификация радиокомпонентов', 'ЧЕРТЕЖ', 'IN_REVIEW', '1.0', 'material-schema-rnd.docx', 'docx', $3, $4, 4),
            (${proj2Id || 1}, 3, 'Типовая форма соглашения NDA и поставки', 'Стандартизированный шаблон договора поставки с защитой данных', 'ДОГОВОР', 'APPROVED', '3.0', 'material-nda-legal.docx', 'docx', $5, $6, 3)
          `, [s1, matFile1, s2, matFile2, s3, matFile3]);
          console.log('[PostgreSQL] ✅ Successfully seeded 3-level directions, projects, and materials.');
        } else {
          console.log('[PostgreSQL] ✅ Successfully seeded directions.');
        }
      }
    } catch (errSeed) {
      console.warn('[PostgreSQL] Notice during directions/materials seeding:', errSeed.message);
    }
  } catch (err) {
    console.error('[PostgreSQL] Error initializing DB:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDb,
  createSampleDocx,
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  withTransaction: async (callback) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
};
