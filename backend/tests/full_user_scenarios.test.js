// backend/tests/full_user_scenarios.test.js
const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const BASE_URL = process.env.TEST_APP_URL || 'http://localhost:3000';

async function apiRequest(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    body = JSON.stringify(body);
  }

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body
  });

  const contentType = res.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }

  return {
    status: res.status,
    ok: res.ok,
    data,
    headers: res.headers
  };
}

async function runFullSystemScenariosTests() {
  console.log('\n===============================================================');
  console.log('🧪 ПОЛНОЕ ТЕСТИРОВАНИЕ ВСЕХ ПОЛЬЗОВАТЕЛЬСКИХ СЦЕНАРИЕВ СИСТЕМЫ');
  console.log('   (Аутентификация, RBAC, Проекты, Задачи, Встречи, Календарь,');
  console.log('    Документы, ONLYOFFICE Со-редактирование, Мессенджер, Почта)');
  console.log('===============================================================');

  const SNAPSHOT_FILE = '/tmp/docflow_db_backup_pre_scenarios.sql';
  let snapshotCreated = false;

  // Step 0: Create database snapshot for guaranteed rollback
  try {
    console.log('📸 [Шаг 0] Создание снимка базы данных перед началом тестирования...');
    execSync(`docker exec docflow_postgres pg_dump -U docflow -d docflow_db --clean --if-exists -f ${SNAPSHOT_FILE}`, { stdio: 'pipe' });
    snapshotCreated = true;
    console.log('  ✅ Снимок базы данных успешно зафиксирован.');
  } catch (snapErr) {
    console.warn('  ⚠️ Не удалось создать снимок через docker exec, будет использована точечная очистка:', snapErr.message);
  }

  // Tracking entities for fallback rollback
  const created = {
    userIds: [],
    projectIds: [],
    taskIds: [],
    conferenceIds: [],
    documentIds: [],
    folderNames: [],
    mailIds: []
  };

  let adminToken = '';
  let colleagueToken = '';
  let colleagueId = null;
  let testProjectId = null;
  let testTaskId = null;
  let testDocxId = null;
  let testXlsxId = null;
  let testConfId = null;

  try {
    // ==============================================================
    // СЦЕНАРИЙ 1: АУТЕНТИФИКАЦИЯ И БЕЗОПАСНОСТЬ
    // ==============================================================
    console.log('\n🔑 [Сценарий 1] Аутентификация и проверка безопасности доступа:');

    // 1.1 Успешный вход под Администратором
    const loginRes = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@docflow.local', password: 'admin123' }
    });
    assert.strictEqual(loginRes.status, 200, 'Вход администратора должен возвращать HTTP 200');
    assert.ok(loginRes.data && loginRes.data.token, 'Ответ должен содержать JWT токен');
    assert.strictEqual(loginRes.data.user.role, 'ADMIN', 'Роль пользователя должна быть ADMIN');
    adminToken = loginRes.data.token;
    console.log('  ✅ 1.1. Вход администратора и получение JWT токена — Успешно');

    // 1.2 Проверка текущего профиля GET /api/auth/me
    const meRes = await apiRequest('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(meRes.status, 200);
    const meUser = meRes.data.user || meRes.data;
    assert.strictEqual(meUser.email, 'admin@docflow.local');
    console.log('  ✅ 1.2. Проверка профиля текущего пользователя (/api/auth/me) — Успешно');

    // 1.3 Вход с неверным паролем
    const wrongLogin = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@docflow.local', password: 'wrong_password_123' }
    });
    assert.strictEqual(wrongLogin.status, 401, 'Неверный пароль должен возвращать 401 Unauthorized');
    console.log('  ✅ 1.3. Отклонение некорректного пароля (401 Unauthorized) — Успешно');

    // 1.4 Доступ без токена
    const unauthRes = await apiRequest('/api/documents');
    assert.strictEqual(unauthRes.status, 401, 'Запрос без токена должен возвращать 401 Unauthorized');
    console.log('  ✅ 1.4. Блокировка неавторизованных запросов без токена — Успешно');

    // ==============================================================
    // СЦЕНАРИЙ 2: УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ И RBAC
    // ==============================================================
    console.log('\n👥 [Сценарий 2] Пользователи, профили и ролевой доступ (RBAC):');

    // 2.1 Список пользователей
    const usersRes = await apiRequest('/api/users', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(usersRes.status, 200);
    assert.ok(Array.isArray(usersRes.data), 'Ответ должен быть списком пользователей');
    console.log(`  ✅ 2.1. Получение реестра пользователей (${usersRes.data.length} польз.) — Успешно`);

    // 2.2 Создание нового сотрудника с ролью USER
    const newColleagueRes = await apiRequest('/api/users', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        full_name: 'Тестовый Сотрудник QA',
        email: 'qa_colleague_test@docflow.local',
        password: 'ColleaguePassword123!',
        role: 'USER',
        department: 'Отдел контроля качества'
      }
    });
    assert.strictEqual(newColleagueRes.status, 201, 'Создание пользователя должно возвращать 201 Created');
    colleagueId = newColleagueRes.data.id;
    created.userIds.push(colleagueId);
    console.log(`  ✅ 2.2. Создание новой учетной записи сотрудника (ID: ${colleagueId}) — Успешно`);

    // 2.3 Авторизация созданного сотрудника
    const colleagueLogin = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'qa_colleague_test@docflow.local', password: 'ColleaguePassword123!' }
    });
    assert.strictEqual(colleagueLogin.status, 200);
    colleagueToken = colleagueLogin.data.token;
    assert.strictEqual(colleagueLogin.data.user.role, 'USER');
    console.log('  ✅ 2.3. Вход созданного сотрудника с ролью USER — Успешно');

    // 2.4 Проверка блокировки роли USER от административных действий
    const forbiddenCreateUser = await apiRequest('/api/users', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${colleagueToken}` },
      body: { full_name: 'Hacker', email: 'hacker@docflow.local', password: '123' }
    });
    assert.strictEqual(forbiddenCreateUser.status, 403, 'Роль USER не может создавать пользователей (403)');
    console.log('  ✅ 2.4. Блокировка административных операций для роли USER (403 Forbidden) — Успешно');

    // 2.5 Редактирование данных сотрудника администратором
    const updateColleague = await apiRequest(`/api/users/${colleagueId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: { department: 'Департамент инноваций и QA' }
    });
    assert.strictEqual(updateColleague.status, 200);
    console.log('  ✅ 2.5. Обновление профиля сотрудника администратором — Успешно');

    // ==============================================================
    // СЦЕНАРИЙ 3: УПРАВЛЕНИЕ ПРОЕКТАМИ
    // ==============================================================
    console.log('\n📁 [Сценарий 3] Жизненный цикл проектов:');

    // 3.1 Создание проекта
    const projRes = await apiRequest('/api/projects', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        title: 'Проект Тестирования Автоматизации',
        description: 'Комплексный проект автоматизации рабочих процессов DocFlow',
        status: 'ACTIVE'
      }
    });
    assert.strictEqual(projRes.status, 201);
    testProjectId = projRes.data.id;
    created.projectIds.push(testProjectId);
    console.log(`  ✅ 3.1. Создание проекта "${projRes.data.title}" (ID: ${testProjectId}) — Успешно`);

    // 3.2 Получение списка проектов
    const projectsList = await apiRequest('/api/projects', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(projectsList.status, 200);
    assert.ok(projectsList.data.some(p => p.id === testProjectId), 'Созданный проект должен быть в списке');
    console.log('  ✅ 3.2. Получение реестра проектов — Успешно');

    // 3.3 Карточка проекта
    const projDetails = await apiRequest(`/api/projects/${testProjectId}/details`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(projDetails.status, 200);
    assert.strictEqual(projDetails.data.project.id, testProjectId);
    console.log('  ✅ 3.3. Получение детальной карточки проекта и аналитики — Успешно');

    // 3.4 Обновление статуса проекта
    const updateProj = await apiRequest(`/api/projects/${testProjectId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: { status: 'IN_PROGRESS' }
    });
    assert.strictEqual(updateProj.status, 200);
    console.log('  ✅ 3.4. Перевод проекта в статус "IN_PROGRESS" — Успешно');

    // ==============================================================
    // СЦЕНАРИЙ 4: УПРАВЛЕНИЕ ЗАДАЧАМИ
    // ==============================================================
    console.log('\n📋 [Сценарий 4] Управление задачами, категориями и исполнителями:');

    // 4.1 Создание задачи администратором
    const taskRes = await apiRequest('/api/tasks', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        title: 'Разработать тестовый сценарий для ONLYOFFICE и чата',
        description: 'Необходимо подготовить end-to-end тесты всех функций платформы',
        project_id: testProjectId,
        assignee_id: colleagueId,
        priority: 'HIGH',
        category: 'WORK',
        deadline: new Date(Date.now() + 86400000).toISOString().split('T')[0]
      }
    });
    assert.strictEqual(taskRes.status, 201);
    testTaskId = taskRes.data.id;
    created.taskIds.push(testTaskId);
    console.log(`  ✅ 4.1. Создание задачи #${testTaskId} с приоритетом HIGH и категорией "WORK" — Успешно`);

    // 4.2 Получение списка задач
    const tasksList = await apiRequest('/api/tasks', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(tasksList.status, 200);
    assert.ok(tasksList.data.some(t => t.id === testTaskId));
    console.log('  ✅ 4.2. Получение реестра задач с фильтрацией — Успешно');

    // 4.3 Исполнитель меняет статус задачи на IN_PROGRESS, затем на DONE
    const progTask = await apiRequest(`/api/tasks/${testTaskId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${colleagueToken}` },
      body: { status: 'IN_PROGRESS' }
    });
    assert.strictEqual(progTask.status, 200);

    const doneTask = await apiRequest(`/api/tasks/${testTaskId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${colleagueToken}` },
      body: { status: 'DONE' }
    });
    assert.strictEqual(doneTask.status, 200);
    console.log('  ✅ 4.3. Выполнение задачи сотрудником: TODO -> IN_PROGRESS -> DONE — Успешно');

    // ==============================================================
    // СЦЕНАРИЙ 5: КОНФЕРЕНЦИИ И ФОРМАТЫ
    // ==============================================================
    console.log('\n🤝 [Сценарий 5] Совещания, кастомные форматы и рабочие группы:');

    // 5.1 Создание нового кастомного формата встречи
    const formatRes = await apiRequest('/api/conferences/formats', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: { name: 'Стратегический хакатон' }
    });
    assert.strictEqual(formatRes.status, 201);
    console.log('  ✅ 5.1. Создание нового формата участия "Стратегический хакатон" — Успешно');

    // 5.2 Создание конференции с участниками
    const confRes = await apiRequest('/api/conferences', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        title: 'Командное обсуждение релиза DocFlow Streamlined',
        description: 'Демонстрация работы редактора документов и почтового клиента',
        meeting_format: 'Стратегический хакатон',
        location_or_link: 'Онлайн-зал 1',
        start_time: new Date(Date.now() + 172800000).toISOString(),
        end_time: new Date(Date.now() + 176400000).toISOString(),
        participant_ids: [1, colleagueId]
      }
    });
    assert.strictEqual(confRes.status, 201);
    testConfId = confRes.data.id;
    created.conferenceIds.push(testConfId);
    console.log(`  ✅ 5.2. Создание конференции #${testConfId} с группой участников — Успешно`);

    // ==============================================================
    // СЦЕНАРИЙ 6: КАЛЕНДАРЬ СОБЫТИЙ
    // ==============================================================
    console.log('\n📅 [Сценарий 6] Агрегированный календарный фид:');

    const calFeed = await apiRequest('/api/calendar/feed', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(calFeed.status, 200);
    const events = Array.isArray(calFeed.data) ? calFeed.data : (calFeed.data.events || []);
    assert.ok(Array.isArray(events), 'Фид должен содержать массив events');
    const hasTaskEvent = events.some(e => (e.type || '').toUpperCase() === 'TASK' && e.id === testTaskId);
    const hasConfEvent = events.some(e => (e.type || '').toUpperCase() === 'CONFERENCE' && e.id === testConfId);
    assert.ok(hasTaskEvent, 'Календарь должен содержать созданную задачу');
    assert.ok(hasConfEvent, 'Календарь должен содержать созданную конференцию');
    console.log(`  ✅ 6.1. Агрегация дедлайнов задач и конференций в едином фиде — Успешно`);

    // ==============================================================
    // СЦЕНАРИЙ 7: ДОКУМЕНТЫ, ONLYOFFICE СО-РЕДАКТИРОВАНИЕ И СОХРАНЕНИЕ
    // ==============================================================
    console.log('\n📄 [Сценарий 7] Хранилище документов, права доступа (ACL) и ONLYOFFICE:');

    // 7.1 Создание папки документов
    const folderRes = await apiRequest('/api/documents/folders', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: { name: 'Договоры 2026' }
    });
    assert.strictEqual(folderRes.status, 201);
    created.folderNames.push('Договоры 2026');
    console.log('  ✅ 7.1. Создание папки "Договоры 2026" в хранилище — Успешно');

    // 7.2 Создание документа Word (.docx)
    const docxRes = await apiRequest('/api/documents/create', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        title: 'Регламент тестирования QA.docx',
        type: 'docx',
        category: 'Договоры 2026'
      }
    });
    assert.strictEqual(docxRes.status, 201);
    testDocxId = docxRes.data.id;
    created.documentIds.push(testDocxId);
    assert.ok(docxRes.data.file_size > 0, 'Размер созданного DOCX должен быть больше 0 байт');
    console.log(`  ✅ 7.2. Генерация валидного Word документа (.docx, ID: ${testDocxId}, ${docxRes.data.file_size} байт) — Успешно`);

    // 7.3 Создание таблицы Excel (.xlsx)
    const xlsxRes = await apiRequest('/api/documents/create', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        title: 'Бюджет проекта.xlsx',
        type: 'xlsx',
        category: 'Договоры 2026'
      }
    });
    assert.strictEqual(xlsxRes.status, 201);
    testXlsxId = xlsxRes.data.id;
    created.documentIds.push(testXlsxId);
    assert.ok(xlsxRes.data.file_size > 0, 'Размер созданного XLSX должен быть больше 0 байт');
    console.log(`  ✅ 7.3. Генерация валидной таблицы Excel (.xlsx, ID: ${testXlsxId}, ${xlsxRes.data.file_size} байт) — Успешно`);

    // 7.4 Выдача прав доступа сотруднику (EDIT)
    const grantPerm = await apiRequest(`/api/documents/${testDocxId}/permissions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        userId: colleagueId,
        permissionLevel: 'EDIT'
      }
    });
    assert.ok([200, 201].includes(grantPerm.status), 'Выдача прав должна возвращать 200 или 201');
    console.log(`  ✅ 7.4. Выдача прав на редактирование (EDIT) сотруднику — Успешно`);

    // 7.5 Проверка конфигурации ONLYOFFICE
    const configAdmin = await apiRequest(`/api/documents/${testDocxId}/onlyoffice-config`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(configAdmin.status, 200);
    assert.strictEqual(configAdmin.data.documentType, 'word');
    assert.strictEqual(configAdmin.data.document.permissions.edit, true);
    assert.strictEqual(configAdmin.data.editorConfig.coEditing.mode, 'fast');
    assert.strictEqual(configAdmin.data.editorConfig.customization.forcesave, true);
    assert.strictEqual(configAdmin.data.editorConfig.customization.autosave, true);
    console.log('  ✅ 7.5. Проверка параметров ONLYOFFICE Docs (coEditing: fast, autosave, forcesave) — Успешно');

    // 7.6 ТЕСТ ОДНОВРЕМЕННОГО СО-РЕДАКТИРОВАНИЯ (CO-EDITING ROOM MATCHING)
    console.log('  👥 Проверка одновременного совместного редактирования:');
    const configColleague = await apiRequest(`/api/documents/${testDocxId}/onlyoffice-config`, {
      headers: { 'Authorization': `Bearer ${colleagueToken}` }
    });
    assert.strictEqual(configColleague.status, 200);
    assert.strictEqual(
      configAdmin.data.document.key,
      configColleague.data.document.key,
      'Ключ комнаты со-редактирования у обоих пользователей ДОЛЖЕН СОВПАДАТЬ'
    );
    console.log(`    ✅ 7.6.1. Комната со-редактирования совпадает: ключ "${configAdmin.data.document.key}" общий для обоих редакторов`);

    // 7.7 ТЕСТ ПРИНУДИТЕЛЬНОГО СОХРАНЕНИЯ (FORCESAVE COMMAND)
    console.log('  💾 Проверка принудительного сохранения (forcesave):');
    const forceSaveRes = await apiRequest(`/api/documents/${testDocxId}/save-now`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(forceSaveRes.status, 200);
    assert.strictEqual(forceSaveRes.data.success, true);
    console.log('    ✅ 7.7.1. Отправка команды forcesave в ONLYOFFICE CommandService — Успешно');

    // 7.8 ТЕСТ ЭМУЛЯЦИИ WEBHOOK CALLBACK ДИНАМИЧЕСКОГО АВТОСОХРАНЕНИЯ (STATUS 6)
    const cbStatus6 = await apiRequest(`/api/documents/onlyoffice-callback?docId=${testDocxId}`, {
      method: 'POST',
      body: { status: 6 } // Dynamic save, no downloadUrl
    });
    assert.strictEqual(cbStatus6.status, 200);
    assert.strictEqual(cbStatus6.data.error, 0);

    // Проверяем, что edit_key не сбросился при статусе 6 (со-редакторы продолжают работу)
    const docAfterStatus6 = await db.query('SELECT edit_key, version FROM documents WHERE id = $1', [testDocxId]);
    assert.ok(docAfterStatus6.rows[0].edit_key, 'Ключ сессии со-редактирования должен сохраняться при промежуточном автосохранении');
    console.log('    ✅ 7.8.1. Динамическое автосохранение: edit_key сохранен для активной сессии');

    // 7.9 ТЕСТ ФИНАЛЬНОГО ЗАВЕРШЕНИЯ СЕССИИ (STATUS 2)
    const cbStatus2 = await apiRequest(`/api/documents/onlyoffice-callback?docId=${testDocxId}`, {
      method: 'POST',
      body: { status: 2 } // All users disconnected
    });
    assert.strictEqual(cbStatus2.status, 200);
    assert.strictEqual(cbStatus2.data.error, 0);
    console.log('    ✅ 7.9.1. Финальное закрытие документа всеми пользователями обработано — Успешно');

    // 7.10 Скачивание документа
    const dlRes = await apiRequest(`/api/documents/download/${testDocxId}?token=${adminToken}`);
    assert.strictEqual(dlRes.status, 200);
    console.log('  ✅ 7.10. Скачивание документа с валидацией токена — Успешно');

    // ==============================================================
    // СЦЕНАРИЙ 8: ВНУТРЕННИЙ МЕССЕНДЖЕР И ВЛОЖЕНИЯ
    // ==============================================================
    console.log('\n💬 [Сценарий 8] Корпоративный мессенджер, чаты и вложения:');

    // 8.1 Отправка текстового сообщения
    const sendMsg1 = await apiRequest('/api/messenger/messages', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${colleagueToken}` },
      body: {
        recipient_id: 1,
        message: 'Добрый день! Отчет по тестированию готов к согласованию.'
      }
    });
    assert.strictEqual(sendMsg1.status, 201);
    console.log('  ✅ 8.1. Отправка текстового личного сообщения собеседнику — Успешно');

    // 8.2 Получение истории сообщений
    const historyRes = await apiRequest(`/api/messenger/messages?recipient_id=${colleagueId}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(historyRes.status, 200);
    assert.ok(Array.isArray(historyRes.data));
    assert.ok(historyRes.data.some(m => m.message.includes('Отчет по тестированию')));
    console.log(`  ✅ 8.2. Чтение истории переписки диалога (${historyRes.data.length} сообщ.) — Успешно`);

    // 8.3 Получение списка активных диалогов
    const convsRes = await apiRequest('/api/messenger/conversations', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(convsRes.status, 200);
    assert.ok(convsRes.data.some(c => c.id === colleagueId));
    console.log('  ✅ 8.3. Реестр активных бесед содержит собеседника с последним сообщением — Успешно');

    // ==============================================================
    // СЦЕНАРИЙ 9: ПОЧТОВЫЙ МОДУЛЬ (БЕЗ ОТПРАВКИ ЧЕРЕЗ SMTP)
    // ==============================================================
    console.log('\n✉️ [Сценарий 9] Почтовый клиент (подсказки, настройки, чтение и удаление):');

    // 9.1 Подсказки получателей при наборе (Suggest / Autocomplete)
    const suggestRes = await apiRequest('/api/mail/recipients/suggest?q=admi', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(suggestRes.status, 200);
    assert.ok(Array.isArray(suggestRes.data));
    assert.ok(suggestRes.data.some(s => s.email.toLowerCase().includes('admin')), 'Подсказка должна содержать admin@docflow.local');
    console.log(`  ✅ 9.1. Автодополнение адресата при наборе "admi" (${suggestRes.data.length} реком.) — Успешно`);

    // 9.2 Проверка настроек почты
    const mailSettingsRes = await apiRequest('/api/mail/settings', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(mailSettingsRes.status, 200);
    console.log('  ✅ 9.2. Получение текущих параметров почты IMAP/SMTP — Успешно');

    // 9.3 Получение списка писем
    const mailList = await apiRequest('/api/mail?folder=inbox', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(mailList.status, 200);
    const messages = Array.isArray(mailList.data) ? mailList.data : (mailList.data?.messages || []);
    assert.ok(Array.isArray(messages), 'Ответ должен содержать массив сообщений');
    console.log(`  ✅ 9.3. Получение списка входящих писем (${messages.length} писем в inbox) — Успешно`);

    // 9.4 Тестирование смены прочитанности и удаления (создаем тестовое письмо в БД для текущего теста)
    const insMail = await db.query(`
      INSERT INTO mail_messages (user_id, folder, sender_name, sender_email, recipient_email, subject, preview, body, is_read)
      VALUES (1, 'inbox', 'Тестовый Отправитель', 'sender@test.local', 'admin@docflow.local', 'Тест флагов прочтения', 'Превью теста', 'Текст письма', false)
      RETURNING id
    `);
    const testMailId = insMail.rows[0].id;
    created.mailIds.push(testMailId);

    // Смена статуса на прочитано
    const readPatch = await apiRequest(`/api/mail/${testMailId}/read`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: { is_read: true }
    });
    assert.strictEqual(readPatch.status, 200);

    // Удаление письма
    const delMail = await apiRequest(`/api/mail/${testMailId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(delMail.status, 200);
    console.log('  ✅ 9.4. Переключение прочитанности (is_read: true) и удаление письма — Успешно');

    console.log('\n===============================================================');
    console.log('🎉 ВСЕ ПОЛЬЗОВАТЕЛЬСКИЕ СЦЕНАРИИ УСПЕШНО ПРОТЕСТИРОВАНЫ И ПРОЙДЕНЫ!');
    console.log('===============================================================');

  } finally {
    // ==============================================================
    // ГАРАНТИРОВАННЫЙ ОТКАТ ИЗМЕНЕНИЙ В БАЗЕ ДАННЫХ (ROLLBACK)
    // ==============================================================
    console.log('\n🔄 [ОТКАТ] Запуск гарантированного отката всех тестовых изменений в БД...');

    if (snapshotCreated) {
      try {
        console.log('  📦 Восстановление состояния базы данных из снимка pg_dump...');
        execSync(`docker exec docflow_postgres psql -U docflow -d docflow_db -f ${SNAPSHOT_FILE}`, { stdio: 'pipe' });
        execSync(`docker exec docflow_postgres rm -f ${SNAPSHOT_FILE}`, { stdio: 'pipe' });
        console.log('  ✅ База данных успешно и полностью возвращена в исходное состояние до каждого байта!');
      } catch (restoreErr) {
        console.warn('  ⚠️ Сбой восстановления через psql:', restoreErr.message);
      }
    } else {
      // Fallback manual database cleanup
      console.log('  🧹 Выполнение точечной очистки тестовых записей в БД...');
      try {
        if (created.mailIds.length) await db.query('DELETE FROM mail_messages WHERE id = ANY($1)', [created.mailIds]);
        if (created.taskIds.length) await db.query('DELETE FROM tasks WHERE id = ANY($1)', [created.taskIds]);
        if (created.projectIds.length) await db.query('DELETE FROM projects WHERE id = ANY($1)', [created.projectIds]);
        if (created.conferenceIds.length) await db.query('DELETE FROM conferences WHERE id = ANY($1)', [created.conferenceIds]);
        if (created.documentIds.length) {
          await db.query('DELETE FROM document_permissions WHERE document_id = ANY($1)', [created.documentIds]);
          await db.query('DELETE FROM documents WHERE id = ANY($1)', [created.documentIds]);
        }
        if (created.folderNames.length) await db.query('DELETE FROM document_folders WHERE name = ANY($1)', [created.folderNames]);
        if (created.userIds.length) await db.query('DELETE FROM users WHERE id = ANY($1)', [created.userIds]);
        console.log('  ✅ Точечная очистка тестовых записей завершена.');
      } catch (cleanupErr) {
        console.warn('  ⚠️ Ошибка точечной очистки:', cleanupErr.message);
      }
    }

    // Clean up created physical files in uploads
    try {
      const uploadsDir = path.join(__dirname, '../../uploads');
      if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(uploadsDir);
        files.forEach(f => {
          if (f.startsWith('doc-') && (f.includes('Регламент') || f.includes('Бюджет'))) {
            try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (e) {}
          }
        });
      }
    } catch (e) {}

    console.log('===============================================================\n');
  }
}

module.exports = { runFullSystemScenariosTests };

if (require.main === module) {
  runFullSystemScenariosTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
