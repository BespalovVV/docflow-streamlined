const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/calendar/feed - Get user merged calendar events
router.get('/feed', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Fetch user assigned tasks with deadlines
    const tasksRes = await db.query(`
      SELECT 
        t.id,
        t.title,
        t.description,
        t.deadline AS event_date,
        t.status,
        t.priority,
        p.title AS project_title,
        'TASK' AS type
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE (t.assignee_id = $1 OR t.creator_id = $1) AND t.deadline IS NOT NULL
    `, [userId]);

    // 2. Fetch user assigned conferences
    const confRes = await db.query(`
      SELECT 
        c.id,
        c.title,
        c.description,
        c.start_time AS event_date,
        c.end_time,
        c.location_or_link,
        'CONFERENCE' AS type
      FROM conferences c
      JOIN conference_participants cp ON cp.conference_id = c.id
      WHERE cp.user_id = $1
    `, [userId]);

    const events = [...tasksRes.rows, ...confRes.rows].sort((a, b) => 
      new Date(a.event_date) - new Date(b.event_date)
    );

    res.json(events);
  } catch (err) {
    console.error('Error fetching calendar feed:', err);
    res.status(500).json({ error: 'Ошибка сервера при загрузке календаря' });
  }
});

module.exports = router;
