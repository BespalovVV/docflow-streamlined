const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { getSubordinateUserIds, isSubordinate } = require('../utils/hierarchy');

// GET /api/tasks - List tasks (restricted: non-admins only see own tasks and subordinates' tasks)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'ADMIN' || req.user.role_code === 'admin';
    const { project_id, assignee_id, standalone, category, scope, deadline_filter, sort_by, sort_dir } = req.query;

    let queryText = `
      SELECT t.*,
             p.title AS project_title,
             u.full_name AS assignee_name,
             u.department AS assignee_department,
             c.full_name AS creator_name
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users c ON t.creator_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (category) {
      params.push(category);
      queryText += ` AND t.category = $${params.length}`;
    }

    // DEF-04: Фильтры по срокам (сегодня, неделя, следующая неделя, будущее, просроченные, бессрочные, завершённые)
    if (deadline_filter && deadline_filter !== 'all') {
      if (deadline_filter === 'overdue') {
        queryText += ` AND t.deadline < CURRENT_TIMESTAMP AND t.status != 'DONE'`;
      } else if (deadline_filter === 'today') {
        queryText += ` AND t.deadline >= CURRENT_DATE AND t.deadline < CURRENT_DATE + INTERVAL '1 day'`;
      } else if (deadline_filter === 'this_week') {
        queryText += ` AND t.deadline >= CURRENT_DATE AND t.deadline <= CURRENT_DATE + ((7 - EXTRACT(ISODOW FROM CURRENT_DATE))::int * INTERVAL '1 day') + INTERVAL '23 hours 59 minutes'`;
      } else if (deadline_filter === 'next_week') {
        queryText += ` AND t.deadline > CURRENT_DATE + ((7 - EXTRACT(ISODOW FROM CURRENT_DATE))::int * INTERVAL '1 day') + INTERVAL '23 hours 59 minutes' AND t.deadline <= CURRENT_DATE + ((14 - EXTRACT(ISODOW FROM CURRENT_DATE))::int * INTERVAL '1 day') + INTERVAL '23 hours 59 minutes'`;
      } else if (deadline_filter === 'future') {
        queryText += ` AND t.deadline > CURRENT_DATE + ((14 - EXTRACT(ISODOW FROM CURRENT_DATE))::int * INTERVAL '1 day') + INTERVAL '23 hours 59 minutes'`;
      } else if (deadline_filter === 'nodate') {
        queryText += ` AND t.deadline IS NULL`;
      } else if (deadline_filter === 'done') {
        queryText += ` AND t.status = 'DONE'`;
      }
    }

    if (isAdmin) {
      if (project_id) {
        params.push(parseInt(project_id, 10));
        queryText += ` AND t.project_id = $${params.length}`;
      }
      if (standalone === 'true') {
        queryText += ` AND t.project_id IS NULL`;
      }
      if (assignee_id) {
        params.push(parseInt(assignee_id, 10));
        queryText += ` AND t.assignee_id = $${params.length}`;
      }
    } else {
      // Non-admin: strictly limited to own tasks (assignee or creator) and subordinates' tasks
      const subordinateIds = await getSubordinateUserIds(req.user.id);
      const allowedUserIds = [parseInt(req.user.id, 10), ...subordinateIds];

      if (scope === 'my') {
        // Only assigned to current user
        params.push(req.user.id);
        queryText += ` AND t.assignee_id = $${params.length}`;
      } else if (scope === 'subordinates') {
        // Only subordinates' tasks
        if (subordinateIds.length === 0) {
          return res.json([]);
        }
        params.push(subordinateIds);
        queryText += ` AND (t.assignee_id = ANY($${params.length}::int[]) OR t.creator_id = ANY($${params.length}::int[]))`;
      } else if (scope === 'created_by_me') {
        // Only tasks created by current user
        params.push(req.user.id);
        queryText += ` AND t.creator_id = $${params.length}`;
      } else {
        // Default: tasks where user is assignee OR creator OR assignee/creator is in subordinates
        params.push(allowedUserIds);
        queryText += ` AND (
          t.assignee_id = ANY($${params.length}::int[])
          OR t.creator_id = ANY($${params.length}::int[])
        )`;
      }

      if (assignee_id) {
        const targetAssigneeId = parseInt(assignee_id, 10);
        if (!allowedUserIds.includes(targetAssigneeId)) {
          // User requested a person they have no access to
          return res.json([]);
        }
        params.push(targetAssigneeId);
        queryText += ` AND t.assignee_id = $${params.length}`;
      }

      if (project_id) {
        params.push(parseInt(project_id, 10));
        queryText += ` AND t.project_id = $${params.length}`;
      }
      if (standalone === 'true') {
        queryText += ` AND t.project_id IS NULL`;
      }
    }

    // DEF-04: Сортировка по столбцам (срок, приоритет, название, статус, дата создания)
    const direction = (sort_dir && sort_dir.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';
    if (sort_by === 'deadline') {
      queryText += ` ORDER BY (t.deadline IS NULL) ASC, t.deadline ${direction}, t.id DESC`;
    } else if (sort_by === 'priority') {
      queryText += ` ORDER BY CASE t.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END ${direction}, t.id DESC`;
    } else if (sort_by === 'title') {
      queryText += ` ORDER BY t.title ${direction}`;
    } else if (sort_by === 'status') {
      queryText += ` ORDER BY CASE t.status WHEN 'TODO' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'REVIEW' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END ${direction}, t.id DESC`;
    } else if (sort_by === 'assignee') {
      queryText += ` ORDER BY u.full_name ${direction} NULLS LAST`;
    } else {
      queryText += ` ORDER BY t.created_at ${direction}`;
    }
    // Optional real SQL pagination with backward compatibility
    const page = parseInt(req.query.page, 10);
    const limit = parseInt(req.query.limit, 10);
    if (!isNaN(page) && !isNaN(limit) && page > 0 && limit > 0) {
      const safeLimit = Math.min(limit, 200);
      const offset = (page - 1) * safeLimit;
      const paginatedSql = `
        WITH base AS (${queryText})
        SELECT *, COUNT(*) OVER()::int AS _total_count
        FROM base
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
      const pagedRes = await db.query(paginatedSql, [...params, safeLimit, offset]);
      const total = pagedRes.rows.length > 0 ? pagedRes.rows[0]._total_count : 0;
      const rows = pagedRes.rows.map(({ _total_count, ...rest }) => rest);
      return res.json({
        tasks: rows,
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit)
      });
    }

    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching tasks:', err);
    res.status(500).json({ error: 'Ошибка загрузки задач' });
  }
});

