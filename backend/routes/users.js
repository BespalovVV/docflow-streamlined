const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticateToken, requireAdmin, invalidateUserCache } = require('../middleware/auth');
const authRouter = require('./auth');
const { getOrganizationTree, getSubordinateUserIds, wouldCreateHierarchyCycle, invalidateHierarchyCache } = require('../utils/hierarchy');

// Вспомогательная проверка и разрешение отдела по справочнику departments
async function resolveDepartmentInput({ department, department_id }) {
  if (department_id !== undefined && department_id !== null && department_id !== '') {
    const parsedId = parseInt(department_id, 10);
    if (isNaN(parsedId)) {
      return { ok: false, error: 'Некорректный идентификатор отдела' };
    }
    const foundById = await db.query('SELECT id, name FROM departments WHERE id = $1', [parsedId]);
    if (foundById.rows.length === 0) {
      return { ok: false, error: 'Выбранный отдел не найден в справочнике' };
    }
    return { ok: true, department_id: foundById.rows[0].id, department: foundById.rows[0].name };
  }

  if (department !== undefined) {
    const clean = department === null ? '' : String(department).trim();
    if (clean === '' || clean.toLowerCase() === 'без отдела') {
      return { ok: true, department_id: null, department: null };
    }
    const foundByName = await db.query(
      'SELECT id, name FROM departments WHERE LOWER(TRIM(name)) = LOWER($1)',
      [clean]
    );
    if (foundByName.rows.length === 0) {
      return {
        ok: false,
        error: `Отдел «${clean}» не найден в справочнике. Выберите существующий отдел, вариант «Без отдела» или сначала создайте отдел.`
      };
    }
    return { ok: true, department_id: foundByName.rows[0].id, department: foundByName.rows[0].name };
  }

  return { ok: true, department_id: null, department: null };
}

// GET /api/users - List users with hierarchy details
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.email, u.full_name, u.role, u.department, u.department_id, u.position, u.manager_id, u.avatar_url, u.created_at,
             u.totp_enabled, u.totp_verified_at,
             m.full_name AS manager_name,
             m.email AS manager_email,
             COUNT(s.id)::int AS direct_subordinates_count
      FROM users u
      LEFT JOIN users m ON u.manager_id = m.id
      LEFT JOIN users s ON s.manager_id = u.id
      GROUP BY u.id, m.full_name, m.email
      ORDER BY u.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки пользователей: ' + err.message });
  }
});

