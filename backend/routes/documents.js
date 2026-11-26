const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const db = require('../db');
const storage = require('../storage');
const templates = require('../templates');
const { authenticateToken, authenticateTokenOptional } = require('../middleware/auth');
const { upload, UPLOADS_DIR } = require('../middleware/upload');
const { fixFilenameEncoding } = require('../utils/encoding');
const { getSubordinateUserIds } = require('../utils/hierarchy');
const { signDownloadUrlParams, verifyDownloadUrlParams } = require('../utils/crypto');
const searchQueue = require('../utils/search_queue');

// Список метаданных документа для реестров (исключает тяжёлые content_text и content_tsv)
const DOC_META_COLUMNS = `
  d.id, d.title, d.file_name, d.file_type, d.file_size, d.file_path,
  d.category, d.folder_id, d.created_by, d.updated_at, d.version, d.edit_key,
  d.is_public, d.indexed_at, d.indexing_status, d.indexing_error
`;

// Helper to determine user access level for a specific document
async function getDocumentAccess(docId, user) {
  const docRes = await db.query('SELECT * FROM documents WHERE id = $1', [docId]);
  if (docRes.rows.length === 0) {
    return { doc: null, accessLevel: null, canView: false, canEdit: false, canDelete: false, canManage: false };
  }
  const doc = docRes.rows[0];

  // System Administrator has full rights over all documents
  if (user.role === 'ADMIN' || user.role_code === 'admin') {
    return {
      doc,
      accessLevel: 'ADMIN',
      canView: true,
      canEdit: true,
      canDelete: true,
      canManage: true
    };
  }

  // Document creator has full OWNER rights
  if (parseInt(doc.created_by, 10) === parseInt(user.id, 10)) {
    return {
      doc,
      accessLevel: 'OWNER',
      canView: true,
      canEdit: true,
      canDelete: true,
      canManage: true
    };
  }

  // Check if user is manager of the document creator
  const subordinateIds = await getSubordinateUserIds(user.id);
  if (doc.created_by && subordinateIds.includes(parseInt(doc.created_by, 10))) {
    return {
      doc,
      accessLevel: 'MANAGER',
      canView: true,
      canEdit: true,
      canDelete: true,
      canManage: true
    };
  }

  // Check explicit permissions in document_permissions
  const permRes = await db.query(
    'SELECT permission_level FROM document_permissions WHERE document_id = $1 AND user_id = $2',
    [docId, user.id]
  );

  if (permRes.rows.length > 0) {
    const level = permRes.rows[0].permission_level.toUpperCase();
    if (level === 'EDIT') {
      return {
        doc,
        accessLevel: 'EDIT',
        canView: true,
        canEdit: true,
        canDelete: false,
        canManage: false
      };
    } else {
      return {
        doc,
        accessLevel: 'VIEW',
        canView: true,
        canEdit: false,
        canDelete: false,
        canManage: false
      };
    }
  }

  // Check if document is public (accessible to all authenticated employees)
  if (doc.is_public) {
    return {
      doc,
      accessLevel: 'PUBLIC',
      canView: true,
      canEdit: false,
      canDelete: false,
      canManage: false
    };
  }

  return {
    doc,
    accessLevel: null,
    canView: false,
    canEdit: false,
    canDelete: false,
    canManage: false
  };
}

// HELPER: Download saved document from ONLYOFFICE Document Server safely
function downloadFromOnlyoffice(originalUrl, targetFilePath) {
  return new Promise(async (resolve, reject) => {
    const urlsToTry = [originalUrl];
    try {
      const u = new URL(originalUrl);
      if (u.hostname !== 'docflow_onlyoffice') {
        const dockerU = new URL(originalUrl);
        dockerU.hostname = 'docflow_onlyoffice';
        dockerU.port = '80';
        dockerU.protocol = 'http:';
        urlsToTry.push(dockerU.toString());
      }
      if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
        const localU = new URL(originalUrl);
        localU.hostname = '127.0.0.1';
        localU.port = process.env.ONLYOFFICE_PORT || '28083';
        localU.protocol = 'http:';
        urlsToTry.push(localU.toString());
      }
    } catch (e) {}

    let lastError = null;
    for (const fetchUrl of urlsToTry) {
      try {
        console.log(`[ONLYOFFICE Download] Attempting to pull saved file from: ${fetchUrl}...`);
        const size = await fetchSingleUrl(fetchUrl, targetFilePath);
        return resolve(size);
      } catch (err) {
        lastError = err;
        console.warn(`[ONLYOFFICE Download] Failed from ${fetchUrl}: ${err.message}. Trying next candidate...`);
      }
    }
    reject(lastError || new Error('Could not download document from any ONLYOFFICE URL'));
  });
}

function fetchSingleUrl(resolvedUrl, targetFilePath) {
  return new Promise((resolve, reject) => {
    const tempFilePath = `${targetFilePath}.tmp.${Date.now()}`;
    const fileStream = fs.createWriteStream(tempFilePath);
    const client = resolvedUrl.startsWith('https:') ? https : http;

    const req = client.get(resolvedUrl, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        fileStream.close();
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        return reject(new Error(`ONLYOFFICE server responded with HTTP ${res.statusCode}`));
      }

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        try {
          const stats = fs.statSync(tempFilePath);
          if (stats.size === 0) {
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            return reject(new Error('Downloaded document from ONLYOFFICE is 0 bytes'));
          }
          fs.copyFileSync(tempFilePath, targetFilePath);
          fs.unlinkSync(tempFilePath);
          resolve(stats.size);
        } catch (err) {
          if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      fileStream.close();
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      fileStream.close();
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      reject(new Error('Timeout downloading from ONLYOFFICE'));
    });
  });
}

