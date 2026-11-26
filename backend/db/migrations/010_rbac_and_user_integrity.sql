-- Migration 010: Базовая целостность RBAC, защита администраторов от понижения/удаления и неизменяемость связей SSO

-- 1. Приводим существующие роли и привязки к каноническому виду
UPDATE users
SET role = UPPER(TRIM(role))
WHERE role IS NOT NULL AND role <> UPPER(TRIM(role));

UPDATE users
SET email = LOWER(TRIM(email))
WHERE email IS NOT NULL AND email <> LOWER(TRIM(email));

UPDATE users
SET role_id = (SELECT id FROM roles WHERE code = 'admin' LIMIT 1)
WHERE role = 'ADMIN'
  AND EXISTS (SELECT 1 FROM roles WHERE code = 'admin')
  AND role_id IS DISTINCT FROM (SELECT id FROM roles WHERE code = 'admin' LIMIT 1);

UPDATE users
SET role_id = (SELECT id FROM roles WHERE code = 'employee' LIMIT 1)
WHERE role = 'USER'
  AND (role_id IS NULL OR role_id = (SELECT id FROM roles WHERE code = 'admin' LIMIT 1))
  AND EXISTS (SELECT 1 FROM roles WHERE code = 'employee');

-- 2. CHECK-ограничение допустимых базовых ролей в users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_users_role_valid' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT chk_users_role_valid CHECK (role IN ('ADMIN', 'USER'));
  END IF;
END $$;

-- 3. Триггерная функция целостности прав и идентификаторов пользователей
CREATE OR REPLACE FUNCTION enforce_users_rbac_integrity()
RETURNS TRIGGER AS $$
DECLARE
  v_admin_role_id INT;
  v_employee_role_id INT;
  v_was_admin BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_admin_role_id FROM roles WHERE code = 'admin' LIMIT 1;
  SELECT id INTO v_employee_role_id FROM roles WHERE code = 'employee' LIMIT 1;

  NEW.role := UPPER(COALESCE(TRIM(NEW.role), 'USER'));
  IF NEW.email IS NOT NULL THEN
    NEW.email := LOWER(TRIM(NEW.email));
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Изменение идентификатора пользователя (id) запрещено' USING ERRCODE = '42501';
    END IF;

    v_was_admin := (UPPER(COALESCE(OLD.role, 'USER')) = 'ADMIN')
      OR (v_admin_role_id IS NOT NULL AND OLD.role_id = v_admin_role_id);

    IF v_was_admin THEN
      IF NEW.role <> 'ADMIN' THEN
        RAISE EXCEPTION 'Нельзя понизить роль администратора до обычного пользователя' USING ERRCODE = '42501';
      END IF;
      IF v_admin_role_id IS NOT NULL AND NEW.role_id IS DISTINCT FROM OLD.role_id AND NEW.role_id IS DISTINCT FROM v_admin_role_id THEN
        RAISE EXCEPTION 'Нельзя сменить системную роль администратора' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- Синхронизируем role_id с role
  IF NEW.role = 'ADMIN' AND v_admin_role_id IS NOT NULL THEN
    NEW.role_id := v_admin_role_id;
  ELSIF NEW.role = 'USER' AND v_employee_role_id IS NOT NULL THEN
    IF NEW.role_id IS NULL OR (v_admin_role_id IS NOT NULL AND NEW.role_id = v_admin_role_id) THEN
      NEW.role_id := v_employee_role_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_rbac_integrity ON users;
CREATE TRIGGER trg_users_rbac_integrity
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION enforce_users_rbac_integrity();

-- 4. Триггер защиты учётных записей администраторов от удаления на уровне БД
CREATE OR REPLACE FUNCTION protect_admin_user_delete()
RETURNS TRIGGER AS $$
DECLARE
  v_admin_role_id INT;
BEGIN
  SELECT id INTO v_admin_role_id FROM roles WHERE code = 'admin' LIMIT 1;
  IF UPPER(COALESCE(OLD.role, 'USER')) = 'ADMIN'
     OR (v_admin_role_id IS NOT NULL AND OLD.role_id = v_admin_role_id) THEN
    RAISE EXCEPTION 'Удаление учётной записи администратора запрещено' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_protect_admin_delete ON users;
CREATE TRIGGER trg_users_protect_admin_delete
BEFORE DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION protect_admin_user_delete();

-- 5. Триггер неизменяемости владельца привязки SSO (sso_links.user_id)
CREATE OR REPLACE FUNCTION enforce_sso_links_owner_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Изменение владельца привязки SSO запрещено; перепривязка возможна только через удаление и новое связывание' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sso_links_immutable_owner ON sso_links;
CREATE TRIGGER trg_sso_links_immutable_owner
BEFORE UPDATE ON sso_links
FOR EACH ROW
EXECUTE FUNCTION enforce_sso_links_owner_immutable();