// GET /api/users/stats - Detailed statistics per employee and department (Admin only)
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const usersResult = await db.query(`
      WITH assigned_stats AS (
        SELECT
          t.assignee_id AS user_id,
          COUNT(*)::int AS total_tasks,
          COUNT(*) FILTER (WHERE t.status != 'DONE')::int AS active_tasks,
          COUNT(*) FILTER (WHERE t.status != 'DONE' AND t.deadline < CURRENT_TIMESTAMP)::int AS overdue_tasks,
          COUNT(*) FILTER (WHERE t.status = 'DONE')::int AS done_tasks,
          COALESCE(
            json_agg(DISTINCT jsonb_build_object('id', p.id, 'title', p.title)) FILTER (WHERE p.id IS NOT NULL),
            '[]'::json
          ) AS projects
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.assignee_id IS NOT NULL
        GROUP BY t.assignee_id
      ),
      created_stats AS (
        SELECT creator_id AS user_id, COUNT(*)::int AS created_tasks
        FROM tasks
        WHERE creator_id IS NOT NULL
        GROUP BY creator_id
      ),
      doc_stats AS (
        SELECT created_by AS user_id, COUNT(*)::int AS documents_count
        FROM documents
        WHERE created_by IS NOT NULL
        GROUP BY created_by
      )
      SELECT 
        u.id, u.email, u.full_name, u.role, u.department, u.position, u.manager_id,
        COALESCE(a.total_tasks, 0)::int AS total_tasks,
        COALESCE(a.active_tasks, 0)::int AS active_tasks,
        COALESCE(a.overdue_tasks, 0)::int AS overdue_tasks,
        COALESCE(a.done_tasks, 0)::int AS done_tasks,
        COALESCE(c.created_tasks, 0)::int AS created_tasks,
        COALESCE(d.documents_count, 0)::int AS documents_count,
        COALESCE(a.projects, '[]'::json) AS projects
      FROM users u
      LEFT JOIN assigned_stats a ON a.user_id = u.id
      LEFT JOIN created_stats c ON c.user_id = u.id
      LEFT JOIN doc_stats d ON d.user_id = u.id
      ORDER BY u.id ASC
    `);

    const users = usersResult.rows;

    // Group by department
    const deptMap = {};
    users.forEach(u => {
      const deptName = u.department || 'Без отдела';
      if (!deptMap[deptName]) {
        deptMap[deptName] = {
          name: deptName,
          users_count: 0,
          total_tasks: 0,
          active_tasks: 0,
          overdue_tasks: 0,
          done_tasks: 0,
          users: []
        };
      }
      deptMap[deptName].users_count += 1;
      deptMap[deptName].total_tasks += u.total_tasks;
      deptMap[deptName].active_tasks += u.active_tasks;
      deptMap[deptName].overdue_tasks += u.overdue_tasks;
      deptMap[deptName].done_tasks += u.done_tasks;
      deptMap[deptName].users.push(u);
    });

    const departments = Object.values(deptMap).map(d => {
      // Find least loaded user in department
      const sortedByActive = [...d.users].sort((a, b) => a.active_tasks - b.active_tasks);
      const leastBusy = sortedByActive[0] || null;
      const mostBusy = sortedByActive[sortedByActive.length - 1] || null;

      return {
        ...d,
        avg_tasks_per_user: d.users_count > 0 ? (d.active_tasks / d.users_count).toFixed(1) : 0,
        least_busy_user: leastBusy ? { id: leastBusy.id, full_name: leastBusy.full_name, active_tasks: leastBusy.active_tasks } : null,
        most_busy_user: mostBusy ? { id: mostBusy.id, full_name: mostBusy.full_name, active_tasks: mostBusy.active_tasks } : null
      };
    });

    res.json({
      users,
      departments,
      summary: {
        total_users: users.length,
        total_active_tasks: users.reduce((acc, u) => acc + u.active_tasks, 0),
        total_overdue_tasks: users.reduce((acc, u) => acc + u.overdue_tasks, 0)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка расчета статистики: ' + err.message });
  }
});

// GET /api/users/hierarchy - Organizational structure tree
router.get('/hierarchy', authenticateToken, async (req, res) => {
  try {
    const tree = await getOrganizationTree();
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки оргструктуры: ' + err.message });
  }
});

// GET /api/users/subordinates - Subordinates of current logged-in user
router.get('/subordinates', authenticateToken, async (req, res) => {
  try {
    const subIds = await getSubordinateUserIds(req.user.id);
    if (subIds.length === 0) {
      return res.json([]);
    }
    const result = await db.query(`
      SELECT u.id, u.email, u.full_name, u.role, u.department, u.position, u.manager_id, u.avatar_url,
             m.full_name AS manager_name
      FROM users u
      LEFT JOIN users m ON u.manager_id = m.id
      WHERE u.id = ANY($1::int[])
      ORDER BY u.full_name ASC
    `, [subIds]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки списка подчинённых: ' + err.message });
  }
});

// GET /api/users/departments - Справочник отделов с числом сотрудников
router.get('/departments', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT d.id, d.name, d.description, d.created_by, d.created_at,
             COUNT(u.id)::int AS users_count
      FROM departments d
      LEFT JOIN users u ON u.department_id = d.id
      GROUP BY d.id
      ORDER BY LOWER(d.name) ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки отделов: ' + err.message });
  }
});

// POST /api/users/departments - Создать отдел в справочнике
router.post('/departments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const cleanName = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();

    if (cleanName.length < 2) {
      return res.status(400).json({ error: 'Название отдела должно содержать минимум 2 символа' });
    }
    if (cleanName.toLowerCase() === 'без отдела') {
      return res.status(400).json({ error: 'Название «Без отдела» зарезервировано системой' });
    }

    const dup = await db.query(
      'SELECT id FROM departments WHERE LOWER(TRIM(name)) = LOWER($1)',
      [cleanName]
    );
    if (dup.rows.length > 0) {
      return res.status(400).json({ error: `Отдел «${cleanName}» уже существует` });
    }

    const result = await db.query(
      `INSERT INTO departments (name, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, created_by, created_at`,
      [cleanName, description, req.user.id]
    );
    res.status(201).json({ ...result.rows[0], users_count: 0 });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка создания отдела: ' + err.message });
  }
});