// GET /api/documents - List documents available to current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'ADMIN' || req.user.role_code === 'admin';
    const page = parseInt(req.query.page, 10);
    const limit = parseInt(req.query.limit, 10);
    const usePagination = !isNaN(page) && !isNaN(limit) && page > 0 && limit > 0;
    const safeLimit = usePagination ? Math.min(limit, 200) : null;
    const offset = usePagination ? (page - 1) * safeLimit : 0;

    let queryText = '';
    let queryParams = [];
    let subordinateIds = [];

    if (isAdmin) {
      queryText = `
        SELECT ${DOC_META_COLUMNS}, u.full_name AS author_name,
               'ADMIN' AS user_access_level
               ${usePagination ? ', COUNT(*) OVER()::int AS _total_count' : ''}
        FROM documents d
        LEFT JOIN users u ON d.created_by = u.id
        ORDER BY d.updated_at DESC
        ${usePagination ? 'LIMIT $1 OFFSET $2' : ''}
      `;
      queryParams = usePagination ? [safeLimit, offset] : [];
    } else {
      subordinateIds = await getSubordinateUserIds(req.user.id);
      const allowedOwnerIds = [parseInt(req.user.id, 10), ...subordinateIds];

      queryText = `
        SELECT ${DOC_META_COLUMNS}, u.full_name AS author_name,
               CASE 
                 WHEN d.created_by = $1 THEN 'OWNER'
                 WHEN d.created_by = ANY($2::int[]) THEN 'MANAGER'
                 WHEN dp.permission_level IS NOT NULL THEN dp.permission_level
                 WHEN d.is_public THEN 'PUBLIC'
                 ELSE 'VIEW'
               END AS user_access_level
               ${usePagination ? ', COUNT(*) OVER()::int AS _total_count' : ''}
        FROM documents d
        LEFT JOIN users u ON d.created_by = u.id
        LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = $1
        WHERE d.created_by = ANY($2::int[]) OR dp.id IS NOT NULL OR d.is_public = TRUE
        ORDER BY d.updated_at DESC
        ${usePagination ? 'LIMIT $3 OFFSET $4' : ''}
      `;
      queryParams = usePagination ? [req.user.id, allowedOwnerIds, safeLimit, offset] : [req.user.id, allowedOwnerIds];
    }

    const result = await db.query(queryText, queryParams);
    const documents = result.rows;
    let total = documents.length;
    if (usePagination) {
      total = documents.length > 0 ? documents[0]._total_count : 0;
      for (const doc of documents) delete doc._total_count;
    }

    // Batch fetch permissions for returned documents in a single SQL query (O(1) instead of N+1)
    if (documents.length > 0) {
      const docIds = documents.map(d => d.id);
      const permsRes = await db.query(`
        SELECT dp.document_id, dp.id, dp.user_id, dp.permission_level, dp.created_at,
               u.full_name, u.email, u.department
        FROM document_permissions dp
        JOIN users u ON dp.user_id = u.id
        WHERE dp.document_id = ANY($1::int[])
        ORDER BY u.full_name ASC
      `, [docIds]);

      const permsByDocId = new Map();
      for (const p of permsRes.rows) {
        if (!permsByDocId.has(p.document_id)) {
          permsByDocId.set(p.document_id, []);
        }
        permsByDocId.get(p.document_id).push(p);
      }

      const subIdSet = new Set(subordinateIds.map(id => parseInt(id, 10)));
      const curUserId = parseInt(req.user.id, 10);
      for (let doc of documents) {
        const ownerId = parseInt(doc.created_by, 10);
        const isOwner = ownerId === curUserId;
        const isManager = subIdSet.has(ownerId);
        doc.can_manage_access = Boolean(isAdmin || isOwner || isManager);
        doc.permissions = permsByDocId.get(doc.id) || [];
        doc.permissions_count = doc.permissions.length;
      }
    }

    if (usePagination) {
      return res.json({
        documents,
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit)
      });
    }

    res.json(documents);
  } catch (err) {
    console.error('Error fetching documents:', err);
    res.status(500).json({ error: 'Ошибка загрузки документов' });
  }
});

// Хелпер: разрешение folder_id и category для документа
async function resolveDocumentFolder(folderIdRaw, categoryRaw) {
  let folderId = null;
  let category = (categoryRaw && String(categoryRaw).trim()) || 'Общие';

  if (folderIdRaw !== undefined && folderIdRaw !== null && folderIdRaw !== '' && folderIdRaw !== 'root') {
    const parsedId = parseInt(folderIdRaw, 10);
    if (!isNaN(parsedId)) {
      const fRes = await db.query('SELECT id, name FROM document_folders WHERE id = $1', [parsedId]);
      if (fRes.rows.length > 0) {
        folderId = fRes.rows[0].id;
        category = fRes.rows[0].name;
      }
    }
  } else if (folderIdRaw === null || folderIdRaw === '' || folderIdRaw === 'root') {
    // Явно указан корень «Мой диск» без категории
    if (!categoryRaw) category = 'Мой диск';
  } else if (categoryRaw && String(categoryRaw).trim()) {
    const fRes = await db.query(
      'SELECT id, name FROM document_folders WHERE LOWER(name) = LOWER($1) AND parent_id IS NULL LIMIT 1',
      [String(categoryRaw).trim()]
    );
    if (fRes.rows.length > 0) {
      folderId = fRes.rows[0].id;
    }
  }

  return { folderId, category };
}

