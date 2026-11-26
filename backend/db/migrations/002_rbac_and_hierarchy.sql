-- Migration 002: Dynamic RBAC Roles, Permissions, Messenger and Hierarchy

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

-- Schema extensions & columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INT REFERENCES roles(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS position VARCHAR(255) DEFAULT 'Сотрудник';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'WORK';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_type VARCHAR(50) DEFAULT 'NONE';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE conferences ADD COLUMN IF NOT EXISTS meeting_format VARCHAR(100) DEFAULT 'Онлайн';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_tasks_creator_id ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_created_by ON documents(created_by);
CREATE INDEX IF NOT EXISTS idx_documents_is_public ON documents(is_public);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel);
CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient ON chat_messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
