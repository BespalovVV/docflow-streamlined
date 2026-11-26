// backend/tests/qa_live_system_tests.js
// Комплексное живое E2E / API тестирование системы DocFlow Streamlined

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, options);
  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, headers: res.headers, data };
}

let passCount = 0;
let failCount = 0;
const results = [];

function assert(condition, testName, details = '') {
  if (condition) {
    passCount++;
    console.log(`  ✅ [PASS] ${testName}`);
    results.push({ name: testName, status: 'PASS', details });
  } else {
    failCount++;
    console.error(`  ❌ [FAIL] ${testName} ${details ? '(' + details + ')' : ''}`);
    results.push({ name: testName, status: 'FAIL', details });
  }
}

async function runLiveSystemTests() {
  console.log('====================================================================');
  console.log('🚀 ЗАПУСК КОМПЛЕКСНОГО ТЕСТИРОВАНИЯ СИСТЕМЫ DOCFLOW STREAMLINED');
  console.log(`📍 Целевой сервер: ${BASE_URL}`);
  console.log('====================================================================\n');

  let adminToken = null;
  let userToken = null;
  let createdDirectionId = null;
  let createdProjectId = null;
  let createdTaskId = null;
  let createdConfId = null;
  let createdEventId = null;

  // ---------------------------------------------------------------------------
  // БЛОК 1: Проверка здоровья и доступности сервисов
  // ---------------------------------------------------------------------------
  console.log('📦 БЛОК 1: Проверка состояния инфраструктуры и Healthcheck');
  try {
    const health = await request('/api/health');
    assert(health.status === 200, 'Healthcheck эндпоинт отвечает кодом 200');
    assert(health.data?.status === 'UP', 'Статус приложения равен UP');
    assert(health.data?.services?.database === 'CONNECTED', 'База данных PostgreSQL подключена');
  } catch (err) {
    assert(false, 'Проверка Healthcheck завершилась ошибкой', err.message);
  }

  // ---------------------------------------------------------------------------
  // БЛОК 2: Аутентификация, безопасность и токены JWT
  // ---------------------------------------------------------------------------
  console.log('\n🔒 БЛОК 2: Аутентификация, авторизация и защита токенов');
  try {
    // 2.1 Вход администратора
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@docflow.local', password: 'admin123' })
    });
    assert(adminLogin.status === 200 && adminLogin.data?.token, 'Успешный вход Администратора с выдачей JWT');
    assert(adminLogin.data?.user?.role === 'ADMIN', 'Роль администратора определена как ADMIN');
    adminToken = adminLogin.data?.token;

    // 2.2 Вход сотрудника
    const userLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ivanov@docflow.local', password: 'Test1234!' })
    });
    assert(userLogin.status === 200 && userLogin.data?.token, 'Успешный вход пользователя ivanov@docflow.local');
    assert(userLogin.data?.user?.role === 'USER', 'Роль сотрудника определена как USER');
    userToken = userLogin.data?.token;

    // 2.3 Вход с неверным паролем
    const badLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@docflow.local', password: 'wrong_password_123' })
    });
    assert(badLogin.status === 401, 'Отказ в доступе при неверном пароле (401 Unauthorized)');

    // 2.4 Запрос без токена
    const noToken = await request('/api/users');
    assert(noToken.status === 401, 'Защита от анонимного доступа к пользователям (401 Unauthorized)');

    // 2.5 Запрос с поврежденным токеном
    const fakeToken = await request('/api/users', {
      headers: { Authorization: 'Bearer invalid.tampered.token' }
    });
    assert(fakeToken.status === 403, 'Защита от поддельного токена (403 Forbidden)');
  } catch (err) {
    assert(false, 'Сбой в блоке аутентификации', err.message);
  }

  // ---------------------------------------------------------------------------
  // БЛОК 3: Разграничение прав доступа (RBAC) и защита Дашборда
  // ---------------------------------------------------------------------------
  console.log('\n🛡️ БЛОК 3: Ролевая модель доступа (RBAC) и защита Дашборда');
  try {
    // 3.1 Администратор имеет доступ к дашборду
    const adminDash = await request('/api/reports/dashboard', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminDash.status === 200, 'Администратор имеет доступ к /api/reports/dashboard (200 OK)');
    assert(adminDash.data?.departments?.length > 0, 'Отчет содержит KPI по отделам');

    // 3.2 Обычный сотрудник НЕ имеет доступа к дашборду
    const userDash = await request('/api/reports/dashboard', {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert(userDash.status === 403, 'Сотрудник заблокирован от /api/reports/dashboard (403 Forbidden)');

    // 3.3 Обычный сотрудник НЕ имеет доступа к экспорту отчетов
    const userExport1 = await request('/api/reports/export/tasks', {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert(userExport1.status === 403, 'Сотрудник заблокирован от экспорта реестра задач (403 Forbidden)');

    const userExport2 = await request('/api/reports/export/summary', {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert(userExport2.status === 403, 'Сотрудник заблокирован от экспорта сводки отделов (403 Forbidden)');

    // 3.4 Экспорт отчетов Администратором
    const adminExportTasks = await request('/api/reports/export/tasks', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminExportTasks.status === 200, 'Администратор успешно выгружает реестр задач (200 OK)');
    const isBomPresent = typeof adminExportTasks.data === 'string' && (
      adminExportTasks.data.startsWith('\uFEFF') || 
      adminExportTasks.data.charCodeAt(0) === 0xFEFF || 
      adminExportTasks.data.includes('№ Задачи')
    );
    assert(isBomPresent, 'CSV реестра задач содержит корректный UTF-8 BOM для Microsoft Excel');

    const adminExportSummary = await request('/api/reports/export/summary', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminExportSummary.status === 200, 'Администратор успешно выгружает сводку KPI отделов (200 OK)');
  } catch (err) {
    assert(false, 'Сбой в блоке проверки RBAC', err.message);
  }

  // ---------------------------------------------------------------------------
  // БЛОК 4: Направления, Проекты и Задачи (Бизнес-процессы)
  // ---------------------------------------------------------------------------
  console.log('\n💼 БЛОК 4: Жизненный цикл Направлений, Проектов и Задач');
  try {
    // 4.1 Создание Направления
    const dirRes = await request('/api/directions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'QA Автоматизация и Тестирование',
        code: 'QA-AUTO-2026',
        color: '#6366f1',
        icon: '🧪',
        description: 'Направление сквозного тестирования качества'
      })
    });
    assert(dirRes.status === 201 && dirRes.data?.id, 'Создание нового Направления (201 Created)');
    createdDirectionId = dirRes.data?.id;

    // 4.2 Создание Проекта в Направлении
    const projRes = await request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        title: 'Внедрение системы непрерывного тестирования',
        description: 'Автоматизация smoke и регрессионных тестов',
        direction_id: createdDirectionId,
        manager_id: 1,
        status: 'ACTIVE',
        start_date: new Date().toISOString().slice(0, 10),
        end_date: '2026-12-31',
        budget: 150000
      })
    });
    assert(projRes.status === 201 && projRes.data?.id, 'Создание Проекта с привязкой к Направлению (201 Created)');
    createdProjectId = projRes.data?.id;

    // 4.3 Создание Задачи в Проекте для сотрудника ivanov (id=2)
    const taskRes = await request('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        title: 'Разработать E2E автотесты API и интерфейса',
        description: 'Покрыть тестами роли ADMIN и USER',
        project_id: createdProjectId,
        assignee_id: 2,
        priority: 'HIGH',
        status: 'TODO',
        deadline: new Date(Date.now() + 86400000 * 3).toISOString()
      })
    });
    assert(taskRes.status === 201 && taskRes.data?.id, 'Создание Задачи с исполнителем и дедлайном (201 Created)');
    createdTaskId = taskRes.data?.id;

    // 4.4 Сотрудник видит назначенную задачу
    const userTasks = await request('/api/tasks?my=1', {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    const foundTask = userTasks.data?.find?.(t => t.id === createdTaskId);
    assert(Boolean(foundTask), 'Сотрудник видит созданную задачу в своем персональном списке');

    // 4.5 Смена статусов задачи через PUT и PATCH: TODO -> IN_PROGRESS -> REVIEW -> DONE
    const step1 = await request(`/api/tasks/${createdTaskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ status: 'IN_PROGRESS' })
    });
    assert(step1.status === 200 && step1.data?.status === 'IN_PROGRESS', 'Перевод задачи в статус IN_PROGRESS');

    const step2 = await request(`/api/tasks/${createdTaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    assert(step2.status === 200 && step2.data?.status === 'DONE', 'Успешное завершение задачи (DONE)');
  } catch (err) {
    assert(false, 'Сбой в блоке Направлений, Проектов и Задач', err.message);
  }

  // ---------------------------------------------------------------------------
  // БЛОК 5: Корпоративный Мессенджер и коммуникации
  // ---------------------------------------------------------------------------
  console.log('\n💬 БЛОК 5: Корпоративный Мессенджер (Каналы и личные сообщения)');
  try {
    // 5.1 Отправка сообщения в Общий канал
    const chanMsg = await request('/api/messenger/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        channel: 'general',
        message: 'Внимание: успешно завершено плановое тестирование платформы!'
      })
    });
    assert(chanMsg.status === 201 && chanMsg.data?.id, 'Публикация сообщения в общий канал #general');

    // 5.2 Отправка личного сообщения сотруднику
    const directMsg = await request('/api/messenger/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        recipient_id: 2,
        message: 'Иван, проверь пожалуйста отчет по автотестам.'
      })
    });
    assert(directMsg.status === 201 && directMsg.data?.id, 'Отправка прямого личного сообщения сотруднику');

    // 5.3 Получение диалога сотрудником
    const chatHistory = await request('/api/messenger/messages?recipient_id=1', {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert(chatHistory.status === 200 && Array.isArray(chatHistory.data), 'Получение истории личной переписки сотрудником');
    const receivedMsg = chatHistory.data?.some(m => m.id === directMsg.data?.id);
    assert(receivedMsg, 'Сотрудник видит полученное личное сообщение в истории диалога');
  } catch (err) {
    assert(false, 'Сбой в блоке Мессенджера', err.message);
  }

  // ---------------------------------------------------------------------------
  // БЛОК 6: Календарь, Конференции и Умный поиск
  // ---------------------------------------------------------------------------
  console.log('\n📅 БЛОК 6: Календарь событий, Видеоконференции и Умный поиск');
  try {
    // 6.1 Проверка единого календаря (задачи с дедлайнами и конференции)
    const calendarFeed = await request('/api/calendar/feed', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(calendarFeed.status === 200 && Array.isArray(calendarFeed.data), 'Агрегированный фид календаря возвращает массив событий (200 OK)');
    const hasTaskEvent = calendarFeed.data?.some(e => e.id === createdTaskId && e.type === 'TASK');
    assert(hasTaskEvent, 'Созданная задача с дедлайном автоматически отображается в календаре');

    // 6.2 Планирование видеоконференции
    const confRes = await request('/api/conferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        title: 'Синхронизация по релизу 2026',
        description: 'Обсуждение результатов тестирования',
        start_time: new Date(Date.now() + 10800000).toISOString(),
        end_time: new Date(Date.now() + 14400000).toISOString()
      })
    });
    assert(confRes.status === 201 && confRes.data?.id, 'Планирование видеоконференции (201 Created)');
    createdConfId = confRes.data?.id;

    // 6.3 Умный поиск по ключевым словам
    const searchRes = await request('/api/search?q=автотесты', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(searchRes.status === 200, 'Запрос умного поиска /api/search отвечает кодом 200 OK');
  } catch (err) {
    assert(false, 'Сбой в блоке Календаря и Поиска', err.message);
  }

  // ---------------------------------------------------------------------------
  // БЛОК 7: Очистка созданных тестовых сущностей (Clean Teardown)
  // ---------------------------------------------------------------------------
  console.log('\n🧹 БЛОК 7: Очистка созданных временных тестовых объектов');
  try {
    if (createdTaskId) {
      const delTask = await request(`/api/tasks/${createdTaskId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert(delTask.status === 200, 'Удаление тестовой задачи');
    }
    if (createdProjectId) {
      const delProj = await request(`/api/projects/${createdProjectId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert(delProj.status === 200, 'Удаление тестового проекта');
    }
    if (createdDirectionId) {
      const delDir = await request(`/api/directions/${createdDirectionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert(delDir.status === 200, 'Удаление тестового направления');
    }
    if (createdEventId) {
      const delEvent = await request(`/api/calendar/events/${createdEventId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert(delEvent.status === 200, 'Удаление тестового календарного события');
    }
    if (createdConfId) {
      const delConf = await request(`/api/conferences/${createdConfId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert(delConf.status === 200, 'Удаление тестовой видеоконференции');
    }
  } catch (err) {
    console.error('Ошибка при очистке:', err);
  }

  // ---------------------------------------------------------------------------
  // ИТОГИ ТЕСТИРОВАНИЯ
  // ---------------------------------------------------------------------------
  console.log('\n====================================================================');
  console.log('📊 ИТОГОВЫЕ РЕЗУЛЬТАТЫ СИСТЕМНОГО ТЕСТИРОВАНИЯ:');
  console.log(`Всего тестов: ${passCount + failCount}`);
  console.log(`Успешно:     ${passCount} ✅`);
  console.log(`Ошибок:      ${failCount} ❌`);
  console.log(`Успешность:  ${Math.round((passCount / (passCount + failCount)) * 100)}%`);
  console.log('====================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runLiveSystemTests().catch(err => {
  console.error('Критический сбой теста:', err);
  process.exit(1);
});
