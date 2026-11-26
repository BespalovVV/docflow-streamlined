const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/projects - List projects (admins see all, employees see relevant)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'ADMIN' || req.user.role_code === 'admin';
    let queryText = '';
    let params = [];

    if (isAdmin) {
      queryText = `
        SELECT p.*,
               d.name AS direction_name,
               d.color AS direction_color,
               COUNT(t.id)::int AS total_tasks,
               COUNT(CASE WHEN t.status = 'DONE' THEN 1 END)::int AS completed_tasks
        FROM projects p
        LEFT JOIN directions d ON p.direction_id = d.id
        LEFT JOIN tasks t ON t.project_id = p.id
        GROUP BY p.id, d.name, d.color
        ORDER BY p.created_at DESC
      `;
    } else {
      queryText = `
        SELECT p.*,
               d.name AS direction_name,
               d.color AS direction_color,
               COUNT(t.id)::int AS total_tasks,
               COUNT(CASE WHEN t.status = 'DONE' THEN 1 END)::int AS completed_tasks
        FROM projects p
        LEFT JOIN directions d ON p.direction_id = d.id
        LEFT JOIN tasks t ON t.project_id = p.id
        WHERE EXISTS (
          SELECT 1 FROM tasks ut 
          WHERE ut.project_id = p.id AND ut.assignee_id = $1
        )
        GROUP BY p.id, d.name, d.color
        ORDER BY p.created_at DESC
      `;
      params = [req.user.id];
    }

    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки проектов' });
  }
});

// GET /api/projects/meta/stats - Summary stats for empty state explanations
router.get('/meta/stats', authenticateToken, async (req, res) => {
  try {
    const totalRes = await db.query('SELECT COUNT(*)::int AS count FROM projects');
    const myCountRes = await db.query(`
      SELECT COUNT(DISTINCT p.id)::int AS count 
      FROM projects p 
      JOIN tasks t ON t.project_id = p.id 
      WHERE t.assignee_id = $1
    `, [req.user.id]);

    const total = totalRes.rows[0].count;
    const userCount = myCountRes.rows[0].count;
    res.json({
      totalCompanyProjects: total,
      total_projects: total,
      myAssignedProjects: userCount,
      user_projects: userCount
    });
  } catch (err) {
    res.json({ totalCompanyProjects: 0, total_projects: 0, myAssignedProjects: 0, user_projects: 0 });
  }
});

// POST /api/projects - Create project
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, name, description, git_url, status, start_date, end_date, direction_id } = req.body;
    const projectTitle = title || name;
    if (!projectTitle || !projectTitle.trim()) {
      return res.status(400).json({ error: 'Укажите название проекта' });
    }

    let parsedDirectionId = direction_id ? parseInt(direction_id, 10) : null;
    if (parsedDirectionId) {
      const dirCheck = await db.query('SELECT id FROM directions WHERE id = $1', [parsedDirectionId]);
      if (dirCheck.rows.length === 0) parsedDirectionId = null;
    }

    const result = await db.query(`
      INSERT INTO projects (title, description, git_url, status, start_date, end_date, direction_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [projectTitle.trim(), description || '', git_url ? git_url.trim() : '', status || 'ACTIVE', start_date || null, end_date || null, parsedDirectionId]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка создания проекта' });
  }
});

// PATCH /api/projects/:id - Update project
router.patch('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, git_url, status, start_date, end_date, direction_id } = req.body;

    const updates = [];
    const params = [id];

    if (title) { params.push(title.trim()); updates.push(`title = $${params.length}`); }
    if (description !== undefined) { params.push(description); updates.push(`description = $${params.length}`); }
    if (git_url !== undefined) { params.push(git_url.trim()); updates.push(`git_url = $${params.length}`); }
    if (status) { params.push(status); updates.push(`status = $${params.length}`); }
    if (start_date !== undefined) { params.push(start_date || null); updates.push(`start_date = $${params.length}`); }
    if (end_date !== undefined) { params.push(end_date || null); updates.push(`end_date = $${params.length}`); }
    if (direction_id !== undefined) {
      const parsedDirId = direction_id ? parseInt(direction_id, 10) : null;
      params.push(parsedDirId);
      updates.push(`direction_id = $${params.length}`);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Нет полей для обновления' });

    const result = await db.query(`UPDATE projects SET ${updates.join(', ')} WHERE id = $1 RETURNING *`, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Проект не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка обновления проекта' });
  }
});

// DELETE /api/projects/:id - Delete project
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM projects WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Проект не найден' });
    res.json({ message: 'Проект удален' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка удаления проекта' });
  }
});

const { getSubordinateUserIds } = require('../utils/hierarchy');

// GET /api/projects/:id/details - Project details with tasks and participants
router.get('/:id/details', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const projectRes = await db.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (projectRes.rows.length === 0) return res.status(404).json({ error: 'Проект не найден' });

    const project = projectRes.rows[0];
    const isAdmin = req.user.role === 'ADMIN' || req.user.role_code === 'admin';

    let tasksQuery = `
      SELECT t.*, u.full_name AS assignee_name, u.email AS assignee_email, u.department AS assignee_department
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      WHERE t.project_id = $1
    `;
    const tasksParams = [id];

    if (!isAdmin) {
      const subordinateIds = await getSubordinateUserIds(req.user.id);
      const allowedUserIds = [parseInt(req.user.id, 10), ...subordinateIds];
      tasksParams.push(allowedUserIds);
      tasksQuery += ` AND (t.assignee_id = ANY($2::int[]) OR t.creator_id = ANY($2::int[]))`;
    }

    tasksQuery += ` ORDER BY t.created_at DESC`;
    const tasksRes = await db.query(tasksQuery, tasksParams);

    const participantsMap = new Map();
    for (const t of tasksRes.rows) {
      if (t.assignee_id && !participantsMap.has(t.assignee_id)) {
        participantsMap.set(t.assignee_id, {
          id: t.assignee_id,
          full_name: t.assignee_name,
          email: t.assignee_email,
          department: t.assignee_department
        });
      }
    }

    res.json({
      project,
      tasks: tasksRes.rows,
      participants: Array.from(participantsMap.values())
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки деталей проекта' });
  }
});

// Materials sub-resource for projects: GET & POST /api/projects/:projectId/materials
const { getMaterialsHandler, createMaterialHandler } = require('./materials');
const { upload } = require('../middleware/upload');
router.get('/:projectId/materials', authenticateToken, getMaterialsHandler);
router.post('/:projectId/materials', authenticateToken, upload.single('file'), createMaterialHandler);

module.exports = router;

