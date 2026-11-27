const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const storage = require('../storage');
const templates = require('../templates');
const { authenticateToken } = require('../middleware/auth');
const { upload, UPLOADS_DIR } = require('../middleware/upload');
const { fixFilenameEncoding } = require('../utils/encoding');
const { canAccessProject } = require('../utils/hierarchy');
const searchQueue = require('../utils/search_queue');

// GET /api/materials/project/:projectId or /api/projects/:projectId/materials
const getMaterialsHandler = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { search, type, status } = req.query;

    const projCheck = await db.query('SELECT id FROM projects WHERE id = $1', [projectId]);
    if (projCheck.rows.length === 0) return res.status(404).json({ error: 'Проект не найден' });

    const hasAccess = await canAccessProject(projectId, req.user);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Отказано в доступе к материалам данного проекта' });
    }

    let queryText = `
      SELECT pm.*,
             u.full_name AS author_name,
             u.email AS author_email,
             p.title AS project_title,
             d.name AS direction_name,
             d.color AS direction_color
      FROM project_materials pm
      LEFT JOIN users u ON pm.author_id = u.id
      LEFT JOIN projects p ON pm.project_id = p.id
      LEFT JOIN directions d ON d.id = COALESCE(pm.direction_id, p.direction_id)
      WHERE pm.project_id = $1
    `;
    const params = [projectId];

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      queryText += ` AND (LOWER(pm.title) LIKE $${params.length} OR LOWER(pm.description) LIKE $${params.length} OR LOWER(pm.file_name) LIKE $${params.length})`;
    }
    if (type && type !== 'ALL') {
      params.push(type);
      queryText += ` AND pm.material_type = $${params.length}`;
    }
    if (status && status !== 'ALL') {
      params.push(status);
      queryText += ` AND pm.status = $${params.length}`;
    }

    queryText += ` ORDER BY pm.created_at DESC`;

    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching materials:', err);
    res.status(500).json({ error: 'Ошибка при загрузке материалов проекта' });
  }
};

// POST /api/materials/project/:projectId or /api/projects/:projectId/materials
const createMaterialHandler = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { title, description, material_type, version, status } = req.body;

    if (!title || !title.trim()) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Укажите название материала' });
    }

    const projRes = await db.query('SELECT id, direction_id FROM projects WHERE id = $1', [projectId]);
    if (projRes.rows.length === 0) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Проект не найден' });
    }

    const hasAccess = await canAccessProject(projectId, req.user);
    if (!hasAccess) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'У вас нет прав на добавление материалов в этот проект' });
    }

    const directionId = projRes.rows[0].direction_id;

    let fileName = '';
    let filePath = '';
    let fileType = 'application/octet-stream';
    let fileSize = 0;

    if (req.file) {
      fileName = fixFilenameEncoding(req.file.originalname);
      filePath = req.file.path;
      fileSize = req.file.size;
      fileType = path.extname(fileName).replace('.', '').toLowerCase() || 'bin';

      try {
        const objectKey = `materials/${path.basename(filePath)}`;
        await storage.uploadFile(objectKey, filePath, req.file.mimetype || 'application/octet-stream');
      } catch (minioErr) {
        console.warn('[Material Upload] MinIO sync notice:', minioErr.message);
      }
    } else {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      fileName = `${title.trim().replace(/[/\\?%*:|"<>]/g, '_')}.docx`;
      filePath = path.join(UPLOADS_DIR, `mat-${uniqueSuffix}.docx`);
      templates.createDocxFromTemplate(filePath, title.trim());
      fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 1024;
      fileType = 'docx';
    }

    const cleanTitle = fixFilenameEncoding(title.trim());
    const matVersion = (version && version.trim()) || '1.0';
    const matType = material_type || 'СПЕЦИФИКАЦИЯ';
    const matStatus = status || 'APPROVED';

    const insertRes = await db.query(`
      INSERT INTO project_materials
        (project_id, direction_id, title, description, material_type, status, version, file_name, file_type, file_size, file_path, author_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      projectId,
      directionId,
      cleanTitle,
      description || '',
      matType,
      matStatus,
      matVersion,
      fileName,
      fileType,
      fileSize,
      filePath,
      req.user.id
    ]);

    const inserted = insertRes.rows[0];
    searchQueue.enqueueSource('project_material', inserted.id, filePath, fileType);
    res.status(201).json(inserted);
  } catch (err) {
    console.error('Error adding project material:', err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Ошибка сохранения материала: ' + err.message });
  }
};

// Routes on /api/materials
router.get('/project/:projectId', authenticateToken, getMaterialsHandler);
router.post('/project/:projectId', authenticateToken, upload.single('file'), createMaterialHandler);

// GET /api/materials/download/:id - Secure download of material file
router.get('/download/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const matRes = await db.query('SELECT * FROM project_materials WHERE id = $1', [id]);
    if (matRes.rows.length === 0) return res.status(404).json({ error: 'Материал не найден' });

    const material = matRes.rows[0];
    const hasAccess = await canAccessProject(material.project_id, req.user);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Отказано в доступе к материалу проекта' });
    }

    const uploadsRoot = path.resolve(UPLOADS_DIR);
    let filePath = path.resolve(material.file_path || '');

    if (!filePath.startsWith(uploadsRoot + path.sep)) {
      return res.status(403).json({ error: 'Недопустимый путь к файлу материала' });
    }

    if (!fs.existsSync(filePath)) {
      const fallbackPath = path.resolve(UPLOADS_DIR, path.basename(filePath));
      if (!fallbackPath.startsWith(uploadsRoot + path.sep)) {
        return res.status(403).json({ error: 'Недопустимый путь к файлу материала' });
      }
      if (fs.existsSync(fallbackPath)) {
        filePath = fallbackPath;
      } else {
        templates.createDocxFromTemplate(fallbackPath, material.title);
        filePath = fallbackPath;
      }
    }

    const rawFilename = material.file_name || `${material.title}.${material.file_type || 'docx'}`;
    const cleanFilename = fixFilenameEncoding(rawFilename);
    const asciiSafeFilename = cleanFilename.replace(/[^\x20-\x7E]/g, '_');
    const encodedUtf8Filename = encodeURIComponent(cleanFilename);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiSafeFilename}"; filename*=UTF-8''${encodedUtf8Filename}`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (err) {
    console.error('Error downloading material:', err);
    res.status(500).json({ error: 'Ошибка при скачивании материала' });
  }
});

