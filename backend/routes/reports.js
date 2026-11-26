// backend/routes/reports.js
// Модуль аналитики и отчётности руководителя
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { fixFilenameEncoding } = require('../utils/encoding');

// GET /api/reports/dashboard - Расширенная аналитика для дашборда руководителя (только ADMIN)
router.get('/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const now = new Date();

    // Выполняем все 5 аналитических запросов параллельно (ускорение в ~3-4x)
    const [tasksMetricsRes, projectsRes, departmentRes, workloadRes, countsRes] = await Promise.all([
      db.query(`
        SELECT 
          COUNT(*)::int AS total_tasks,
          COUNT(CASE WHEN status = 'DONE' THEN 1 END)::int AS done_tasks,
          COUNT(CASE WHEN status = 'IN_PROGRESS' THEN 1 END)::int AS in_progress_tasks,
          COUNT(CASE WHEN status = 'REVIEW' THEN 1 END)::int AS review_tasks,
          COUNT(CASE WHEN status = 'TODO' THEN 1 END)::int AS todo_tasks,
          COUNT(CASE WHEN deadline IS NOT NULL AND deadline < NOW() AND status != 'DONE' THEN 1 END)::int AS overdue_tasks,
          COUNT(CASE WHEN priority = 'HIGH' AND status != 'DONE' THEN 1 END)::int AS high_priority_tasks
        FROM tasks
      `),
      db.query(`
        SELECT 
          p.id, p.title, p.status, p.start_date, p.end_date, p.budget,
          d.name AS direction_name, d.color AS direction_color,
          u.full_name AS manager_name,
          COUNT(t.id)::int AS total_tasks,
          COUNT(CASE WHEN t.status = 'DONE' THEN 1 END)::int AS done_tasks,
          COUNT(CASE WHEN t.deadline IS NOT NULL AND t.deadline < NOW() AND t.status != 'DONE' THEN 1 END)::int AS overdue_tasks
        FROM projects p
        LEFT JOIN directions d ON p.direction_id = d.id
        LEFT JOIN users u ON p.manager_id = u.id
        LEFT JOIN tasks t ON t.project_id = p.id
        GROUP BY p.id, d.name, d.color, u.full_name
        ORDER BY p.id ASC
      `),
      db.query(`
        SELECT 
          COALESCE(NULLIF(u.department, ''), 'Общий отдел') AS department,
          COUNT(DISTINCT u.id)::int AS employees_count,
          COUNT(t.id)::int AS total_tasks,
          COUNT(CASE WHEN t.status = 'DONE' THEN 1 END)::int AS done_tasks,
          COUNT(CASE WHEN t.status != 'DONE' THEN 1 END)::int AS active_tasks,
          COUNT(CASE WHEN t.deadline IS NOT NULL AND t.deadline < NOW() AND t.status != 'DONE' THEN 1 END)::int AS overdue_tasks
        FROM users u
        LEFT JOIN tasks t ON t.assignee_id = u.id
        GROUP BY COALESCE(NULLIF(u.department, ''), 'Общий отдел')
        ORDER BY total_tasks DESC, employees_count DESC
      `),
      db.query(`
        SELECT 
          u.id, u.full_name, u.email, u.department, u.position, u.role,
          m.full_name AS manager_name,
          COUNT(t.id)::int AS total_tasks,
          COUNT(CASE WHEN t.status = 'DONE' THEN 1 END)::int AS done_tasks,
          COUNT(CASE WHEN t.status = 'IN_PROGRESS' THEN 1 END)::int AS in_progress_tasks,
          COUNT(CASE WHEN t.status != 'DONE' THEN 1 END)::int AS active_tasks,
          COUNT(CASE WHEN t.deadline IS NOT NULL AND t.deadline < NOW() AND t.status != 'DONE' THEN 1 END)::int AS overdue_tasks
        FROM users u
        LEFT JOIN users m ON u.manager_id = m.id
        LEFT JOIN tasks t ON t.assignee_id = u.id
        GROUP BY u.id, m.full_name
        ORDER BY active_tasks DESC, u.full_name ASC
      `),
      db.query(`
        SELECT 
          (SELECT COUNT(*) FROM documents)::int AS documents_count,
          (SELECT COUNT(*) FROM users)::int AS users_count,
          (SELECT COUNT(*) FROM directions)::int AS directions_count,
          (SELECT COUNT(*) FROM conferences WHERE end_time >= NOW())::int AS upcoming_conferences_count
      `)
    ]);

    const projectHealth = projectsRes.rows.map(p => {
      const progress = p.total_tasks > 0 ? Math.round((p.done_tasks / p.total_tasks) * 100) : 0;
      let deadlineStatus = 'IN_TIME';
      if (p.end_date && new Date(p.end_date) < now && p.status !== 'COMPLETED') {
        deadlineStatus = 'OVERDUE';
      }
      return {
        ...p,
        progress,
        deadlineStatus
      };
    });

    const departmentStats = departmentRes.rows.map(d => ({
      ...d,
      efficiency: d.total_tasks > 0 ? Math.round((d.done_tasks / d.total_tasks) * 100) : 100
    }));

    res.json({
      tasks: tasksMetricsRes.rows[0] || {},
      projects: projectHealth,
      departments: departmentStats,
      workload: workloadRes.rows,
      counts: countsRes.rows[0] || {}
    });
  } catch (err) {
    console.error('[Reports Error] /dashboard:', err);
    res.status(500).json({ error: 'Ошибка формирования отчёта дашборда: ' + err.message });
  }
});