// PATCH /api/users/departments/:deptId - Обновить отдел и синхронизировать сотрудников
router.patch('/departments/:deptId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const deptId = parseInt(req.params.deptId, 10);
    if (isNaN(deptId)) return res.status(400).json({ error: 'Некорректный ID отдела' });

    const cleanName = req.body.name !== undefined ? String(req.body.name).trim() : undefined;
    const description = req.body.description !== undefined ? String(req.body.description).trim() : undefined;

    if (cleanName !== undefined) {
      if (cleanName.length < 2) {
        return res.status(400).json({ error: 'Название отдела должно содержать минимум 2 символа' });
      }
      if (cleanName.toLowerCase() === 'без отдела') {
        return res.status(400).json({ error: 'Название «Без отдела» зарезервировано системой' });
      }
      const dup = await db.query(
        'SELECT id FROM departments WHERE LOWER(TRIM(name)) = LOWER($1) AND id != $2',
        [cleanName, deptId]
      );
      if (dup.rows.length > 0) {
        return res.status(400).json({ error: `Отдел «${cleanName}» уже существует` });
      }
    }

    const updated = await db.withTransaction(async (client) => {
      const curRes = await client.query('SELECT * FROM departments WHERE id = $1', [deptId]);
      if (curRes.rows.length === 0) return null;
      const cur = curRes.rows[0];
      const nextName = cleanName !== undefined ? cleanName : cur.name;
      const nextDesc = description !== undefined ? description : (cur.description || '');

      const updRes = await client.query(
        `UPDATE departments SET name = $1, description = $2 WHERE id = $3
         RETURNING id, name, description, created_by, created_at`,
        [nextName, nextDesc, deptId]
      );
      if (nextName !== cur.name) {
        await client.query('UPDATE users SET department = $1 WHERE department_id = $2', [nextName, deptId]);
      }
      const cntRes = await client.query('SELECT COUNT(*)::int AS cnt FROM users WHERE department_id = $1', [deptId]);
      return { ...updRes.rows[0], users_count: cntRes.rows[0]?.cnt || 0 };
    });

    if (!updated) return res.status(404).json({ error: 'Отдел не найден' });
    invalidateUserCache();
    invalidateHierarchyCache();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка обновления отдела: ' + err.message });
  }
});

// DELETE /api/users/departments/:deptId - Удалить отдел (сотрудники переходят в «Без отдела»)
router.delete('/departments/:deptId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const deptId = parseInt(req.params.deptId, 10);
    if (isNaN(deptId)) return res.status(400).json({ error: 'Некорректный ID отдела' });

    const outcome = await db.withTransaction(async (client) => {
      const cur = await client.query('SELECT id, name FROM departments WHERE id = $1', [deptId]);
      if (cur.rows.length === 0) return null;

      const updUsers = await client.query(
        'UPDATE users SET department_id = NULL, department = NULL WHERE department_id = $1',
        [deptId]
      );
      await client.query('DELETE FROM departments WHERE id = $1', [deptId]);
      return { name: cur.rows[0].name, affectedUsers: updUsers.rowCount || 0 };
    });

    if (!outcome) return res.status(404).json({ error: 'Отдел не найден' });
    invalidateUserCache();
    invalidateHierarchyCache();
    res.json({
      message: `Отдел «${outcome.name}» удалён`,
      affectedUsers: outcome.affectedUsers
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка удаления отдела: ' + err.message });
  }
});

