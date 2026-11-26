CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_name_lower
  ON departments (LOWER(TRIM(name)));

ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_department_id ON users(department_id);

-- Снимаем старый дефолт 'Общий отдел', чтобы вариант «Без отдела» хранился как NULL
ALTER TABLE users ALTER COLUMN department DROP DEFAULT;

-- Переносим существующие непустые отделы пользователей в справочник
INSERT INTO departments (name)
SELECT DISTINCT TRIM(department)
FROM users
WHERE department IS NOT NULL
  AND TRIM(department) != ''
  AND LOWER(TRIM(department)) != 'без отдела'
  AND NOT EXISTS (
    SELECT 1 FROM departments d WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(users.department))
  );

-- Привязываем существующих пользователей к department_id
UPDATE users u
SET department_id = d.id,
    department = d.name
FROM departments d
WHERE u.department IS NOT NULL
  AND LOWER(TRIM(u.department)) = LOWER(TRIM(d.name))
  AND u.department_id IS NULL;