// GET /api/reports/export/tasks - Выгрузка реестра задач в Excel (только ADMIN)
router.get('/export/tasks', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        t.id,
        t.title,
        COALESCE(p.title, 'Без проекта') AS project_title,
        t.priority,
        t.status,
        COALESCE(u.full_name, 'Не назначен') AS assignee_name,
        COALESCE(u.department, '-') AS assignee_department,
        t.deadline,
        COALESCE(c.full_name, 'Система') AS creator_name,
        t.created_at,
        t.description
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users c ON t.creator_id = c.id
      ORDER BY t.created_at DESC
    `);

    const statusMap = {
      TODO: 'К исполнению',
      IN_PROGRESS: 'В работе',
      REVIEW: 'На проверке',
      DONE: 'Завершено'
    };

    const priorityMap = {
      LOW: 'Низкий',
      MEDIUM: 'Средний',
      HIGH: 'Высокий'
    };

    // Заголовки отчёта
    const headers = [
      '№ Задачи',
      'Название задачи',
      'Проект',
      'Приоритет',
      'Статус',
      'Исполнитель',
      'Отдел исполнителя',
      'Срок выполнения',
      'Статус срока',
      'Поручил(а)',
      'Дата создания',
      'Описание'
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      let str = String(val).replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
      // Защита от CSV Formula Injection в Excel
      if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
      return `"${str}"`;
    };

    const rows = result.rows.map(t => {
      const isDone = t.status === 'DONE';
      const isOverdue = t.deadline && new Date(t.deadline) < new Date() && !isDone;
      const deadlineStatus = isDone ? 'Выполнено' : isOverdue ? 'ПРОСРОЧЕНО' : t.deadline ? 'В срок' : 'Бессрочно';

      const deadlineStr = t.deadline 
        ? new Date(t.deadline).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Без срока';

      const createdStr = t.created_at 
        ? new Date(t.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '';

      return [
        t.id,
        t.title,
        t.project_title,
        priorityMap[t.priority] || t.priority,
        statusMap[t.status] || t.status,
        t.assignee_name,
        t.assignee_department,
        deadlineStr,
        deadlineStatus,
        t.creator_name,
        createdStr,
        t.description || ''
      ].map(escapeCsv).join(';');
    });

    // UTF-8 BOM для безупречного открытия в русском Microsoft Excel без кракозябр
    const BOM = '\uFEFF';
    const csvContent = BOM + headers.map(escapeCsv).join(';') + '\r\n' + rows.join('\r\n');

    const filename = `DocFlow_Reestr_Zadach_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    console.error('[Reports Error] /export/tasks:', err);
    res.status(500).json({ error: 'Ошибка экспорта реестра задач: ' + err.message });
  }
});

// GET /api/reports/export/summary - Сводный KPI отчёт эффективности отделов (только ADMIN)
router.get('/export/summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const deptRes = await db.query(`
      SELECT 
        COALESCE(NULLIF(u.department, ''), 'Общий отдел') AS department,
        COUNT(DISTINCT u.id)::int AS employees_count,
        COUNT(t.id)::int AS total_tasks,
        COUNT(CASE WHEN t.status = 'DONE' THEN 1 END)::int AS done_tasks,
        COUNT(CASE WHEN t.status != 'DONE' THEN 1 END)::int AS active_tasks,
        COUNT(CASE WHEN t.deadline IS NOT NULL AND t.deadline < NOW() AND t.status != 'DONE' THEN 1 END)::int AS overdue_tasks
      FROM users u
      LEFT JOIN tasks t ON t.assignee_id = u.id
      GROUP BY COALESCE(NULLIF(u.department, ''), 'Общий отдел')
      ORDER BY total_tasks DESC
    `);

    const headers = [
      'Подразделение / Отдел',
      'Количество сотрудников',
      'Всего задач',
      'Выполнено задач',
      'В работе',
      'Просрочено задач',
      'Процент эффективности'
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      let str = String(val).replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
      // Защита от CSV Formula Injection в Excel
      if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
      return `"${str}"`;
    };

    const rows = deptRes.rows.map(d => {
      const eff = d.total_tasks > 0 ? Math.round((d.done_tasks / d.total_tasks) * 100) : 100;
      return [
        d.department,
        d.employees_count,
        d.total_tasks,
        d.done_tasks,
        d.active_tasks,
        d.overdue_tasks,
        `${eff}%`
      ].map(escapeCsv).join(';');
    });

    const BOM = '\uFEFF';
    const csvContent = BOM + headers.map(escapeCsv).join(';') + '\r\n' + rows.join('\r\n');

    const filename = `DocFlow_KPI_Otdelov_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    console.error('[Reports Error] /export/summary:', err);
    res.status(500).json({ error: 'Ошибка экспорта сводки: ' + err.message });
  }
});

module.exports = router;