// POST /api/documents/upload - Upload document
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не выбран' });

    const { title, category, folder_id, is_public } = req.body;
    const isPublicBool = is_public === true || is_public === 'true';
    const cleanOriginal = fixFilenameEncoding(req.file.originalname);
    const ext = path.extname(cleanOriginal).replace('.', '').toLowerCase();
    const docTitle = title ? title.trim() : cleanOriginal;
    const resolved = await resolveDocumentFolder(folder_id, category);

    const doc = await db.withTransaction(async (client) => {
      const result = await client.query(`
        INSERT INTO documents (title, file_name, file_type, file_size, file_path, category, folder_id, created_by, is_public)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [docTitle, req.file.filename, ext, req.file.size, req.file.path, resolved.category, resolved.folderId, req.user.id, isPublicBool]);
      return result.rows[0];
    });

    console.log(`[Document Storage] Uploaded document #${doc.id}: ${docTitle} (${req.file.path})`);
    storage.uploadFile(`documents/${doc.file_name}`, req.file.path);
    searchQueue.enqueue(doc.id, req.file.path, ext, { sourceType: 'document', immediateFts: true });
    doc.user_access_level = 'OWNER';
    doc.can_manage_access = true;
    doc.permissions = [];
    doc.permissions_count = 0;
    res.status(201).json(doc);
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    console.error('Document Upload error:', err);
    res.status(500).json({ error: 'Ошибка загрузки файла документа: ' + err.message });
  }
});