// POST /api/tasks - Create task (admins, managers for subordinates/self, employees for self/projects)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'ADMIN' || req.user.role_code === 'admin';
    const {
      project_id,
      title,
      description,
      priority,
      status,
      deadline,
      assignee_id,
      category,
      is_recurring,
      recurring_type,
      recurring_until,
      recurring_interval,
      recurring_days,
      recurring_exceptions,
      series_id
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Укажите название задачи' });
    }

    let parsedAssigneeId = assignee_id ? parseInt(assignee_id, 10) : null;
    let parsedProjectId = project_id ? parseInt(project_id, 10) : null;

    if (!isAdmin) {
      const subordinateIds = await getSubordinateUserIds(req.user.id);
      const isSelf = parsedAssigneeId === parseInt(req.user.id, 10);
      const isSub = parsedAssigneeId && subordinateIds.includes(parsedAssigneeId);

      // If assigning to someone else who is not a subordinate, verify authorization
      if (parsedAssigneeId && !isSelf && !isSub) {
        return res.status(403).json({
          error: 'Отказано в доступе. Вы можете назначать исполнителями только себя или своих подчинённых сотрудников.'
        });
      }
    }

    // If no assignee specified, default to creator (both for admin and regular users)
    if (!parsedAssigneeId) {
      parsedAssigneeId = req.user.id;
    }

    // Verify project exists if specified
    if (parsedProjectId) {
      const projCheck = await db.query('SELECT id FROM projects WHERE id = $1', [parsedProjectId]);
      if (projCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Указанный проект не найден' });
      }
    }

    const intervalVal = recurring_interval ? Math.max(1, parseInt(recurring_interval, 10)) : 1;
    const daysVal = recurring_days ? String(recurring_days) : null;
    const exceptionsVal = Array.isArray(recurring_exceptions) ? recurring_exceptions : [];
    const seriesVal = series_id ? parseInt(series_id, 10) : null;

    const result = await db.query(`
      INSERT INTO tasks (
        project_id, title, description, priority, status, deadline, assignee_id, creator_id,
        category, is_recurring, recurring_type, recurring_until,
        recurring_interval, recurring_days, recurring_exceptions, series_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `, [
      parsedProjectId,
      title.trim(),
      description || '',
      priority || 'MEDIUM',
      status || 'TODO',
      deadline || null,
      parsedAssigneeId,
      req.user.id,
      category || 'WORK',
      is_recurring === true || is_recurring === 'true',
      recurring_type || 'NONE',
      recurring_until || null,
      intervalVal,
      daysVal,
      exceptionsVal,
      seriesVal
    ]);

    let createdTask = result.rows[0];

    // Если создана повторяющаяся задача без series_id, она становится корнем собственной серии
    const isRecurring = is_recurring === true || is_recurring === 'true' || (recurring_type && recurring_type !== 'NONE');
    if (!seriesVal && isRecurring) {
      await db.query('UPDATE tasks SET series_id = $1 WHERE id = $1', [createdTask.id]);
    }

    // Fetch joined details
    const fullTaskRes = await db.query(`
      SELECT t.*,
             p.title AS project_title,
             u.full_name AS assignee_name,
             u.department AS assignee_department,
             c.full_name AS creator_name
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users c ON t.creator_id = c.id
      WHERE t.id = $1
    `, [createdTask.id]);

    res.status(201).json(fullTaskRes.rows[0] || createdTask);
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ error: 'Ошибка создания задачи: ' + err.message });
  }
});

