// public/js/modules/users.js
window.UsersModule = (function() {
  let activeTab = 'list'; // 'list' | 'departments' | 'hierarchy' | 'stats'
  let usersSearchQuery = '';
  let usersDeptFilter = 'ALL';
  let usersPage = 1;
  let usersPageSize = 12;
  let deptsSearchQuery = '';
  let deptsPage = 1;
  let deptsPageSize = 12;
  let statsSearchQuery = '';
  let statsPage = 1;
  let statsPageSize = 15;
  let cachedDepartments = [];

  function updateHeaderAndActions(containerEl) {
    AppState.setHeader('Участники и структура', 'Иерархическая организационная структура компании и справочник пользователей');

    const currentUser = AppState.getCurrentUser();
    const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin';

    if (isAdmin) {
      AppState.setTopBarActions(`
        <button class="btn btn-secondary" id="btn-create-dept"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-building'/></svg> Добавить отдел</button>
        <button class="btn btn-primary" id="btn-create-user">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Добавить участника</span>
        </button>
      `);
      const targetPanel = containerEl || document.getElementById('view-panel-users');
      document.getElementById('btn-create-dept')?.addEventListener('click', () => openDepartmentModal(null, targetPanel));
      document.getElementById('btn-create-user')?.addEventListener('click', () => openUserModal(null, targetPanel));
    } else {
      AppState.setTopBarActions('');
    }
  }

  async function render(containerEl) {
    updateHeaderAndActions(containerEl);
    const currentUser = AppState.getCurrentUser();
    const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin';

    containerEl.innerHTML = `
      <div class="card" style="padding: 10px 16px; margin-bottom: 20px; display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap;">
        <div style="display: flex; gap: 8px; flex-wrap: wrap; width: 100%;">
          <button class="btn btn-sm ${activeTab === 'list' ? 'btn-primary' : 'btn-secondary'}" id="tab-users-list">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-users"/></svg> Справочник сотрудников
          </button>
          <button class="btn btn-sm ${activeTab === 'departments' ? 'btn-primary' : 'btn-secondary'}" id="tab-users-departments">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-building"/></svg> Отделы
          </button>
          <button class="btn btn-sm ${activeTab === 'hierarchy' ? 'btn-primary' : 'btn-secondary'}" id="tab-users-hierarchy">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-sitemap"/></svg> Иерархия
          </button>
          <button class="btn btn-sm ${activeTab === 'stats' ? 'btn-primary' : 'btn-secondary'}" id="tab-users-stats">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-bar-chart"/></svg> Статистика и загрузка
          </button>
        </div>
      </div>
      <div id="users-content-area">
        <div class="grid-3">
          <div class="skeleton-card" style="height: 160px;"></div>
          <div class="skeleton-card" style="height: 160px;"></div>
          <div class="skeleton-card" style="height: 160px;"></div>
        </div>
      </div>
    `;

    document.getElementById('tab-users-list')?.addEventListener('click', () => {
      activeTab = 'list';
      render(containerEl);
    });
    document.getElementById('tab-users-departments')?.addEventListener('click', () => {
      activeTab = 'departments';
      render(containerEl);
    });
    document.getElementById('tab-users-hierarchy')?.addEventListener('click', () => {
      activeTab = 'hierarchy';
      render(containerEl);
    });
    document.getElementById('tab-users-stats')?.addEventListener('click', () => {
      activeTab = 'stats';
      render(containerEl);
    });

    const contentArea = document.getElementById('users-content-area');

    try {
      if (activeTab === 'stats') {
        await renderStatsView(contentArea, containerEl);
        return;
      }

      if (activeTab === 'departments') {
        const departments = await API.getDepartments();
        cachedDepartments = Array.isArray(departments) ? departments : [];
        renderDepartmentsView(contentArea, cachedDepartments, isAdmin, containerEl);
        return;
      }

      const [users, hierarchyData, departments] = await Promise.all([
        API.getUsers(),
        API.getUserHierarchy().catch(() => ({ roots: [], allUsers: [] })),
        API.getDepartments().catch(() => [])
      ]);
      cachedDepartments = Array.isArray(departments) ? departments : [];

      if (activeTab === 'hierarchy') {
        renderHierarchyView(contentArea, hierarchyData, users, isAdmin, containerEl);
      } else {
        renderListView(contentArea, users, cachedDepartments, isAdmin, currentUser, containerEl);
      }
    } catch (err) {
      contentArea.innerHTML = `<div class="form-error">Ошибка загрузки участников: ${err.message}</div>`;
    }
  }

  function renderListView(contentArea, users, departments, isAdmin, currentUser, containerEl) {
    const deptNames = Array.isArray(departments) && departments.length > 0
      ? departments.map(d => d.name)
      : Array.from(new Set(users.map(u => u.department).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru'));

    contentArea.innerHTML = `
      <div class="card list-toolbar-card">
        <div class="list-toolbar-search">
          <input type="text" id="users-list-search" class="list-search-input" placeholder="Поиск по ФИО, email, должности или отделу..." value="${AppState.escapeHtml(usersSearchQuery)}" autocomplete="off">
        </div>
        <div class="list-toolbar-filters">
          <select id="users-dept-filter" class="list-filter-select">
            <option value="ALL" ${usersDeptFilter === 'ALL' ? 'selected' : ''}>Все отделы</option>
            <option value="__NONE__" ${usersDeptFilter === '__NONE__' ? 'selected' : ''}>Без отдела</option>
            ${deptNames.map(d => `<option value="${AppState.escapeHtml(d)}" ${usersDeptFilter === d ? 'selected' : ''}>${AppState.escapeHtml(d)}</option>`).join('')}
          </select>
          <span id="users-count-badge" class="badge badge-subtle" style="font-size: 12px;">${users.length}</span>
        </div>
      </div>
      <div id="users-grid-mount"></div>
    `;

    const renderUsersGrid = () => {
      const mountEl = contentArea.querySelector('#users-grid-mount');
      if (!mountEl) return;

      const q = (usersSearchQuery || '').toLowerCase().trim();
      const filtered = users.filter(u => {
        if (usersDeptFilter === '__NONE__') {
          if (u.department && u.department.trim() !== '') return false;
        } else if (usersDeptFilter !== 'ALL' && (u.department || '') !== usersDeptFilter) {
          return false;
        }
        if (q) {
          const deptStr = u.department || 'без отдела';
          const hay = `${u.full_name || ''} ${u.email || ''} ${u.position || ''} ${deptStr}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      const countBadge = contentArea.querySelector('#users-count-badge');
      if (countBadge) countBadge.textContent = `Найдено: ${filtered.length}`;

      if (filtered.length === 0) {
        mountEl.innerHTML = `
          <div class="card" style="text-align: center; padding: 36px;">
            <div style="font-size: 36px; margin-bottom: 8px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-users'/></svg></div>
            <h3 style="font-size: 15px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">Сотрудники не найдены</h3>
            <p class="text-muted" style="font-size: 13px;">Попробуйте изменить поисковый запрос или выбрать другой отдел.</p>
          </div>
        `;
        return;
      }

      const pg = AppState.paginate(filtered, usersPage, usersPageSize);
      usersPage = pg.page;

      mountEl.innerHTML = `
        <div class="grid-3">
          ${pg.items.map(u => {
            const initials = u.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const isUserAdmin = u.role === 'ADMIN';

            return `
              <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                  <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 12px;">
                    <div class="user-avatar" style="width: 48px; height: 48px; font-size: 16px; flex-shrink: 0;">
                      ${initials}
                    </div>
                    <div style="flex: 1; min-width: 0;">
                      <div style="font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-main);">
                        ${AppState.escapeHtml(u.full_name)}
                      </div>
                      <div style="font-size: 12px; color: var(--primary); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${AppState.escapeHtml(u.position || 'Сотрудник')}
                      </div>
                      <div class="text-muted" style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${AppState.escapeHtml(u.email)}
                      </div>
                    </div>
                  </div>

                  <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12px; margin-bottom: 12px; padding: 8px 10px; background: var(--bg-hover, rgba(255,255,255,0.03)); border-radius: 6px; border: 1px solid var(--border-color);">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                      <span class="text-muted">Отдел:</span>
                      ${u.department
                        ? `<strong style="color: var(--text-main); font-size: 11px;">${AppState.escapeHtml(u.department)}</strong>`
                        : `<span class="badge badge-subtle" style="font-size: 10.5px;">Без отдела</span>`
                      }
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span class="text-muted">Руководитель:</span>
                      <span style="color: var(--text-main); font-size: 11px;">
                        ${u.manager_name ? `<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-briefcase"/></svg> ${AppState.escapeHtml(u.manager_name)}` : '<span class="text-muted">Высшее руководство</span>'}
                      </span>
                    </div>
                    ${u.direct_subordinates_count > 0 ? `
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                        <span class="text-muted">Подчинённых:</span>
                        <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 10px; padding: 1px 6px;">
                          <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-users"/></svg> ${u.direct_subordinates_count} сотр.
                        </span>
                      </div>
                    ` : ''}
                  </div>

                  <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <span class="badge ${isUserAdmin ? 'badge-danger' : 'badge-primary'}">
                      ${isUserAdmin ? 'Администратор' : 'Сотрудник'}
                    </span>
                    <span class="badge" style="${u.totp_enabled
                      ? 'background: rgba(16, 185, 129, 0.14); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);'
                      : 'background: rgba(245, 158, 11, 0.14); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);'}">
                      ${u.totp_enabled ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-lock"/></svg> 2FA активна' : '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clock"/></svg> 2FA не настроена'}
                    </span>
                  </div>
                </div>

                ${isAdmin ? `
                  <div style="display: flex; gap: 6px; border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 14px; flex-wrap: wrap;">
                    <button class="btn btn-secondary btn-sm edit-user-btn" data-id="${u.id}" style="flex: 1;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg> Редактировать</button>
                    <button class="btn btn-secondary btn-sm assign-dept-btn" data-id="${u.id}" title="Назначить или сменить отдел"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-building'/></svg> Отдел</button>
                    ${u.totp_enabled ? `
                      <button class="btn btn-secondary btn-sm reset-2fa-btn" data-id="${u.id}" title="Аварийный сброс 2FA пользователя" style="color: #f59e0b;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-refresh'/></svg> 2FA</button>
                    ` : ''}
                    ${u.id !== currentUser?.id ? `
                      <button class="btn btn-secondary btn-sm delete-user-btn" data-id="${u.id}" style="color: var(--danger);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-trash'/></svg></button>
                    ` : ''}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
        ${AppState.renderPaginationHtml(pg, { pageSizeOptions: [12, 24, 48] })}
      `;

      AppState.bindPaginationEvents(mountEl, {
        onPageChange: (p) => { usersPage = p; renderUsersGrid(); },
        onPageSizeChange: (sz) => { usersPageSize = sz; usersPage = 1; renderUsersGrid(); }
      });
      bindUserActions(mountEl, users, containerEl);
    };

    contentArea.querySelector('#users-list-search')?.addEventListener('input', (e) => {
      usersSearchQuery = e.target.value;
      usersPage = 1;
      renderUsersGrid();
    });
    contentArea.querySelector('#users-dept-filter')?.addEventListener('change', (e) => {
      usersDeptFilter = e.target.value;
      usersPage = 1;
      renderUsersGrid();
    });

    renderUsersGrid();
  }

  function renderDepartmentsView(contentArea, departments, isAdmin, containerEl) {
    contentArea.innerHTML = `
      <div class="card list-toolbar-card">
        <div class="list-toolbar-search">
          <input type="text" id="depts-search-input" class="list-search-input" placeholder="Поиск отдела по названию или описанию..." value="${AppState.escapeHtml(deptsSearchQuery)}" autocomplete="off">
        </div>
        <div class="list-toolbar-filters">
          <span id="depts-count-badge" class="badge badge-subtle" style="font-size: 12px;">${departments.length}</span>
          ${isAdmin ? `<button type="button" class="btn btn-primary btn-sm" id="btn-inline-create-dept"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-building"/></svg> Новый отдел</button>` : ''}
        </div>
      </div>
      <div id="depts-grid-mount"></div>
    `;

    contentArea.querySelector('#btn-inline-create-dept')?.addEventListener('click', () => {
      openDepartmentModal(null, containerEl);
    });

    const renderDeptsGrid = () => {
      const mountEl = contentArea.querySelector('#depts-grid-mount');
      if (!mountEl) return;

      const q = (deptsSearchQuery || '').toLowerCase().trim();
      const filtered = departments.filter(d => {
        if (!q) return true;
        return `${d.name || ''} ${d.description || ''}`.toLowerCase().includes(q);
      });

      const badge = contentArea.querySelector('#depts-count-badge');
      if (badge) badge.textContent = `Найдено: ${filtered.length}`;

      if (filtered.length === 0) {
        mountEl.innerHTML = `
          <div class="card" style="text-align: center; padding: 36px;">
            <div style="font-size: 36px; margin-bottom: 8px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-building'/></svg></div>
            <h3 style="font-size: 15px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">Отделы не найдены</h3>
            <p class="text-muted" style="font-size: 13px; margin-bottom: 14px;">
              ${departments.length === 0 ? 'В справочнике пока нет отделов.' : 'Попробуйте изменить поисковый запрос.'}
            </p>
            ${isAdmin ? `<button type="button" class="btn btn-primary btn-sm" id="btn-empty-create-dept"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-building"/></svg> Добавить отдел</button>` : ''}
          </div>
        `;
        mountEl.querySelector('#btn-empty-create-dept')?.addEventListener('click', () => openDepartmentModal(null, containerEl));
        return;
      }

      const pg = AppState.paginate(filtered, deptsPage, deptsPageSize);
      deptsPage = pg.page;

      mountEl.innerHTML = `
        <div class="grid-3">
          ${pg.items.map(d => `
            <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; gap: 12px;">
              <div>
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                  <h3 style="font-size: 15px; font-weight: 700; color: var(--ink); margin: 0;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-building'/></svg> ${AppState.escapeHtml(d.name)}</h3>
                  <span class="badge badge-primary" style="font-size: 11px; flex-shrink: 0;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-users'/></svg> ${d.users_count || 0}</span>
                </div>
                <p class="text-muted" style="font-size: 12.5px; line-height: 1.45; margin: 0;">
                  ${AppState.escapeHtml(d.description || 'Описание не указано')}
                </p>
              </div>
              ${isAdmin ? `
                <div style="display: flex; gap: 8px; border-top: 1px solid var(--line); padding-top: 10px;">
                  <button type="button" class="btn btn-secondary btn-sm edit-dept-btn" data-id="${d.id}" style="flex: 1;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg> Изменить</button>
                  <button type="button" class="btn btn-secondary btn-sm delete-dept-btn" data-id="${d.id}" style="color: var(--danger);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-trash'/></svg></button>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
        ${AppState.renderPaginationHtml(pg, { pageSizeOptions: [12, 24, 48] })}
      `;

      AppState.bindPaginationEvents(mountEl, {
        onPageChange: (p) => { deptsPage = p; renderDeptsGrid(); },
        onPageSizeChange: (sz) => { deptsPageSize = sz; deptsPage = 1; renderDeptsGrid(); }
      });

      if (isAdmin) {
        mountEl.querySelectorAll('.edit-dept-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = parseInt(btn.getAttribute('data-id'), 10);
            const dept = departments.find(x => x.id === id);
            if (dept) openDepartmentModal(dept, containerEl);
          });
        });
        mountEl.querySelectorAll('.delete-dept-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = parseInt(btn.getAttribute('data-id'), 10);
            const dept = departments.find(x => x.id === id);
            if (!dept) return;
            AppState.showConfirmModal({
              title: 'Удаление отдела',
              message: `Удалить отдел «${dept.name}»? Все его сотрудники (${dept.users_count || 0}) останутся в системе в статусе «Без отдела».`,
              confirmText: 'Удалить отдел',
              cancelText: 'Отмена',
              onConfirm: async () => {
                try {
                  await API.deleteDepartment(id);
                  AppState.showAlert(`Отдел «${dept.name}» удалён`, 'success');
                  render(containerEl);
                } catch (err) {
                  AppState.showAlert('Ошибка удаления отдела: ' + err.message, 'danger');
                }
              }
            });
          });
        });
      }
    };

    contentArea.querySelector('#depts-search-input')?.addEventListener('input', (e) => {
      deptsSearchQuery = e.target.value;
      deptsPage = 1;
      renderDeptsGrid();
    });

    renderDeptsGrid();
  }

  let collapsedNodes = new Set();

  function renderHierarchyView(contentArea, hierarchyData, users, isAdmin, containerEl) {
    const roots = hierarchyData.roots || [];

    if (roots.length === 0) {
      contentArea.innerHTML = `
        <div class="card" style="text-align: center; padding: 40px;">
          <div style="font-size: 32px; margin-bottom: 12px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-sitemap'/></svg></div>
          <p class="text-muted">Иерархическая структура пока не сформирована. Назначьте руководителей в карточках сотрудников.</p>
        </div>
      `;
      return;
    }

    function renderNode(node, level = 0) {
      const initials = node.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      const hasSubs = node.subordinates && node.subordinates.length > 0;
      const subsCount = hasSubs ? node.subordinates.length : 0;
      const isTopLevel = level === 0;
      const isCollapsed = collapsedNodes.has(node.id);

      return `
        <div class="hierarchy-tree-node" data-id="${node.id}" style="margin-left: ${level * 16}px; margin-bottom: 10px; position: relative;">
          <div class="card org-chart-card" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 12px 16px; border-left: 4px solid ${isTopLevel ? '#ef4444' : hasSubs ? '#3b82f6' : 'var(--border-color)'}; background: var(--bg-card); border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);">
            <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
              ${hasSubs ? `
                <button type="button" class="btn btn-secondary btn-sm toggle-subs-btn" data-id="${node.id}" title="${isCollapsed ? 'Развернуть подчинённых' : 'Свернуть подчинённых'}" style="width: 26px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; border-radius: 50%;">
                  ${isCollapsed ? '▶' : '▼'}
                </button>
              ` : `
                <div style="width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: var(--text-muted); flex-shrink: 0;">•</div>
              `}
              <div class="user-avatar" style="width: 38px; height: 38px; font-size: 13px; flex-shrink: 0; background: ${isTopLevel ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 'linear-gradient(135deg, #3b82f6, #1d4ed8)'}; color: #fff;">
                ${initials}
              </div>
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <strong style="font-size: 14px; color: var(--text-main);">${AppState.escapeHtml(node.full_name)}</strong>
                  <span class="badge ${node.role === 'ADMIN' ? 'badge-danger' : 'badge-primary'}" style="font-size: 10px;">
                    ${node.role === 'ADMIN' ? 'Руководитель / Админ' : 'Сотрудник'}
                  </span>
                </div>
                <div style="font-size: 12px; color: var(--primary); font-weight: 500;">
                  ${AppState.escapeHtml(node.position || 'Сотрудник')}
                  <span class="text-muted" style="font-weight: 400;"> • ${AppState.escapeHtml(node.department || 'Общий отдел')}</span>
                </div>
                <div class="text-muted" style="font-size: 11px;">
                  ${AppState.escapeHtml(node.email)}
                </div>
              </div>
            </div>

            <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
              ${hasSubs ? `
                <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 11px; padding: 4px 10px; cursor: pointer;" onclick="document.querySelector('.toggle-subs-btn[data-id=\\'${node.id}\\']')?.click();">
                  <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-users"/></svg> ${subsCount} ${subsCount === 1 ? 'подчинённый' : (subsCount < 5 ? 'подчинённых' : 'подчинённых')}
                </span>
              ` : `
                <span class="text-muted" style="font-size: 11px; padding-right: 6px;">Исполнитель</span>
              `}
              ${isAdmin ? `
                <button class="btn btn-secondary btn-sm edit-user-btn" data-id="${node.id}" title="Редактировать"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg></button>
              ` : ''}
            </div>
          </div>

          ${hasSubs ? `
            <div id="subs-${node.id}" class="hierarchy-subordinates ${isCollapsed ? 'hidden' : ''}" style="border-left: 2px dashed var(--primary); margin-left: 14px; padding-left: 8px; margin-top: 6px;">
              ${node.subordinates.map(sub => renderNode(sub, level + 1)).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }

    contentArea.innerHTML = `
      <div style="margin-bottom: 16px; padding: 12px 16px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; font-size: 13px; color: var(--text-muted); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-sitemap'/></svg></span>
          <div>
            <strong>Интерактивная оргсхема</strong> &bull; Нажмите на стрелки <b>▼ / ▶</b> для сворачивания отделов и нижестоящих сотрудников.
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="btn btn-secondary btn-sm" id="btn-expand-all-hierarchy" style="font-size: 11px;">Развернуть всё</button>
          <button class="btn btn-secondary btn-sm" id="btn-collapse-all-hierarchy" style="font-size: 11px;">Свернуть всё</button>
          <span class="badge badge-subtle" style="font-size: 11px;">Всего: ${users.length}</span>
        </div>
      </div>
      <div class="hierarchy-container">
        ${roots.map(r => renderNode(r, 0)).join('')}
      </div>
    `;

    // Event listeners for toggle collapse/expand
    contentArea.querySelectorAll('.toggle-subs-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.getAttribute('data-id'), 10);
        if (collapsedNodes.has(id)) {
          collapsedNodes.delete(id);
        } else {
          collapsedNodes.add(id);
        }
        renderHierarchyView(contentArea, hierarchyData, users, isAdmin, containerEl);
      });
    });

    contentArea.querySelector('#btn-expand-all-hierarchy')?.addEventListener('click', () => {
      collapsedNodes.clear();
      renderHierarchyView(contentArea, hierarchyData, users, isAdmin, containerEl);
    });

    contentArea.querySelector('#btn-collapse-all-hierarchy')?.addEventListener('click', () => {
      function collectIds(list) {
        list.forEach(item => {
          if (item.subordinates && item.subordinates.length > 0) {
            collapsedNodes.add(item.id);
            collectIds(item.subordinates);
          }
        });
      }
      collectIds(roots);
      renderHierarchyView(contentArea, hierarchyData, users, isAdmin, containerEl);
    });

    bindUserActions(contentArea, users, containerEl);
  }

  function bindUserActions(contentArea, users, containerEl) {
    contentArea.querySelectorAll('.edit-user-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const user = users.find(u => u.id === id);
        if (user) openUserModal(user, containerEl);
      });
    });

    contentArea.querySelectorAll('.assign-dept-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const user = users.find(u => u.id === id);
        if (user) {
          const depts = cachedDepartments.length > 0 ? cachedDepartments : await API.getDepartments().catch(() => []);
          openAssignDepartmentModal(user, depts, containerEl);
        }
      });
    });

    contentArea.querySelectorAll('.reset-2fa-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const user = users.find(u => u.id === id);
        if (!user) return;

        AppState.showConfirmModal({
          title: 'Сброс двухфакторной аутентификации (2FA)',
          message: `Сбросить 2FA и резервные коды для "${user.full_name}"? При следующем входе сотруднику нужно будет заново отсканировать QR-код.`,
          confirmText: 'Сбросить 2FA',
          cancelText: 'Отмена',
          onConfirm: async () => {
            try {
              const res = await API.resetUser2FA(id);
              AppState.showAlert(res.message || '2FA успешно сброшена', 'success');
              render(containerEl);
            } catch (err) {
              alert('Ошибка сброса 2FA: ' + err.message);
            }
          }
        });
      });
    });

    contentArea.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const user = users.find(u => u.id === id);
        if (!user) return;

        AppState.showConfirmModal({
          title: 'Удаление участника',
          message: `Вы действительно хотите удалить пользователя "${user.full_name}" из системы?`,
          confirmText: 'Удалить',
          cancelText: 'Отмена',
          onConfirm: async () => {
            try {
              await API.deleteUser(id);
              AppState.showAlert('Участник успешно удален', 'success');
              render(containerEl);
            } catch (err) {
              alert('Ошибка удаления участника: ' + err.message);
            }
          }
        });
      });
    });
  }

  // DETAILED EMPLOYEE & DEPARTMENT STATS VIEW (DEF-18)
  async function renderStatsView(contentArea, containerEl) {
    contentArea.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">Загрузка аналитики и статистики...</div>`;

    try {
      const stats = await API.getUserStats();
      const users = stats.users || [];
      const departments = stats.departments || [];
      const summary = stats.summary || {};

      contentArea.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 20px;">
          
          <!-- KPI SUMMARY CARDS -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;">
            <div class="card" style="padding: 16px; border-left: 4px solid var(--primary);">
              <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Сотрудников в штате</div>
              <div style="font-size: 26px; font-weight: 800; color: var(--text-main); margin-top: 4px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-users'/></svg> ${summary.total_users || users.length}</div>
            </div>
            <div class="card" style="padding: 16px; border-left: 4px solid #3b82f6;">
              <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Активных задач в работе</div>
              <div style="font-size: 26px; font-weight: 800; color: #3b82f6; margin-top: 4px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-clipboard'/></svg> ${summary.total_active_tasks || 0}</div>
            </div>
            <div class="card" style="padding: 16px; border-left: 4px solid var(--danger);">
              <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Просроченных задач</div>
              <div style="font-size: 26px; font-weight: 800; color: var(--danger); margin-top: 4px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-clock'/></svg> ${summary.total_overdue_tasks || 0}</div>
            </div>
            <div class="card" style="padding: 16px; border-left: 4px solid #10b981;">
              <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Подразделений и отделов</div>
              <div style="font-size: 26px; font-weight: 800; color: #10b981; margin-top: 4px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-building'/></svg> ${departments.length}</div>
            </div>
          </div>

          <!-- DEPARTMENTS BREAKDOWN -->
          <div class="card" style="padding: 18px;">
            <h3 style="font-size: 16px; font-weight: 700; color: var(--text-main); margin-bottom: 14px; display: flex; align-items: center; gap: 8px;">
              <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-building"/></svg></span> <span>Загруженность по отделам компании</span>
            </h3>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px;">
              ${departments.map(d => {
                const avgTasks = parseFloat(d.avg_tasks_per_user || 0);
                let loadColor = '#10b981';
                let loadText = 'Низкая загрузка';
                if (avgTasks > 4) { loadColor = 'var(--danger)'; loadText = 'Высокая загрузка'; }
                else if (avgTasks > 2) { loadColor = 'var(--warning)'; loadText = 'Средняя загрузка'; }

                return `
                  <div style="background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                      <div>
                        <div style="font-weight: 700; font-size: 14px; color: var(--text-main);">${AppState.escapeHtml(d.name)}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${d.users_count} сотрудн. &bull; ${d.active_tasks} активных задач</div>
                      </div>
                      <span class="badge" style="background: ${loadColor}20; color: ${loadColor}; font-size: 10px; font-weight: 700;">
                        ${loadText}
                      </span>
                    </div>

                    <div style="display: flex; align-items: center; gap: 8px; font-size: 11.5px; margin-top: 4px;">
                      <span style="color: var(--text-muted);">Средняя нагрузка:</span>
                      <strong style="color: var(--text-main);">${avgTasks} задач / сотр.</strong>
                    </div>

                    ${d.least_busy_user ? `
                      <div style="font-size: 11px; color: var(--text-muted); background: var(--bg-card); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color); margin-top: 2px;">
                        <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-lightbulb"/></svg> <strong>Наименее загружен:</strong> ${AppState.escapeHtml(d.least_busy_user.full_name)} (${d.least_busy_user.active_tasks} зад.)
                      </div>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- DETAILED EMPLOYEES TABLE -->
          <div class="card" style="padding: 18px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
              <h3 style="font-size: 16px; font-weight: 700; color: var(--text-main); margin: 0; display: flex; align-items: center; gap: 8px;">
                <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-users"/></svg></span> <span>Персональная загрузка и проекты сотрудников</span>
              </h3>
              <input type="text" id="stats-employee-search" class="list-search-input" placeholder="Найти сотрудника или отдел..." value="${AppState.escapeHtml(statsSearchQuery)}" style="max-width: 260px;">
            </div>

            <div id="stats-users-mount"></div>
          </div>

        </div>
      `;

      const renderStatsTable = () => {
        const mountEl = contentArea.querySelector('#stats-users-mount');
        if (!mountEl) return;

        const q = (statsSearchQuery || '').toLowerCase().trim();
        const filteredUsers = users.filter(u => {
          if (!q) return true;
          const hay = `${u.full_name || ''} ${u.email || ''} ${u.department || ''} ${u.position || ''}`.toLowerCase();
          return hay.includes(q);
        });

        const pg = AppState.paginate(filteredUsers, statsPage, statsPageSize);
        statsPage = pg.page;

        if (filteredUsers.length === 0) {
          mountEl.innerHTML = `<div class="text-muted" style="text-align: center; padding: 24px;">Сотрудники не найдены</div>`;
          return;
        }

        mountEl.innerHTML = `
          <div class="tasks-table-container">
            <table class="tasks-table" id="stats-users-table">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Отдел / Должность</th>
                  <th style="width: 100px; text-align: center;">В работе</th>
                  <th style="width: 110px; text-align: center;">Просрочено</th>
                  <th style="width: 100px; text-align: center;">Завершено</th>
                  <th>Проекты сотрудника</th>
                  <th style="width: 80px; text-align: center;">Документы</th>
                  <th style="width: 120px; text-align: center;">Действие</th>
                </tr>
              </thead>
              <tbody>
                ${pg.items.map(u => {
                  const projects = Array.isArray(u.projects) ? u.projects : [];
                  return `
                    <tr class="stats-user-row">
                      <td>
                        <div style="font-weight: 600; font-size: 13px; color: var(--text-main);">${AppState.escapeHtml(u.full_name)}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${AppState.escapeHtml(u.email)}</div>
                      </td>
                      <td>
                        <div style="font-size: 12px; color: var(--text-main);">${AppState.escapeHtml(u.department || 'Общий отдел')}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${AppState.escapeHtml(u.position || 'Сотрудник')}</div>
                      </td>
                      <td style="text-align: center;">
                        <span class="badge ${u.active_tasks > 0 ? 'badge-primary' : 'badge-subtle'}" style="font-size: 11px; font-weight: 700;">
                          ${u.active_tasks}
                        </span>
                      </td>
                      <td style="text-align: center;">
                        ${u.overdue_tasks > 0 
                          ? `<span class="badge" style="background: rgba(239,68,68,0.15); color: #ef4444; font-weight: 700; font-size: 11px; border: 1px solid rgba(239,68,68,0.3);"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clock"/></svg> ${u.overdue_tasks}</span>`
                          : '<span class="text-muted" style="font-size: 12px;">0</span>'
                        }
                      </td>
                      <td style="text-align: center;">
                        <span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; font-size: 11px;">
                          ${u.done_tasks}
                        </span>
                      </td>
                      <td>
                        <div style="display: flex; gap: 4px; flex-wrap: wrap; max-width: 240px;">
                          ${projects.length === 0 ? '<span class="text-muted" style="font-size: 11px;">Без проектов</span>' : projects.slice(0, 3).map(p => `
                            <span class="badge badge-subtle" style="font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
                              <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder"/></svg> ${AppState.escapeHtml(p.title)}
                            </span>
                          `).join('')}
                          ${projects.length > 3 ? `<span class="text-muted" style="font-size: 10px;">+${projects.length - 3}</span>` : ''}
                        </div>
                      </td>
                      <td style="text-align: center; font-size: 12px; font-weight: 600; color: var(--text-muted);">
                        <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-file-text"/></svg> ${u.documents_count || 0}
                      </td>
                      <td style="text-align: center;">
                        <button type="button" class="btn btn-secondary btn-sm stats-assign-task-btn" data-id="${u.id}" data-name="${AppState.escapeHtml(u.full_name)}" data-dept="${AppState.escapeHtml(u.department || '')}" style="font-size: 11px; padding: 4px 8px; border-radius: 4px; white-space: nowrap;">
                          + Поручить
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
          ${AppState.renderPaginationHtml(pg, { pageSizeOptions: [10, 15, 30, 50] })}
        `;

        AppState.bindPaginationEvents(mountEl, {
          onPageChange: (p) => { statsPage = p; renderStatsTable(); },
          onPageSizeChange: (sz) => { statsPageSize = sz; statsPage = 1; renderStatsTable(); }
        });

        mountEl.querySelectorAll('.stats-assign-task-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = parseInt(btn.getAttribute('data-id'), 10);
            if (window.TasksModule) {
              window.TasksModule.openTaskModal(null, {
                fromUsers: true,
                defaultAssigneeId: id
              });
            }
          });
        });
      };

      const search = document.getElementById('stats-employee-search');
      search?.addEventListener('input', (e) => {
        statsSearchQuery = e.target.value;
        statsPage = 1;
        renderStatsTable();
      });

      renderStatsTable();

    } catch (err) {
      contentArea.innerHTML = `<div class="form-error">Ошибка загрузки статистики: ${AppState.escapeHtml(err.message)}</div>`;
    }
  }

  function mountDepartmentCombobox({ wrapperEl, departments = [], initialDeptId = null, initialDeptName = '', submitBtnEl = null }) {
    const cleanInitName = (initialDeptName || '').trim();
    const matchedInit = initialDeptId
      ? departments.find(d => Number(d.id) === Number(initialDeptId))
      : (cleanInitName ? departments.find(d => d.name.toLowerCase() === cleanInitName.toLowerCase()) : null);

    let selectedId = matchedInit ? matchedInit.id : null;
    let selectedName = matchedInit ? matchedInit.name : null;
    let isValid = true;
    let displayValue = matchedInit ? matchedInit.name : 'Без отдела';

    wrapperEl.innerHTML = `
      <div class="dept-combobox">
        <div class="dept-combobox-input-row">
          <input type="text" class="dept-search-input" value="${AppState.escapeHtml(displayValue)}" placeholder="Поиск отдела или «Без отдела»..." autocomplete="off">
          <button type="button" class="dept-combobox-toggle" title="Открыть список отделов" aria-label="Открыть список отделов">▼</button>
        </div>
        <div class="dept-dropdown"></div>
        <div class="dept-validation-row">
          <span class="dept-validation-msg"></span>
          <button type="button" class="dept-quick-none-btn hidden">Выбрать «Без отдела»</button>
        </div>
      </div>
    `;

    const boxEl = wrapperEl.querySelector('.dept-combobox');
    const inputEl = wrapperEl.querySelector('.dept-search-input');
    const toggleBtn = wrapperEl.querySelector('.dept-combobox-toggle');
    const dropdownEl = wrapperEl.querySelector('.dept-dropdown');
    const msgEl = wrapperEl.querySelector('.dept-validation-msg');
    const quickNoneBtn = wrapperEl.querySelector('.dept-quick-none-btn');

    const syncValidationUI = (typedText) => {
      boxEl.classList.toggle('is-invalid', !isValid);
      if (submitBtnEl) submitBtnEl.disabled = !isValid;

      if (!isValid) {
        msgEl.className = 'dept-validation-msg dept-validation-error';
        msgEl.textContent = `Отдел «${typedText.trim()}» не найден — создание недоступно`;
        quickNoneBtn.classList.remove('hidden');
      } else if (selectedId === null) {
        msgEl.className = 'dept-validation-msg dept-validation-muted';
        msgEl.textContent = 'Без отдела — отдел можно назначить позже';
        quickNoneBtn.classList.add('hidden');
      } else {
        msgEl.className = 'dept-validation-msg dept-validation-ok';
        msgEl.textContent = `✓ Выбран отдел: ${selectedName}`;
        quickNoneBtn.classList.add('hidden');
      }
    };

    const renderDropdown = (filterQuery = '') => {
      const q = (filterQuery || '').toLowerCase().trim();
      const showAll = q === '' || q === 'без отдела';
      const matches = showAll
        ? departments
        : departments.filter(d => d.name.toLowerCase().includes(q));

      let html = '';
      if (q === '' || 'без отдела'.includes(q)) {
        html += `
          <button type="button" class="dept-option dept-option--none ${isValid && selectedId === null ? 'active' : ''}" data-dept-id="">
            <span>— Без отдела —</span>
            <span class="dept-option-count">назначить позже</span>
          </button>
        `;
      }

      if (matches.length > 0) {
        html += matches.map(d => `
          <button type="button" class="dept-option ${Number(selectedId) === Number(d.id) ? 'active' : ''}" data-dept-id="${d.id}">
            <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-building"/></svg> ${AppState.escapeHtml(d.name)}</span>
            <span class="dept-option-count">${d.users_count || 0} сотр.</span>
          </button>
        `).join('');
      } else {
        html += `
          <div class="dept-empty-warn">
            Отдел «${AppState.escapeHtml(filterQuery.trim())}» не найден в справочнике. Создайте его во вкладке «Отделы» или выберите «Без отдела».
          </div>
        `;
      }

      dropdownEl.innerHTML = html;
      dropdownEl.querySelectorAll('.dept-option').forEach(opt => {
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const rawId = opt.getAttribute('data-dept-id');
          if (!rawId) {
            selectedId = null;
            selectedName = null;
            isValid = true;
            inputEl.value = 'Без отдела';
          } else {
            const found = departments.find(d => Number(d.id) === Number(rawId));
            if (found) {
              selectedId = found.id;
              selectedName = found.name;
              isValid = true;
              inputEl.value = found.name;
            }
          }
          dropdownEl.classList.remove('open');
          syncValidationUI(inputEl.value);
        });
      });
    };

    inputEl.addEventListener('focus', () => {
      if (inputEl.value === 'Без отдела') {
        inputEl.select();
      }
      renderDropdown(inputEl.value === 'Без отдела' ? '' : inputEl.value);
      dropdownEl.classList.add('open');
    });

    inputEl.addEventListener('input', () => {
      const raw = inputEl.value;
      const q = raw.trim().toLowerCase();
      if (q === '' || q === 'без отдела') {
        selectedId = null;
        selectedName = null;
        isValid = true;
      } else {
        const exact = departments.find(d => d.name.trim().toLowerCase() === q);
        if (exact) {
          selectedId = exact.id;
          selectedName = exact.name;
          isValid = true;
        } else {
          selectedId = null;
          selectedName = null;
          isValid = false;
        }
      }
      renderDropdown(raw);
      dropdownEl.classList.add('open');
      syncValidationUI(raw);
    });

    inputEl.addEventListener('blur', () => {
      setTimeout(() => {
        dropdownEl.classList.remove('open');
      }, 150);
    });

    toggleBtn.addEventListener('click', () => {
      const willOpen = !dropdownEl.classList.contains('open');
      if (willOpen) {
        renderDropdown(inputEl.value === 'Без отдела' ? '' : inputEl.value);
        dropdownEl.classList.add('open');
        inputEl.focus();
      } else {
        dropdownEl.classList.remove('open');
      }
    });

    quickNoneBtn.addEventListener('click', () => {
      selectedId = null;
      selectedName = null;
      isValid = true;
      inputEl.value = 'Без отдела';
      dropdownEl.classList.remove('open');
      syncValidationUI(inputEl.value);
    });

    syncValidationUI(displayValue);

    return {
      focus: () => inputEl.focus(),
      getValue: () => ({
        isValid,
        department_id: selectedId,
        department: selectedName
      })
    };
  }

  function openDepartmentModal(deptToEdit = null, containerEl = null) {
    const isEdit = !!deptToEdit;
    AppState.setModalTitle(isEdit ? 'Редактировать отдел' : 'Создать отдел');
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <form id="department-form">
        <div class="form-group">
          <label>Название отдела *</label>
          <input type="text" id="dept-modal-name" required minlength="2" value="${isEdit ? AppState.escapeHtml(deptToEdit.name) : ''}" placeholder="Например: Лаборатория аналитики">
        </div>
        <div class="form-group">
          <label>Описание / Задачи подразделения</label>
          <textarea id="dept-modal-desc" rows="3" placeholder="Краткое описание функций отдела...">${isEdit ? AppState.escapeHtml(deptToEdit.description || '') : ''}</textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block">${isEdit ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-save"/></svg> Сохранить отдел' : '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-building"/></svg> Создать отдел'}</button>
      </form>
    `;
    AppState.openModal(null, null, 'sm');
    setTimeout(() => document.getElementById('dept-modal-name')?.focus(), 50);

    document.getElementById('department-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('dept-modal-name').value.trim();
      const description = document.getElementById('dept-modal-desc').value.trim();
      if (name.length < 2) return;

      try {
        if (isEdit) {
          await API.updateDepartment(deptToEdit.id, { name, description });
          AppState.showAlert(`Отдел «${name}» обновлён`, 'success');
        } else {
          await API.createDepartment({ name, description });
          AppState.showAlert(`Отдел «${name}» добавлен в справочник`, 'success');
        }
        AppState.closeModal();
        const target = containerEl || document.getElementById('view-panel-users');
        if (target) render(target);
      } catch (err) {
        AppState.showAlert(err.message || 'Ошибка сохранения отдела', 'danger');
      }
    });
  }

  function openAssignDepartmentModal(user, departments, containerEl) {
    AppState.setModalTitle(`Назначить отдел: ${user.full_name}`);
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <form id="assign-dept-form">
        <div class="form-group">
          <label>Сотрудник</label>
          <input type="text" disabled value="${AppState.escapeHtml(user.full_name)} (${AppState.escapeHtml(user.email)})">
        </div>
        <div class="form-group">
          <label>Отдел</label>
          <div id="assign-dept-combobox-mount"></div>
        </div>
        <button type="submit" id="btn-save-assign-dept" class="btn btn-primary btn-block"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-save'/></svg> Сохранить отдел</button>
      </form>
    `;
    AppState.openModal(null, null, 'sm');

    const submitBtn = document.getElementById('btn-save-assign-dept');
    const combo = mountDepartmentCombobox({
      wrapperEl: document.getElementById('assign-dept-combobox-mount'),
      departments,
      initialDeptId: user.department_id,
      initialDeptName: user.department,
      submitBtnEl: submitBtn
    });

    document.getElementById('assign-dept-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = combo.getValue();
      if (!val.isValid) {
        combo.focus();
        return;
      }
      try {
        await API.updateUser(user.id, {
          department_id: val.department_id,
          department: val.department
        });
        AppState.showAlert(val.department ? `Назначен отдел «${val.department}»` : 'Установлен статус «Без отдела»', 'success');
        AppState.closeModal();
        render(containerEl || document.getElementById('view-panel-users'));
      } catch (err) {
        AppState.showAlert(err.message || 'Ошибка назначения отдела', 'danger');
      }
    });
  }

  async function openUserModal(userToEdit = null, containerEl) {
    const isEdit = !!userToEdit;
    AppState.setModalTitle(isEdit ? 'Редактировать участника' : 'Добавить нового участника');

    const [allUsers, departments] = await Promise.all([
      API.getUsers().catch(() => []),
      API.getDepartments().catch(() => [])
    ]);
    cachedDepartments = Array.isArray(departments) ? departments : [];

    // Exclude self from manager candidates
    const potentialManagers = isEdit ? allUsers.filter(u => u.id !== userToEdit.id) : allUsers;

    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <form id="user-form">
        <div class="form-group">
          <label>ФИО сотрудника *</label>
          <input type="text" id="user-fullname" required value="${isEdit ? AppState.escapeHtml(userToEdit.full_name) : ''}" placeholder="Иванов Сергей Викторович">
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label>Должность *</label>
            <input type="text" id="user-position" required value="${isEdit ? AppState.escapeHtml(userToEdit.position || 'Сотрудник') : 'Сотрудник'}" placeholder="Например: Руководитель отдела разработки">
          </div>
          <div class="form-group">
            <label>Подразделение / Отдел</label>
            <div id="user-dept-combobox-mount"></div>
          </div>
        </div>

        <div class="form-group">
          <label>Непосредственный руководитель / Начальник (Иерархия)</label>
          <select id="user-manager">
            <option value="">— Без руководителя (высшее руководство) —</option>
            ${potentialManagers.map(m => `
              <option value="${m.id}" ${isEdit && userToEdit.manager_id === m.id ? 'selected' : ''}>${AppState.escapeHtml(m.full_name)} — ${AppState.escapeHtml(m.position || 'Сотрудник')} (${AppState.escapeHtml(m.department || 'Без отдела')})
 </option>
            `).join('')}
          </select>
          <small class="text-muted" style="display:block; margin-top:4px; font-size:11px;">
            Руководитель автоматически получает доступ к просмотру задач и документов подчинённого.
          </small>
        </div>

        <div class="form-group">
          <label>Электронная почта (логин) *</label>
          <input type="email" id="user-email" required value="${isEdit ? AppState.escapeHtml(userToEdit.email) : ''}" placeholder="user@docflow.local">
        </div>

        <div class="form-group">
          <label>
            ${isEdit ? 'Новый пароль (оставьте пустым, если не меняете)' : 'Пароль учетной записи *'}
          </label>
          <input type="password" id="user-pass" ${!isEdit ? 'required' : ''} placeholder="••••••••">
          ${isEdit ? '<small class="text-muted" style="display:block; margin-top:4px; font-size:11px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-lock"/></svg> Пароль будет автоматически захэширован в базе данных через bcrypt.</small>' : ''}
        </div>

        <div class="form-group">
          <label>Роль в системе</label>
          <select id="user-role">
            <option value="USER" ${isEdit && userToEdit.role === 'USER' ? 'selected' : ''}>Пользователь (USER)</option>
            <option value="ADMIN" ${isEdit && userToEdit.role === 'ADMIN' ? 'selected' : ''}>Администратор (ADMIN)</option>
          </select>
        </div>

        <button type="submit" id="btn-submit-user-form" class="btn btn-primary btn-block" style="margin-top: 10px;">
          ${isEdit ? 'Сохранить изменения' : 'Создать участника'}
        </button>
      </form>
    `;
    AppState.openModal();

    const submitBtn = document.getElementById('btn-submit-user-form');
    const deptCombo = mountDepartmentCombobox({
      wrapperEl: document.getElementById('user-dept-combobox-mount'),
      departments: cachedDepartments,
      initialDeptId: isEdit ? userToEdit.department_id : null,
      initialDeptName: isEdit ? userToEdit.department : '',
      submitBtnEl: submitBtn
    });

    document.getElementById('user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const deptVal = deptCombo.getValue();
      if (!deptVal.isValid) {
        AppState.showAlert('Указанный отдел не найден в справочнике. Выберите отдел из списка или «Без отдела».', 'danger');
        deptCombo.focus();
        return;
      }

      const managerVal = document.getElementById('user-manager').value;
      const payload = {
        full_name: document.getElementById('user-fullname').value.trim(),
        email: document.getElementById('user-email').value.trim(),
        role: document.getElementById('user-role').value,
        department_id: deptVal.department_id,
        department: deptVal.department,
        position: document.getElementById('user-position').value.trim(),
        manager_id: managerVal ? parseInt(managerVal, 10) : null
      };
      const pass = document.getElementById('user-pass').value.trim();
      if (pass) {
        payload.password = pass;
      }

      try {
        if (isEdit) {
          await API.updateUser(userToEdit.id, payload);
          AppState.showAlert('Данные участника обновлены', 'success');
        } else {
          await API.createUser(payload);
          AppState.showAlert('Новый участник добавлен в систему', 'success');
        }
        AppState.closeModal();
        render(containerEl);
      } catch (err) {
        AppState.showAlert('Ошибка при сохранении участника: ' + err.message, 'danger');
      }
    });
  }

  return {
    render: render,
    onActivated: (containerEl) => {
      updateHeaderAndActions(containerEl);
    }
  };
})();
