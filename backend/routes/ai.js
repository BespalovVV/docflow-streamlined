// backend/routes/ai.js
// Единый автономный AI-ассистент DocFlow:
// 1) Hybrid RAG + Extractive QA по документам, материалам проектов и вложениям почты (pgvector + ONNX)
//    с гарантированным показом ближайшего варианта при отсутствии точных совпадений.
// 2) Платформенная аналитика задач и нагрузки со строгой RBAC / иерархической изоляцией.

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { getSubordinateUserIds } = require('../utils/hierarchy');
const ragService = require('../services/ragService');

/**
 * Получение аналитики нагрузки и просрочек с соблюдением RBAC и иерархии (без бага LIMIT 30!)
 */
async function fetchPlatformAnalytics(user) {
  const isAdmin = user.role === 'ADMIN' || user.role_code === 'admin';
  const userId = parseInt(user.id, 10);
  const subIds = !isAdmin ? await getSubordinateUserIds(userId) : [];
  const allowedUserIds = !isAdmin ? [userId, ...subIds] : [];

  const usersSql = isAdmin
    ? `
      SELECT u.id, u.full_name, u.email, u.department, u.position,
             COUNT(t.id) FILTER (WHERE t.status != 'DONE')::int AS active_tasks,
             COUNT(t.id) FILTER (WHERE t.status != 'DONE' AND t.deadline < CURRENT_TIMESTAMP)::int AS overdue_tasks,
             COUNT(t.id) FILTER (WHERE t.status = 'DONE')::int AS done_tasks
      FROM users u
      LEFT JOIN tasks t ON t.assignee_id = u.id
      GROUP BY u.id
      ORDER BY active_tasks ASC, u.id ASC
    `
    : `
      SELECT u.id, u.full_name, u.email, u.department, u.position,
             COUNT(t.id) FILTER (WHERE t.status != 'DONE')::int AS active_tasks,
             COUNT(t.id) FILTER (WHERE t.status != 'DONE' AND t.deadline < CURRENT_TIMESTAMP)::int AS overdue_tasks,
             COUNT(t.id) FILTER (WHERE t.status = 'DONE')::int AS done_tasks
      FROM users u
      LEFT JOIN tasks t ON t.assignee_id = u.id
      WHERE u.id = ANY($1::int[])
      GROUP BY u.id
      ORDER BY active_tasks ASC, u.id ASC
    `;

  // Просроченные задачи фильтруются прямо в SQL (устранён баг LIMIT 30!)
  const overdueSql = isAdmin
    ? `
      SELECT t.id, t.title, t.priority, t.status, t.deadline, p.title AS project_title, u.full_name AS assignee_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.status != 'DONE' AND t.deadline IS NOT NULL AND t.deadline < CURRENT_TIMESTAMP
      ORDER BY t.deadline ASC
      LIMIT 25
    `
    : `
      SELECT t.id, t.title, t.priority, t.status, t.deadline, p.title AS project_title, u.full_name AS assignee_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.status != 'DONE' AND t.deadline IS NOT NULL AND t.deadline < CURRENT_TIMESTAMP
        AND (t.assignee_id = ANY($1::int[]) OR t.creator_id = ANY($1::int[]))
      ORDER BY t.deadline ASC
      LIMIT 25
    `;

  const params = isAdmin ? [] : [allowedUserIds];
  const [usersRes, overdueRes] = await Promise.all([
    db.query(usersSql, params),
    db.query(overdueSql, params)
  ]);

  return {
    isAdmin,
    users: usersRes.rows,
    overdueTasks: overdueRes.rows,
    departments: Array.from(new Set(usersRes.rows.map(u => u.department).filter(Boolean)))
  };
}

