-- SCHEMAS FOR DOCFLOW STREAMLINED (POSTGRESQL)

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
  is_public BOOLEAN DEFAULT FALSE,
  content_text TEXT DEFAULT '',
  content_tsv TSVECTOR,
  indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
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

-- ==========================================
-- DYNAMIC RBAC TABLES (ROLES & PERMISSIONS)
-- ==========================================
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT DEFAULT '',
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  code VARCHAR(100) UNIQUE NOT NULL,
  category VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ==========================================
-- MESSENGER, FOLDERS, FORMATS & RECURRING TASKS
-- ==========================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INT REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(50) DEFAULT 'general',
  message TEXT NOT NULL,
  attachment_url TEXT,
  attachment_name TEXT,
  attachment_size INT,
  attachment_type TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_folders (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conference_formats (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- EXTEND TASKS COLUMNS
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'WORK';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_type VARCHAR(50) DEFAULT 'NONE';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_interval INT DEFAULT 1;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_days VARCHAR(50) DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_exceptions TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS series_id INT DEFAULT NULL;

-- EXTEND CONFERENCES COLUMNS
ALTER TABLE conferences ADD COLUMN IF NOT EXISTS meeting_format VARCHAR(100) DEFAULT 'Онлайн';

-- PERFORMANCE INDEXES & DEDUPLICATION CONSTRAINTS
ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS imap_uid INT;
CREATE INDEX IF NOT EXISTS idx_mail_messages_user_id_folder ON mail_messages(user_id, folder);
CREATE INDEX IF NOT EXISTS idx_mail_messages_message_id ON mail_messages(message_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_messages_user_folder_uid ON mail_messages (user_id, folder, imap_uid) WHERE imap_uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_messages_user_folder_msgid ON mail_messages (user_id, folder, message_id) WHERE message_id IS NOT NULL AND message_id != '';
CREATE INDEX IF NOT EXISTS idx_documents_created_by ON documents(created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS position VARCHAR(255) DEFAULT 'Сотрудник';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_tasks_creator_id ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_documents_is_public ON documents(is_public);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel);
CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient ON chat_messages(recipient_id);

-- ==========================================
-- 3-LEVEL SUBDIVISION (НАПРАВЛЕНИЕ -> ПРОЕКТ -> МАТЕРИАЛ)
-- ==========================================
CREATE TABLE IF NOT EXISTS directions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE,
  description TEXT,
  icon VARCHAR(50) DEFAULT '🧭',
  color VARCHAR(50) DEFAULT '#3b82f6',
  manager_id INT REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'ACTIVE',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS direction_id INT REFERENCES directions(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS code VARCHAR(50);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS manager_id INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget NUMERIC(15, 2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS project_materials (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  direction_id INT REFERENCES directions(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  material_type VARCHAR(100) DEFAULT 'СПЕЦИФИКАЦИЯ',
  status VARCHAR(50) DEFAULT 'APPROVED',
  version VARCHAR(50) DEFAULT '1.0',
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(100) DEFAULT 'application/octet-stream',
  file_size INT DEFAULT 0,
  file_path VARCHAR(500) NOT NULL,
  author_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_directions_manager ON directions(manager_id);
CREATE INDEX IF NOT EXISTS idx_projects_direction ON projects(direction_id);
CREATE INDEX IF NOT EXISTS idx_materials_project_id ON project_materials(project_id);
CREATE INDEX IF NOT EXISTS idx_materials_direction_id ON project_materials(direction_id);

-- ==========================================
-- LIGHTWEIGHT SEARCH & RAG (FTS + CHUNKS)
-- ==========================================
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_text TEXT DEFAULT '';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_tsv TSVECTOR;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS indexing_status VARCHAR(20) DEFAULT 'PENDING';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS indexing_error TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_content_tsv ON documents USING GIN(content_tsv);
CREATE INDEX IF NOT EXISTS idx_documents_indexing_status ON documents(indexing_status);

CREATE TABLE IF NOT EXISTS document_chunks (
  id SERIAL PRIMARY KEY,
  document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  tsv TSVECTOR,
  embedding REAL[] DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON document_chunks USING GIN(tsv);

-- High-performance composite indexes (Architecture audit)
CREATE INDEX IF NOT EXISTS idx_tasks_status_deadline ON tasks(status, deadline);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_created ON chat_messages(channel, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient_created ON chat_messages(recipient_id, sender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_recipient_created ON chat_messages(sender_id, recipient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_attachment_url ON chat_messages(attachment_url) WHERE attachment_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_file_name ON documents(file_name);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_attachments_mail_id ON mail_attachments(mail_id);
CREATE INDEX IF NOT EXISTS idx_mail_attachments_file_path ON mail_attachments(file_path);
CREATE INDEX IF NOT EXISTS idx_mail_messages_unread ON mail_messages(user_id, folder) WHERE is_read = FALSE;

-- Mail sync optimization: skip list for promotional UIDs & HTML presence flag
ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS has_html BOOLEAN DEFAULT TRUE;
CREATE TABLE IF NOT EXISTS mail_skipped_uids (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder VARCHAR(50) NOT NULL,
  imap_uid INT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, folder, imap_uid)
);

-- ==========================================
-- UNIFIED PGVECTOR HYBRID RAG (DOCUMENTS + MATERIALS + MAIL ATTACHMENTS)
-- ==========================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE project_materials ADD COLUMN IF NOT EXISTS content_text TEXT DEFAULT '';
ALTER TABLE project_materials ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE project_materials ADD COLUMN IF NOT EXISTS indexing_status VARCHAR(20) DEFAULT 'PENDING';
ALTER TABLE project_materials ADD COLUMN IF NOT EXISTS indexing_error TEXT;
CREATE INDEX IF NOT EXISTS idx_materials_indexing_status ON project_materials(indexing_status);

ALTER TABLE mail_attachments ADD COLUMN IF NOT EXISTS content_text TEXT DEFAULT '';
ALTER TABLE mail_attachments ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE mail_attachments ADD COLUMN IF NOT EXISTS indexing_status VARCHAR(20) DEFAULT 'PENDING';
ALTER TABLE mail_attachments ADD COLUMN IF NOT EXISTS indexing_error TEXT;
CREATE INDEX IF NOT EXISTS idx_mail_att_indexing_status ON mail_attachments(indexing_status);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id SERIAL PRIMARY KEY,
  source_type VARCHAR(30) NOT NULL,
  source_id INT NOT NULL,
  chunk_index INT NOT NULL,
  title VARCHAR(500) NOT NULL DEFAULT '',
  section_label VARCHAR(255) DEFAULT '',
  content TEXT NOT NULL,
  contextual_content TEXT NOT NULL,
  tsv TSVECTOR,
  embedding vector(384),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_type, source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_kc_source ON knowledge_chunks(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_kc_source_type ON knowledge_chunks(source_type);
CREATE INDEX IF NOT EXISTS idx_kc_tsv ON knowledge_chunks USING GIN(tsv);
CREATE INDEX IF NOT EXISTS idx_kc_content_trgm ON knowledge_chunks USING GIN(content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_kc_title_trgm ON knowledge_chunks USING GIN(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_kc_embedding_hnsw ON knowledge_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_documents_title_trgm ON documents USING GIN(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_materials_title_trgm ON project_materials USING GIN(title gin_trgm_ops);

-- Автоматическая очистка полиморфных чанков при удалении записи из любой таблицы-источника
CREATE OR REPLACE FUNCTION cleanup_knowledge_chunks_fn() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM knowledge_chunks WHERE source_type = TG_ARGV[0] AND source_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cleanup_kc_documents ON documents;
CREATE TRIGGER trg_cleanup_kc_documents AFTER DELETE ON documents
FOR EACH ROW EXECUTE FUNCTION cleanup_knowledge_chunks_fn('document');

DROP TRIGGER IF EXISTS trg_cleanup_kc_materials ON project_materials;
CREATE TRIGGER trg_cleanup_kc_materials AFTER DELETE ON project_materials
FOR EACH ROW EXECUTE FUNCTION cleanup_knowledge_chunks_fn('project_material');

DROP TRIGGER IF EXISTS trg_cleanup_kc_mail_att ON mail_attachments;
CREATE TRIGGER trg_cleanup_kc_mail_att AFTER DELETE ON mail_attachments
FOR EACH ROW EXECUTE FUNCTION cleanup_knowledge_chunks_fn('mail_attachment');

-- 2FA (TOTP + резервные одноразовые коды)
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_verified_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE TABLE IF NOT EXISTS user_backup_codes (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash VARCHAR(255) NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_backup_codes_user_id ON user_backup_codes(user_id);

-- 3. Вложенные папки Google Диска
ALTER TABLE document_folders ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES document_folders(id) ON DELETE CASCADE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_id INT REFERENCES document_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON document_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_documents_folder_id ON documents(folder_id);