// POST /api/users
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { email, password, full_name, role, department, department_id, position, manager_id } = req.body;
    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Заполните обязательные поля: Email, Пароль, ФИО' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }

    const deptRes = await resolveDepartmentInput({ department, department_id });
    if (!deptRes.ok) {
      return res.status(400).json({ error: deptRes.error });
    }

    let parsedManagerId = null;
    if (manager_id !== undefined && manager_id !== null && manager_id !== '') {
      parsedManagerId = parseInt(manager_id, 10);
      if (isNaN(parsedManagerId)) parsedManagerId = null;
      else {
        const mgrCheck = await db.query('SELECT id FROM users WHERE id = $1', [parsedManagerId]);
        if (mgrCheck.rows.length === 0) {
          return res.status(400).json({ error: 'Указанный руководитель не найден в системе' });
        }
      }
    }

    const assignedRole = (String(role || '').trim().toUpperCase() === 'ADMIN') ? 'ADMIN' : 'USER';
    const roleCode = assignedRole === 'ADMIN' ? 'admin' : 'employee';
    const roleRow = await db.query('SELECT id FROM roles WHERE code = $1 LIMIT 1', [roleCode]);
    const assignedRoleId = roleRow.rows[0]?.id || null;
    const passHash = await bcrypt.hash(password, 10);

    const result = await db.query(`
      INSERT INTO users (email, password_hash, full_name, role, role_id, department, department_id, position, manager_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, email, full_name, role, role_id, department, department_id, position, manager_id, totp_enabled, created_at
    `, [
      cleanEmail,
      passHash,
      full_name.trim(),
      assignedRole,
      assignedRoleId,
      deptRes.department,
      deptRes.department_id,
      position ? position.trim() : 'Сотрудник',
      parsedManagerId
    ]);

    invalidateHierarchyCache();
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка создания пользователя: ' + err.message });
  }
});

// PATCH /api/users/:id
router.patch('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      return res.status(400).json({ error: 'Некорректный ID пользователя' });
    }

    const existingRes = await db.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.role_id, u.department, u.totp_enabled, r.code AS role_code
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [targetId]
    );
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    const targetUser = existingRes.rows[0];
    const targetIsAdmin = (targetUser.role || '').toUpperCase() === 'ADMIN' || targetUser.role_code === 'admin';

    const { full_name, email, role, department, department_id, position, manager_id, password } = req.body;

    const updates = [];
    const params = [targetId];

    if (full_name !== undefined) {
      const cleanName = String(full_name).trim();
      if (!cleanName) {
        return res.status(400).json({ error: 'ФИО сотрудника не может быть пустым' });
      }
      params.push(cleanName);
      updates.push(`full_name = $${params.length}`);
    }
    if (email !== undefined) {
      const cleanEmail = String(email).trim().toLowerCase();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        return res.status(400).json({ error: 'Укажите корректный email' });
      }
      const dupRes = await db.query(
        'SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2',
        [cleanEmail, targetId]
      );
      if (dupRes.rows.length > 0) {
        return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
      }
      params.push(cleanEmail);
      updates.push(`email = $${params.length}`);
    }
    if (department !== undefined || department_id !== undefined) {
      const deptRes = await resolveDepartmentInput({ department, department_id });
      if (!deptRes.ok) {
        return res.status(400).json({ error: deptRes.error });
      }
      params.push(deptRes.department);
      updates.push(`department = $${params.length}`);
      params.push(deptRes.department_id);
      updates.push(`department_id = $${params.length}`);
    }
    if (position !== undefined) {
      params.push(String(position).trim());
      updates.push(`position = $${params.length}`);
    }
    if (manager_id !== undefined) {
      let parsedManagerId = null;
      if (manager_id !== null && manager_id !== '') {
        parsedManagerId = parseInt(manager_id, 10);
        if (isNaN(parsedManagerId)) parsedManagerId = null;
      }

      if (parsedManagerId !== null) {
        if (targetId === parsedManagerId) {
          return res.status(400).json({ error: 'Сотрудник не может быть руководителем самого себя' });
        }
        const isCycle = await wouldCreateHierarchyCycle(targetId, parsedManagerId);
        if (isCycle) {
          return res.status(400).json({ error: 'Нельзя назначить руководителем сотрудника, который уже находится в подчинении (циклическая иерархия)' });
        }
      }
      params.push(parsedManagerId);
      updates.push(`manager_id = $${params.length}`);
    }
    if (role !== undefined && role !== null && String(role).trim() !== '') {
      const cleanRole = (String(role).trim().toUpperCase() === 'ADMIN') ? 'ADMIN' : 'USER';
      if (targetIsAdmin && cleanRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Нельзя понизить роль администратора (ни себе, ни другому администратору)' });
      }
      params.push(cleanRole);
      updates.push(`role = $${params.length}`);
      const roleCode = cleanRole === 'ADMIN' ? 'admin' : 'employee';
      const roleRow = await db.query('SELECT id FROM roles WHERE code = $1 LIMIT 1', [roleCode]);
      if (roleRow.rows.length > 0) {
        params.push(roleRow.rows[0].id);
        updates.push(`role_id = $${params.length}`);
      }
    }
    if (password && String(password).trim().length > 0) {
      const hash = await bcrypt.hash(String(password).trim(), 10);
      params.push(hash);
      updates.push(`password_hash = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Нет полей для обновления' });
    }

    const result = await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $1 RETURNING id, email, full_name, role, role_id, department, department_id, position, manager_id, totp_enabled, created_at`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    invalidateUserCache(targetId);
    invalidateHierarchyCache();

    const updatedUser = result.rows[0];
    if (targetId === parseInt(req.user.id, 10)) {
      const freshRes = await db.query(`${authRouter.USER_WITH_ROLE_SQL} WHERE u.id = $1`, [targetId]);
      if (freshRes.rows.length > 0) {
        const { token } = authRouter.issueSessionToken(req, res, freshRes.rows[0]);
        updatedUser.refreshedToken = token;
      }
    }

    res.json(updatedUser);
  } catch (err) {
    if (err.code === '42501') {
      return res.status(403).json({ error: err.message });
    }
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }
    res.status(500).json({ error: 'Ошибка обновления пользователя: ' + err.message });
  }
});

