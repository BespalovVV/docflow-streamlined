// backend/utils/search_queue.js
// Унифицированная фоновая очередь индексации (Документы + Материалы проектов + Вложения почты)
// с MinIO fallback, транзакционной пакетной записью и локальными 384-dim ONNX эмбеддингами (pgvector).

const fs = require('fs');
const path = require('path');
const db = require('../db');
const storage = require('../storage');
const { extractTextFromFile } = require('./text_extractor');
const { chunkText, buildContextualContent } = require('./chunker');
const { embedBatch, toPgVector, generateEmbedding, getEmbedderStatus } = require('./embedder');

const SOURCE_LABELS = {
  document: 'Документ',
  project_material: 'Материал проекта',
  mail_attachment: 'Вложение письма'
};

class SearchQueue {
  constructor() {
    this.queue = [];
    this.queuedKeys = new Set();
    this.isProcessing = false;
    this.activeTaskKey = null;
    this.activeDocId = null;
    this.stats = {
      processedCount: 0,
      totalChunksIndexed: 0,
      lastError: null,
      lastProcessedAt: null
    };
  }

  /**
   * Универсальная постановка любого источника в очередь индексации
   * @param {'document'|'project_material'|'mail_attachment'} sourceType
   * @param {number|string} sourceId
   * @param {string} filePath
   * @param {string} fileType
   * @param {Object} options
   */
  async enqueueSource(sourceType, sourceId, filePath, fileType, options = {}) {
    const id = parseInt(sourceId, 10);
    if (!id || !SOURCE_LABELS[sourceType]) return;

    const key = `${sourceType}:${id}`;
    if (this.queuedKeys.has(key)) {
      return;
    }

    this.queue.push({ sourceType, id, filePath, fileType, options });
    this.queuedKeys.add(key);

    // Фиксируем статус PENDING в соответствующей таблице
    try {
      const table = this._getTableName(sourceType);
      await db.query(`
        UPDATE ${table}
        SET indexing_status = 'PENDING'
        WHERE id = $1 AND (indexing_status IS NULL OR indexing_status != 'INDEXED')
      `, [id]);
    } catch (e) {}

    this.processNext();
  }

  /**
   * Обратная совместимость для документов
   */
  async enqueue(docId, filePath, fileType, options = {}) {
    return this.enqueueSource('document', docId, filePath, fileType, options);
  }

  /**
   * Удаление всех чанков источника из единой базы знаний
   */
  async removeSource(sourceType, sourceId) {
    const id = parseInt(sourceId, 10);
    if (!id) return;
    try {
      await db.query('DELETE FROM knowledge_chunks WHERE source_type = $1 AND source_id = $2', [sourceType, id]);
      if (sourceType === 'document') {
        await db.query('DELETE FROM document_chunks WHERE document_id = $1', [id]);
      }
    } catch (e) {
      console.warn(`[SearchQueue] removeSource(${sourceType}:${id}) warning:`, e.message);
    }
  }

  _getTableName(sourceType) {
    if (sourceType === 'document') return 'documents';
    if (sourceType === 'project_material') return 'project_materials';
    if (sourceType === 'mail_attachment') return 'mail_attachments';
    throw new Error(`Unsupported sourceType: ${sourceType}`);
  }

  /**
   * Быстрый FTS для документов (сохранен для обратной совместимости с тестами)
   */
  async indexFastFts(docId, filePath, fileType) {
    try {
      const extracted = await extractTextFromFile(filePath, fileType);
      if (extracted.text) {
        await db.query(`
          UPDATE documents 
          SET content_text = $1,
              content_tsv = to_tsvector('russian', coalesce(title, '') || ' ' || $1),
              indexed_at = NOW(),
              indexing_status = 'FAST_INDEXED'
          WHERE id = $2
        `, [extracted.text, docId]);
        console.log(`[SearchQueue] Fast FTS indexed document #${docId} (${extracted.wordCount} words)`);
      }
      return extracted;
    } catch (err) {
      console.warn(`[SearchQueue] Fast FTS error for doc #${docId}:`, err.message);
      return null;
    }
  }

