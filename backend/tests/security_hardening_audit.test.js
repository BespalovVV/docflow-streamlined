/**
 * Регрессионный тест безопасности (по результатам аудита P0/P1/P2):
 * C-01..C-05, H-01..H-05, M-03
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { encrypt, decryptStrict } = require('../utils/crypto');
const { loginRateLimiter } = require('../middleware/rateLimiter');
const { UPLOADS_DIR } = require('../middleware/upload');

const BASE_URL = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';

async function api(endpoint, options = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, options);
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => '');
  }
  return { status: res.status, ok: res.ok, headers: res.headers, data };
}

async function run() {
  console.log('\n🛡️ Запуск автотестов закрытых уязвимостей безопасности (P0/P1/P2)...');
  await db.initDb();

  const usersRes = await db.query(
    "SELECT id, email, role, full_name, COALESCE(token_version, 1) AS token_version FROM users WHERE role = 'USER' ORDER BY id ASC LIMIT 2"
  );
  assert.ok(usersRes.rows.length >= 2, 'Требуется минимум 2 обычных пользователя в БД');
  const userA = usersRes.rows[0];
  const userB = usersRes.rows[1];

  const adminRes = await db.query(
    "SELECT id, email, role, full_name, COALESCE(token_version, 1) AS token_version FROM users WHERE role = 'ADMIN' ORDER BY id ASC LIMIT 1"
  );
  const admin = adminRes.rows[0];

  const makeToken = (u) => jwt.sign(
    { id: u.id, email: u.email, role: u.role, full_name: u.full_name, tv: Number(u.token_version || 1) },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const tokenA = makeToken(userA);
  const tokenB = makeToken(userB);
  const adminToken = makeToken(admin);

  const created = {
    docIds: [],
    folderIds: [],
    projectIds: [],
    materialIds: [],
    taskIds: [],
    userIds: [],
    tempFiles: []
  };

  try {
    // M-03: decryptStrict должен выбрасывать ошибку на поддельном AES-GCM шифротексте
    {
      const enc = encrypt('SuperSecretMailPass_2026!');
      const parts = enc.split(':');
      const tampered = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -2)}ff`;
      assert.throws(() => decryptStrict(tampered), 'decryptStrict обязан выбрасывать ошибку при нарушении AuthTag');
      console.log('  ✅ M-03: decryptStrict отклоняет поддельный шифротекст');
    }

    // C-01: Проверка удаления бэкдора тестовых паролей
    {
      const tempEmail = `sec_audit_${Date.now()}@docflow.local`;
      const createU = await api('/api/users', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: tempEmail,
          password: 'UniqueAuditPassword_2026!',
          full_name: 'Audit Test User',
          role: 'USER'
        })
      });
      assert.equal(createU.status, 201);
      created.userIds.push(createU.data.id);

      for (const fallbackPass of ['Test1234!', 'admin123', 'user123']) {
        const badLogin = await api('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: tempEmail, password: fallbackPass })
        });
        assert.equal(badLogin.status, 401, `Захардкоженный пароль ${fallbackPass} не должен подходить`);
      }
      console.log('  ✅ C-01: Бэкдор резервных паролей (@docflow.local) устранён');
    }

    // C-02: Неподписанный callback ONLYOFFICE должен отклоняться с 403
    {
      const unsignedCb = await api('/api/documents/onlyoffice-callback?docId=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 2, url: 'http://169.254.169.254/latest/meta-data/' })
      });
      assert.equal(unsignedCb.status, 403, 'Неподписанный onlyoffice-callback обязан возвращать 403');

      const fakeSigCb = await api('/api/documents/onlyoffice-callback?docId=1&sig=deadbeef&exp=9999999999', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 2, url: 'http://127.0.0.1:3000/api/health' })
      });
      assert.equal(fakeSigCb.status, 403, 'Callback с поддельной подписью обязан возвращать 403');
      console.log('  ✅ C-02: Неподписанный ONLYOFFICE callback и SSRF-подмена URL отклонены (403)');
    }

    // C-03: Сервисные эндпоинты ONLYOFFICE на внешнем прокси должны быть закрыты (403)
    {
      const cmdRes = await api('/onlyoffice/coauthoring/CommandService.ashx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ c: 'version' })
      });
      assert.equal(cmdRes.status, 403, 'Внешний доступ к CommandService.ashx должен быть закрыт (403)');

      const convRes = await api('/onlyoffice/ConvertService.ashx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(convRes.status, 403, 'Внешний доступ к ConvertService.ashx должен быть закрыт (403)');
      console.log('  ✅ C-03: Внешний доступ к сервисным эндпоинтам /onlyoffice/* заблокирован (403)');
    }

    // Создаём приватный документ и публичный документ от userA
    const privDocRes = await api('/api/documents/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Приватный документ аудита', type: 'txt', is_public: false })
    });
    assert.equal(privDocRes.status, 201);
    const privDoc = privDocRes.data;
    created.docIds.push(privDoc.id);

    const pubDocRes = await api('/api/documents/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Общедоступный документ аудита', type: 'txt', is_public: true })
    });
    assert.equal(pubDocRes.status, 201);
    const pubDoc = pubDocRes.data;
    created.docIds.push(pubDoc.id);

    // C-04: Default-deny на /api/messenger/download и /uploads/:filename
    {
      const msgDlIdor = await api(`/api/messenger/download?url=/uploads/${encodeURIComponent(privDoc.file_name)}`, {
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      assert.equal(msgDlIdor.status, 403, 'Чужой USER не должен скачивать приватный документ через /api/messenger/download');

      const uploadsIdor = await api(`/uploads/${encodeURIComponent(privDoc.file_name)}`, {
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      assert.equal(uploadsIdor.status, 403, 'Чужой USER не должен скачивать приватный документ через /uploads');

      const orphanName = `orphan-audit-${Date.now()}.txt`;
      const orphanPath = path.join(UPLOADS_DIR, orphanName);
      fs.writeFileSync(orphanPath, 'internal secret');
      created.tempFiles.push(orphanPath);

      const orphanRes = await api(`/uploads/${orphanName}`, {
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      assert.equal(orphanRes.status, 403, 'Незарегистрированный в БД файл должен блокироваться (default-deny 403)');
      console.log('  ✅ C-04: IDOR-обходы в /api/messenger/download и /uploads устранены (default-deny 403)');
    }

    // C-05: Подделка attachments_json и произвольные каналы в мессенджере
    {
      const forgedDocMsg = await api('/api/messenger/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_id: userA.id,
          message: 'Проверь документ',
          attachments_json: JSON.stringify([{ docId: privDoc.id, url: 'javascript:alert(1)' }])
        })
      });
      assert.equal(forgedDocMsg.status, 403, 'Нельзя прикрепить чужой приватный документ через attachments_json');

      const xssUrlMsg = await api('/api/messenger/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_id: userA.id,
          message: 'XSS URL test',
          attachments_json: JSON.stringify([{ url: 'javascript:alert(document.cookie)', name: 'evil' }])
        })
      });
      assert.equal(xssUrlMsg.status, 201);
      assert.equal(xssUrlMsg.data.attachments.length, 0, 'Небезопасные произвольные URL в attachments_json должны отбрасываться');
      await db.query('DELETE FROM chat_messages WHERE id = $1', [xssUrlMsg.data.id]);

      const arbitraryChan = await api('/api/messenger/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'arbitrary_broadcast', message: 'spam' })
      });
      assert.equal(arbitraryChan.status, 403, 'Обычный пользователь не может писать в произвольный канал');
      console.log('  ✅ C-05: Бэкенд мессенджера очищает attachments_json и блокирует произвольные каналы');
    }

    // H-01: Строгий whitelist расширений и sandbox-заголовок на /uploads
    {
      const fd = new FormData();
      fd.append('title', 'xss_payload.html');
      fd.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'xss_payload.html');
      const htmlUpload = await api('/api/documents/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: fd
      });
      assert.ok(htmlUpload.status >= 400, `Загрузка .html должна блокироваться (получен статус ${htmlUpload.status})`);

      const uploadRead = await api(`/uploads/${encodeURIComponent(privDoc.file_name)}`, {
        headers: { Authorization: `Bearer ${tokenA}` }
      });
      assert.equal(uploadRead.status, 200);
      assert.equal(uploadRead.headers.get('content-security-policy'), 'sandbox');
      assert.ok((uploadRead.headers.get('content-disposition') || '').includes('attachment'));
      console.log('  ✅ H-01: Загрузка .html заблокирована, отдача файлов изолирована через CSP sandbox и attachment');
    }

    // H-02: IDOR на папки, проекты/материалы, серии задач и анонимный доступ к is_public
    {
      const anonPub = await api(`/api/documents/download/${pubDoc.id}`);
      assert.equal(anonPub.status, 401, 'Скачивание is_public документа без авторизации должно возвращать 401');

      const anonUploadPub = await api(`/uploads/${encodeURIComponent(pubDoc.file_name)}`);
      assert.equal(anonUploadPub.status, 401, 'Чтение is_public файла через /uploads без авторизации должно возвращать 401');

      const admFolder = await api('/api/documents/folders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `SecAuditFolder_${Date.now()}` })
      });
      assert.equal(admFolder.status, 201);
      created.folderIds.push(admFolder.data.id);

      const folderRenameByOther = await api(`/api/documents/folders/${admFolder.data.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'HackedFolder' })
      });
      assert.equal(folderRenameByOther.status, 403, 'Чужой USER не может переименовать чужую папку');

      const folderDeleteByOther = await api(`/api/documents/folders/${admFolder.data.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      assert.equal(folderDeleteByOther.status, 403, 'Чужой USER не может удалить чужую папку');

      // Изоляция проектов и материалов
      const projRes = await api('/api/projects', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `SecretAuditProj_${Date.now()}`, description: 'Confidential' })
      });
      assert.equal(projRes.status, 201);
      created.projectIds.push(projRes.data.id);

      const matForm = new FormData();
      matForm.append('title', 'SecretSpec');
      matForm.append('description', 'Top secret spec');
      matForm.append('file', new Blob(['Top secret material text'], { type: 'text/plain' }), 'secret_spec.txt');
      const matRes = await api(`/api/materials/project/${projRes.data.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: matForm
      });
      assert.equal(matRes.status, 201);
      created.materialIds.push(matRes.data.id);
      if (matRes.data.file_path) created.tempFiles.push(matRes.data.file_path);

      const projDetailsByB = await api(`/api/projects/${projRes.data.id}/details`, {
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      assert.equal(projDetailsByB.status, 403, 'Неучастник проекта не должен видеть /projects/:id/details');

      const matListByB = await api(`/api/materials/project/${projRes.data.id}`, {
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      assert.equal(matListByB.status, 403, 'Неучастник проекта не должен видеть материалы чужого проекта');

      const matDlByB = await api(`/api/materials/download/${matRes.data.id}`, {
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      assert.equal(matDlByB.status, 403, 'Неучастник проекта не должен скачивать материалы чужого проекта');

      // Серия задач: защита от переписывания чужой серии
      const admTaskRes = await api('/api/tasks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Admin Series Task', assignee_id: admin.id, is_recurring: true, recurring_type: 'WEEKLY' })
      });
      assert.equal(admTaskRes.status, 201);
      created.taskIds.push(admTaskRes.data.id);

      const bTaskRes = await api('/api/tasks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'UserB Task', assignee_id: userB.id })
      });
      assert.equal(bTaskRes.status, 201);
      created.taskIds.push(bTaskRes.data.id);

      const hijackSeries = await api(`/api/tasks/${bTaskRes.data.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ series_id: admTaskRes.data.id, update_scope: 'series', title: 'Hijacked' })
      });
      assert.equal(hijackSeries.status, 403, 'Привязка задачи к чужой серии задач должна блокироваться (403)');
      console.log('  ✅ H-02: IDOR на папки, проекты, материалы, серии задач и is_public без авторизации закрыты');
    }

    // H-03: Спуфинг X-Forwarded-For не обходит rateLimiter
    {
      let blocked = false;
      for (let i = 0; i < 25; i++) {
        let statusSent = 200;
        let passed = false;
        const mockReq = {
          ip: '203.0.113.77',
          baseUrl: '/api/auth',
          path: '/login-audit-check',
          headers: { 'x-forwarded-for': `198.51.100.${i + 1}` },
          body: { email: `ratelimit_${i}@example.test` },
          socket: { remoteAddress: '203.0.113.77' }
        };
        const mockRes = {
          setHeader: () => {},
          status: (code) => {
            statusSent = code;
            return { json: () => {} };
          }
        };
        loginRateLimiter(mockReq, mockRes, () => { passed = true; });
        if (!passed && statusSent === 429) {
          blocked = true;
          break;
        }
      }
      assert.equal(blocked, true, 'Подмена X-Forwarded-For не должна обходить rateLimiter по req.ip');
      console.log('  ✅ H-03: Rate limiter устойчив к подделке заголовка X-Forwarded-For');
    }

    // H-04: Блокировка SSRF в настройках почты
    {
      for (const badHost of ['127.0.0.1', 'localhost', 'postgres', '169.254.169.254']) {
        const mailCfg = await api('/api/mail/settings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'audit@example.com',
            password: 'MailPassword123',
            imap_host: badHost,
            imap_port: 993,
            smtp_host: 'smtp.gmail.com',
            smtp_port: 465
          })
        });
        assert.equal(mailCfg.status, 400, `Внутренний IMAP-хост ${badHost} обязан отклоняться (400)`);
      }
      console.log('  ✅ H-04: SSRF на внутренние адреса в настройках почты заблокирован');
    }

    // H-05: Logout отзывает действующий JWT через token_version++
    {
      const meBefore = await api('/api/auth/me', {
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      assert.equal(meBefore.status, 200);

      const logoutRes = await api('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      assert.equal(logoutRes.status, 200);

      const meAfter = await api('/api/auth/me', {
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      assert.equal(meAfter.status, 401, 'После POST /api/auth/logout старый JWT обязан отклоняться с 401');
      console.log('  ✅ H-05: Выход из системы мгновенно отзывает JWT через token_version');
    }

    console.log('🎉 ВСЕ ТЕСТЫ БЕЗОПАСНОСТИ (P0/P1/P2) ПРОЙДЕНЫ УСПЕШНО!');
  } finally {
    for (const id of created.taskIds) {
      await db.query('DELETE FROM tasks WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.materialIds) {
      await db.query('DELETE FROM project_materials WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.projectIds) {
      await db.query('DELETE FROM projects WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.folderIds) {
      await db.query('DELETE FROM document_folders WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.docIds) {
      await db.query('DELETE FROM document_permissions WHERE document_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM documents WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of created.userIds) {
      await db.query('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
    }
    for (const fPath of created.tempFiles) {
      if (fPath && fs.existsSync(fPath)) {
        try { fs.unlinkSync(fPath); } catch (e) {}
      }
    }
    await db.pool.end().catch(() => {});
  }
}

run().catch((err) => {
  console.error('❌ Ошибка в тестах безопасности аудита:', err);
  process.exit(1);
});