// DELETE /api/users/:id
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      return res.status(400).json({ error: 'Некорректный ID пользователя' });
    }
    if (targetId === parseInt(req.user.id, 10)) {
      return res.status(403).json({ error: 'Нельзя удалить собственный аккаунт Администратора' });
    }

    const targetRes = await db.query(
      `SELECT u.id, u.role, r.code AS role_code
       FROM users u LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [targetId]
    );
    if (targetRes.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    const tUser = targetRes.rows[0];
    if ((tUser.role || '').toUpperCase() === 'ADMIN' || tUser.role_code === 'admin') {
      return res.status(403).json({ error: 'Нельзя удалить учётную запись Администратора' });
    }

    const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [targetId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
    invalidateUserCache(targetId);
    invalidateHierarchyCache();
    res.json({ message: 'Пользователь успешно удален' });
  } catch (err) {
    if (err.code === '42501') {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: 'Ошибка удаления пользователя: ' + err.message });
  }
});

// POST /api/users/:id/reset-2fa - Аварийный сброс 2FA администратором
router.post('/:id/reset-2fa', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      return res.status(400).json({ error: 'Некорректный ID пользователя' });
    }

    const targetRes = await db.query(
      `SELECT u.id, u.role, r.code AS role_code
       FROM users u LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [targetId]
    );
    if (targetRes.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    const tUser = targetRes.rows[0];
    if ((tUser.role || '').toUpperCase() === 'ADMIN' || tUser.role_code === 'admin') {
      return res.status(403).json({ error: 'Сброс 2FA запрещён для учётных записей администраторов' });
    }

    const updated = await db.withTransaction(async (client) => {
      const updRes = await client.query(
        'UPDATE users SET totp_enabled = FALSE, totp_secret_enc = NULL, totp_verified_at = NULL WHERE id = $1 RETURNING id, email, full_name',
        [targetId]
      );
      if (updRes.rows.length === 0) return null;
      await client.query('DELETE FROM user_backup_codes WHERE user_id = $1', [targetId]);
      return updRes.rows[0];
    });

    if (!updated) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    invalidateUserCache(targetId);
    res.json({
      success: true,
      message: `2FA для пользователя ${updated.full_name} сброшена. При следующем входе потребуется повторная привязка QR-кода.`
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сброса 2FA: ' + err.message });
  }
});

module.exports = router;
