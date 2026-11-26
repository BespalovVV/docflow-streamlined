-- Migration 001: Initial Core Schema (Users, Projects, Tasks, Conferences, Documents, Mail)

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'USER',
  department VARCHAR(255) DEFAULT 'Общий отдел',
  position VARCHAR(255) DEFAULT 'Сотрудник',
  manager_id INT REFERENCES users(id) ON DELETE SET NULL,
  avatar_url VARCHAR(500) DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  git_url VARCHAR(500) DEFAULT '',
  status VARCHAR(50) DEFAULT 'ACTIVE',
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  priority VARCHAR(50) DEFAULT 'MEDIUM',
  status VARCHAR(50) DEFAULT 'TODO',
  deadline TIMESTAMP WITH TIME ZONE,
  assignee_id INT REFERENCES users(id) ON DELETE SET NULL,
  creator_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conferences (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  location_or_link VARCHAR(500) DEFAULT 'Онлайн-зал 1',
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conference_participants (
  conference_id INT REFERENCES conferences(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (conference_id, user_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  file_size INT NOT NULL DEFAULT 0,
  file_path VARCHAR(500) NOT NULL,
  category VARCHAR(100) DEFAULT 'Общие',
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  version INT DEFAULT 1,
  edit_key VARCHAR(120) DEFAULT NULL,
  is_public BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS document_permissions (
  id SERIAL PRIMARY KEY,
  document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_level VARCHAR(20) NOT NULL DEFAULT 'VIEW',
  granted_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (document_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_perm_user ON document_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_doc_perm_doc ON document_permissions(document_id);

CREATE TABLE IF NOT EXISTS mail_messages (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  folder VARCHAR(50) NOT NULL DEFAULT 'inbox',
  sender_name VARCHAR(255) NOT NULL,
  sender_email VARCHAR(255) NOT NULL,
  recipient_email VARCHAR(255) DEFAULT '',
  subject VARCHAR(500) NOT NULL,
  preview TEXT NOT NULL,
  body TEXT NOT NULL,
  message_id VARCHAR(500) DEFAULT NULL,
  imap_uid INT DEFAULT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_mail_settings (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  imap_host VARCHAR(255) NOT NULL DEFAULT 'imap.yandex.ru',
  imap_port INT NOT NULL DEFAULT 993,
  imap_tls BOOLEAN DEFAULT TRUE,
  smtp_host VARCHAR(255) NOT NULL DEFAULT 'smtp.yandex.ru',
  smtp_port INT NOT NULL DEFAULT 465,
  smtp_tls BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mail_attachments (
  id SERIAL PRIMARY KEY,
  mail_id INT REFERENCES mail_messages(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(100) DEFAULT 'application/octet-stream',
  file_size INT DEFAULT 0,
  file_path VARCHAR(500) NOT NULL,
  content_id VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