// POST /api/documents/create - Create new blank document
router.post('/create', authenticateToken, async (req, res) => {
  let filePath = null;
  try {
    const { title, type, category, folder_id, is_public } = req.body;
    const isPublicBool = is_public === true || is_public === 'true';
    if (!title || !type) {
      return res.status(400).json({ error: 'Укажите название и тип создаваемого файла' });
    }

    const ext = type.toLowerCase().replace('.', '');
    const allowedCreate = ['docx', 'xlsx', 'pptx', 'txt', 'csv', 'md'];
    if (!allowedCreate.includes(ext)) {
      return res.status(400).json({ error: 'Поддерживается создание форматов: .docx, .xlsx, .pptx, .txt, .csv, .md' });
    }

    let fileBuffer;
    if (ext === 'docx') {
      fileBuffer = templates.generateBlankDocx();
    } else if (ext === 'xlsx') {
      fileBuffer = templates.generateBlankXlsx();
    } else if (ext === 'pptx') {
      fileBuffer = templates.generateBlankPptx();
    } else if (ext === 'txt') {
      fileBuffer = templates.generateBlankTxt(title);
    } else if (ext === 'csv') {
      fileBuffer = templates.generateBlankCsv();
    } else if (ext === 'md') {
      fileBuffer = templates.generateBlankMd(title);
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const fileName = `doc-${uniqueSuffix}.${ext}`;
    filePath = path.join(UPLOADS_DIR, fileName);

    await fs.promises.writeFile(filePath, fileBuffer);

    let docTitle = title.trim();
    if (!docTitle.toLowerCase().endsWith('.' + ext)) {
      docTitle += '.' + ext;
    }

    const resolved = await resolveDocumentFolder(folder_id, category);

    const doc = await db.withTransaction(async (client) => {
      const result = await client.query(`
        INSERT INTO documents (title, file_name, file_type, file_size, file_path, category, folder_id, created_by, is_public)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [docTitle, fileName, ext, fileBuffer.length, filePath, resolved.category, resolved.folderId, req.user.id, isPublicBool]);
      return result.rows[0];
    });

    console.log(`[Document Storage] Created blank document #${doc.id}: ${docTitle} (${filePath})`);

    // Sync to MinIO S3 (асинхронно) и однократная постановка в очередь индексации
    storage.uploadFile(`documents/${doc.file_name}`, filePath).catch(() => {});
    searchQueue.enqueue(doc.id, filePath, ext, { sourceType: 'document', immediateFts: true });

    doc.user_access_level = 'OWNER';
    doc.can_manage_access = true;
    doc.permissions = [];
    doc.permissions_count = 0;
    res.status(201).json(doc);
  } catch (err) {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
    console.error('Create document error:', err);
    res.status(500).json({ error: 'Ошибка при создании документа: ' + err.message });
  }
});

// GET /api/documents/folders - List document folders tree
router.get('/folders', authenticateToken, async (req, res) => {
  try {
    const docCatsRes = await db.query("SELECT DISTINCT TRIM(category) AS cat FROM documents WHERE category IS NOT NULL AND TRIM(category) != '' AND TRIM(category) != 'Мой диск'");
    for (const row of docCatsRes.rows) {
      const existsRes = await db.query(
        'SELECT id FROM document_folders WHERE LOWER(name) = LOWER($1) AND parent_id IS NULL LIMIT 1',
        [row.cat]
      );
      if (existsRes.rows.length === 0) {
        await db.query('INSERT INTO document_folders (name) VALUES ($1)', [row.cat]).catch(() => {});
      }
    }

    const foldersRes = await db.query(`
      SELECT id, name, parent_id, created_by, created_at
      FROM document_folders
      ORDER BY name ASC
    `);
    res.json(foldersRes.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка загрузки папок' });
  }
});

// POST /api/documents/folders - Create new document folder (supports nested parent_id)
router.post('/folders', authenticateToken, async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название папки' });
    const cleanName = name.trim();

    let parsedParentId = null;
    if (parent_id !== undefined && parent_id !== null && parent_id !== '' && parent_id !== 'root') {
      parsedParentId = parseInt(parent_id, 10);
      if (isNaN(parsedParentId)) {
        return res.status(400).json({ error: 'Некорректная родительская папка' });
      }
      const parentCheck = await db.query('SELECT id FROM document_folders WHERE id = $1', [parsedParentId]);
      if (parentCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Родительская папка не найдена' });
      }
    }

    const existing = await db.query(
      'SELECT * FROM document_folders WHERE LOWER(name) = LOWER($1) AND COALESCE(parent_id, 0) = $2',
      [cleanName, parsedParentId || 0]
    );
    if (existing.rows.length > 0) return res.json(existing.rows[0]);

    const resRow = await db.query(
      'INSERT INTO document_folders (name, parent_id, created_by) VALUES ($1, $2, $3) RETURNING *',
      [cleanName, parsedParentId, req.user.id]
    );
    res.status(201).json(resRow.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка создания папки: ' + err.message });
  }
});

// PATCH /api/documents/folders/:id - Rename or move folder
router.patch('/folders/:id', authenticateToken, async (req, res) => {
  try {
    const folderId = parseInt(req.params.id, 10);
    if (isNaN(folderId)) return res.status(400).json({ error: 'Некорректный ID папки' });

    const existingRes = await db.query('SELECT * FROM document_folders WHERE id = $1', [folderId]);
    if (existingRes.rows.length === 0) return res.status(404).json({ error: 'Папка не найдена' });

    const { name, parent_id } = req.body;
    const updates = [];
    const params = [folderId];

    if (name !== undefined && String(name).trim()) {
      params.push(String(name).trim());
      updates.push(`name = $${params.length}`);
    }

    if (parent_id !== undefined) {
      let nextParentId = null;
      if (parent_id !== null && parent_id !== '' && parent_id !== 'root') {
        nextParentId = parseInt(parent_id, 10);
        if (isNaN(nextParentId) || nextParentId === folderId) {
          return res.status(400).json({ error: 'Нельзя переместить папку саму в себя' });
        }
        // Защита от циклической вложенности
        const cycleRes = await db.query(`
          WITH RECURSIVE tree AS (
            SELECT id, parent_id FROM document_folders WHERE id = $1
            UNION ALL
            SELECT f.id, f.parent_id FROM document_folders f JOIN tree t ON f.parent_id = t.id
          )
          SELECT 1 FROM tree WHERE id = $2
        `, [folderId, nextParentId]);
        if (cycleRes.rows.length > 0) {
          return res.status(400).json({ error: 'Нельзя переместить папку внутрь её собственной подпапки' });
        }
      }
      params.push(nextParentId);
      updates.push(`parent_id = $${params.length}`);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Нет полей для обновления' });

    const updated = await db.withTransaction(async (client) => {
      const updRes = await client.query(
        `UPDATE document_folders SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
        params
      );
      const row = updRes.rows[0];
      if (name !== undefined && String(name).trim()) {
        await client.query('UPDATE documents SET category = $1 WHERE folder_id = $2', [row.name, folderId]);
      }
      return row;
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка обновления папки: ' + err.message });
  }
});

// DELETE /api/documents/folders/:id - Delete folder safely (moves children & docs up to parent)
router.delete('/folders/:id', authenticateToken, async (req, res) => {
  try {
    const folderId = parseInt(req.params.id, 10);
    if (isNaN(folderId)) return res.status(400).json({ error: 'Некорректный ID папки' });

    const folderRes = await db.query('SELECT * FROM document_folders WHERE id = $1', [folderId]);
    if (folderRes.rows.length === 0) return res.status(404).json({ error: 'Папка не найдена' });
    const folder = folderRes.rows[0];

    await db.withTransaction(async (client) => {
      let parentCategory = 'Общие';
      if (folder.parent_id) {
        const pRes = await client.query('SELECT name FROM document_folders WHERE id = $1', [folder.parent_id]);
        if (pRes.rows.length > 0) parentCategory = pRes.rows[0].name;
      }
      await client.query(
        'UPDATE documents SET folder_id = $1, category = $2 WHERE folder_id = $3',
        [folder.parent_id || null, parentCategory, folderId]
      );
      await client.query(
        'UPDATE document_folders SET parent_id = $1 WHERE parent_id = $2',
        [folder.parent_id || null, folderId]
      );
      await client.query('DELETE FROM document_folders WHERE id = $1', [folderId]);
    });

    res.json({ success: true, message: `Папка «${folder.name}» удалена, файлы перенесены на уровень выше` });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка удаления папки: ' + err.message });
  }
});

// GET /api/documents/:id/permissions - Get list of users with granted access
router.get('/:id/permissions', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await getDocumentAccess(id, req.user);
    if (!access.doc) return res.status(404).json({ error: 'Документ не найден' });
    if (!access.canManage) {
      return res.status(403).json({ error: 'У вас нет прав на управление доступом к этому документу' });
    }

    const permsRes = await db.query(`
      SELECT dp.id, dp.user_id, dp.permission_level, dp.created_at,
             u.full_name, u.email, u.department,
             gb.full_name AS granted_by_name
      FROM document_permissions dp
      JOIN users u ON dp.user_id = u.id
      LEFT JOIN users gb ON dp.granted_by = gb.id
      WHERE dp.document_id = $1
      ORDER BY u.full_name ASC
    `, [id]);

    const usersRes = await db.query(`
      SELECT id, full_name, email, department, role
      FROM users
      WHERE id != $1
      ORDER BY full_name ASC
    `, [access.doc.created_by || 0]);

    res.json({
      document: {
        id: access.doc.id,
        title: access.doc.title,
        created_by: access.doc.created_by
      },
      permissions: permsRes.rows,
      availableUsers: usersRes.rows
    });
  } catch (err) {
    console.error('Get doc permissions error:', err);
    res.status(500).json({ error: 'Ошибка получения списка прав доступа' });
  }
});

// POST /api/documents/:id/permissions - Grant or update user permission
router.post('/:id/permissions', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, permissionLevel } = req.body;

    if (!userId || !permissionLevel) {
      return res.status(400).json({ error: 'Укажите пользователя и уровень доступа (VIEW или EDIT)' });
    }

    const cleanLevel = String(permissionLevel).toUpperCase() === 'EDIT' ? 'EDIT' : 'VIEW';
    const targetUserId = parseInt(userId, 10);
    if (isNaN(targetUserId)) {
      return res.status(400).json({ error: 'Некорректный ID пользователя' });
    }

    const access = await getDocumentAccess(id, req.user);
    if (!access.doc) return res.status(404).json({ error: 'Документ не найден' });
    if (!access.canManage) {
      return res.status(403).json({ error: 'У вас нет прав на выдачу доступа к этому документу' });
    }

    if (parseInt(access.doc.created_by, 10) === targetUserId) {
      return res.status(400).json({ error: 'Создатель документа уже обладает полными правами владельца' });
    }

    const userCheck = await db.query('SELECT id, full_name, email, department FROM users WHERE id = $1', [targetUserId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден в системе' });
    }

    const result = await db.query(`
      INSERT INTO document_permissions (document_id, user_id, permission_level, granted_by, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (document_id, user_id)
      DO UPDATE SET permission_level = EXCLUDED.permission_level, granted_by = EXCLUDED.granted_by, created_at = NOW()
      RETURNING *
    `, [id, targetUserId, cleanLevel, req.user.id]);

    const perm = result.rows[0];
    perm.full_name = userCheck.rows[0].full_name;
    perm.email = userCheck.rows[0].email;
    perm.department = userCheck.rows[0].department;

    res.status(201).json({
      message: `Права (${cleanLevel === 'EDIT' ? 'Редактирование' : 'Просмотр'}) успешно выданы пользователю ${perm.full_name}`,
      permission: perm
    });
  } catch (err) {
    console.error('Grant doc permission error:', err);
    res.status(500).json({ error: 'Ошибка сохранения прав доступа: ' + err.message });
  }
});

// POST /api/documents/:id/permissions/bulk - Bulk grant permissions
router.post('/:id/permissions/bulk', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { targetType, department, permissionLevel } = req.body;
    const cleanLevel = String(permissionLevel).toUpperCase() === 'EDIT' ? 'EDIT' : 'VIEW';

    const access = await getDocumentAccess(id, req.user);
    if (!access.doc) return res.status(404).json({ error: 'Документ не найден' });
    if (!access.canManage) {
      return res.status(403).json({ error: 'У вас нет прав на управление доступом к этому документу' });
    }

    let usersQuery = 'SELECT id, full_name, email, department FROM users WHERE id != $1';
    let params = [access.doc.created_by || 0];

    if (targetType === 'department' && department) {
      params.push(department);
      usersQuery += ` AND department = $${params.length}`;
    }

    const targetUsers = await db.query(usersQuery, params);
    const targetUserIds = targetUsers.rows.map(u => u.id);
    const count = targetUserIds.length;
    if (count > 0) {
      await db.query(`
        INSERT INTO document_permissions (document_id, user_id, permission_level, granted_by, created_at)
        SELECT $1, uid, $3, $4, NOW()
        FROM UNNEST($2::int[]) AS uid
        ON CONFLICT (document_id, user_id)
        DO UPDATE SET permission_level = EXCLUDED.permission_level, granted_by = EXCLUDED.granted_by, created_at = NOW()
      `, [id, targetUserIds, cleanLevel, req.user.id]);
    }

    res.json({
      message: `Права (${cleanLevel === 'EDIT' ? 'Редактирование' : 'Просмотр'}) успешно выданы (${count} сотр.)`,
      count
    });
  } catch (err) {
    console.error('Bulk grant doc permissions error:', err);
    res.status(500).json({ error: 'Ошибка массовой выдачи прав: ' + err.message });
  }
});

// DELETE /api/documents/:id/permissions/:userId - Revoke access
router.delete('/:id/permissions/:userId', authenticateToken, async (req, res) => {
  try {
    const { id, userId } = req.params;
    const targetUserId = parseInt(userId, 10);
    if (isNaN(targetUserId)) return res.status(400).json({ error: 'Некорректный ID пользователя' });

    const access = await getDocumentAccess(id, req.user);
    if (!access.doc) return res.status(404).json({ error: 'Документ не найден' });
    if (!access.canManage) {
      return res.status(403).json({ error: 'У вас нет прав на управление доступом к этому документу' });
    }

    const delRes = await db.query(
      'DELETE FROM document_permissions WHERE document_id = $1 AND user_id = $2 RETURNING *',
      [id, targetUserId]
    );

    if (delRes.rows.length === 0) {
      return res.status(404).json({ error: 'Запись о правах доступа для данного пользователя не найдена' });
    }

    res.json({ message: 'Доступ к документу успешно отозван' });
  } catch (err) {
    console.error('Revoke doc permission error:', err);
    res.status(500).json({ error: 'Ошибка отзыва прав доступа' });
  }
});

// PATCH /api/documents/:id - Update metadata
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await getDocumentAccess(id, req.user);
    if (!access.doc) return res.status(404).json({ error: 'Документ не найден' });
    if (!access.canEdit) {
      return res.status(403).json({ error: 'У вас нет прав на редактирование этого документа' });
    }

    const { title, category, folder_id, is_public } = req.body;
    const updates = [];
    const params = [id];

    if (title) { params.push(title.trim()); updates.push(`title = $${params.length}`); }
    if (folder_id !== undefined) {
      const resolved = await resolveDocumentFolder(folder_id, category);
      params.push(resolved.folderId);
      updates.push(`folder_id = $${params.length}`);
      params.push(resolved.category);
      updates.push(`category = $${params.length}`);
    } else if (category) {
      params.push(category.trim());
      updates.push(`category = $${params.length}`);
    }
    if (is_public !== undefined) {
      if (!access.canManage) {
        return res.status(403).json({ error: 'Изменять статус общедоступности документа может только его создатель, руководитель или администратор' });
      }
      params.push(is_public === true || is_public === 'true');
      updates.push(`is_public = $${params.length}`);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Нет полей для обновления' });

    const result = await db.query(`UPDATE documents SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, params);
    if (title || category) {
      const updated = result.rows[0];
      if (updated) searchQueue.enqueueSource('document', updated.id, updated.file_path, updated.file_type);
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка обновления метаданных документа' });
  }
});

// POST /api/documents/:id/toggle-public - Toggle public visibility
router.post('/:id/toggle-public', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await getDocumentAccess(id, req.user);
    if (!access.doc) return res.status(404).json({ error: 'Документ не найден' });
    if (!access.canManage) {
      return res.status(403).json({ error: 'Изменять статус общедоступности документа может только создатель, руководитель или администратор' });
    }

    const currentPublic = !!access.doc.is_public;
    const newPublic = !currentPublic;

    const result = await db.query('UPDATE documents SET is_public = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [newPublic, id]);
    res.json({
      message: newPublic ? 'Документ теперь общедоступен для всех сотрудников' : 'Документ переведен в закрытый режим',
      is_public: newPublic,
      document: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка переключения доступа к документу: ' + err.message });
  }
});

// DELETE /api/documents/:id - Delete document
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await getDocumentAccess(id, req.user);
    if (!access.doc) return res.status(404).json({ error: 'Документ не найден' });
    if (!access.canDelete) {
      return res.status(403).json({ error: 'Удалить документ может только его создатель или администратор' });
    }

    const doc = access.doc;
    if (fs.existsSync(doc.file_path)) {
      try { fs.unlinkSync(doc.file_path); } catch (e) {}
    }
    storage.deleteObject(`documents/${doc.file_name}`);

    await db.withTransaction(async (client) => {
      await client.query('DELETE FROM document_permissions WHERE document_id = $1', [id]);
      await client.query('DELETE FROM document_chunks WHERE document_id = $1', [id]);
      await client.query('DELETE FROM knowledge_chunks WHERE source_type = $1 AND source_id = $2', ['document', id]);
      await client.query('DELETE FROM documents WHERE id = $1', [id]);
    });
    res.json({ message: 'Документ удален' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка удаления документа' });
  }
});

// GET /api/documents/:id/onlyoffice-config - Generate ONLYOFFICE Editor config
router.get('/:id/onlyoffice-config', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await getDocumentAccess(id, req.user);
    if (!access.doc) return res.status(404).json({ error: 'Документ не найден' });

    if (!access.canView) {
      return res.status(403).json({ error: 'Доступ запрещен: у вас нет прав на просмотр этого документа' });
    }
    const doc = access.doc;

    const clientProto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const clientHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const hostIp = clientHost.split(':')[0];
    const onlyofficePort = process.env.ONLYOFFICE_PORT || '28083';

    let onlyofficeApiUrl = '';
    if (process.env.ONLYOFFICE_PUBLIC_URL) {
      onlyofficeApiUrl = `${process.env.ONLYOFFICE_PUBLIC_URL.replace(/\/+$/, '')}/web-apps/apps/api/documents/api.js`;
    } else {
      // Встроенный same-origin прокси /onlyoffice: работает на localhost, в LAN и через любые туннели без проброса 28083
      onlyofficeApiUrl = `${clientProto}://${clientHost}/onlyoffice/web-apps/apps/api/documents/api.js`;
    }

    const canEdit = access.canEdit;
    const canDownload = true;
    const cleanFileType = (doc.file_type || path.extname(doc.file_name || '').replace('.', '') || 'docx').toLowerCase().replace(/^\./, '').trim();

    let documentType = 'word';
    let isReadOnly = cleanFileType === 'pdf' || !canEdit;
    if (['xlsx', 'xls', 'csv', 'ods', 'tsv', 'xlsm'].includes(cleanFileType)) documentType = 'cell';
    if (['pptx', 'ppt', 'odp', 'ppsx', 'potx'].includes(cleanFileType)) documentType = 'slide';

    // Адрес скачивания и обратного вызова для ONLYOFFICE Document Server
    // Сервер ONLYOFFICE работает в Docker и обращается к бэкенду по внутренней сети
    const internalHost = process.env.APP_INTERNAL_URL
      ? process.env.APP_INTERNAL_URL.replace(/^https?:\/\//, '')
      : (process.env.CONTAINER_APP_HOST || 'docflow_streamlined:3000');
    const { sig, exp } = signDownloadUrlParams(doc.id, 7200);
    const downloadUrl = `http://${internalHost}/api/documents/download/${doc.id}?sig=${sig}&exp=${exp}`;
    const callbackUrl = `http://${internalHost}/api/documents/onlyoffice-callback?docId=${doc.id}`;

    let documentKey = doc.edit_key;
    if (!documentKey) {
      const version = doc.version || 1;
      documentKey = `doc_${doc.id}_v${version}_${Date.now()}`;
      await db.query('UPDATE documents SET edit_key = $1 WHERE id = $2', [documentKey, doc.id]);
    }

    const config = {
      documentType,
      document: {
        fileType: cleanFileType,
        key: documentKey,
        title: doc.title,
        url: downloadUrl,
        permissions: {
          download: canDownload,
          edit: !isReadOnly && canEdit,
          print: canDownload,
          comment: canEdit,
          fillForms: canEdit,
          review: canEdit
        }
      },
      editorConfig: {
        callbackUrl: callbackUrl,
        user: {
          id: String(req.user.id),
          name: req.user.full_name
        },
        lang: 'ru',
        mode: isReadOnly ? 'view' : 'edit',
        coEditing: {
          mode: 'fast',
          change: true
        },
        customization: {
          autosave: true,
          chat: true,
          comments: canEdit,
          compactHeader: true,
          forcesave: canEdit,
          help: false,
          feedback: false
        }
      },
      onlyofficeApiUrl: onlyofficeApiUrl,
      onlyofficeDirectUrl: `http://${hostIp}:${onlyofficePort}/web-apps/apps/api/documents/api.js`,
      userAccessLevel: access.accessLevel
    };

    res.json(config);
  } catch (err) {
    console.error('ONLYOFFICE config error:', err);
    res.status(500).json({ error: 'Ошибка получения конфигурации ONLYOFFICE' });
  }
});

// POST /api/documents/:id/save-now - Force immediate save
router.post('/:id/save-now', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await getDocumentAccess(id, req.user);
    if (!access.doc) return res.status(404).json({ error: 'Документ не найден' });
    if (!access.canEdit) {
      return res.status(403).json({ error: 'У вас нет прав на сохранение этого документа' });
    }

    const doc = access.doc;
    const documentKey = doc.edit_key || `doc_${doc.id}_v${doc.version || 1}_${Date.now()}`;
    if (!doc.edit_key) {
      await db.query('UPDATE documents SET edit_key = $1 WHERE id = $2', [documentKey, doc.id]);
    }

    const commandPayload = JSON.stringify({
      c: 'forcesave',
      key: documentKey
    });

    const commandResult = await new Promise((resolve) => {
      const commandReq = http.request({
        hostname: 'docflow_onlyoffice',
        port: 80,
        path: '/coauthoring/CommandService.ashx',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(commandPayload)
        },
        timeout: 8000
      }, (cmdRes) => {
        let raw = '';
        cmdRes.on('data', chunk => raw += chunk);
        cmdRes.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            resolve({ raw, error: -1 });
          }
        });
      });

      commandReq.on('error', (err) => {
        console.warn('[CommandService forcesave error]:', err.message);
        resolve({ error: -1, message: err.message });
      });

      commandReq.on('timeout', () => {
        commandReq.destroy();
        resolve({ error: -2, message: 'timeout' });
      });

      commandReq.write(commandPayload);
      commandReq.end();
    });

    console.log(`[CommandService] forcesave for doc #${id} (key: ${documentKey}) result:`, commandResult);
    await new Promise(r => setTimeout(r, 600));

    res.json({
      success: true,
      message: 'Команда сохранения успешно выполнена',
      commandResult
    });
  } catch (err) {
    console.error('Save-now error:', err);
    res.status(500).json({ error: 'Ошибка сохранения документа: ' + err.message });
  }
});

// GET /api/documents/download/:id - File download for ONLYOFFICE (signed HMAC) & Authorized Browser
router.get('/download/:id', authenticateTokenOptional, async (req, res) => {
  try {
    const { id } = req.params;
    const hasValidSignedUrl = verifyDownloadUrlParams(id, req.query.sig, req.query.exp);

    let doc = null;
    if (hasValidSignedUrl) {
      const docRes = await db.query('SELECT * FROM documents WHERE id = $1', [id]);
      if (docRes.rows.length === 0) return res.status(404).send('File not found');
      doc = docRes.rows[0];
    } else if (req.user) {
      const access = await getDocumentAccess(id, req.user);
      if (!access.doc) return res.status(404).send('File not found');
      if (!access.canView) {
        return res.status(403).json({ error: 'Отказано в доступе к документу' });
      }
      doc = access.doc;
    } else {
      // Без подписи и без токена разрешаем только явно общедоступные документы
      const docRes = await db.query('SELECT * FROM documents WHERE id = $1', [id]);
      if (docRes.rows.length === 0) return res.status(404).send('File not found');
      if (!docRes.rows[0].is_public) {
        return res.status(401).json({ error: 'Требуется авторизация для скачивания документа' });
      }
      doc = docRes.rows[0];
    }
    const safePath = path.resolve(doc.file_path);
    if (!safePath.startsWith(path.resolve(UPLOADS_DIR))) {
      console.warn(`[Security Alert] Path traversal attempt blocked for document #${id}: ${doc.file_path}`);
      return res.status(403).send('Access denied: invalid file path');
    }

    let isFileValid = fs.existsSync(safePath) && fs.statSync(safePath).size > 0;

    if (!isFileValid) {
      console.log(`[Storage] File ${doc.file_name} for document #${doc.id} missing or corrupted (0 bytes). Recovering from MinIO...`);
      const downloaded = await storage.downloadFile(`documents/${doc.file_name}`, safePath);
      isFileValid = downloaded && fs.existsSync(safePath) && fs.statSync(safePath).size > 0;

      if (!isFileValid) {
        if (doc.file_type === 'docx') {
          console.log(`[Storage] Re-generating valid blank DOCX for document #${doc.id}...`);
          const blankBuf = templates.generateBlankDocx();
          fs.writeFileSync(safePath, blankBuf);
          await storage.uploadFile(`documents/${doc.file_name}`, safePath);
          await db.query('UPDATE documents SET file_size = $1, updated_at = NOW() WHERE id = $2', [blankBuf.length, doc.id]);
        } else if (doc.file_type === 'xlsx') {
          console.log(`[Storage] Re-generating valid blank XLSX for document #${doc.id}...`);
          const blankBuf = templates.generateBlankXlsx();
          fs.writeFileSync(safePath, blankBuf);
          await storage.uploadFile(`documents/${doc.file_name}`, safePath);
          await db.query('UPDATE documents SET file_size = $1, updated_at = NOW() WHERE id = $2', [blankBuf.length, doc.id]);
        } else {
          return res.status(404).send('File physical storage missing or corrupted');
        }
      }
    }

    // Explicit MIME mapping for ONLYOFFICE & Browser compatibility
    const mimeTypes = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc: 'application/msword',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xls: 'application/vnd.ms-excel',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ppt: 'application/vnd.ms-powerpoint',
      pdf: 'application/pdf',
      txt: 'text/plain; charset=utf-8',
      rtf: 'application/rtf',
      odt: 'application/vnd.oasis.opendocument.text',
      ods: 'application/vnd.oasis.opendocument.spreadsheet',
      odp: 'application/vnd.oasis.opendocument.presentation',
      csv: 'text/csv; charset=utf-8'
    };
    const cleanExt = (doc.file_type || path.extname(doc.file_name || '').replace('.', '') || 'docx').toLowerCase().replace(/^\./, '').trim();
    const contentType = mimeTypes[cleanExt] || 'application/octet-stream';
    const safeAsciiFilename = doc.file_name || `document_${doc.id}.${cleanExt}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeAsciiFilename}"`);
    return res.sendFile(safePath);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).send('Download error');
  }
});

