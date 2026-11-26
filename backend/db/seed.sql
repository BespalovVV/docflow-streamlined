-- SEED DATA SCRIPT FOR DOCFLOW STREAMLINED (POSTGRESQL)

-- Clear existing data (in correct cascade order)
TRUNCATE conference_participants, mail_messages, tasks, documents, conferences, projects, users RESTART IDENTITY CASCADE;

-- 1. Insert Initial Users
-- Passwords: admin123 and user123 (bcrypt hashes)
INSERT INTO users (id, email, password_hash, full_name, role, department) VALUES
(1, 'admin@docflow.local', '$2a$10$3n2K5YyDsmL75z3e3dMee.eAexiO9d1xJg.Nf0nUaD.K7yK6K7vOi', 'Администратор Системы', 'ADMIN', 'Управление'),
(2, 'ivanov@docflow.local', '$2a$10$6Rz3G9bF7A7eW4m2x8n8u.QYxJgK0lP9m.Nf0nUaD.K7yK6K7vOi', 'Иван Иванов', 'USER', 'Отдел разработки'),
(3, 'petrova@docflow.local', '$2a$10$6Rz3G9bF7A7eW4m2x8n8u.QYxJgK0lP9m.Nf0nUaD.K7yK6K7vOi', 'Анна Петрова', 'USER', 'Юридический отдел');

SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));

-- 2. Insert Projects (With Git URLs and Empty Git URLs)
INSERT INTO projects (id, title, description, git_url, status, start_date, end_date) VALUES
(1, 'Платформа Документооборота v2', 'Обновленный модуль онлайн-редактирования и аналитики задач', 'https://github.com/docflow/core-service.git', 'ACTIVE', '2026-09-01', '2026-12-31'),
(2, 'Модернизация регламентов юридического отдела', 'Пересмотр внутренних инструкций и согласование шаблонов документов', '', 'ACTIVE', '2026-08-15', '2026-10-15');

SELECT setval('projects_id_seq', (SELECT MAX(id) FROM projects));

-- 3. Insert Tasks (Both Project-bound and Standalone)
INSERT INTO tasks (id, project_id, title, description, priority, status, deadline, assignee_id, creator_id) VALUES
(1, 1, 'Настройка интеграции ONLYOFFICE Docs API', 'Проверить работу обратных вызовов сохранения и токенов JWT', 'HIGH', 'IN_PROGRESS', NOW() + INTERVAL '3 days', 2, 1),
(2, 2, 'Подготовка проекта юридического соглашения', 'Составить стандартную форму договора поставки оборудования', 'MEDIUM', 'TODO', NOW() + INTERVAL '5 days', 3, 1),
(3, NULL, 'Обновить квалификационные сертификаты сотрудника', 'Автономная задача: загрузить сканы документов в личный профиль', 'LOW', 'TODO', NOW() + INTERVAL '7 days', 2, 1);

SELECT setval('tasks_id_seq', (SELECT MAX(id) FROM tasks));

-- 4. Insert Conferences
INSERT INTO conferences (id, title, description, start_time, end_time, location_or_link, created_by) VALUES
(1, 'Стратегический комитет по архитектуре платформы', 'Обсуждение единой точки входа, перехода на PostgreSQL и интеграции ONLYOFFICE', NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 2 hours', 'https://meet.docflow.local/arch-review', 1);

SELECT setval('conferences_id_seq', (SELECT MAX(id) FROM conferences));

-- 5. Insert Conference Participants
INSERT INTO conference_participants (conference_id, user_id) VALUES
(1, 1),
(1, 2),
(1, 3);

-- 6. Insert Mail Messages
INSERT INTO mail_messages (id, user_id, folder, sender_name, sender_email, subject, preview, body, is_read) VALUES
(1, 1, 'inbox', 'Алексей Смирнов', 'smirnov@partner.ru', 'Согласование спецификации по проекту Alpha', 'Приветствую! Высылаю обновленную спецификацию для ознакомления.', 'Приветствую!\n\nВысылаю обновленную спецификацию по проекту Alpha. Прошу проверить разделы 3 и 4 и дать обратную связь до конца недели.\n\nС уважением,\nАлексей', false),
(2, 1, 'inbox', 'IT Поддержка', 'support@docflow.local', 'Плановое обслуживание серверов ONLYOFFICE', 'Уведомляем о проведении профилактических работ в субботу в 22:00.', 'Уважаемые коллеги!\n\nВ субботу в 22:00 будут проводиться плановые работы по обновлению сервера ONLYOFFICE Docs. Возможны кратковременные перерывы в работе онлайн-редакторов.\n\nКоманда IT', true);

SELECT setval('mail_messages_id_seq', (SELECT MAX(id) FROM mail_messages));

-- 7. Insert Sample Document
INSERT INTO documents (id, title, file_name, file_type, file_size, file_path, category, created_by) VALUES
(1, 'Техническое задание на платформу.docx', 'sample-spec.docx', 'docx', 15420, '/app/uploads/sample-spec.docx', 'Спецификации', 1);

SELECT setval('documents_id_seq', (SELECT MAX(id) FROM documents));
