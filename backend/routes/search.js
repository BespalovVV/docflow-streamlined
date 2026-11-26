// backend/routes/search.js
// Единый интеллектуальный гибридный поиск (pgvector HNSW + FTS + pg_trgm + ONNX multilingual-e5-small)
// по всей базе знаний: Документы + Материалы проектов + Вложения почты со строгим Pre-Filter RBAC.

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const searchQueue = require('../utils/search_queue');
const ragService = require('../services/ragService');

/**
 * GET /api/search - Hybrid RAG search across documents, project materials & mail attachments
 * Параметры:
 *  - q: поисковый запрос / вопрос
 *  - category: опциональный фильтр категории/папки
 *  - source_type: all | document | project_material | mail_attachment (или список через запятую)
 *  - limit: 1..50 (default 12)
 *  - include_qa: 'true' -> возвращает объект { results, qa, isFallbackNearest, confidence }
 *                иначе -> возвращает массив results (обратная совместимость)
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const query = (req.query.q || '').trim();
    const category = (req.query.category || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '12', 10), 1), 50);
    const includeQa = req.query.include_qa === 'true' || req.query.include_qa === '1';

    let cleanQuery = query;
    try {
      if (cleanQuery.includes('%')) cleanQuery = decodeURIComponent(cleanQuery).trim();
    } catch (e) {}

    if (!cleanQuery) {
      return res.json(includeQa ? { results: [], qa: null, isFallbackNearest: false, confidence: 'none' } : []);
    }

    // Парсим фильтр по типам источников
    const validTypes = new Set(['document', 'project_material', 'mail_attachment']);
    let sourceTypes = ['document', 'project_material', 'mail_attachment'];
    const rawSourceType = (req.query.source_type || '').trim().toLowerCase();
    if (rawSourceType && rawSourceType !== 'all') {
      const parsed = rawSourceType.split(',').map(s => s.trim()).filter(s => validTypes.has(s));
      if (parsed.length > 0) sourceTypes = parsed;
    }

    const searchData = await ragService.searchKnowledge(cleanQuery, req.user, {
      limit,
      category,
      sourceTypes
    });

    // Очищаем внутреннее сырое поле чанка из выдачи карточек
    const results = searchData.items.map(({ rawChunkContent, ...publicItem }) => publicItem);

    if (includeQa) {
      let qa = null;
      if (results.length > 0) {
        qa = await ragService.answerQuestion(cleanQuery, req.user, {
          limit: Math.min(limit, 6),
          sourceTypes
        });
      }
      return res.json({
        results,
        qa,
        isFallbackNearest: searchData.isFallbackNearest,
        confidence: searchData.confidence
      });
    }

    res.json(results);
  } catch (err) {
    console.error('[Search] Error in /api/search:', err);
    res.status(500).json({ error: 'Ошибка выполнения умного поиска: ' + err.message });
  }
});

/**
 * GET /api/search/status - Check search queue, ONNX embedder & unified knowledge base stats
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const queueStatus = searchQueue.getStatus();
    const statsRes = await db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM documents) AS total_docs,
        (SELECT COUNT(*)::int FROM documents WHERE indexed_at IS NOT NULL) AS indexed_docs,
        (SELECT COUNT(*)::int FROM project_materials) AS total_materials,
        (SELECT COUNT(*)::int FROM project_materials WHERE indexed_at IS NOT NULL) AS indexed_materials,
        (SELECT COUNT(*)::int FROM mail_attachments) AS total_mail_atts,
        (SELECT COUNT(*)::int FROM mail_attachments WHERE indexed_at IS NOT NULL) AS indexed_mail_atts,
        (SELECT COUNT(*)::int FROM knowledge_chunks) AS total_knowledge_chunks,
        (SELECT COUNT(*)::int FROM knowledge_chunks WHERE embedding IS NOT NULL) AS vectorized_chunks
    `);

    const s = statsRes.rows[0] || {};
    const totalAll = (s.total_docs || 0) + (s.total_materials || 0) + (s.total_mail_atts || 0);
    const indexedAll = (s.indexed_docs || 0) + (s.indexed_materials || 0) + (s.indexed_mail_atts || 0);

    res.json({
      ...queueStatus,
      totalDocuments: s.total_docs || 0,
      indexedDocuments: s.indexed_docs || 0,
      totalMaterials: s.total_materials || 0,
      indexedMaterials: s.indexed_materials || 0,
      totalMailAttachments: s.total_mail_atts || 0,
      indexedMailAttachments: s.indexed_mail_atts || 0,
      totalChunks: s.total_knowledge_chunks || 0,
      vectorizedChunks: s.vectorized_chunks || 0,
      isFullyIndexed: indexedAll >= totalAll && queueStatus.pendingCount === 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка получения статуса индексатора: ' + err.message });
  }
});

/**
 * POST /api/search/reindex - Trigger full re-indexing across documents, materials & mail attachments (Admin only)
 */
router.post('/reindex', authenticateToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'ADMIN' || req.user.role_code === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Переиндексация доступна только администраторам платформы' });
    }

    const counts = await searchQueue.reindexAll();

    res.json({
      message: `Запущена фоновая переиндексация базы знаний: документов — ${counts.documents}, материалов — ${counts.materials}, вложений почты — ${counts.mailAttachments}`,
      queued: counts.total,
      breakdown: counts
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка запуска переиндексации: ' + err.message });
  }
});

module.exports = router;
