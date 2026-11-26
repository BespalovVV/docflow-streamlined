-- Таблица привязки внешних аккаунтов (сквозная аутентификация DocFlow <-> LabSpace)
CREATE TABLE IF NOT EXISTS sso_links (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  external_user_id VARCHAR(128) NOT NULL,
  external_email VARCHAR(255) DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, external_user_id),
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_sso_links_provider_ext ON sso_links(provider, external_user_id);