  async processNext() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const task = this.queue.shift();
    const key = `${task.sourceType}:${task.id}`;
    this.queuedKeys.delete(key);
    this.activeTaskKey = key;
    this.activeDocId = task.sourceType === 'document' ? task.id : null;

    try {
      await this.processSource(task.sourceType, task.id, task.filePath, task.fileType);
      this.stats.processedCount++;
      this.stats.lastProcessedAt = new Date();
    } catch (err) {
      console.error(`[SearchQueue] Failed to index ${key}:`, err.message || err);
      this.stats.lastError = err.message || String(err);
      try {
        const table = this._getTableName(task.sourceType);
        await db.query(`
          UPDATE ${table}
          SET indexing_status = 'FAILED', indexing_error = $1
          WHERE id = $2
        `, [err.message || 'Unknown indexing error', task.id]);
      } catch (e) {}
    } finally {
      this.activeTaskKey = null;
      this.activeDocId = null;
      this.isProcessing = false;

      if (this.queue.length > 0) {
        setTimeout(() => this.processNext(), 30);
      }
    }
  }

  /**
   * Загрузка метаданных источника из БД для формирования контекста чанков
   */
  async _loadSourceRecord(sourceType, sourceId) {
    if (sourceType === 'document') {
      const res = await db.query(`
        SELECT d.id, d.title, d.file_name, d.file_type, d.file_path, d.category, d.is_public,
               d.created_by, u.full_name AS author_name
        FROM documents d
        LEFT JOIN users u ON d.created_by = u.id
        WHERE d.id = $1
      `, [sourceId]);
      if (res.rows.length === 0) return null;
      const d = res.rows[0];
      return {
        id: d.id,
        title: d.title || d.file_name || `Документ #${d.id}`,
        fileName: d.file_name,
        fileType: d.file_type,
        filePath: d.file_path,
        description: '',
        metaLine: `Папка: ${d.category || 'Общие'}${d.author_name ? ` | Автор: ${d.author_name}` : ''}`,
        minioCandidates: [`documents/${d.file_name}`, d.file_name].filter(Boolean),
        metadata: {
          category: d.category || 'Общие',
          file_name: d.file_name,
          file_type: d.file_type,
          author_name: d.author_name || 'Не указан',
          is_public: Boolean(d.is_public)
        }
      };
    }

    if (sourceType === 'project_material') {
      const res = await db.query(`
        SELECT pm.id, pm.title, pm.description, pm.material_type, pm.version, pm.status,
               pm.file_name, pm.file_type, pm.file_path, pm.project_id, pm.direction_id,
               p.title AS project_title, dir.name AS direction_name, u.full_name AS author_name
        FROM project_materials pm
        LEFT JOIN projects p ON pm.project_id = p.id
        LEFT JOIN directions dir ON dir.id = COALESCE(pm.direction_id, p.direction_id)
        LEFT JOIN users u ON pm.author_id = u.id
        WHERE pm.id = $1
      `, [sourceId]);
      if (res.rows.length === 0) return null;
      const m = res.rows[0];
      const baseName = m.file_path ? path.basename(m.file_path) : m.file_name;
      return {
        id: m.id,
        title: m.title || m.file_name || `Материал #${m.id}`,
        fileName: m.file_name,
        fileType: m.file_type,
        filePath: m.file_path,
        description: m.description || '',
        metaLine: [
          m.direction_name ? `Направление: ${m.direction_name}` : null,
          m.project_title ? `Проект: ${m.project_title}` : null,
          m.material_type ? `Тип: ${m.material_type}` : null,
          m.version ? `Версия: ${m.version}` : null
        ].filter(Boolean).join(' | '),
        minioCandidates: [`materials/${baseName}`, baseName].filter(Boolean),
        metadata: {
          project_id: m.project_id,
          project_title: m.project_title || '',
          direction_name: m.direction_name || '',
          material_type: m.material_type || 'СПЕЦИФИКАЦИЯ',
          version: m.version || '1.0',
          status: m.status || 'APPROVED',
          file_name: m.file_name,
          file_type: m.file_type,
          author_name: m.author_name || 'Не указан'
        }
      };
    }

    if (sourceType === 'mail_attachment') {
      const res = await db.query(`
        SELECT ma.id, ma.mail_id, ma.file_name, ma.file_type, ma.file_size, ma.file_path,
               mm.user_id, mm.subject, mm.sender_name, mm.sender_email, mm.folder, mm.created_at
        FROM mail_attachments ma
        JOIN mail_messages mm ON ma.mail_id = mm.id
        WHERE ma.id = $1
      `, [sourceId]);
      if (res.rows.length === 0) return null;
      const a = res.rows[0];
      const extFromName = path.extname(a.file_name || '').replace('.', '').toLowerCase();
      return {
        id: a.id,
        title: `${a.file_name} (Письмо: ${a.subject || 'Без темы'})`,
        fileName: a.file_name,
        fileType: extFromName || a.file_type || '',
        filePath: a.file_path,
        description: `Тема письма: ${a.subject || ''}. Отправитель: ${a.sender_name || ''} <${a.sender_email || ''}>`,
        metaLine: `Письмо: ${a.subject || 'Без темы'} | От: ${a.sender_name || a.sender_email || ''}`,
        minioCandidates: [],
        metadata: {
          mail_id: a.mail_id,
          user_id: a.user_id,
          subject: a.subject || '',
          sender_name: a.sender_name || '',
          sender_email: a.sender_email || '',
          folder: a.folder || 'inbox',
          file_name: a.file_name,
          file_type: extFromName || a.file_type || ''
        }
      };
    }

    return null;
  }

  /**
   * Обратная совместимость: processDocument -> processSource('document', ...)
   */
  async processDocument(docId, filePath, fileType) {
    return this.processSource('document', docId, filePath, fileType);
  }

  /**
   * Полная транзакционная индексация источника (Extraction + Structure Chunking + ONNX 384d + pgvector + FTS)
   */
  async processSource(sourceType, sourceId, filePathOverride, fileTypeOverride) {
    const rec = await this._loadSourceRecord(sourceType, sourceId);
    if (!rec) return;

    const table = this._getTableName(sourceType);
    const targetPath = filePathOverride || rec.filePath;
    const targetType = fileTypeOverride || rec.fileType;

    await db.query(`UPDATE ${table} SET indexing_status = 'PROCESSING' WHERE id = $1`, [sourceId]).catch(() => {});

    // Проверяем файл на диске и при необходимости восстанавливаем из MinIO S3
    let fileExists = Boolean(targetPath && fs.existsSync(targetPath));
    if (!fileExists && targetPath && rec.minioCandidates.length > 0) {
      for (const objKey of rec.minioCandidates) {
        const ok = await storage.downloadFile(objKey, targetPath);
        if (ok && fs.existsSync(targetPath)) {
          fileExists = true;
          break;
        }
      }
    }

    let extracted = { text: '', wordCount: 0, sections: null, isScanned: false, error: null };
    if (fileExists) {
      extracted = await extractTextFromFile(targetPath, targetType);
    }

    const rawText = extracted.text || '';
    const combinedFullText = [rec.description, rawText].filter(Boolean).join('\n\n').trim();
    const sourceLabel = SOURCE_LABELS[sourceType] || 'Документ';

    let chunks = [];
    let isTitleOnly = false;

    if (combinedFullText.length > 0) {
      chunks = chunkText(combinedFullText, {
        maxWords: 260,
        overlap: 45,
        title: rec.title,
        sourceLabel,
        metaLine: rec.metaLine,
        sections: rawText && extracted.sections ? extracted.sections : null
      });
    } else {
      // Даже для сканов/пустых шаблонов создаём метаданный чанк, чтобы находились по названию и контексту
      isTitleOnly = true;
      const metaText = [rec.title, rec.description, rec.metaLine].filter(Boolean).join('. ');
      chunks = [{
        chunkIndex: 0,
        content: metaText,
        contextualContent: buildContextualContent(metaText, {
          title: rec.title,
          sourceLabel,
          metaLine: rec.metaLine,
          sectionLabel: extracted.isScanned ? 'Скан/Метаданные' : 'Заголовок'
        }),
        sectionLabel: extracted.isScanned ? 'Скан/Метаданные' : 'Заголовок',
        wordCount: metaText.split(/\s+/).filter(Boolean).length
      }];
    }

    // Пакетная генерация локальных ONNX 384-dim эмбеддингов
    const contextualTexts = chunks.map(c => c.contextualContent);
    const embeddings384 = await embedBatch(contextualTexts, 'passage', 8);

    const chunkMetaBase = {
      ...rec.metadata,
      is_title_only: isTitleOnly,
      is_scanned: Boolean(extracted.isScanned)
    };

    // Атомарная транзакционная запись в БД (без частичных состояний при рестарте)
    await db.withTransaction(async (client) => {
      if (sourceType === 'document') {
        await client.query(`
          UPDATE documents
          SET content_text = $1,
              content_tsv = to_tsvector('russian', coalesce(title, '') || ' ' || $1),
              indexed_at = NOW(),
              indexing_status = 'INDEXED',
              indexing_error = $2
          WHERE id = $3
        `, [rawText, isTitleOnly ? (fileExists ? 'No extractable text' : 'File missing on storage') : null, sourceId]);
      } else {
        await client.query(`
          UPDATE ${table}
          SET content_text = $1,
              indexed_at = NOW(),
              indexing_status = 'INDEXED',
              indexing_error = $2
          WHERE id = $3
        `, [rawText, isTitleOnly ? (fileExists ? 'No extractable text' : 'File missing on storage') : null, sourceId]);
      }

      // Очистка старых чанков и пакетная вставка в knowledge_chunks
      await client.query('DELETE FROM knowledge_chunks WHERE source_type = $1 AND source_id = $2', [sourceType, sourceId]);

      if (chunks.length > 0) {
        const chunkIndices = [];
        const titles = [];
        const sections = [];
        const contents = [];
        const ctxContents = [];
        const vecStrings = [];
        const metas = [];

        for (let i = 0; i < chunks.length; i++) {
          const ch = chunks[i];
          chunkIndices.push(ch.chunkIndex);
          titles.push(rec.title.slice(0, 500));
          sections.push((ch.sectionLabel || '').slice(0, 255));
          contents.push(ch.content);
          ctxContents.push(ch.contextualContent);
          vecStrings.push(toPgVector(embeddings384[i]));
          metas.push(JSON.stringify(chunkMetaBase));
        }

        await client.query(`
          INSERT INTO knowledge_chunks (
            source_type, source_id, chunk_index, title, section_label,
            content, contextual_content, tsv, embedding, metadata
          )
          SELECT
            $1, $2, ci, ttl, sec, cnt, ctx,
            to_tsvector('russian', ctx),
            vec::vector(384),
            meta::jsonb
          FROM UNNEST(
            $3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[]
          ) AS t(ci, ttl, sec, cnt, ctx, vec, meta)
        `, [sourceType, sourceId, chunkIndices, titles, sections, contents, ctxContents, vecStrings, metas]);
      }

      // Обратная совместимость с таблицей document_chunks (для legacy-проверок)
      if (sourceType === 'document') {
        await client.query('DELETE FROM document_chunks WHERE document_id = $1', [sourceId]);
        if (!isTitleOnly && chunks.length > 0) {
          for (const ch of chunks) {
            const legacyVec = generateEmbedding(ch.content);
            await client.query(`
              INSERT INTO document_chunks (document_id, chunk_index, content, tsv, embedding)
              VALUES ($1, $2, $3, to_tsvector('russian', $3), $4)
            `, [sourceId, ch.chunkIndex, ch.content, legacyVec]);
          }
        }
      }
    });

    this.stats.totalChunksIndexed += chunks.length;
    console.log(`[SearchQueue] ✅ Indexed ${sourceType}#${sourceId} ("${rec.title}") -> ${chunks.length} chunks (384d ONNX)`);
  }

  /**
   * Полное сканирование всех непроиндексированных объектов по всем 3 источникам
   * (без жёсткого обрыва на 50 — ставит в очередь всё, чего нет в knowledge_chunks).
   */
  async indexAllUnindexed() {
    try {
      const [docsRes, matsRes, mailAttsRes] = await Promise.all([
        db.query(`
          SELECT d.id, d.file_path, d.file_type
          FROM documents d
          WHERE d.indexed_at IS NULL
             OR d.indexing_status IN ('PENDING', 'FAILED', 'FAST_INDEXED')
             OR NOT EXISTS (
               SELECT 1 FROM knowledge_chunks kc
               WHERE kc.source_type = 'document' AND kc.source_id = d.id AND kc.embedding IS NOT NULL
             )
          ORDER BY d.id DESC
        `),
        db.query(`
          SELECT pm.id, pm.file_path, pm.file_type
          FROM project_materials pm
          WHERE pm.indexed_at IS NULL
             OR pm.indexing_status IN ('PENDING', 'FAILED')
             OR NOT EXISTS (
               SELECT 1 FROM knowledge_chunks kc
               WHERE kc.source_type = 'project_material' AND kc.source_id = pm.id AND kc.embedding IS NOT NULL
             )
          ORDER BY pm.id DESC
        `),
        db.query(`
          SELECT ma.id, ma.file_path, ma.file_name, ma.file_type
          FROM mail_attachments ma
          WHERE ma.indexed_at IS NULL
             OR ma.indexing_status IN ('PENDING', 'FAILED')
             OR NOT EXISTS (
               SELECT 1 FROM knowledge_chunks kc
               WHERE kc.source_type = 'mail_attachment' AND kc.source_id = ma.id AND kc.embedding IS NOT NULL
             )
          ORDER BY ma.id DESC
        `)
      ]);

      for (const r of docsRes.rows) {
        this.enqueueSource('document', r.id, r.file_path, r.file_type);
      }
      for (const r of matsRes.rows) {
        this.enqueueSource('project_material', r.id, r.file_path, r.file_type);
      }
      for (const r of mailAttsRes.rows) {
        const ext = path.extname(r.file_name || '').replace('.', '').toLowerCase() || r.file_type;
        this.enqueueSource('mail_attachment', r.id, r.file_path, ext);
      }

      const total = docsRes.rows.length + matsRes.rows.length + mailAttsRes.rows.length;
      if (total > 0) {
        console.log(`[SearchQueue] Queued ${total} unindexed items (docs: ${docsRes.rows.length}, materials: ${matsRes.rows.length}, mail_attachments: ${mailAttsRes.rows.length})`);
      }
      return total;
    } catch (e) {
      console.warn('[SearchQueue] indexAllUnindexed warning:', e.message);
      return 0;
    }
  }

  /**
   * Принудительная полная переиндексация всей базы знаний (Admin action)
   */
  async reindexAll() {
    const [docsRes, matsRes, mailAttsRes] = await Promise.all([
      db.query('SELECT id, file_path, file_type FROM documents ORDER BY id DESC'),
      db.query('SELECT id, file_path, file_type FROM project_materials ORDER BY id DESC'),
      db.query('SELECT id, file_path, file_name, file_type FROM mail_attachments ORDER BY id DESC')
    ]);

    for (const r of docsRes.rows) {
      this.enqueueSource('document', r.id, r.file_path, r.file_type);
    }
    for (const r of matsRes.rows) {
      this.enqueueSource('project_material', r.id, r.file_path, r.file_type);
    }
    for (const r of mailAttsRes.rows) {
      const ext = path.extname(r.file_name || '').replace('.', '').toLowerCase() || r.file_type;
      this.enqueueSource('mail_attachment', r.id, r.file_path, ext);
    }

    return {
      documents: docsRes.rows.length,
      materials: matsRes.rows.length,
      mailAttachments: mailAttsRes.rows.length,
      total: docsRes.rows.length + matsRes.rows.length + mailAttsRes.rows.length
    };
  }

  getStatus() {
    return {
      isProcessing: this.isProcessing,
      pendingCount: this.queue.length,
      activeTaskKey: this.activeTaskKey,
      activeDocId: this.activeDocId,
      processedCount: this.stats.processedCount,
      totalChunksIndexed: this.stats.totalChunksIndexed,
      lastProcessedAt: this.stats.lastProcessedAt,
      lastError: this.stats.lastError,
      embedder: getEmbedderStatus()
    };
  }
}

const searchQueueInstance = new SearchQueue();
module.exports = searchQueueInstance;