// PUT /api/materials/:id - Update material metadata (author or admin)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, material_type, version, status } = req.body;

    const existingRes = await db.query('SELECT id, author_id FROM project_materials WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) return res.status(404).json({ error: 'Материал не найден' });
    const isAdmin = req.user.role === 'ADMIN' || req.user.role_code === 'admin';
    if (!isAdmin && parseInt(existingRes.rows[0].author_id, 10) !== parseInt(req.user.id, 10)) {
      return res.status(403).json({ error: 'Редактировать материал может только его автор или администратор' });
    }

    const updates = [];
    const params = [id];

    if (title) { params.push(fixFilenameEncoding(title.trim())); updates.push(`title = $${params.length}`); }
    if (description !== undefined) { params.push(description); updates.push(`description = $${params.length}`); }
    if (material_type) { params.push(material_type); updates.push(`material_type = $${params.length}`); }
    if (version) { params.push(version.trim()); updates.push(`version = $${params.length}`); }
    if (status) { params.push(status); updates.push(`status = $${params.length}`); }
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    const result = await db.query(`
      UPDATE project_materials SET ${updates.join(', ')} WHERE id = $1 RETURNING *
    `, params);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Материал не найден' });
    const updated = result.rows[0];
    searchQueue.enqueueSource('project_material', updated.id, updated.file_path, updated.file_type);
    res.json(updated);
  } catch (err) {
    console.error('Error updating material:', err);
    res.status(500).json({ error: 'Ошибка обновления материала' });
  }
});

// DELETE /api/materials/:id - Delete material (author or admin + MinIO cleanup)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const matRes = await db.query('SELECT * FROM project_materials WHERE id = $1', [id]);
    if (matRes.rows.length === 0) return res.status(404).json({ error: 'Материал не найден' });

    const material = matRes.rows[0];
    const isAdmin = req.user.role === 'ADMIN' || req.user.role_code === 'admin';
    if (!isAdmin && parseInt(material.author_id, 10) !== parseInt(req.user.id, 10)) {
      return res.status(403).json({ error: 'Удалить материал может только его автор или администратор' });
    }

    if (material.file_path && fs.existsSync(material.file_path)) {
      try { fs.unlinkSync(material.file_path); } catch (e) {}
    }
    if (material.file_path) {
      const base = path.basename(material.file_path);
      storage.deleteObject(`materials/${base}`).catch(() => {});
      storage.deleteObject(base).catch(() => {});
    }

    await db.query('DELETE FROM knowledge_chunks WHERE source_type = $1 AND source_id = $2', ['project_material', id]).catch(() => {});
    await db.query('DELETE FROM project_materials WHERE id = $1', [id]);
    res.json({ message: 'Материал успешно удален', id: material.id });
  } catch (err) {
    console.error('Error deleting material:', err);
    res.status(500).json({ error: 'Ошибка удаления материала' });
  }
});

module.exports = router;
module.exports.getMaterialsHandler = getMaterialsHandler;
module.exports.createMaterialHandler = createMaterialHandler;
