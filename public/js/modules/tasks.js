// public/js/modules/tasks.js
window.TasksModule = (function() {
  let taskScopeFilter = 'all'; // 'all' | 'my' | 'subordinates' | 'created_by_me'
  let taskProjectFilter = 'ALL';
  let taskDeadlineFilter = 'all'; // 'all' | 'overdue' | 'today' | 'this_week' | 'next_week' | 'future' | 'nodate' | 'done'
  let taskSortBy = 'created_at'; // 'created_at' | 'deadline' | 'priority' | 'title' | 'status' | 'assignee'
  let taskSortDir = 'DESC'; // 'ASC' | 'DESC'
  let taskSearchQuery = '';
  let taskPage = 1;
  let taskPageSize = 15;
  let taskViewMode = localStorage.getItem('docflow_task_view_mode') || 'table'; // 'grid' | 'table' (DEF-11: по умолчанию строкой как в Битрикс24)

  const weekDayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  function updateHeaderAndActions() {
    AppState.setHeader('Задачи и поручения', 'Контроль исполнения регламентов, проектных задач и поручений подчинённым');

    AppState.setTopBarActions(`
      <button class="btn btn-primary" id="btn-create-task">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>Создать задачу</span>
      </button>
    `);
    document.getElementById('btn-create-task')?.addEventListener('click', () => openTaskModal());
  }

  async function render(containerEl) {
    updateHeaderAndActions();
    const currentUser = AppState.getCurrentUser();
    const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin';

    containerEl.innerHTML = `
      <div class="card" style="padding: 10px 16px; margin-bottom: 20px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px;">
        <span style="font-size: 12px; font-weight: 600; color: var(--text-muted); margin-right: 6px;">Загрузка фильтров и задач...</span>
      </div>
      <div class="tasks-grid">
        <div class="skeleton-card" style="min-height: 220px;"></div>
        <div class="skeleton-card" style="min-height: 220px;"></div>
        <div class="skeleton-card" style="min-height: 220px;"></div>
      </div>
    `;

    try {
      const [tasks, projects, subordinates] = await Promise.all([
        API.getTasks({
          scope: taskScopeFilter !== 'all' ? taskScopeFilter : undefined,
          deadline_filter: taskDeadlineFilter !== 'all' ? taskDeadlineFilter : undefined,
          sort_by: taskSortBy,
          sort_dir: taskSortDir
        }),
        API.getProjects(),
        !isAdmin ? API.getSubordinates().catch(() => []) : Promise.resolve([])
      ]);

      const currentUserId = currentUser ? parseInt(currentUser.id, 10) : 0;
      const subordinateIds = Array.isArray(subordinates) ? subordinates.map(s => s.id) : [];
      const hasSubordinates = subordinateIds.length > 0;

      // Filter Bar HTML (DEF-04: Поиск, сроки, сортировка, режимы)
      const filterBarHtml = `
        <div class="card" style="padding: 14px 16px; margin-bottom: 20px; display: flex; flex-direction: column; gap: 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px;">
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <div class="list-toolbar-search">
              <input type="text" id="task-search-input" class="list-search-input" placeholder="Поиск по названию, описанию, исполнителю или проекту..." value="${AppState.escapeHtml(taskSearchQuery)}" autocomplete="off">
            </div>
            <span id="tasks-count-badge" class="badge badge-subtle" style="font-size: 12px;">${tasks.length}</span>
          </div>

          <!-- 1. SCOPE FILTERS (Иерархия и область видимости) -->
          <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            <span style="font-size: 12px; font-weight: 700; color: var(--text-muted); min-width: 60px;">Область:</span>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="btn btn-sm ${taskScopeFilter === 'all' ? 'btn-primary' : 'btn-secondary'} task-scope-filter-btn" data-scope="all">
                Все доступные (${tasks.length})
              </button>
              <button class="btn btn-sm ${taskScopeFilter === 'my' ? 'btn-primary' : 'btn-secondary'} task-scope-filter-btn" data-scope="my">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-target"/></svg> Мои задачи
              </button>
              ${(hasSubordinates || isAdmin) ? `
                <button class="btn btn-sm ${taskScopeFilter === 'subordinates' ? 'btn-primary' : 'btn-secondary'} task-scope-filter-btn" data-scope="subordinates">
                  <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-users"/></svg> Задачи подчинённых ${subordinateIds.length > 0 ? `(${subordinateIds.length} сотр.)` : ''}
                </button>
              ` : ''}
              <button class="btn btn-sm ${taskScopeFilter === 'created_by_me' ? 'btn-primary' : 'btn-secondary'} task-scope-filter-btn" data-scope="created_by_me">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-file-edit"/></svg> Порученные мной
              </button>
            </div>
          </div>

          <!-- 2. DEADLINE FILTERS (DEF-04: Фильтры по срокам) -->
          <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; border-top: 1px solid var(--border-color); padding-top: 10px;">
            <span style="font-size: 12px; font-weight: 700; color: var(--text-muted); min-width: 60px;">Сроки:</span>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="btn btn-sm ${taskDeadlineFilter === 'all' ? 'btn-primary' : 'btn-secondary'} task-deadline-filter-btn" data-deadline="all">
                Все сроки
              </button>
              <button class="btn btn-sm ${taskDeadlineFilter === 'overdue' ? 'btn-danger' : 'btn-secondary'} task-deadline-filter-btn" data-deadline="overdue" title="Срок истёк, задача не завершена">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clock"/></svg> Просроченные
              </button>
              <button class="btn btn-sm ${taskDeadlineFilter === 'today' ? 'btn-primary' : 'btn-secondary'} task-deadline-filter-btn" data-deadline="today">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-sun"/></svg> Сегодня
              </button>
              <button class="btn btn-sm ${taskDeadlineFilter === 'this_week' ? 'btn-primary' : 'btn-secondary'} task-deadline-filter-btn" data-deadline="this_week">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-calendar"/></svg> На этой неделе
              </button>
              <button class="btn btn-sm ${taskDeadlineFilter === 'next_week' ? 'btn-primary' : 'btn-secondary'} task-deadline-filter-btn" data-deadline="next_week">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-calendar"/></svg> На следующей неделе
              </button>
              <button class="btn btn-sm ${taskDeadlineFilter === 'future' ? 'btn-primary' : 'btn-secondary'} task-deadline-filter-btn" data-deadline="future">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-rocket"/></svg> В будущем
              </button>
              <button class="btn btn-sm ${taskDeadlineFilter === 'nodate' ? 'btn-primary' : 'btn-secondary'} task-deadline-filter-btn" data-deadline="nodate">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-infinity"/></svg> Бессрочные
              </button>
              <button class="btn btn-sm ${taskDeadlineFilter === 'done' ? 'btn-primary' : 'btn-secondary'} task-deadline-filter-btn" data-deadline="done">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-check-circle"/></svg> Завершённые
              </button>
            </div>
          </div>

          <!-- 3. PROJECT, SORTING & VIEW MODE CONTROLS -->
          <div style="display: flex; gap: 14px; flex-wrap: wrap; align-items: center; justify-content: space-between; border-top: 1px solid var(--border-color); padding-top: 10px;">
            <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
              <!-- Project selector -->
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 12px; font-weight: 600; color: var(--text-muted);">Проект:</span>
                <select id="task-filter-project" style="padding: 5px 10px; font-size: 12px; border-radius: 6px; max-width: 240px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color);">
                  <option value="ALL" ${taskProjectFilter === 'ALL' ? 'selected' : ''}>Все проекты</option>
                  <option value="NONE" ${taskProjectFilter === 'NONE' ? 'selected' : ''}>Без проекта (автономные)</option>
                  ${projects.map(p => `
                    <option value="${p.id}" ${taskProjectFilter == p.id ? 'selected' : ''}>${AppState.escapeHtml(p.title)}</option>
                  `).join('')}
                </select>
              </div>

              <!-- Sorting selector -->
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 12px; font-weight: 600; color: var(--text-muted);">Сортировка:</span>
                <select id="task-sort-by" style="padding: 5px 10px; font-size: 12px; border-radius: 6px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color);">
                  <option value="created_at" ${taskSortBy === 'created_at' ? 'selected' : ''}>По дате создания</option>
                  <option value="deadline" ${taskSortBy === 'deadline' ? 'selected' : ''}>По сроку (дедлайн)</option>
                  <option value="priority" ${taskSortBy === 'priority' ? 'selected' : ''}>По приоритету</option>
                  <option value="title" ${taskSortBy === 'title' ? 'selected' : ''}>По названию</option>
                  <option value="status" ${taskSortBy === 'status' ? 'selected' : ''}>По статусу</option>
                  <option value="assignee" ${taskSortBy === 'assignee' ? 'selected' : ''}>По исполнителю</option>
                </select>
                <button class="btn btn-secondary btn-sm" id="btn-toggle-sort-dir" title="Направление сортировки" style="padding: 4px 8px; font-size: 12px;">
                  ${taskSortDir === 'ASC' ? '▲ Возр.' : '▼ Убыв.'}
                </button>
              </div>
            </div>

            <!-- View Mode Switcher (Grid vs Table) -->
            <div style="display: inline-flex; background: var(--bg-subtle); padding: 2px; border-radius: 6px; border: 1px solid var(--border-color);">
              <button class="btn btn-sm ${taskViewMode === 'grid' ? 'btn-primary' : 'btn-secondary'}" id="btn-view-grid" style="padding: 4px 10px; font-size: 12px; ${taskViewMode === 'grid' ? '' : 'background: transparent; border-color: transparent; color: var(--text-muted);'}">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folders"/></svg> Карточки
              </button>
              <button class="btn btn-sm ${taskViewMode === 'table' ? 'btn-primary' : 'btn-secondary'}" id="btn-view-table" style="padding: 4px 10px; font-size: 12px; ${taskViewMode === 'table' ? '' : 'background: transparent; border-color: transparent; color: var(--text-muted);'}">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-files"/></svg> Таблица
              </button>
            </div>
          </div>
        </div>
      `;

      containerEl.innerHTML = `
        ${filterBarHtml}
        <div id="tasks-list-mount"></div>
      `;

      const renderTasksList = () => {
        const mountEl = containerEl.querySelector('#tasks-list-mount');
        if (!mountEl) return;

        const q = (taskSearchQuery || '').toLowerCase().trim();
        const filteredTasks = tasks.filter(t => {
          if (taskProjectFilter !== 'ALL') {
            if (taskProjectFilter === 'NONE') {
              if (t.project_id) return false;
            } else if (parseInt(t.project_id, 10) !== parseInt(taskProjectFilter, 10)) {
              return false;
            }
          }
          if (q) {
            const hay = `${t.title || ''} ${t.description || ''} ${t.assignee_name || ''} ${t.creator_name || ''} ${t.project_title || ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

        const countBadge = containerEl.querySelector('#tasks-count-badge');
        if (countBadge) countBadge.textContent = `Найдено: ${filteredTasks.length}`;

        if (filteredTasks.length === 0) {
          mountEl.innerHTML = `
            <div class="card" style="text-align: center; padding: 40px;">
              <div style="font-size: 40px; margin-bottom: 12px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-clipboard'/></svg></div>
              <h3 style="font-size: 16px; font-weight: 600; color: var(--text-main); margin-bottom: 8px;">
                Задачи не найдены
              </h3>
              <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 20px;">
                ${q
                  ? `По запросу «${AppState.escapeHtml(taskSearchQuery)}» задачи не найдены.`
                  : taskDeadlineFilter !== 'all'
                    ? 'Нет задач, соответствующих выбранному сроку или фильтрам.'
                    : taskScopeFilter === 'my'
                      ? 'У вас нет назначенных задач в выбранной категории.'
                      : taskScopeFilter === 'subordinates'
                        ? 'У ваших подчинённых сотрудников нет активных задач.'
                        : 'Нет задач, соответствующих выбранным параметрам поиска.'}
              </p>
              <button class="btn btn-primary" id="btn-empty-create-task">+ Создать задачу</button>
            </div>
          `;
          mountEl.querySelector('#btn-empty-create-task')?.addEventListener('click', () => openTaskModal());
          return;
        }

        const pg = AppState.paginate(filteredTasks, taskPage, taskPageSize);
        taskPage = pg.page;
        const pageItems = pg.items;

        let tasksContentHtml = '';
        if (taskViewMode === 'grid') {
          tasksContentHtml = `
            <div class="tasks-grid">
              ${pageItems.map(t => renderTaskCard(t, currentUserId, subordinateIds, isAdmin)).join('')}
            </div>
          `;
        } else {
          tasksContentHtml = `
            <div class="tasks-table-container">
              <table class="tasks-table bitrix-style-table">
                <thead>
                  <tr>
                    <th style="width: 42px; text-align: center;" title="Отметить выполненной">✓</th>
                    <th class="sortable" data-sort="title">Задача ${taskSortBy === 'title' ? (taskSortDir === 'ASC' ? '▲' : '▼') : ''}</th>
                    <th class="sortable" data-sort="deadline" style="width: 150px;">Крайний срок ${taskSortBy === 'deadline' ? (taskSortDir === 'ASC' ? '▲' : '▼') : ''}</th>
                    <th class="sortable" data-sort="assignee" style="width: 170px;">Ответственный ${taskSortBy === 'assignee' ? (taskSortDir === 'ASC' ? '▲' : '▼') : ''}</th>
                    <th style="width: 150px;">Постановщик</th>
                    <th class="sortable" data-sort="status" style="width: 130px;">Статус ${taskSortBy === 'status' ? (taskSortDir === 'ASC' ? '▲' : '▼') : ''}</th>
                    <th class="sortable" data-sort="priority" style="width: 90px;">Приоритет ${taskSortBy === 'priority' ? (taskSortDir === 'ASC' ? '▲' : '▼') : ''}</th>
                    <th style="width: 75px; text-align: center;">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  ${pageItems.map(t => renderTaskTableRow(t, currentUserId, subordinateIds, isAdmin)).join('')}
                </tbody>
              </table>
            </div>
          `;
        }

        mountEl.innerHTML = tasksContentHtml + AppState.renderPaginationHtml(pg, { pageSizeOptions: [10, 15, 30, 50] });

        mountEl.querySelectorAll('.tasks-table th.sortable').forEach(th => {
          th.addEventListener('click', () => {
            const sortField = th.getAttribute('data-sort');
            if (taskSortBy === sortField) {
              taskSortDir = taskSortDir === 'ASC' ? 'DESC' : 'ASC';
            } else {
              taskSortBy = sortField;
              taskSortDir = 'ASC';
            }
            taskPage = 1;
            render(containerEl);
          });
        });

        AppState.bindPaginationEvents(mountEl, {
          onPageChange: (p) => { taskPage = p; renderTasksList(); },
          onPageSizeChange: (sz) => { taskPageSize = sz; taskPage = 1; renderTasksList(); }
        });

        bindTaskItemEvents(containerEl, tasks);
      };

      bindFilterEvents(containerEl, projects, renderTasksList);
      renderTasksList();

    } catch (err) {
      containerEl.innerHTML = `<div class="form-error">Ошибка загрузки задач: ${AppState.escapeHtml(err.message)}</div>`;
    }
  }

  function getRecurrenceLabel(t) {
    if (!t.is_recurring) return '';
    const interval = t.recurring_interval || 1;
    let typeLabel = '';
    if (t.recurring_type === 'DAILY') {
      typeLabel = interval === 1 ? 'Каждый день' : `Каждые ${interval} дн.`;
    } else if (t.recurring_type === 'WEEKLY') {
      typeLabel = interval === 1 ? 'Раз в неделю' : `Каждые ${interval} нед.`;
      if (t.recurring_days) {
        const daysArr = t.recurring_days.split(',').map(d => weekDayNames[parseInt(d, 10) - 1] || d);
        typeLabel += ` (${daysArr.join(', ')})`;
      }
    } else if (t.recurring_type === 'MONTHLY') {
      typeLabel = interval === 1 ? 'Раз в месяц' : `Каждые ${interval} мес.`;
    } else {
      typeLabel = 'Повтор';
    }

    if (t.recurring_exceptions && t.recurring_exceptions.length > 0) {
      typeLabel += ` [-${t.recurring_exceptions.length}]`;
    }

    return typeLabel;
  }

  function renderTaskCard(t, currentUserId, subordinateIds, isAdmin) {
    let badgeClass = 'badge-subtle';
    if (t.priority === 'HIGH') badgeClass = 'badge-danger';
    if (t.priority === 'MEDIUM') badgeClass = 'badge-warning';

    const recurringText = getRecurrenceLabel(t);
    let recurringBadge = '';
    if (recurringText) {
      recurringBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 11px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-refresh"/></svg> ${AppState.escapeHtml(recurringText)}</span>`;
    }

    let relationBadge = '';
    const isAssignedToMe = parseInt(t.assignee_id, 10) === currentUserId;
    const isCreatedByMe = parseInt(t.creator_id, 10) === currentUserId;
    const isSubordinateTask = t.assignee_id && subordinateIds.includes(parseInt(t.assignee_id, 10));

    if (isAssignedToMe) {
      relationBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 10px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-target"/></svg> Назначено мне</span>`;
    } else if (isSubordinateTask) {
      relationBadge = `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 10px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-users"/></svg> Подчинённый</span>`;
    } else if (isCreatedByMe) {
      relationBadge = `<span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #8b5cf6; border: 1px solid rgba(139, 92, 246, 0.3); font-size: 10px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-file-edit"/></svg> Автор</span>`;
    }

    const canManageTask = isAdmin || isCreatedByMe || isSubordinateTask;
    let deadlineColor = 'var(--text-main)';
    let deadlineStr = 'Бессрочно';
    if (t.deadline) {
      const d = new Date(t.deadline);
      const now = new Date();
      deadlineStr = d.toLocaleDateString('ru-RU');
      if (t.status !== 'DONE') {
        if (d < now) deadlineColor = 'var(--danger, #ef4444)';
        else if (d.toDateString() === now.toDateString()) deadlineColor = 'var(--warning, #f59e0b)';
      }
    }

    return `
      <div class="card task-card" style="display: flex; flex-direction: column; justify-content: space-between; border-radius: 8px;">
        <div>
          <div class="card-header" style="align-items: flex-start; gap: 8px; margin-bottom: 8px;">
            <span class="card-title" style="font-weight: 600; font-size: 14px; line-height: 1.3;">${AppState.escapeHtml(t.title)}</span>
            <span class="badge ${badgeClass}">${t.priority || 'MEDIUM'}</span>
          </div>

          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;">
            ${relationBadge}
            ${recurringBadge}
            ${t.project_title ? `<span class="badge badge-subtle" title="Проект"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder"/></svg> ${AppState.escapeHtml(t.project_title)}</span>` : '<span class="badge badge-subtle" style="opacity: 0.6;">Без проекта</span>'}
          </div>

          <p class="text-muted" style="font-size: 12.5px; margin-bottom: 12px; line-height: 1.4; max-height: 60px; overflow: hidden; text-overflow: ellipsis;">
            ${AppState.escapeHtml(t.description || 'Описание отсутствует')}
          </p>

          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; background: var(--bg-hover, rgba(255,255,255,0.03)); border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="display: flex; justify-content: space-between;">
              <span>Исполнитель:</span>
              <strong style="color: var(--text-main); font-size: 11px;">
                ${t.assignee_name ? `<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-user"/></svg> ${AppState.escapeHtml(t.assignee_name)}` : '<span class="text-muted">Не назначен</span>'}
              </strong>
            </div>
            ${t.creator_name ? `
              <div style="display: flex; justify-content: space-between;">
                <span>Поручил(а):</span>
                <span style="color: var(--text-main); font-size: 11px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-briefcase'/></svg> ${AppState.escapeHtml(t.creator_name)}</span>
              </div>
            ` : ''}
            <div style="display: flex; justify-content: space-between;">
              <span>Срок:</span>
              <strong style="color: ${deadlineColor}; font-size: 11px;">${deadlineStr}</strong>
            </div>
          </div>
        </div>

        <div style="border-top: 1px solid var(--border-color); padding-top: 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="flex: 1;">
            <select class="task-status-select" data-id="${t.id}" style="padding: 4px 8px; font-size: 12px; border-radius: 4px; width: 100%;">
              <option value="TODO" ${t.status === 'TODO' ? 'selected' : ''}>К исполнению</option>
              <option value="IN_PROGRESS" ${t.status === 'IN_PROGRESS' ? 'selected' : ''}>В работе</option>
              <option value="REVIEW" ${t.status === 'REVIEW' ? 'selected' : ''}>На проверке</option>
              <option value="DONE" ${t.status === 'DONE' ? 'selected' : ''}>Завершено</option>
            </select>
          </div>
          ${canManageTask ? `
            <button class="btn btn-secondary btn-sm edit-task-btn" data-id="${t.id}" title="Редактировать"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg></button>
            <button class="btn btn-secondary btn-sm delete-task-btn" data-id="${t.id}" title="Удалить" style="color: var(--danger);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-trash'/></svg></button>
          ` : ''}
        </div>
      </div>
    `;
  }

  function renderTaskTableRow(t, currentUserId, subordinateIds, isAdmin) {
    let badgeClass = 'badge-subtle';
    if (t.priority === 'HIGH') badgeClass = 'badge-danger';
    if (t.priority === 'MEDIUM') badgeClass = 'badge-warning';

    const canManageTask = isAdmin || parseInt(t.creator_id, 10) === currentUserId || (t.assignee_id && subordinateIds.includes(parseInt(t.assignee_id, 10)));
    const isDone = t.status === 'DONE';

    // Bitrix-style deadline badge formatting (DEF-11)
    let deadlineBadgeHtml = '<span class="text-muted" style="font-size: 11.5px;">Без срока</span>';
    if (t.deadline) {
      const d = new Date(t.deadline);
      const now = new Date();
      const timeStr = AppState.formatTimeRu(d);
      const dateStr = AppState.formatDateRu(d);
      
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const diffDays = Math.round((startOfTarget - startOfToday) / 86400000);

      if (isDone) {
        deadlineBadgeHtml = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-size: 11px; font-weight: 600;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-check-circle"/></svg> Завершена</span>`;
      } else if (diffDays < 0) {
        const daysPast = Math.abs(diffDays);
        deadlineBadgeHtml = `
          <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; font-size: 11px; font-weight: 700; border: 1px solid rgba(239, 68, 68, 0.3);">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clock"/></svg> ${daysPast === 1 ? 'Вчера' : `-${daysPast} дн.`} (${dateStr})
          </span>
        `;
      } else if (diffDays === 0) {
        deadlineBadgeHtml = `
          <span class="badge" style="background: rgba(245, 158, 11, 0.18); color: #f59e0b; font-size: 11px; font-weight: 700; border: 1px solid rgba(245, 158, 11, 0.3);">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-sun"/></svg> Сегодня, ${timeStr}
          </span>
        `;
      } else if (diffDays === 1) {
        deadlineBadgeHtml = `
          <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; font-size: 11px; font-weight: 600;">
            Завтра, ${timeStr}
          </span>
        `;
      } else {
        deadlineBadgeHtml = `
          <span style="font-size: 11.5px; color: var(--text-main); font-weight: 500;">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-calendar"/></svg> ${dateStr}
          </span>
        `;
      }
    }

    const recLabel = getRecurrenceLabel(t);
    const assigneeInitial = (t.assignee_name || 'U').trim().charAt(0).toUpperCase();
    const creatorInitial = (t.creator_name || 'A').trim().charAt(0).toUpperCase();

    return `
      <tr class="${isDone ? 'task-row-done' : ''}" style="transition: background 0.15s ease;">
        <td style="text-align: center; width: 42px;">
          <input type="checkbox" class="task-quick-toggle-done" data-id="${t.id}" ${isDone ? 'checked' : ''} title="${isDone ? 'Вернуть к исполнению' : 'Отметить задачу выполненной'}" style="width: 17px; height: 17px; cursor: pointer; accent-color: #10b981;">
        </td>
        <td>
          <div style="font-weight: 600; color: var(--text-main); font-size: 13px; ${isDone ? 'text-decoration: line-through; opacity: 0.6;' : ''}">
            ${AppState.escapeHtml(t.title)}
            ${recLabel ? `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; font-size: 9.5px; margin-left: 4px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-refresh"/></svg> ${AppState.escapeHtml(recLabel)}</span>` : ''}
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 1px;">
            ${t.project_title ? `<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder"/></svg> ${AppState.escapeHtml(t.project_title)}` : 'Без проекта'}
          </div>
        </td>
        <td>
          ${deadlineBadgeHtml}
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div style="width: 24px; height: 24px; border-radius: 50%; background: rgba(59,130,246,0.18); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0;">
              ${assigneeInitial}
            </div>
            <span style="font-size: 12px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px;" title="${AppState.escapeHtml(t.assignee_name || 'Не назначен')}">
              ${t.assignee_name ? AppState.escapeHtml(t.assignee_name) : '<span class="text-muted">Не назначен</span>'}
            </span>
          </div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div style="width: 22px; height: 22px; border-radius: 50%; background: var(--bg-subtle); color: var(--text-muted); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; border: 1px solid var(--border-color);">
              ${creatorInitial}
            </div>
            <span style="font-size: 11.5px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;" title="${AppState.escapeHtml(t.creator_name || '')}">
              ${t.creator_name ? AppState.escapeHtml(t.creator_name) : '—'}
            </span>
          </div>
        </td>
        <td>
          <select class="task-status-select" data-id="${t.id}" style="padding: 3px 6px; font-size: 11px; border-radius: 4px; width: 100%; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-main);">
            <option value="TODO" ${t.status === 'TODO' ? 'selected' : ''}>К исполнению</option>
            <option value="IN_PROGRESS" ${t.status === 'IN_PROGRESS' ? 'selected' : ''}>В работе</option>
            <option value="REVIEW" ${t.status === 'REVIEW' ? 'selected' : ''}>На проверке</option>
            <option value="DONE" ${t.status === 'DONE' ? 'selected' : ''}>Завершено</option>
          </select>
        </td>
        <td>
          <span class="badge ${badgeClass}" style="font-size: 10px; padding: 2px 6px;">${t.priority || 'MEDIUM'}</span>
        </td>
        <td style="text-align: center; white-space: nowrap;">
          ${canManageTask ? `
            <button class="btn btn-secondary btn-sm edit-task-btn" data-id="${t.id}" title="Редактировать" style="padding: 2px 6px; font-size: 11px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg></button>
            <button class="btn btn-secondary btn-sm delete-task-btn" data-id="${t.id}" title="Удалить" style="padding: 2px 6px; font-size: 11px; color: var(--danger);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-trash'/></svg></button>
          ` : '<span class="text-muted" style="font-size: 11px;">—</span>'}
        </td>
      </tr>
    `;
  }

  function bindFilterEvents(containerEl, projects, onLocalUpdate) {
    // Search input (no full re-render to keep focus)
    containerEl.querySelector('#task-search-input')?.addEventListener('input', (e) => {
      taskSearchQuery = e.target.value;
      taskPage = 1;
      if (typeof onLocalUpdate === 'function') onLocalUpdate();
    });

    // Scope filters
    containerEl.querySelectorAll('.task-scope-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        taskScopeFilter = btn.getAttribute('data-scope');
        taskPage = 1;
        render(containerEl);
      });
    });

    // Deadline filters
    containerEl.querySelectorAll('.task-deadline-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        taskDeadlineFilter = btn.getAttribute('data-deadline');
        taskPage = 1;
        render(containerEl);
      });
    });

    // Project filter
    containerEl.querySelector('#task-filter-project')?.addEventListener('change', (e) => {
      taskProjectFilter = e.target.value;
      taskPage = 1;
      if (typeof onLocalUpdate === 'function') onLocalUpdate();
      else render(containerEl);
    });

    // Sort By selector
    containerEl.querySelector('#task-sort-by')?.addEventListener('change', (e) => {
      taskSortBy = e.target.value;
      taskPage = 1;
      render(containerEl);
    });

    // Sort Dir toggle
    containerEl.querySelector('#btn-toggle-sort-dir')?.addEventListener('click', () => {
      taskSortDir = taskSortDir === 'ASC' ? 'DESC' : 'ASC';
      taskPage = 1;
      render(containerEl);
    });

    // View Mode switches
    containerEl.querySelector('#btn-view-grid')?.addEventListener('click', () => {
      taskViewMode = 'grid';
      localStorage.setItem('docflow_task_view_mode', 'grid');
      if (typeof onLocalUpdate === 'function') render(containerEl);
      else render(containerEl);
    });

    containerEl.querySelector('#btn-view-table')?.addEventListener('click', () => {
      taskViewMode = 'table';
      localStorage.setItem('docflow_task_view_mode', 'table');
      render(containerEl);
    });
  }

  function bindTaskItemEvents(containerEl, tasks) {
    // Quick checkbox completion (Bitrix24 style)
    containerEl.querySelectorAll('.task-quick-toggle-done').forEach(chk => {
      chk.addEventListener('change', async (e) => {
        const id = parseInt(e.target.getAttribute('data-id'), 10);
        const newStatus = e.target.checked ? 'DONE' : 'TODO';
        try {
          await API.updateTask(id, { status: newStatus });
          AppState.showAlert(newStatus === 'DONE' ? 'Задача выполнена <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-check-circle"/></svg>' : 'Задача возвращена в работу', 'success');
          AppState.emit('tasks-updated');
          render(containerEl);
        } catch (err) {
          alert('Ошибка обновления статуса: ' + err.message);
          render(containerEl);
        }
      });
    });

    // Status change
    containerEl.querySelectorAll('.task-status-select').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        const id = parseInt(e.target.getAttribute('data-id'), 10);
        const newStatus = e.target.value;
        try {
          await API.updateTask(id, { status: newStatus });
          AppState.showAlert('Статус задачи обновлен', 'success');
          AppState.emit('tasks-updated');
        } catch (err) {
          alert('Ошибка обновления статуса: ' + err.message);
          render(containerEl);
        }
      });
    });

    // Edit task
    containerEl.querySelectorAll('.edit-task-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const task = tasks.find(t => t.id === id);
        if (task) openTaskModal(task);
      });
    });

    // Delete task
    containerEl.querySelectorAll('.delete-task-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        AppState.showConfirmModal({
          title: 'Удаление задачи',
          message: 'Вы уверены, что хотите удалить эту задачу?',
          confirmText: 'Удалить',
          cancelText: 'Отмена',
          onConfirm: async () => {
            try {
              await API.deleteTask(id);
              AppState.showAlert('Задача удалена', 'success');
              AppState.emit('tasks-updated');
              render(containerEl);
            } catch (err) {
              alert('Ошибка удаления задачи: ' + err.message);
            }
          }
        });
      });
    });
  }

  // TASK MODAL WITH ADVANCED RECURRENCE (DEF-03)
  async function openTaskModal(taskToEdit = null, options = {}) {
    const isEdit = !!taskToEdit;
    AppState.setModalTitle(isEdit ? 'Редактировать задачу' : 'Создать новую задачу');

    const currentUser = AppState.getCurrentUser();
    const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin';

    const [projects, users, subordinates] = await Promise.all([
      API.getProjects(),
      API.getUsers(),
      !isAdmin ? API.getSubordinates().catch(() => []) : Promise.resolve([])
    ]);

    const subordinateIds = Array.isArray(subordinates) ? subordinates.map(s => s.id) : [];

    let initialDateStr = '';
    let initialTimeStr = '18:00';
    if (isEdit && taskToEdit.deadline) {
      const d = new Date(taskToEdit.deadline);
      initialDateStr = AppState.formatDateRu(d);
      initialTimeStr = AppState.formatTimeRu(d);
    } else if (options.defaultDate) {
      initialDateStr = AppState.formatDateRu(new Date(options.defaultDate));
      if (typeof options.defaultHour === 'number') {
        initialTimeStr = `${String(options.defaultHour).padStart(2, '0')}:00`;
      }
    }

    const selectedProjectId = options.defaultProjectId || (isEdit ? taskToEdit.project_id : '');

    let initialAssigneeId = currentUser ? currentUser.id : '';
    let initialAssigneeName = currentUser ? `${currentUser.full_name} (${currentUser.department || 'Я'})` : '';
    if (isEdit && taskToEdit.assignee_id) {
      initialAssigneeId = taskToEdit.assignee_id;
      const found = users.find(u => u.id === taskToEdit.assignee_id);
      initialAssigneeName = found ? `${found.full_name} (${found.department || 'Сотрудник'})` : (taskToEdit.assignee_name || '');
    }

    // Recurrence initial state
    const isRecurring = isEdit ? Boolean(taskToEdit.is_recurring) : false;
    const recurringType = isEdit ? (taskToEdit.recurring_type || 'WEEKLY') : 'WEEKLY';
    const recurringInterval = isEdit ? (taskToEdit.recurring_interval || 1) : 1;
    let recurringUntilStr = '';
    if (isEdit && taskToEdit.recurring_until) {
      recurringUntilStr = AppState.formatDateRu(new Date(taskToEdit.recurring_until));
    }

    // Selected week days (e.g. "1,3,5")
    let selectedDays = (isEdit && taskToEdit.recurring_days) ? taskToEdit.recurring_days.split(',') : ['1'];
    // Excluded dates array
    let excludedDates = (isEdit && Array.isArray(taskToEdit.recurring_exceptions)) ? [...taskToEdit.recurring_exceptions] : [];

    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <form id="task-form">
        <div class="form-group">
          <label>Название задачи *</label>
          <input type="text" id="task-title" required value="${isEdit ? AppState.escapeHtml(taskToEdit.title) : ''}" placeholder="Например: Проверить спецификацию оборудования">
        </div>

        <div class="form-group">
          <label>Привязка к проекту компании</label>
          <select id="task-project" style="font-weight: 500;">
            <option value="">Без проекта (автономная задача)</option>
            ${projects.map(p => `
              <option value="${p.id}" ${selectedProjectId == p.id ? 'selected' : ''}>${AppState.escapeHtml(p.title)}</option>
            `).join('')}
          </select>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label>Приоритет</label>
            <select id="task-priority">
              <option value="LOW" ${isEdit && taskToEdit.priority === 'LOW' ? 'selected' : ''}>Низкий</option>
              <option value="MEDIUM" ${!isEdit || taskToEdit.priority === 'MEDIUM' ? 'selected' : ''}>Средний</option>
              <option value="HIGH" ${isEdit && taskToEdit.priority === 'HIGH' ? 'selected' : ''}>Высокий</option>
            </select>
          </div>
          <div class="form-group">
            <label>Статус</label>
            <select id="task-status">
              <option value="TODO" ${!isEdit || taskToEdit.status === 'TODO' ? 'selected' : ''}>К исполнению</option>
              <option value="IN_PROGRESS" ${isEdit && taskToEdit.status === 'IN_PROGRESS' ? 'selected' : ''}>В работе</option>
              <option value="REVIEW" ${isEdit && taskToEdit.status === 'REVIEW' ? 'selected' : ''}>На проверке</option>
              <option value="DONE" ${isEdit && taskToEdit.status === 'DONE' ? 'selected' : ''}>Завершено</option>
            </select>
          </div>
        </div>

        <!-- ASSIGNEE SEARCH -->
        <div class="form-group">
          <label>Исполнитель задачи</label>
          <div class="user-search-wrapper" style="position: relative;">
            <div style="display: flex; gap: 6px;">
              <input type="text" id="task-assignee-search" class="user-search-input" placeholder="Выберите исполнителя из списка..." value="${AppState.escapeHtml(initialAssigneeName)}" autocomplete="off" style="flex: 1;">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-clear-assignee" title="Очистить исполнителя" style="padding: 4px 10px;">✕</button>
            </div>
            <input type="hidden" id="task-assignee" value="${initialAssigneeId}">
            <div id="task-assignee-dropdown" class="user-search-dropdown"></div>
          </div>
          <small class="text-muted" style="display: block; margin-top: 4px; font-size: 11px;">
            ${isAdmin ? 'Администратор может назначить любого сотрудника.' : subordinateIds.length > 0 ? 'Вы можете назначить задачу себе или любому из своих подчинённых.' : 'Вы можете назначить задачу себе или коллегам по проекту.'}
          </small>
        </div>

        <!-- RECURRING TASK SETTINGS (DEF-03: Расширенное повторение, интервалы, дни недели, исключения) -->
        <div class="form-group" style="background: var(--bg-subtle); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 14px;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 0; font-weight: 600;">
            <input type="checkbox" id="task-is-recurring" ${isRecurring ? 'checked' : ''} style="accent-color: #3b82f6;">
            <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-refresh"/></svg> Повторяющаяся задача</span>
          </label>

          <div id="recurring-settings-box" class="${isRecurring ? '' : 'hidden'}" style="margin-top: 12px; display: flex; flex-direction: column; gap: 12px;">
            
            <!-- Interval & Type row -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div>
                <label style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Интервал повторения</label>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="font-size: 12px; color: var(--text-muted);">Каждые</span>
                  <input type="number" id="task-recurring-interval" min="1" max="52" value="${recurringInterval}" style="width: 60px; font-size: 12px; padding: 6px; text-align: center;">
                  <select id="task-recurring-type" style="font-size: 12px; padding: 6px 10px; flex: 1;">
                    <option value="DAILY" ${recurringType === 'DAILY' ? 'selected' : ''}>дней</option>
                    <option value="WEEKLY" ${recurringType === 'WEEKLY' ? 'selected' : ''}>недель</option>
                    <option value="MONTHLY" ${recurringType === 'MONTHLY' ? 'selected' : ''}>месяцев</option>
                  </select>
                </div>
              </div>

              <div>
                <label style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Повторять до даты (ДД.ММ.ГГГГ)</label>
                <input type="text" id="task-recurring-until" placeholder="31.12.2026 (или бессрочно)" value="${recurringUntilStr}" maxlength="10" style="font-size: 12px; padding: 6px 10px;">
              </div>
            </div>

            <!-- Weekdays Selection (for Weekly mode) -->
            <div id="recurring-days-box" style="${recurringType === 'WEEKLY' ? '' : 'display: none;'}">
              <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px; display: block;">
                Дни недели для повторения:
              </label>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;" id="recurring-weekdays-container">
                ${weekDayNames.map((name, idx) => {
                  const dayNum = String(idx + 1);
                  const isDaySelected = selectedDays.includes(dayNum);
                  return `
                    <button type="button" class="day-toggle-btn ${isDaySelected ? 'active' : ''}" data-day="${dayNum}">
                      ${name}
                    </button>
                  `;
                }).join('')}
              </div>
            </div>

            <!-- Date Exceptions (DEF-03: Исключения дат) -->
            <div>
              <label style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px; display: block;">
                Исключения дат (пропустить повтор в эти дни):
              </label>
              <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 6px;">
                <input type="text" id="task-exception-date-input" placeholder="ДД.ММ.ГГГГ" maxlength="10" style="font-size: 12px; padding: 5px 8px; width: 120px;">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-add-exception" style="padding: 5px 10px; font-size: 11.5px;">
                  + Добавить исключение
                </button>
              </div>
              <div id="exceptions-chips-container" style="display: flex; gap: 6px; flex-wrap: wrap; min-height: 24px;">
                <!-- Chips injected dynamically -->
              </div>
            </div>

            <!-- Series vs Instance Edit Choice (DEF-03) -->
            ${(isEdit && (taskToEdit.is_recurring || taskToEdit.series_id)) ? `
              <div class="scope-selector-container">
                <div class="scope-selector-header">
                  <div class="scope-badge-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="17 1 21 5 17 9"></polyline>
                      <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                      <polyline points="7 23 3 19 7 15"></polyline>
                      <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                    </svg>
                  </div>
                  <div>
                    <span class="scope-title">Область применения изменений</span>
                    <span class="scope-subtitle">Задача входит в повторяющуюся серию</span>
                  </div>
                </div>
                <div class="radio-cards-grid">
                  <label class="radio-card active">
                    <input type="radio" name="update-scope" value="instance" checked class="custom-radio-input">
                    <span class="custom-radio-dot"></span>
                    <div class="radio-card-content">
                      <div class="radio-card-title">Только для этой задачи</div>
                      <div class="radio-card-desc">Отдельный экземпляр — изменения коснутся только выбранной задачи</div>
                    </div>
                  </label>
                  <label class="radio-card">
                    <input type="radio" name="update-scope" value="series" class="custom-radio-input">
                    <span class="custom-radio-dot"></span>
                    <div class="radio-card-content">
                      <div class="radio-card-title">Для всей серии задач</div>
                      <div class="radio-card-desc">Применить изменения ко всем повторениям в серии</div>
                    </div>
                  </label>
                </div>
              </div>
            ` : ''}

          </div>
        </div>

        <!-- RUSSIAN DATE FORMAT (DD.MM.YYYY) -->
        <div class="form-group" style="background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label style="margin: 0; font-weight: 600; font-size: 13px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-calendar'/></svg> Срок выполнения (день.месяц.год)</label>
            <span style="font-size: 11px; color: var(--text-muted);">Формат РФ (ДД.ММ.ГГГГ)</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr auto 110px; gap: 8px; align-items: center;">
            <div style="position: relative;">
              <input type="text" id="task-deadline-date" class="form-control" placeholder="ДД.ММ.ГГГГ" value="${initialDateStr}" maxlength="10" autocomplete="off" style="font-weight: 500; font-size: 13px;">
              <input type="date" id="task-deadline-native-picker" tabindex="-1" style="position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; left: 0; bottom: 0;">
            </div>
            <button type="button" class="btn btn-secondary" id="btn-pick-calendar-date" title="Выбрать дату в календаре" style="padding: 7px 11px; font-size: 13px; white-space: nowrap;">
              <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-calendar"/></svg> Календарь
            </button>
            <div>
              <input type="time" id="task-deadline-time" class="form-control" value="${initialTimeStr}" title="Время завершения (ЧЧ:ММ)" style="font-size: 13px;">
            </div>
          </div>

          <div style="display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; align-items: center;">
            <span style="font-size: 11px; color: var(--text-muted);">Быстро:</span>
            <button type="button" class="btn btn-secondary btn-sm date-preset-btn" data-preset="today" style="font-size: 11px; padding: 2px 7px;">Сегодня</button>
            <button type="button" class="btn btn-secondary btn-sm date-preset-btn" data-preset="tomorrow" style="font-size: 11px; padding: 2px 7px;">Завтра</button>
            <button type="button" class="btn btn-secondary btn-sm date-preset-btn" data-preset="end_week" style="font-size: 11px; padding: 2px 7px;">Конец недели</button>
            <button type="button" class="btn btn-secondary btn-sm date-preset-btn" data-preset="week" style="font-size: 11px; padding: 2px 7px;">+7 дней</button>
            <button type="button" class="btn btn-secondary btn-sm date-preset-btn" data-preset="clear" style="font-size: 11px; padding: 2px 7px; color: var(--danger);">✕ Очистить</button>
          </div>

          <div id="task-deadline-preview" style="font-size: 12px; margin-top: 8px; color: var(--primary); font-weight: 500; min-height: 18px;"></div>
        </div>

        <div class="form-group">
          <label>Описание задачи</label>
          <textarea id="task-desc" rows="3" placeholder="Подробная инструкция и ожидаемый результат...">${isEdit ? AppState.escapeHtml(taskToEdit.description || '') : ''}</textarea>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 16px;">
          <button type="submit" class="btn btn-primary btn-block">${isEdit ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-save"/></svg> Сохранить изменения' : 'Создать задачу'}</button>
          ${options.fromCalendar ? `<button type="button" class="btn btn-secondary btn-block" id="btn-back-to-calendar"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-calendar"/></svg> Вернуться в календарь</button>` : ''}
        </div>
      </form>
    `;
    AppState.openModal();

    // Recurring toggle
    const chkRecurring = document.getElementById('task-is-recurring');
    const recurringBox = document.getElementById('recurring-settings-box');
    const recurringTypeSelect = document.getElementById('task-recurring-type');
    const recurringDaysBox = document.getElementById('recurring-days-box');

    chkRecurring?.addEventListener('change', () => {
      if (chkRecurring.checked) {
        recurringBox.classList.remove('hidden');
      } else {
        recurringBox.classList.add('hidden');
      }
    });

    recurringTypeSelect?.addEventListener('change', () => {
      if (recurringTypeSelect.value === 'WEEKLY') {
        recurringDaysBox.style.display = 'block';
      } else {
        recurringDaysBox.style.display = 'none';
      }
    });

    // Weekdays toggle buttons
    const daysContainer = document.getElementById('recurring-weekdays-container');
    daysContainer?.querySelectorAll('.day-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = btn.getAttribute('data-day');
        if (selectedDays.includes(d)) {
          if (selectedDays.length > 1) {
            selectedDays = selectedDays.filter(day => day !== d);
            btn.classList.remove('active');
          }
        } else {
          selectedDays.push(d);
          btn.classList.add('active');
        }
      });
    });

    // Exception chips management
    const chipsContainer = document.getElementById('exceptions-chips-container');
    const exceptionInput = document.getElementById('task-exception-date-input');
    const addExceptionBtn = document.getElementById('btn-add-exception');

    function renderExceptionChips() {
      if (!chipsContainer) return;
      if (excludedDates.length === 0) {
        chipsContainer.innerHTML = `<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">Исключений нет</span>`;
        return;
      }
      chipsContainer.innerHTML = excludedDates.map((dateStr, idx) => `
        <span class="exception-chip">
          <span>${dateStr}</span>
          <button type="button" class="exception-chip-remove" data-idx="${idx}" title="Удалить исключение">&times;</button>
        </span>
      `).join('');

      chipsContainer.querySelectorAll('.exception-chip-remove').forEach(rmBtn => {
        rmBtn.addEventListener('click', () => {
          const idx = parseInt(rmBtn.getAttribute('data-idx'), 10);
          excludedDates.splice(idx, 1);
          renderExceptionChips();
        });
      });
    }

    renderExceptionChips();

    // Radio cards selection handler for recurring update scope
    document.querySelectorAll('.radio-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
      });
    });

    addExceptionBtn?.addEventListener('click', () => {
      const val = exceptionInput.value.trim();
      if (!val) return;
      const parsedIso = AppState.parseRuDateTime(val, '00:00');
      if (!parsedIso) {
        alert('Введите корректную дату в формате ДД.ММ.ГГГГ');
        return;
      }
      const isoDateOnly = parsedIso.split('T')[0];
      if (!excludedDates.includes(isoDateOnly)) {
        excludedDates.push(isoDateOnly);
        renderExceptionChips();
      }
      exceptionInput.value = '';
    });

    exceptionInput?.addEventListener('input', (e) => {
      let v = e.target.value.replace(/[^0-9.]/g, '');
      if (v.length === 2 && !v.includes('.')) v += '.';
      if (v.length === 5 && v.split('.').length === 2) v += '.';
      e.target.value = v;
    });

    // Assignee dropdown & outside click handling
    const assigneeSearchInput = document.getElementById('task-assignee-search');
    const assigneeHiddenInput = document.getElementById('task-assignee');
    const assigneeDropdown = document.getElementById('task-assignee-dropdown');
    const clearAssigneeBtn = document.getElementById('btn-clear-assignee');

    let availableUsers = users;
    if (!isAdmin && subordinateIds.length > 0) {
      availableUsers = users.filter(u => u.id === currentUser.id || subordinateIds.includes(u.id));
    }

    const renderAssigneeDropdown = (query = '') => {
      const q = query.toLowerCase().trim();
      const filtered = availableUsers.filter(u => 
        u.full_name.toLowerCase().includes(q) || 
        (u.department || '').toLowerCase().includes(q) || 
        (u.position || '').toLowerCase().includes(q) || 
        u.email.toLowerCase().includes(q)
      );

      if (filtered.length === 0) {
        assigneeDropdown.innerHTML = `<div class="user-search-item text-muted">Сотрудники не найдены</div>`;
      } else {
        assigneeDropdown.innerHTML = filtered.map(u => {
          const isSub = subordinateIds.includes(u.id);
          const isSelf = currentUser && u.id === currentUser.id;
          let tagHtml = '';
          if (isSelf) tagHtml = '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-size: 10px;">Я</span>';
          else if (isSub) tagHtml = '<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; font-size: 10px;">Подчинённый</span>';

          return `
            <div class="user-search-item" data-id="${u.id}" data-name="${AppState.escapeHtml(u.full_name)} (${AppState.escapeHtml(u.department || 'Сотрудник')})">
              <div>
                <div style="font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                  ${AppState.escapeHtml(u.full_name)}
                  ${tagHtml}
                </div>
                <div style="color: var(--text-muted); font-size: 11px;">
                  ${AppState.escapeHtml(u.position || 'Сотрудник')} • ${AppState.escapeHtml(u.department || 'Общий отдел')}
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
      assigneeDropdown.classList.add('open');
    };

    assigneeSearchInput.addEventListener('focus', () => renderAssigneeDropdown(assigneeSearchInput.value));
    assigneeSearchInput.addEventListener('input', () => renderAssigneeDropdown(assigneeSearchInput.value));

    assigneeDropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.user-search-item');
      if (item && item.getAttribute('data-id')) {
        assigneeHiddenInput.value = item.getAttribute('data-id');
        assigneeSearchInput.value = item.getAttribute('data-name');
        assigneeDropdown.classList.remove('open');
      }
    });

    clearAssigneeBtn.addEventListener('click', () => {
      assigneeHiddenInput.value = '';
      assigneeSearchInput.value = '';
      assigneeDropdown.classList.remove('open');
    });

    // Deadline preview & native picker
    const dateInput = document.getElementById('task-deadline-date');
    const nativePicker = document.getElementById('task-deadline-native-picker');
    const btnPickCalendar = document.getElementById('btn-pick-calendar-date');
    const deadlinePreview = document.getElementById('task-deadline-preview');

    const updatePreview = () => {
      const val = dateInput.value.trim();
      const timeVal = document.getElementById('task-deadline-time').value.trim() || '18:00';
      if (!val) {
        deadlinePreview.innerText = '';
        return;
      }
      const iso = AppState.parseRuDateTime(val, timeVal);
      if (iso) {
        const d = new Date(iso);
        deadlinePreview.innerText = `Срок: ${AppState.formatHumanDate(d)} в ${timeVal}`;
      } else {
        deadlinePreview.innerText = 'Формат: ДД.ММ.ГГГГ';
      }
    };

    dateInput.addEventListener('input', (e) => {
      let v = e.target.value.replace(/[^0-9.]/g, '');
      if (v.length === 2 && !v.includes('.')) v += '.';
      if (v.length === 5 && v.split('.').length === 2) v += '.';
      e.target.value = v;
      updatePreview();
    });

    btnPickCalendar.addEventListener('click', () => {
      if (nativePicker.showPicker) nativePicker.showPicker();
      else nativePicker.click();
    });

    nativePicker.addEventListener('change', () => {
      if (nativePicker.value) {
        const [yyyy, mm, dd] = nativePicker.value.split('-');
        dateInput.value = `${dd}.${mm}.${yyyy}`;
        updatePreview();
      }
    });

    document.getElementById('task-deadline-time').addEventListener('input', updatePreview);
    updatePreview();

    modalBody.querySelectorAll('.date-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-preset');
        const now = new Date();
        if (preset === 'today') dateInput.value = AppState.formatDateRu(now);
        else if (preset === 'tomorrow') dateInput.value = AppState.formatDateRu(new Date(now.getTime() + 86400000));
        else if (preset === 'end_week') {
          const dayOfWeek = (now.getDay() + 6) % 7;
          const friday = new Date(now);
          friday.setDate(now.getDate() + (4 - dayOfWeek));
          if (dayOfWeek >= 5) friday.setDate(friday.getDate() + 7);
          dateInput.value = AppState.formatDateRu(friday);
        } else if (preset === 'week') dateInput.value = AppState.formatDateRu(new Date(now.getTime() + 7 * 86400000));
        else if (preset === 'clear') dateInput.value = '';
        updatePreview();
      });
    });

    document.getElementById('btn-back-to-calendar')?.addEventListener('click', () => {
      AppState.closeModal();
      AppState.switchView('calendar');
    });

    // Form submit
    document.getElementById('task-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const dateVal = document.getElementById('task-deadline-date').value.trim();
      const timeVal = document.getElementById('task-deadline-time').value.trim() || '18:00';
      let deadlineIso = null;
      if (dateVal) {
        deadlineIso = AppState.parseRuDateTime(dateVal, timeVal);
        if (!deadlineIso) {
          alert('Неверный формат даты дедлайна. Введите ДД.ММ.ГГГГ');
          return;
        }
      }

      let recUntilIso = null;
      let intervalVal = 1;
      let recType = 'NONE';
      let recDays = null;

      if (chkRecurring?.checked) {
        const rVal = document.getElementById('task-recurring-until').value.trim();
        if (rVal) {
          recUntilIso = AppState.parseRuDateTime(rVal, '23:59');
        }
        recType = document.getElementById('task-recurring-type').value;
        intervalVal = Math.max(1, parseInt(document.getElementById('task-recurring-interval').value, 10) || 1);
        if (recType === 'WEEKLY') {
          recDays = selectedDays.join(',');
        }
      }

      const updateScopeChoice = modalBody.querySelector('input[name="update-scope"]:checked')?.value || 'instance';

      const payload = {
        title: document.getElementById('task-title').value.trim(),
        project_id: document.getElementById('task-project').value || null,
        priority: document.getElementById('task-priority').value,
        status: document.getElementById('task-status').value,
        assignee_id: document.getElementById('task-assignee').value || null,
        deadline: deadlineIso,
        is_recurring: chkRecurring?.checked || false,
        recurring_type: recType,
        recurring_interval: intervalVal,
        recurring_days: recDays,
        recurring_exceptions: excludedDates,
        recurring_until: recUntilIso,
        description: document.getElementById('task-desc').value.trim(),
        update_scope: updateScopeChoice
      };

      try {
        if (isEdit) {
          await API.updateTask(taskToEdit.id, payload);
          AppState.showAlert('Задача обновлена', 'success');
        } else {
          await API.createTask(payload);
          AppState.showAlert('Задача создана', 'success');
        }
        AppState.closeModal();
        AppState.emit('tasks-updated');
        const container = document.getElementById('view-panel-tasks');
        if (container && AppState.getCurrentView() === 'tasks') render(container);
      } catch (err) {
        alert('Ошибка при сохранении задачи: ' + err.message);
      }
    });
  }

  return {
    render: render,
    onActivated: () => {
      updateHeaderAndActions();
    },
    openTaskModal: openTaskModal
  };
})();
