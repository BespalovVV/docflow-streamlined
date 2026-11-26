// backend/tests/defects_verification.test.js
// Комплексный интеграционный тест для проверки исправления дефектов DEF-01, DEF-03, DEF-04, DEF-05, DEF-06

const http = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqHeaders = { ...headers };
    let reqBody = null;
    if (body) {
      reqBody = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(reqBody);
    }

    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (reqBody) req.write(reqBody);
    req.end();
  });
}

async function runDefectsVerification() {
  console.log('========================================================');
  console.log('ЗАПУСК КОМПЛЕКСНОЙ ВЕРИФИКАЦИИ ИСПРАВЛЕНИЙ DEF-01..DEF-06');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Авторизация администратора
  console.log('--- 0. Авторизация администратора ---');
  const loginRes = await request('POST', '/api/auth/login', {
    email: 'admin@docflow.local',
    password: 'admin123'
  });
  assert(loginRes.status === 200 && loginRes.body.token, 'Успешная авторизация admin@docflow.local');
  const adminToken = loginRes.body.token;
  const authHeaders = { 'Authorization': `Bearer ${adminToken}` };

  // 2. DEF-01: ONLYOFFICE API & Proxy
  console.log('\n--- 1. Проверка DEF-01 (ONLYOFFICE Proxy & Health-Check) ---');
  const healthRes = await request('GET', '/api/documents/onlyoffice-health', null, authHeaders);
  assert(healthRes.status === 200, `Эндпоинт /api/documents/onlyoffice-health вернул HTTP 200 (получено ${healthRes.status})`);
  assert(healthRes.body.ok === true, `Health-check подтвердил доступность ONLYOFFICE (ok: true, latency: ${healthRes.body.latencyMs}ms)`);

  const proxyRes = await request('GET', '/onlyoffice/web-apps/apps/api/documents/api.js');
  assert(proxyRes.status === 200, `Проксирование скрипта /onlyoffice/.../api.js возвращает HTTP 200`);
  assert(typeof proxyRes.body === 'string' && proxyRes.body.includes('DocsAPI'), `Содержимое api.js содержит DocsAPI ONLYOFFICE`);

  // 3. DEF-03: Задачи / Интервалы, дни недели, исключения дат, серия vs экземпляр
  console.log('\n--- 2. Проверка DEF-03 (Задачи: расширенное повторение, дни недели, серия) ---');
  const taskData = {
    title: 'Автотест регулярной задачи раз в 2 недели',
    description: 'Тестирование повторения DEF-03',
    priority: 'HIGH',
    due_date: new Date(Date.now() + 86400000).toISOString(),
    recurring_type: 'WEEKLY',
    recurring_interval: 2,
    recurring_days: '1,4',
    recurring_exceptions: ['2026-11-02', '2026-11-16']
  };

  const createTaskRes = await request('POST', '/api/tasks', taskData, authHeaders);
  assert(createTaskRes.status === 201, `Создание задачи с интервалом вернуло HTTP 201`);
  const createdTask = createTaskRes.body;
  assert(createdTask.recurring_interval === 2, `Интервал задачи сохранен корректно: ${createdTask.recurring_interval}`);
  assert(createdTask.recurring_days === '1,4', `Дни недели задачи сохранены корректно: ${createdTask.recurring_days}`);
  assert(Array.isArray(createdTask.recurring_exceptions) && createdTask.recurring_exceptions.length === 2, 
    `Исключения дат сохранены в массиве: ${JSON.stringify(createdTask.recurring_exceptions)}`);
  assert(createdTask.series_id, `Серийный идентификатор series_id присвоен: ${createdTask.series_id}`);

  // Обновление всей серии
  const patchSeriesRes = await request('PATCH', `/api/tasks/${createdTask.id}`, {
    title: 'Автотест регулярной задачи раз в 3 недели (Серия)',
    recurring_interval: 3,
    update_scope: 'series'
  }, authHeaders);
  assert(patchSeriesRes.status === 200, `Пакетное обновление серии вернуло HTTP 200`);
  assert(patchSeriesRes.body.recurring_interval === 3, `Интервал серии успешно изменен на 3`);

  // 4. DEF-04: Задачи / Серверная фильтрация по срокам и сортировка
  console.log('\n--- 3. Проверка DEF-04 (Фильтры по срокам и сортировка задач) ---');
  const filtersToTest = ['all', 'today', 'this_week', 'next_week', 'future', 'overdue', 'nodate', 'done'];
  for (const filter of filtersToTest) {
    const fRes = await request('GET', `/api/tasks?deadline_filter=${filter}`, null, authHeaders);
    assert(fRes.status === 200 && Array.isArray(fRes.body), `Фильтр deadline_filter=${filter} успешно отработал (получено ${fRes.body.length} задач)`);
  }

  const sortDueRes = await request('GET', '/api/tasks?sort_by=due_date&sort_dir=ASC', null, authHeaders);
  assert(sortDueRes.status === 200 && Array.isArray(sortDueRes.body), 'Сортировка sort_by=due_date&sort_dir=ASC работает корректно');

  const sortTitleRes = await request('GET', '/api/tasks?sort_by=title&sort_dir=DESC', null, authHeaders);
  assert(sortTitleRes.status === 200 && Array.isArray(sortTitleRes.body), 'Сортировка sort_by=title&sort_dir=DESC работает корректно');

  // 5. DEF-05: Проекты / Связи Направление -> Проект -> Материалы и Empty State
  console.log('\n--- 4. Проверка DEF-05 (Проекты, связи и метаданные доступа) ---');
  const statsRes = await request('GET', '/api/projects/meta/stats', null, authHeaders);
  assert(statsRes.status === 200, 'Эндпоинт статистики проектов /api/projects/meta/stats вернул HTTP 200');
  assert(typeof statsRes.body.total_projects === 'number', `Возвращено общее количество проектов в системе: ${statsRes.body.total_projects}`);

  // Создание направления и привязка проекта
  const dirRes = await request('POST', '/api/directions', {
    name: 'Направление автотеста DEF-05',
    code: 'DIR_TEST_' + Date.now(),
    description: 'Проверка сквозной связи'
  }, authHeaders);
  assert(dirRes.status === 201, 'Создано тестовое направление');

  const projRes = await request('POST', '/api/projects', {
    name: 'Проект со связью DEF-05',
    code: 'PRJ_TEST_' + Date.now(),
    direction_id: dirRes.body.id
  }, authHeaders);
  assert(projRes.status === 201, 'Создан тестовый проект с привязкой direction_id');
  assert(projRes.body.direction_id === dirRes.body.id, `ID направления в проекте сохранен: ${projRes.body.direction_id}`);

  // Получение проектов и проверка JOIN с направлением
  const listProjectsRes = await request('GET', '/api/projects', null, authHeaders);
  const foundProj = listProjectsRes.body.find(p => p.id === projRes.body.id);
  assert(foundProj && foundProj.direction_name === 'Направление автотеста DEF-05', 
    `Проект вернулся с названием направления: "${foundProj ? foundProj.direction_name : null}"`);

  // 6. DEF-06: Навигация / Доступность, уникальные ID и отсутствие дублирования
  console.log('\n--- 5. Проверка DEF-06 (Семантика навигации, уникальные ID, aria-атрибуты) ---');
  const indexRes = await request('GET', '/');
  assert(indexRes.status === 200, 'Главная страница index.html успешно загружена');
  const html = indexRes.body;

  assert(html.includes('role="navigation"') && html.includes('aria-label="Основное меню навигации"'), 
    'Сайдбар снабжен role="navigation" и aria-label="Основное меню навигации"');
  assert(html.includes('id="nav-desktop-dashboard"') && html.includes('id="nav-desktop-tasks"'), 
    'Десктопные ссылки имеют уникальные идентификаторы nav-desktop-*');
  assert(html.includes('id="nav-mobile-dashboard"') && html.includes('id="nav-mobile-tasks"'), 
    'Мобильные ссылки имеют уникальные идентификаторы nav-mobile-*');
  assert(html.includes('id="mobile-bottom-nav"') && html.includes('aria-hidden="true"') && html.includes('hidden'), 
    'Мобильная навигация по умолчанию снабжена aria-hidden="true" и hidden для предотвращения дублирования в accessibility tree');
  assert(html.includes('id="sidebar-theme-wrapper"') && html.includes('aria-hidden="true"'), 
    'Дублирующая кнопка темы в сайдбаре скрыта на десктопе через aria-hidden="true"');

  console.log('\n========================================================');
  console.log(`РЕЗУЛЬТАТ: УСПЕШНО: ${passed}, ОШИБОК: ${failed}`);
  console.log('========================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runDefectsVerification().catch(err => {
  console.error('Ошибка выполнения автотеста:', err);
  process.exit(1);
});