function buildAnalyticsReply(qLower, analytics) {
  const { isAdmin, users, overdueTasks, departments } = analytics;
  const isLeastBusyQuery = /меньше.*задач|кто.*свобод|кому поручить|наименее.*загруж|разгруж|свободн.*сотрудник/i.test(qLower);
  const isOverdueQuery = /просроч.*задач|горят.*задач|просроченные|какие задачи.*горя|дедлайн.*задач|просрочк.*по.*задач/i.test(qLower)
    || (/просроч|дедлайн|горят|истек/i.test(qLower) && !/договор|поставк|документ|регламент|приказ|материал|письм|штраф|неустойк/i.test(qLower));
  const isDepartmentSummary = /сводк.*отдел|загрузк.*отдел|нагрузк.*отдел|по\s+отдел|средн.*нагрузк/i.test(qLower);

  if (!isLeastBusyQuery && !isOverdueQuery && !isDepartmentSummary) {
    return null;
  }

  let targetDept = null;
  for (const d of departments) {
    if (qLower.includes(d.toLowerCase())) {
      targetDept = d;
      break;
    }
  }
  if (!targetDept) {
    if (/разработ|ит|программ/i.test(qLower)) targetDept = departments.find(d => /разработ/i.test(d)) || null;
    else if (/продаж|клиент/i.test(qLower)) targetDept = departments.find(d => /продаж/i.test(d)) || null;
    else if (/бухгалт|финанс/i.test(qLower)) targetDept = departments.find(d => /бухгалт/i.test(d)) || null;
    else if (/юрид|юрист/i.test(qLower)) targetDept = departments.find(d => /юрид/i.test(d)) || null;
    else if (/админ|руковод/i.test(qLower)) targetDept = departments.find(d => /управлен|админ/i.test(d)) || null;
  }

  const scopeNote = isAdmin ? '' : '\n*(показаны данные по вам и вашим подчинённым согласно правам доступа)*';

  if (isLeastBusyQuery) {
    let filteredUsers = users;
    if (targetDept) {
      filteredUsers = users.filter(u => (u.department || '').toLowerCase().includes(targetDept.toLowerCase()));
    }
    if (filteredUsers.length === 0) {
      return {
        answer: `В отделе «${targetDept || 'указанном'}» доступные вам сотрудники не найдены. Всего в зоне вашей видимости: ${users.length} сотр.${scopeNote}`,
        suggestedAction: null
      };
    }
    const sorted = [...filteredUsers].sort((a, b) => a.active_tasks - b.active_tasks);
    const best = sorted[0];
    const next = sorted[1];
    const deptStr = targetDept ? `по отделу «${targetDept}»` : (isAdmin ? 'по всем отделам компании' : 'по вашей команде');

    return {
      answer: `📊 Анализ загрузки ${deptStr}:\n\n` +
        `🎯 **Меньше всего задач:** **${best.full_name}** (${best.position || 'Сотрудник'}, ${best.department || 'Общий отдел'})\n` +
        `• Активных задач в работе: **${best.active_tasks}**\n` +
        `• Просроченных дедлайнов: **${best.overdue_tasks}**\n` +
        `• Завершено за всё время: **${best.done_tasks}**\n\n` +
        (next ? `Следующий по доступности: **${next.full_name}** (${next.active_tasks} активн. задач).\n\n` : '') +
        `💡 **Рекомендация:** Назначьте новую задачу на **${best.full_name}** — у него сейчас максимальный резерв рабочего времени!${scopeNote}`,
      suggestedAction: {
        type: 'create_task',
        label: `➕ Назначить задачу на ${best.full_name}`,
        assignee_id: best.id,
        assignee_name: best.full_name
      }
    };
  }

  if (isOverdueQuery) {
    if (overdueTasks.length === 0) {
      return {
        answer: `🎉 Отличные новости! В зоне вашей видимости сейчас нет ни одной просроченной задачи. Все дедлайны соблюдаются вовремя!${scopeNote}`,
        suggestedAction: null
      };
    }
    return {
      answer: `⚠️ **Внимание! Найдено просроченных задач: ${overdueTasks.length}**\n\n` +
        overdueTasks.slice(0, 6).map((t, idx) => {
          const dateStr = new Date(t.deadline).toLocaleDateString('ru-RU');
          return `${idx + 1}. **${t.title}**\n   • Ответственный: **${t.assignee_name || 'Не назначен'}**\n   • Дедлайн был: **${dateStr}**\n   • Проект: ${t.project_title || 'Без проекта'}`;
        }).join('\n\n') +
        (overdueTasks.length > 6 ? `\n\n... и ещё ${overdueTasks.length - 6} просроченных задач.` : '') +
        scopeNote,
      suggestedAction: {
        type: 'open_tasks',
        label: '📋 Открыть задачи в фильтре',
        filter: 'overdue'
      }
    };
  }

  // Сводка по отделам
  const deptStats = {};
  users.forEach(u => {
    const d = u.department || 'Общий отдел';
    if (!deptStats[d]) deptStats[d] = { count: 0, active: 0, overdue: 0 };
    deptStats[d].count += 1;
    deptStats[d].active += u.active_tasks;
    deptStats[d].overdue += u.overdue_tasks;
  });

  return {
    answer: `🏢 **Сводка загрузки по отделам:**\n\n` +
      Object.entries(deptStats).map(([dName, dData]) => {
        const avg = (dData.active / dData.count).toFixed(1);
        return `• **${dName}**: ${dData.count} чел., ${dData.active} активн. задач (ср. ${avg}/чел.), просрочено: ${dData.overdue}`;
      }).join('\n\n') + scopeNote,
    suggestedAction: {
      type: 'open_users_stats',
      label: '📊 Открыть подробную аналитику отделов'
    }
  };
}