// POST /api/documents/onlyoffice-callback - Save handler
router.post('/onlyoffice-callback', async (req, res) => {
  try {
    const { status, url: downloadUrl } = req.body;
    const docId = req.query.docId;
    console.log(`[ONLYOFFICE Callback] Status: ${status} for docId: ${docId}, hasUrl: ${Boolean(downloadUrl)}`);

    if (status === 6 && downloadUrl) {
      const docRes = await db.query('SELECT * FROM documents WHERE id = $1', [docId]);
      if (docRes.rows.length > 0) {
        const doc = docRes.rows[0];
        const newSize = await downloadFromOnlyoffice(downloadUrl, doc.file_path);

        await db.query('UPDATE documents SET updated_at = NOW(), file_size = $1 WHERE id = $2', [newSize, docId]);
        await storage.uploadFile(`documents/${doc.file_name}`, doc.file_path);
        searchQueue.enqueue(docId, doc.file_path, doc.file_type, { sourceType: 'document', immediateFts: true });
        console.log(`[ONLYOFFICE Callback] ✅ Dynamic save for doc #${docId} (${newSize} bytes) synced to disk & MinIO.`);
      }
    } else if (status === 2 && downloadUrl) {
      const docRes = await db.query('SELECT * FROM documents WHERE id = $1', [docId]);
      if (docRes.rows.length > 0) {
        const doc = docRes.rows[0];
        const newSize = await downloadFromOnlyoffice(downloadUrl, doc.file_path);

        await db.query(`
          UPDATE documents 
          SET updated_at = NOW(), file_size = $1, version = COALESCE(version, 1) + 1, edit_key = NULL 
          WHERE id = $2
        `, [newSize, docId]);
        await storage.uploadFile(`documents/${doc.file_name}`, doc.file_path);
        searchQueue.enqueue(docId, doc.file_path, doc.file_type, { sourceType: 'document', immediateFts: true });
        console.log(`[ONLYOFFICE Callback] ✅ Final session save for doc #${docId} (${newSize} bytes). New version recorded.`);
      }
    } else if (status === 4) {
      await db.query('UPDATE documents SET edit_key = NULL WHERE id = $1', [docId]);
      console.log(`[ONLYOFFICE Callback] Document #${docId} closed without changes, edit_key cleared.`);
    }

    res.json({ error: 0 });
  } catch (err) {
    console.error('[ONLYOFFICE Callback Error]:', err.message);
    res.json({ error: 1 });
  }
});

module.exports = router;