// PATCH & PUT /api/tasks/:id - Update task
const updateTaskHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = req.user.role === 'ADMIN' || req.user.role_code === 'admin';
    const {
      title,
      description,
      project_id,
      status,
      priority,
      assignee_id,
      deadline,
      category,
      is_recurring,
      recurring_type,
      recurring_until,
      recurring_interval,
      recurring_days,
      recurring_exceptions,
      series_id,
      update_scope
    } = req.body;

    const taskCheck = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (taskCheck.rows.length === 0) return res.status(404).json({ error: 'Задача не найдена' });
    const task = taskCheck.rows[0];

    const isCreator = parseInt(task.creator_id, 10) === parseInt(req.user.id, 10);
    const isAssignee = parseInt(task.assignee_id, 10) === parseInt(req.user.id, 10);

    let isManagerOfAssignee = false;
    let isManagerOfCreator = false;
    let cachedSubordinateIds = null;
    if (!isAdmin) {
      cachedSubordinateIds = await getSubordinateUserIds(req.user.id);
      if (task.assignee_id && cachedSubordinateIds.includes(parseInt(task.assignee_id, 10))) {
        isManagerOfAssignee = true;
      }
      if (task.creator_id && cachedSubordinateIds.includes(parseInt(task.creator_id, 10))) {
        isManagerOfCreator = true;
      }
    }

    const hasManagementRights = isAdmin || isCreator || isManagerOfAssignee || isManagerOfCreator;

    if (!hasManagementRights && !isAssignee) {
      return res.status(403).json({ error: 'Отказано в доступе к данной задаче.' });
    }

    // If user is only the assignee (not admin, creator or manager), they can only update status
    if (!hasManagementRights && isAssignee) {
      const hasOtherUpdates = title !== undefined || description !== undefined || priority !== undefined ||
                              deadline !== undefined || assignee_id !== undefined || project_id !== undefined ||
                              category !== undefined || is_recurring !== undefined;
      if (hasOtherUpdates) {
        return res.status(403).json({
          error: 'Исполнитель может изменять только статус задачи. Назначение исполнителя и параметров выполняет руководитель или автор задачи.'
        });
      }

      if (status) {
        const result = await db.query('UPDATE tasks SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
        return res.json(result.rows[0]);
      }
      return res.status(400).json({ error: 'Укажите новый статус задачи' });
    }

    // User has management rights (Admin, Creator, or Manager)
    const updates = [];
    const params = [id];

    if (title) { params.push(title.trim()); updates.push(`title = $${params.length}`); }
    if (description !== undefined) { params.push(description); updates.push(`description = $${params.length}`); }
    if (project_id !== undefined) {
      params.push(project_id ? parseInt(project_id, 10) : null);
      updates.push(`project_id = $${params.length}`);
    }
    if (status) { params.push(status); updates.push(`status = $${params.length}`); }
    if (priority) { params.push(priority); updates.push(`priority = $${params.length}`); }
    if (assignee_id !== undefined) {
      let newAssigneeId = assignee_id ? parseInt(assignee_id, 10) : null;
      if (!isAdmin && newAssigneeId) {
        const subordinateIds = cachedSubordinateIds || await getSubordinateUserIds(req.user.id);
        const isSelf = newAssigneeId === parseInt(req.user.id, 10);
        const isSub = subordinateIds.includes(newAssigneeId);
        if (!isSelf && !isSub) {
          return res.status(403).json({ error: 'Вы можете назначать исполнителем только себя или своих подчинённых' });
        }
      }
      params.push(newAssigneeId);
      updates.push(`assignee_id = $${params.length}`);
    }
    if (deadline !== undefined) { params.push(deadline || null); updates.push(`deadline = $${params.length}`); }
    if (category) { params.push(category); updates.push(`category = $${params.length}`); }
    if (is_recurring !== undefined) { params.push(is_recurring === true || is_recurring === 'true'); updates.push(`is_recurring = $${params.length}`); }
    if (recurring_type !== undefined) { params.push(recurring_type); updates.push(`recurring_type = $${params.length}`); }
    if (recurring_until !== undefined) { params.push(recurring_until || null); updates.push(`recurring_until = $${params.length}`); }
    if (recurring_interval !== undefined) { params.push(Math.max(1, parseInt(recurring_interval, 10) || 1)); updates.push(`recurring_interval = $${params.length}`); }
    if (recurring_days !== undefined) { params.push(recurring_days ? String(recurring_days) : null); updates.push(`recurring_days = $${params.length}`); }
    if (recurring_exceptions !== undefined) { params.push(Array.isArray(recurring_exceptions) ? recurring_exceptions : []); updates.push(`recurring_exceptions = $${params.length}`); }
    if (series_id !== undefined) {
      const requestedSeriesId = series_id ? parseInt(series_id, 10) : null;
      if (requestedSeriesId && requestedSeriesId !== task.series_id && requestedSeriesId !== task.id) {
        if (!isAdmin) {
          const subordinateIds = cachedSubordinateIds || await getSubordinateUserIds(req.user.id);
          const allowedUserIds = [parseInt(req.user.id, 10), ...subordinateIds];
          const seriesOwnerRes = await db.query(
            'SELECT 1 FROM tasks WHERE (id = $1 OR series_id = $1) AND (creator_id = ANY($2::int[]) OR assignee_id = ANY($2::int[])) LIMIT 1',
            [requestedSeriesId, allowedUserIds]
          );
          if (seriesOwnerRes.rows.length === 0) {
            return res.status(403).json({ error: 'Отказано в доступе к указанной серии задач' });
          }
        }
      }
      params.push(requestedSeriesId);
      updates.push(`series_id = $${params.length}`);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Нет полей для обновления' });

    const result = await db.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = $1 RETURNING *`, params);

    // DEF-03: Если запрошено обновление всей серии (update_scope: 'series')
    if (update_scope === 'series') {
      const rootSeriesId = task.series_id || task.id;
      let seriesSql = `
        UPDATE tasks SET
          title = COALESCE($2, title),
          description = COALESCE($3, description),
          priority = COALESCE($4, priority),
          category = COALESCE($5, category),
          recurring_type = COALESCE($6, recurring_type),
          recurring_interval = COALESCE($7, recurring_interval),
          recurring_days = COALESCE($8, recurring_days),
          recurring_until = COALESCE($9, recurring_until)
        WHERE (series_id = $1 OR id = $1) AND id != $10
      `;
      const seriesParams = [
        rootSeriesId,
        title ? title.trim() : null,
        description !== undefined ? description : null,
        priority || null,
        category || null,
        recurring_type || null,
        recurring_interval ? Math.max(1, parseInt(recurring_interval, 10)) : null,
        recurring_days || null,
        recurring_until || null,
        id
      ];
      if (!isAdmin) {
        const subordinateIds = cachedSubordinateIds || await getSubordinateUserIds(req.user.id);
        const allowedUserIds = [parseInt(req.user.id, 10), ...subordinateIds];
        seriesParams.push(allowedUserIds);
        seriesSql += ` AND (creator_id = ANY($${seriesParams.length}::int[]) OR assignee_id = ANY($${seriesParams.length}::int[]))`;
      }
      await db.query(seriesSql, seriesParams).catch(e => console.warn('[Tasks Series Update Warning]:', e.message));
    }

    const fullTaskRes = await db.query(`
      SELECT t.*,
             p.title AS project_title,
             u.full_name AS assignee_name,
             u.department AS assignee_department,
             c.full_name AS creator_name
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users c ON t.creator_id = c.id
      WHERE t.id = $1
    `, [id]);

    res.json(fullTaskRes.rows[0] || result.rows[0]);
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(500).json({ error: 'Ошибка обновления задачи' });
  }
};

router.patch('/:id', authenticateToken, updateTaskHandler);
router.put('/:id', authenticateToken, updateTaskHandler);

// DELETE /api/tasks/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = req.user.role === 'ADMIN' || req.user.role_code === 'admin';

    const taskCheck = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (taskCheck.rows.length === 0) return res.status(404).json({ error: 'Задача не найдена' });
    const task = taskCheck.rows[0];

    const isCreator = parseInt(task.creator_id, 10) === parseInt(req.user.id, 10);
    let isManager = false;
    if (!isAdmin) {
      const subordinateIds = await getSubordinateUserIds(req.user.id);
      if (task.creator_id && subordinateIds.includes(parseInt(task.creator_id, 10))) isManager = true;
      if (task.assignee_id && subordinateIds.includes(parseInt(task.assignee_id, 10))) isManager = true;
    }

    if (!isAdmin && !isCreator && !isManager) {
      return res.status(403).json({ error: 'Удалить задачу может только ее создатель, руководитель или администратор' });
    }

    await db.query('DELETE FROM tasks WHERE id = $1', [id]);
    res.json({ message: 'Задача удалена' });
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(500).json({ error: 'Ошибка удаления задачи' });
  }
});

module.exports = router;