// POST /api/ai/ask - Unified Autonomous AI Assistant (Hybrid RAG + Extractive QA + RBAC Platform Analytics)
const ALLOWED_SOURCE_TYPES = new Set(['document', 'project_material', 'mail_attachment']);

router.post('/ask', authenticateToken, async (req, res) => {
  const startedAt = Date.now();
  try {
    const question = (req.body.question || '').trim();
    if (!question) {
      return res.status(400).json({ error: 'Задайте вопрос ассистенту' });
    }

    const qLower = question.toLowerCase();

    // Приветствие / помощь
    if (/^(привет|здравствуй|добрый день|доброе утро|добрый вечер|хай|hello|hi|помощь|help|что ты умеешь|что умеешь|\?)[!.?]*$/i.test(qLower)) {
      return res.json({
        answer:
          `🤖 **DocFlow AI Assistant на связи!**\n\n` +
          `Я умею искать точные ответы **внутри ваших документов, материалов проектов и вложений почты** (с соблюдением прав доступа), а также анализировать задачи и загрузку команды.\n\n` +
          `**Примеры вопросов:**\n` +
          `— «Какой размер суточных указан в регламенте командировок?»\n` +
          `— «Какие условия оплаты и штрафы в договоре поставки?»\n` +
          `— «Что сказано в спецификации проекта?»\n` +
          `— «У кого меньше всего задач в отделе разработки?»\n` +
          `— «Какие задачи просрочены?»`,
        mode: 'help',
        confidence: 'high',
        isFallbackNearest: false,
        sources: [],
        suggestedAction: null,
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString()
      });
    }

    // 1. Проверяем, относится ли запрос к аналитике задач/штата
    const mentionsKnowledgeSource = /документ|договор|приказ|регламент|инструкц|спецификац|материал|письм|вложен|файл|чертеж|акт|протокол|отчет|штраф|неустойк|суточн|компенсац|квантов|техническ|тз|nda/i.test(qLower);
    const mentionsAnalytics = /меньше.*задач|кто.*свобод|кому поручить|наименее.*загруж|свободн.*сотрудник|просроч.*задач|горят.*задач|просроченные|сводк.*отдел|загрузк.*отдел|нагрузк.*отдел|по\s+отдел/i.test(qLower);

    // Чисто аналитический запрос по задачам/отделам
    if (mentionsAnalytics && !mentionsKnowledgeSource) {
      const analytics = await fetchPlatformAnalytics(req.user);
      const reply = buildAnalyticsReply(qLower, analytics);
      if (reply) {
        return res.json({
          answer: reply.answer,
          mode: 'platform_analytics',
          confidence: 'high',
          isFallbackNearest: false,
          sources: [],
          suggestedAction: reply.suggestedAction,
          latencyMs: Date.now() - startedAt,
          timestamp: new Date().toISOString()
        });
      }
    }

    // 2. Поиск ответа по единой базе знаний (Документы + Материалы проектов + Вложения почты)
    const rawSourceTypes = Array.isArray(req.body.sourceTypes)
      ? req.body.sourceTypes.filter(t => ALLOWED_SOURCE_TYPES.has(t))
      : [];
    const sourceTypes = rawSourceTypes.length > 0
      ? rawSourceTypes
      : ['document', 'project_material', 'mail_attachment'];

    const ragResult = await ragService.answerQuestion(question, req.user, {
      limit: 6,
      sourceTypes
    });

    // Гибридный запрос (и про документы, и про поручение/просрочки)
    if (mentionsAnalytics && mentionsKnowledgeSource) {
      const analytics = await fetchPlatformAnalytics(req.user);
      const analyticsReply = buildAnalyticsReply(qLower, analytics);
      if (analyticsReply) {
        return res.json({
          answer: `${ragResult.answer}\n\n---\n\n${analyticsReply.answer}`,
          mode: 'hybrid',
          confidence: ragResult.confidence,
          isFallbackNearest: ragResult.isFallbackNearest,
          sources: ragResult.sources,
          appliedSourceTypes: sourceTypes,
          suggestedAction: analyticsReply.suggestedAction || ragResult.suggestedAction,
          latencyMs: Date.now() - startedAt,
          timestamp: new Date().toISOString()
        });
      }
    }

    res.json({
      answer: ragResult.answer,
      mode: ragResult.mode,
      confidence: ragResult.confidence,
      isFallbackNearest: ragResult.isFallbackNearest,
      sources: ragResult.sources,
      appliedSourceTypes: sourceTypes,
      suggestedAction: ragResult.suggestedAction,
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('AI ask error:', err);
    res.status(500).json({ error: 'Ошибка обработки вопроса AI: ' + err.message });
  }
});

module.exports = router;
