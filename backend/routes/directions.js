const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/directions - List all directions with project and material counts (pre-aggregated CTEs, no OR-join Cartesian fan-out)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const query = `
      WITH proj_stats AS (
        SELECT
          direction_id,
          COUNT(*)::int AS projects_count,
          COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_projects_count
        FROM projects
        WHERE direction_id IS NOT NULL
        GROUP BY direction_id
      ),
      mat_stats AS (
        SELECT
          COALESCE(pm.direction_id, p.direction_id) AS direction_id,
          COUNT(DISTINCT pm.id)::int AS materials_count
        FROM project_materials pm
        LEFT JOIN projects p ON pm.project_id = p.id
        WHERE COALESCE(pm.direction_id, p.direction_id) IS NOT NULL
        GROUP BY COALESCE(pm.direction_id, p.direction_id)
      )
      SELECT d.*,
             u.full_name AS manager_name,
             u.email AS manager_email,
             COALESCE(ps.projects_count, 0)::int AS projects_count,
             COALESCE(ms.materials_count, 0)::int AS materials_count,
             COALESCE(ps.active_projects_count, 0)::int AS active_projects_count
      FROM directions d
      LEFT JOIN users u ON d.manager_id = u.id
      LEFT JOIN proj_stats ps ON ps.direction_id = d.id
      LEFT JOIN mat_stats ms ON ms.direction_id = d.id
      ORDER BY d.id ASC
    `;
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching directions:', err);
    res.status(500).json({ error: 'Ошибка сервера при получении направлений' });
  }
});

// GET /api/directions/:id - Single direction details with projects & materials summary
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const dirRes = await db.query(`
      SELECT d.*,
             u.full_name AS manager_name,
             u.email AS manager_email,
             u.department AS manager_department
      FROM directions d
      LEFT JOIN users u ON d.manager_id = u.id
      WHERE d.id = $1
    `, [id]);

    if (dirRes.rows.length === 0) return res.status(404).json({ error: 'Направление не найдено' });

    const projectsRes = await db.query(`
      SELECT p.*,
             u.full_name AS manager_name,
             COUNT(DISTINCT t.id)::int AS total_tasks,
             COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'DONE')::int AS completed_tasks,
             COUNT(DISTINCT pm.id)::int AS materials_count
      FROM projects p
      LEFT JOIN users u ON p.manager_id = u.id
      LEFT JOIN tasks t ON t.project_id = p.id
      LEFT JOIN project_materials pm ON pm.project_id = p.id
      WHERE p.direction_id = $1
      GROUP BY p.id, u.full_name
      ORDER BY p.created_at DESC
    `, [id]);

    res.json({
      direction: dirRes.rows[0],
      projects: projectsRes.rows
    });
  } catch (err) {
    console.error('Error fetching direction details:', err);
    res.status(500).json({ error: 'Ошибка при получении данных направления' });
  }
});

// POST /api/directions - Create new direction (Admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, code, description, icon, color, manager_id, status } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название направления' });

    const cleanCode = code ? code.trim().toUpperCase() : ('DIR' + Date.now().toString().slice(-4));
    const result = await db.query(`
      INSERT INTO directions (name, code, description, icon, color, manager_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      name.trim(),
      cleanCode,
      description || '',
      icon || '🧭',
      color || '#3b82f6',
      manager_id ? parseInt(manager_id, 10) : null,
      status || 'ACTIVE'
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating direction:', err);
    res.status(500).json({ error: 'Ошибка при создании направления: ' + err.message });
  }
});

// PUT /api/directions/:id - Update direction (Admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description, icon, color, manager_id, status } = req.body;

    const updates = [];
    const params = [id];

    if (name) { params.push(name.trim()); updates.push(`name = $${params.length}`); }
    if (code) { params.push(code.trim().toUpperCase()); updates.push(`code = $${params.length}`); }
    if (description !== undefined) { params.push(description); updates.push(`description = $${params.length}`); }
    if (icon) { params.push(icon); updates.push(`icon = $${params.length}`); }
    if (color) { params.push(color); updates.push(`color = $${params.length}`); }
    if (manager_id !== undefined) { params.push(manager_id ? parseInt(manager_id, 10) : null); updates.push(`manager_id = $${params.length}`); }
    if (status) { params.push(status); updates.push(`status = $${params.length}`); }
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    const result = await db.query(`
      UPDATE directions SET ${updates.join(', ')} WHERE id = $1 RETURNING *
    `, params);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Направление не найдено' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating direction:', err);
    res.status(500).json({ error: 'Ошибка обновления направления: ' + err.message });
  }
});

// DELETE /api/directions/:id - Delete direction (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('UPDATE projects SET direction_id = NULL WHERE direction_id = $1', [id]);
    const result = await db.query('DELETE FROM directions WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Направление не найдено' });
    res.json({ message: 'Направление успешно удалено', id: result.rows[0].id });
  } catch (err) {
    console.error('Error deleting direction:', err);
    res.status(500).json({ error: 'Ошибка удаления направления: ' + err.message });
  }
});

// POST /api/directions/:id/projects - Create project under direction (Admin only)
router.post('/:id/projects', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, git_url, status, start_date, end_date, budget } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Укажите название проекта' });

    const dirCheck = await db.query('SELECT id FROM directions WHERE id = $1', [id]);
    if (dirCheck.rows.length === 0) return res.status(404).json({ error: 'Направление не найдено' });

    const result = await db.query(`
      INSERT INTO projects (title, description, git_url, status, start_date, end_date, direction_id, budget)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      title.trim(),
      description || '',
      git_url ? git_url.trim() : '',
      status || 'ACTIVE',
      start_date || null,
      end_date || null,
      id,
      budget ? parseFloat(budget) : 0
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating direction project:', err);
    res.status(500).json({ error: 'Ошибка создания проекта в направлении: ' + err.message });
  }
});

module.exports = router;
