const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/conferences
router.get('/', authenticateToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'ADMIN' || req.user.role_code === 'admin';
    let queryText = '';
    let params = [];

    if (isAdmin) {
      queryText = `
        SELECT c.*, u.full_name AS creator_name
        FROM conferences c
        LEFT JOIN users u ON c.created_by = u.id
        ORDER BY c.start_time ASC
      `;
    } else {
      queryText = `
        SELECT c.*, u.full_name AS creator_name
        FROM conferences c
        LEFT JOIN users u ON c.created_by = u.id
        WHERE EXISTS (
          SELECT 1 FROM conference_participants cp
          WHERE cp.conference_id = c.id AND cp.user_id = $1
        ) OR c.created_by = $1
        ORDER BY c.start_time ASC
      `;
      params = [req.user.id];
    }

    const confsRes = await db.query(queryText, params);
    const conferences = confsRes.rows;

    // Batch fetch participants for all conferences in a single query (eliminates N+1)
    if (conferences.length > 0) {
      const confIds = conferences.map(c => c.id);
      const partsRes = await db.query(`
        SELECT cp.conference_id, u.id, u.full_name, u.email, u.department
        FROM conference_participants cp
        JOIN users u ON cp.user_id = u.id
        WHERE cp.conference_id = ANY($1::int[])
        ORDER BY u.full_name ASC
      `, [confIds]);

      const partsByConf = new Map();
      for (const row of partsRes.rows) {
        if (!partsByConf.has(row.conference_id)) partsByConf.set(row.conference_id, []);
        partsByConf.get(row.conference_id).push({
          id: row.id,
          full_name: row.full_name,
          email: row.email,
          department: row.department
        });
      }
      for (const conf of conferences) {
        conf.participants = partsByConf.get(conf.id) || [];
      }
    }

    res.json(conferences);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки конференций' });
  }
});

// GET /api/conferences/formats
router.get('/formats', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM conference_formats ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки форматов' });
  }
});

// POST /api/conferences/formats
router.post('/formats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название формата' });
    const cleanName = name.trim();
    const result = await db.query(`
      INSERT INTO conference_formats (name)
      VALUES ($1)
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING *
    `, [cleanName]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка добавления формата: ' + err.message });
  }
});

// POST /api/conferences
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { title, description, start_time, end_time, location_or_link, meeting_format, participant_ids } = req.body;
    if (!title || !start_time || !end_time) return res.status(400).json({ error: 'Заполните тему и время конференции' });

    await client.query('BEGIN');

    const confRes = await client.query(`
      INSERT INTO conferences (title, description, start_time, end_time, location_or_link, meeting_format, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [title.trim(), description || '', start_time, end_time, location_or_link || 'Онлайн-зал 1', meeting_format || 'Онлайн', req.user.id]);

    const conf = confRes.rows[0];

    if (Array.isArray(participant_ids) && participant_ids.length > 0) {
      const validIds = participant_ids.map(pid => parseInt(pid, 10)).filter(n => !isNaN(n));
      if (validIds.length > 0) {
        await client.query(`
          INSERT INTO conference_participants (conference_id, user_id)
          SELECT $1, pid FROM UNNEST($2::int[]) AS pid
          ON CONFLICT DO NOTHING
        `, [conf.id, validIds]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json(conf);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Ошибка создания конференции' });
  } finally {
    client.release();
  }
});

// PATCH /api/conferences/:id
router.patch('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { id } = req.params;
    const { title, description, start_time, end_time, location_or_link, meeting_format, participant_ids } = req.body;

    await client.query('BEGIN');

    const updates = [];
    const params = [id];

    if (title) { params.push(title.trim()); updates.push(`title = $${params.length}`); }
    if (description !== undefined) { params.push(description); updates.push(`description = $${params.length}`); }
    if (start_time) { params.push(start_time); updates.push(`start_time = $${params.length}`); }
    if (end_time) { params.push(end_time); updates.push(`end_time = $${params.length}`); }
    if (location_or_link) { params.push(location_or_link); updates.push(`location_or_link = $${params.length}`); }
    if (meeting_format) { params.push(meeting_format); updates.push(`meeting_format = $${params.length}`); }

    if (updates.length > 0) {
      await client.query(`UPDATE conferences SET ${updates.join(', ')} WHERE id = $1`, params);
    }

    if (Array.isArray(participant_ids)) {
      await client.query('DELETE FROM conference_participants WHERE conference_id = $1', [id]);
      const validIds = participant_ids.map(pid => parseInt(pid, 10)).filter(n => !isNaN(n));
      if (validIds.length > 0) {
        await client.query(`
          INSERT INTO conference_participants (conference_id, user_id)
          SELECT $1, pid FROM UNNEST($2::int[]) AS pid
          ON CONFLICT DO NOTHING
        `, [id, validIds]);
      }
    }

    await client.query('COMMIT');

    const updatedConf = await db.query('SELECT * FROM conferences WHERE id = $1', [id]);
    res.json(updatedConf.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Ошибка обновления конференции' });
  } finally {
    client.release();
  }
});

// DELETE /api/conferences/:id
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM conferences WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Конференция не найдена' });
    res.json({ message: 'Конференция удалена' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка удаления конференции' });
  }
});

module.exports = router;
