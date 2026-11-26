-- Migration 003: 3-Level Corporate Subdivision (Directions -> Projects -> Materials)

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
