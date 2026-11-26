// public/js/modules/materials.js
// Трёхуровневое отдельное подразделение: Направление -> Проект -> Материал
window.MaterialsModule = (function() {
  let currentLevel = 'directions'; // 'directions' | 'projects' | 'materials'
  let selectedDirection = null;
  let selectedProject = null;
  let directionsList = [];
  let currentProjects = [];
  let currentMaterials = [];
  let searchQuery = '';
  let selectedTypeFilter = 'ALL';
  let selectedStatusFilter = 'ALL';
  let dirPage = 1;
  let dirPageSize = 9;
  let dirProjSearch = '';
  let dirProjPage = 1;
  let dirProjPageSize = 8;
  let matPage = 1;
  let matPageSize = 12;

  // RENDER ENTRYPOINT
  async function render(containerEl) {
    AppState.setHeader('Направления и база материалов', 'Трёхуровневое подразделение: Направление &rarr; Проект &rarr; Материал');
    AppState.setTopBarActions('');

    // Restore to root if not set
    if (!selectedDirection) {
      currentLevel = 'directions';
    }

    await refreshView(containerEl);
  }

  async function refreshView(containerEl) {
    if (currentLevel === 'directions') {
      await renderDirectionsLevel(containerEl);
    } else if (currentLevel === 'projects') {
      await renderProjectsLevel(containerEl);
    } else if (currentLevel === 'materials') {
      await renderMaterialsLevel(containerEl);
    }
  }

  // ==========================================
  // LEVEL 1: НАПРАВЛЕНИЯ (DIRECTIONS)
  // ==========================================
  async function renderDirectionsLevel(containerEl) {
    AppState.setHeader('Направления деятельности', 'Уровень 1: Выберите стратегическое направление компании для доступа к проектам и материалам');

    const currentUser = AppState.getCurrentUser();
    const canManage = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin' || currentUser?.role_code === 'manager';

    if (canManage) {
      AppState.setTopBarActions(`<button class="btn btn-primary" id="btn-create-direction">+ Создать направление</button>`);
      document.getElementById('btn-create-direction')?.addEventListener('click', () => openDirectionModal());
    } else {
      AppState.setTopBarActions('');
    }

    containerEl.innerHTML = `
      <div class="hierarchy-level-container">
        <!-- TOP BANNER -->
        <div class="card" style="margin-bottom: 20px; background: linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(99, 102, 241, 0.04)); border: 1px solid rgba(59, 130, 246, 0.2);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span style="font-size: 20px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-compass'/></svg></span>
                <h2 style="font-size: 16px; font-weight: 700; color: var(--text-main); margin: 0;">Трёхуровневый фонд проектных материалов</h2>
              </div>
              <p style="color: var(--text-muted); font-size: 12.5px; margin: 0;">
                Структурированное хранение документации и спецификаций: <b>Направление &rarr; Проект &rarr; Материал</b> (изолировано от общего хранилища файлов).
              </p>
            </div>
            <div style="display: flex; gap: 10px; align-items: center;">
              <input type="text" id="directions-search-input" placeholder="Поиск направлений..." value="${AppState.escapeHtml(searchQuery)}"
                     style="padding: 7px 12px; font-size: 13px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-main); width: 220px;">
            </div>
          </div>
        </div>

        <!-- DIRECTIONS GRID -->
        <div id="directions-grid-container" class="grid-3" style="gap: 18px;">
          <div class="skeleton-card" style="height: 180px;"></div>
          <div class="skeleton-card" style="height: 180px;"></div>
          <div class="skeleton-card" style="height: 180px;"></div>
        </div>
      </div>
    `;

    // Search event
    const searchInput = containerEl.querySelector('#directions-search-input');
    searchInput?.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      dirPage = 1;
      renderFilteredDirections(containerEl);
    });

    try {
      directionsList = await API.getDirections();
      renderFilteredDirections(containerEl);
    } catch (err) {
      containerEl.querySelector('#directions-grid-container').innerHTML = `
        <div class="form-error">Ошибка загрузки направлений: ${AppState.escapeHtml(err.message)}</div>
      `;
    }
  }

  function renderFilteredDirections(containerEl) {
    const gridEl = containerEl.querySelector('#directions-grid-container');
    if (!gridEl) return;

    let filtered = directionsList;
    if (searchQuery) {
      filtered = directionsList.filter(d =>
        (d.name && d.name.toLowerCase().includes(searchQuery)) ||
        (d.description && d.description.toLowerCase().includes(searchQuery)) ||
        (d.code && d.code.toLowerCase().includes(searchQuery))
      );
    }

    if (filtered.length === 0) {
      gridEl.innerHTML = `
        <div class="card" style="grid-column: 1 / -1; text-align: center; padding: 40px;">
          <div style="font-size: 36px; margin-bottom: 8px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-compass'/></svg></div>
          <h3 style="font-size: 15px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">Направления не найдены</h3>
          <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 16px;">Попробуйте изменить поисковый запрос или создайте новое направление.</p>
        </div>
      `;
      return;
    }

    const currentUser = AppState.getCurrentUser();
    const canManage = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin';
    const pg = AppState.paginate(filtered, dirPage, dirPageSize);
    dirPage = pg.page;

    gridEl.innerHTML = pg.items.map(d => {
      const iconHtml = typeof dfIcon === 'function' ? dfIcon(d.icon || 'compass', 20) : '';
      const color = d.color || '#3b82f6';
      const prjCount = d.projects_count || 0;
      const matCount = d.materials_count || 0;

      return `
        <div class="card direction-card" data-direction-id="${d.id}" style="border-top: 4px solid ${color}; display: flex; flex-direction: column; justify-content: space-between; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <div style="width: 40px; height: 40px; border-radius: 10px; background: ${color}15; color: ${color}; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;">
                  ${iconHtml}
                </div>
                <div>
                  <span class="badge" style="background: ${color}20; color: ${color}; font-size: 10px; font-weight: 700; letter-spacing: 0.5px;">${AppState.escapeHtml(d.code || 'DIR')}</span>
                  <h3 style="font-size: 15px; font-weight: 700; color: var(--text-main); margin: 3px 0 0 0; line-height: 1.3;">
                    ${AppState.escapeHtml(d.name)}
                  </h3>
                </div>
              </div>
              ${canManage ? `
                <div style="display: flex; gap: 4px;" onclick="event.stopPropagation();">
                  <button class="btn-icon btn-edit-dir" data-id="${d.id}" title="Редактировать" style="font-size: 13px; padding: 4px 6px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg></button>
                  <button class="btn-icon btn-delete-dir" data-id="${d.id}" title="Удалить" style="font-size: 13px; padding: 4px 6px; color: var(--danger);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-trash'/></svg></button>
                </div>
              ` : ''}
            </div>

            <p style="color: var(--text-muted); font-size: 12.5px; line-height: 1.45; margin-bottom: 16px; min-height: 36px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              ${AppState.escapeHtml(d.description || 'Описание направления деятельности отсутствует')}
            </p>
          </div>

          <div>
            <!-- METRICS SUMMARY -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: var(--bg-subtle); padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 14px;">
              <div style="text-align: center;">
                <div style="font-size: 16px; font-weight: 700; color: var(--text-main);">${prjCount}</div>
                <div style="font-size: 11px; color: var(--text-muted);">Проектов</div>
              </div>
              <div style="text-align: center; border-left: 1px solid var(--border-color);">
                <div style="font-size: 16px; font-weight: 700; color: ${color};">${matCount}</div>
                <div style="font-size: 11px; color: var(--text-muted);">Материалов</div>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11.5px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-user"/></svg> ${AppState.escapeHtml(d.manager_name || 'Не назначен')}
              </span>
              <span style="font-size: 12px; color: var(--primary); font-weight: 600; display: flex; align-items: center; gap: 4px;">
                Открыть проекты &rarr;
              </span>
            </div>
          </div>
        </div>
      `;
    }).join('') + `<div style="grid-column: 1 / -1;">${AppState.renderPaginationHtml(pg, { pageSizeOptions: [9, 18, 36] })}</div>`;

    AppState.bindPaginationEvents(gridEl, {
      onPageChange: (p) => { dirPage = p; renderFilteredDirections(containerEl); },
      onPageSizeChange: (sz) => { dirPageSize = sz; dirPage = 1; renderFilteredDirections(containerEl); }
    });

    // Bind card clicks
    gridEl.querySelectorAll('.direction-card').forEach(card => {
      card.addEventListener('click', async () => {
        const dirId = parseInt(card.getAttribute('data-direction-id'), 10);
        selectedDirection = directionsList.find(d => d.id === dirId);
        currentLevel = 'projects';
        await refreshView(containerEl);
      });
    });

    // Bind Edit/Delete
    gridEl.querySelectorAll('.btn-edit-dir').forEach(btn => {
      btn.addEventListener('click', () => {
        const dirId = parseInt(btn.getAttribute('data-id'), 10);
        const dir = directionsList.find(d => d.id === dirId);
        if (dir) openDirectionModal(dir);
      });
    });

    gridEl.querySelectorAll('.btn-delete-dir').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dirId = parseInt(btn.getAttribute('data-id'), 10);
        if (confirm('Вы действительно хотите удалить это направление? Проекты направления останутся в системе.')) {
          try {
            await API.deleteDirection(dirId);
            directionsList = directionsList.filter(d => d.id !== dirId);
            renderFilteredDirections(containerEl);
          } catch (e) {
            alert('Ошибка удаления: ' + e.message);
          }
        }
      });
    });
  }

  // ==========================================
  // LEVEL 2: ПРОЕКТЫ НАПРАВЛЕНИЯ (PROJECTS)
  // ==========================================
  async function renderProjectsLevel(containerEl) {
    if (!selectedDirection) {
      currentLevel = 'directions';
      await renderDirectionsLevel(containerEl);
      return;
    }

    AppState.setHeader(
      `Проекты: ${selectedDirection.name}`,
      `Уровень 2: Проекты направления «${selectedDirection.name}». Выберите проект для доступа к его материалам.`
    );

    const currentUser = AppState.getCurrentUser();
    const canCreate = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin' || currentUser?.role_code === 'manager';

    if (canCreate) {
      AppState.setTopBarActions(`
        <button class="btn btn-secondary" id="btn-back-to-directions-top">← Все направления</button>
        <button class="btn btn-primary" id="btn-create-proj-in-dir">+ Создать проект</button>
      `);
      document.getElementById('btn-back-to-directions-top')?.addEventListener('click', () => {
        currentLevel = 'directions';
        selectedDirection = null;
        refreshView(containerEl);
      });
      document.getElementById('btn-create-proj-in-dir')?.addEventListener('click', () => openProjectInDirectionModal(selectedDirection));
    } else {
      AppState.setTopBarActions(`<button class="btn btn-secondary" id="btn-back-to-directions-top">← Все направления</button>`);
      document.getElementById('btn-back-to-directions-top')?.addEventListener('click', () => {
        currentLevel = 'directions';
        selectedDirection = null;
        refreshView(containerEl);
      });
    }

    containerEl.innerHTML = `
      <div class="hierarchy-level-container">
        <!-- BREADCRUMBS NAVIGATION (LEVEL 1 -> LEVEL 2) -->
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 16px;">
          <div class="hierarchy-breadcrumbs" style="display: flex; align-items: center; gap: 8px; font-size: 13px;">
            <a href="javascript:void(0)" id="breadcrumb-all-directions" style="color: var(--primary); text-decoration: none; font-weight: 600;">
              <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-compass"/></svg> Все направления
            </a>
            <span style="color: var(--text-muted);">&rsaquo;</span>
            <span style="color: var(--text-main); font-weight: 700;">
              ${AppState.escapeHtml(selectedDirection.name)}
            </span>
          </div>
          <button class="btn btn-sm btn-secondary" id="btn-back-to-directions">
            ← Назад к направлениям
          </button>
        </div>

        <!-- DIRECTION HEADER BANNER -->
        <div class="card" style="margin-bottom: 20px; border-left: 5px solid ${selectedDirection.color || '#3b82f6'};">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 14px;">
              <div style="width: 48px; height: 48px; border-radius: 12px; background: ${(selectedDirection.color || '#3b82f6')}20; color: ${selectedDirection.color || '#3b82f6'}; display: flex; align-items: center; justify-content: center; font-size: 24px;">
                ${typeof dfIcon === 'function' ? dfIcon(selectedDirection.icon || 'compass', 22) : ''}
              </div>
              <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="badge" style="background: ${(selectedDirection.color || '#3b82f6')}20; color: ${selectedDirection.color || '#3b82f6'}; font-weight: 700;">
                    ${AppState.escapeHtml(selectedDirection.code || 'DIR')}
                  </span>
                  <h2 style="font-size: 18px; font-weight: 700; color: var(--text-main); margin: 0;">
                    ${AppState.escapeHtml(selectedDirection.name)}
                  </h2>
                </div>
                <p style="color: var(--text-muted); font-size: 12.5px; margin: 4px 0 0 0;">
                  ${AppState.escapeHtml(selectedDirection.description || 'Описание отсутствует')}
                </p>
              </div>
            </div>
            <div>
              <span class="badge badge-subtle" style="font-size: 12px; padding: 6px 12px;">
                Руководитель: <b>${AppState.escapeHtml(selectedDirection.manager_name || 'Не назначен')}</b>
              </span>
            </div>
          </div>
        </div>

        <!-- SEARCH BAR FOR DIRECTION PROJECTS -->
        <div class="card list-toolbar-card">
          <div class="list-toolbar-search">
            <input type="text" id="dir-projects-search-input" class="list-search-input" placeholder="Поиск проектов в направлении..." value="${AppState.escapeHtml(dirProjSearch)}" autocomplete="off">
          </div>
          <span id="dir-projects-count" class="badge badge-subtle" style="font-size: 12px;">0</span>
        </div>

        <!-- PROJECTS CONTAINER -->
        <div id="dir-projects-grid" class="grid-2" style="gap: 16px;">
          <div class="skeleton-card" style="height: 160px;"></div>
          <div class="skeleton-card" style="height: 160px;"></div>
        </div>
      </div>
    `;

    // Breadcrumbs click
    containerEl.querySelector('#breadcrumb-all-directions')?.addEventListener('click', () => {
      currentLevel = 'directions';
      selectedDirection = null;
      refreshView(containerEl);
    });
    containerEl.querySelector('#btn-back-to-directions')?.addEventListener('click', () => {
      currentLevel = 'directions';
      selectedDirection = null;
      refreshView(containerEl);
    });

    try {
      const details = await API.getDirectionDetails(selectedDirection.id);
      currentProjects = details.projects || [];

      const renderFilteredDirProjects = () => {
        const gridEl = containerEl.querySelector('#dir-projects-grid');
        if (!gridEl) return;

        const q = (dirProjSearch || '').toLowerCase().trim();
        const filteredProjects = currentProjects.filter(p => {
          if (!q) return true;
          return `${p.title || ''} ${p.description || ''}`.toLowerCase().includes(q);
        });

        const cntEl = containerEl.querySelector('#dir-projects-count');
        if (cntEl) cntEl.textContent = `Найдено: ${filteredProjects.length}`;

        if (filteredProjects.length === 0) {
          gridEl.innerHTML = `
            <div class="card" style="grid-column: 1 / -1; text-align: center; padding: 40px;">
              <div style="font-size: 36px; margin-bottom: 8px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-folder'/></svg></div>
              <h3 style="font-size: 15px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">
                ${currentProjects.length === 0 ? 'В направлении пока нет проектов' : 'Проекты не найдены'}
              </h3>
              <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 16px;">
                ${currentProjects.length === 0 ? 'Создайте первый проект для данного направления, чтобы прикреплять материалы и ставить задачи.' : 'Попробуйте изменить поисковый запрос.'}
              </p>
              ${canCreate && currentProjects.length === 0 ? `<button class="btn btn-primary" id="btn-empty-create-proj">+ Создать проект</button>` : ''}
            </div>
          `;
          gridEl.querySelector('#btn-empty-create-proj')?.addEventListener('click', () => openProjectInDirectionModal(selectedDirection));
          return;
        }

        const pg = AppState.paginate(filteredProjects, dirProjPage, dirProjPageSize);
        dirProjPage = pg.page;

        gridEl.innerHTML = pg.items.map(p => {
          const matCount = p.materials_count || 0;
          const totalTasks = p.total_tasks || 0;
          const compTasks = p.completed_tasks || 0;

          return `
            <div class="card project-dir-card" data-project-id="${p.id}" style="cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; transition: transform 0.2s, box-shadow 0.2s;">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                  <h3 style="font-size: 15px; font-weight: 700; color: var(--text-main); margin: 0; display: flex; align-items: center; gap: 8px;">
                    <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder"/></svg></span>
                    <span>${AppState.escapeHtml(p.title)}</span>
                  </h3>
                  <span class="badge ${p.status === 'ACTIVE' ? 'badge-active' : 'badge-subtle'}">${p.status || 'ACTIVE'}</span>
                </div>

                <p style="color: var(--text-muted); font-size: 12.5px; line-height: 1.4; margin-bottom: 14px; min-height: 34px;">
                  ${AppState.escapeHtml(p.description || 'Описание проекта не указано')}
                </p>
              </div>

              <div>
                <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-subtle); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 12px; font-size: 12px;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="color: var(--primary); font-weight: 700;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-folders'/></svg> ${matCount}</span>
                    <span style="color: var(--text-muted);">материалов</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="color: var(--text-main); font-weight: 600;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-clipboard'/></svg> ${compTasks}/${totalTasks}</span>
                    <span style="color: var(--text-muted);">задач решено</span>
                  </div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 11px; color: var(--text-muted);">
                    ${p.start_date ? `Сроки: ${p.start_date.slice(0, 10)}` : 'Бессрочный проект'}
                  </span>
                  <span style="font-size: 12px; color: var(--primary); font-weight: 600; display: flex; align-items: center; gap: 4px;">
                    Материалы проекта &rarr;
                  </span>
                </div>
              </div>
            </div>
          `;
        }).join('') + `<div style="grid-column: 1 / -1;">${AppState.renderPaginationHtml(pg, { pageSizeOptions: [8, 16, 32] })}</div>`;

        AppState.bindPaginationEvents(gridEl, {
          onPageChange: (p) => { dirProjPage = p; renderFilteredDirProjects(); },
          onPageSizeChange: (sz) => { dirProjPageSize = sz; dirProjPage = 1; renderFilteredDirProjects(); }
        });

        gridEl.querySelectorAll('.project-dir-card').forEach(card => {
          card.addEventListener('click', async () => {
            const projId = parseInt(card.getAttribute('data-project-id'), 10);
            selectedProject = currentProjects.find(p => p.id === projId);
            currentLevel = 'materials';
            matPage = 1;
            await refreshView(containerEl);
          });
        });
      };

      containerEl.querySelector('#dir-projects-search-input')?.addEventListener('input', (e) => {
        dirProjSearch = e.target.value;
        dirProjPage = 1;
        renderFilteredDirProjects();
      });

      renderFilteredDirProjects();

    } catch (err) {
      containerEl.querySelector('#dir-projects-grid').innerHTML = `
        <div class="form-error">Ошибка загрузки проектов направления: ${AppState.escapeHtml(err.message)}</div>
      `;
    }
  }

  // ==========================================
  // LEVEL 3: МАТЕРИАЛЫ ПРОЕКТА (MATERIALS)
  // ==========================================
  async function renderMaterialsLevel(containerEl) {
    if (!selectedProject || !selectedDirection) {
      currentLevel = 'directions';
      await renderDirectionsLevel(containerEl);
      return;
    }

    AppState.setHeader(
      `Материалы: ${selectedProject.title}`,
      `Уровень 3: Репозиторий проектных материалов и документации проекта «${selectedProject.title}»`
    );

    const currentUser = AppState.getCurrentUser();
    const canUpload = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin' || currentUser?.role_code === 'manager' || currentUser?.role_code === 'employee';

    if (canUpload) {
      AppState.setTopBarActions(`
        <button class="btn btn-secondary" id="btn-back-to-projects-top">← К проектам</button>
        <button class="btn btn-primary" id="btn-upload-material"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-upload'/></svg> Добавить материал</button>
      `);
      document.getElementById('btn-back-to-projects-top')?.addEventListener('click', () => {
        currentLevel = 'projects';
        selectedProject = null;
        refreshView(containerEl);
      });
      document.getElementById('btn-upload-material')?.addEventListener('click', () => openMaterialModal(selectedProject));
    } else {
      AppState.setTopBarActions(`<button class="btn btn-secondary" id="btn-back-to-projects-top">← К проектам</button>`);
      document.getElementById('btn-back-to-projects-top')?.addEventListener('click', () => {
        currentLevel = 'projects';
        selectedProject = null;
        refreshView(containerEl);
      });
    }

    containerEl.innerHTML = `
      <div class="hierarchy-level-container">
        <!-- 3-LEVEL BREADCRUMBS (DIRECTIONS > PROJECT > MATERIALS) -->
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 16px;">
          <div class="hierarchy-breadcrumbs" style="display: flex; align-items: center; gap: 8px; font-size: 13px; flex-wrap: wrap;">
            <a href="javascript:void(0)" id="bc-all-dirs" style="color: var(--primary); text-decoration: none; font-weight: 600;">
              <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-compass"/></svg> Все направления
            </a>
            <span style="color: var(--text-muted);">&rsaquo;</span>
            <a href="javascript:void(0)" id="bc-current-dir" style="color: var(--primary); text-decoration: none; font-weight: 600;">
              ${AppState.escapeHtml(selectedDirection.name)}
            </a>
            <span style="color: var(--text-muted);">&rsaquo;</span>
            <span style="color: var(--text-main); font-weight: 700;">
              <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder"/></svg> ${AppState.escapeHtml(selectedProject.title)}
            </span>
          </div>

          <button class="btn btn-sm btn-secondary" id="btn-back-to-projects">
            ← Назад к проектам
          </button>
        </div>

        <!-- FILTER TOOLBAR -->
        <div class="card" style="margin-bottom: 18px; padding: 12px 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 260px;">
              <input type="text" id="materials-search-input" placeholder="Найти материал по названию или описанию..." 
                     style="width: 100%; padding: 8px 12px; font-size: 13px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-main);">
            </div>
            
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <!-- TYPE FILTER -->
              <select id="filter-material-type" style="padding: 7px 10px; font-size: 12.5px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-main);">
                <option value="ALL">Все типы материалов</option>
                <option value="СПЕЦИФИКАЦИЯ">ТЗ / Спецификации</option>
                <option value="ЧЕРТЕЖ">Чертежи и схемы</option>
                <option value="РЕГЛАМЕНТ">Регламенты и стандарты</option>
                <option value="ДОГОВОР">Договоры и соглашения</option>
                <option value="ОТЧЕТ">Финальные отчеты</option>
                <option value="ПРЕЗЕНТАЦИЯ">Презентации</option>
                <option value="ДИЗАЙН">Дизайн-макеты</option>
              </select>

              <!-- STATUS FILTER -->
              <select id="filter-material-status" style="padding: 7px 10px; font-size: 12.5px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-main);">
                <option value="ALL">Все статусы</option>
                <option value="APPROVED">Утвержден</option>
                <option value="IN_REVIEW">На согласовании</option>
                <option value="DRAFT">Черновик</option>
                <option value="ARCHIVED">В архиве</option>
              </select>
            </div>
          </div>
        </div>

        <!-- MATERIALS LIST CONTAINER -->
        <div id="materials-cards-container" style="display: flex; flex-direction: column; gap: 12px;">
          <div class="skeleton-card" style="height: 100px;"></div>
          <div class="skeleton-card" style="height: 100px;"></div>
        </div>
      </div>
    `;

    // Navigation events
    containerEl.querySelector('#bc-all-dirs')?.addEventListener('click', () => {
      currentLevel = 'directions';
      selectedDirection = null;
      selectedProject = null;
      refreshView(containerEl);
    });
    containerEl.querySelector('#bc-current-dir')?.addEventListener('click', () => {
      currentLevel = 'projects';
      selectedProject = null;
      refreshView(containerEl);
    });
    containerEl.querySelector('#btn-back-to-projects')?.addEventListener('click', () => {
      currentLevel = 'projects';
      selectedProject = null;
      refreshView(containerEl);
    });

    // Filters
    const searchInput = containerEl.querySelector('#materials-search-input');
    const typeSelect = containerEl.querySelector('#filter-material-type');
    const statusSelect = containerEl.querySelector('#filter-material-status');

    searchInput?.addEventListener('input', () => { matPage = 1; filterAndRenderMaterials(containerEl); });
    typeSelect?.addEventListener('change', () => { matPage = 1; filterAndRenderMaterials(containerEl); });
    statusSelect?.addEventListener('change', () => { matPage = 1; filterAndRenderMaterials(containerEl); });

    await loadAndRenderMaterials(containerEl);
  }

  async function loadAndRenderMaterials(containerEl) {
    try {
      currentMaterials = await API.getProjectMaterials(selectedProject.id);
      filterAndRenderMaterials(containerEl);
    } catch (err) {
      containerEl.querySelector('#materials-cards-container').innerHTML = `
        <div class="form-error">Ошибка загрузки материалов: ${AppState.escapeHtml(err.message)}</div>
      `;
    }
  }

  function filterAndRenderMaterials(containerEl) {
    const searchVal = (containerEl.querySelector('#materials-search-input')?.value || '').toLowerCase().trim();
    const typeVal = containerEl.querySelector('#filter-material-type')?.value || 'ALL';
    const statusVal = containerEl.querySelector('#filter-material-status')?.value || 'ALL';

    let filtered = currentMaterials;

    if (searchVal) {
      filtered = filtered.filter(m =>
        (m.title && m.title.toLowerCase().includes(searchVal)) ||
        (m.description && m.description.toLowerCase().includes(searchVal)) ||
        (m.file_name && m.file_name.toLowerCase().includes(searchVal))
      );
    }

    if (typeVal !== 'ALL') {
      filtered = filtered.filter(m => m.material_type === typeVal);
    }

    if (statusVal !== 'ALL') {
      filtered = filtered.filter(m => m.status === statusVal);
    }

    const container = containerEl.querySelector('#materials-cards-container');
    if (!container) return;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 40px;">
          <div style="font-size: 36px; margin-bottom: 8px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-files'/></svg></div>
          <h3 style="font-size: 15px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">
            Материалы не найдены
          </h3>
          <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 16px;">
            В этом проекте еще нет материалов с заданными параметрами фильтрации.
          </p>
          <button class="btn btn-primary" id="btn-empty-upload-mat"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-upload'/></svg> Добавить первый материал</button>
        </div>
      `;
      container.querySelector('#btn-empty-upload-mat')?.addEventListener('click', () => openMaterialModal(selectedProject));
      return;
    }

    const currentUser = AppState.getCurrentUser();
    const canManage = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin' || currentUser?.role_code === 'manager';
    const pg = AppState.paginate(filtered, matPage, matPageSize);
    matPage = pg.page;

    container.innerHTML = pg.items.map(m => {
      const ext = (m.file_type || 'docx').toLowerCase();
      let icon = dfIcon('file-text', 16);
      if (ext.includes('doc')) icon = dfIcon('file-edit', 16);
      else if (ext.includes('xls') || ext.includes('csv')) icon = dfIcon('bar-chart', 16);
      else if (ext.includes('pdf')) icon = dfIcon('book', 16);
      else if (ext.includes('zip') || ext.includes('rar') || ext.includes('7z')) icon = dfIcon('archive', 16);
      else if (ext.includes('ppt')) icon = dfIcon('video', 16);
      else if (['png', 'jpg', 'jpeg', 'svg'].includes(ext)) icon = dfIcon('image', 16);

      // Status badge styling
      let statusBadge = '<span class="badge badge-active">Утверждено</span>';
      if (m.status === 'IN_REVIEW') statusBadge = '<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b;">На согласовании</span>';
      else if (m.status === 'DRAFT') statusBadge = '<span class="badge badge-subtle">Черновик</span>';
      else if (m.status === 'ARCHIVED') statusBadge = '<span class="badge" style="background: rgba(107, 114, 128, 0.2); color: #9ca3af;">Архив</span>';

      const formattedSize = m.file_size ? `${(m.file_size / 1024).toFixed(1)} КБ` : '0 КБ';
      const createdDate = m.created_at ? new Date(m.created_at).toLocaleDateString('ru-RU') : '';

      return `
        <div class="card material-item-card" data-id="${m.id}" style="padding: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
          <div style="display: flex; align-items: center; gap: 14px; min-width: 240px; flex: 1;">
            <div style="width: 44px; height: 44px; border-radius: 10px; background: rgba(59, 130, 246, 0.1); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0;">
              ${icon}
            </div>
            <div style="min-width: 0; flex: 1;">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                <span class="badge" style="background: var(--bg-subtle); color: var(--primary); font-size: 10.5px; font-weight: 700; border: 1px solid var(--border-color);">
                  ${AppState.escapeHtml(m.material_type || 'СПЕЦИФИКАЦИЯ')}
                </span>
                <span class="badge badge-subtle" style="font-size: 10.5px; font-weight: 700;">
                  v${AppState.escapeHtml(m.version || '1.0')}
                </span>
                ${statusBadge}
              </div>
              <h4 style="font-size: 15px; font-weight: 700; color: var(--text-main); margin: 0 0 3px 0; word-break: break-word;">
                ${AppState.escapeHtml(m.title)}
              </h4>
              <p style="color: var(--text-muted); font-size: 12px; margin: 0 0 6px 0; line-height: 1.35;">
                ${AppState.escapeHtml(m.description || 'Описание отсутствует')}
              </p>
              <div style="display: flex; align-items: center; gap: 12px; font-size: 11px; color: var(--text-muted); flex-wrap: wrap;">
                <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-paperclip"/></svg> <b>${AppState.escapeHtml(m.file_name)}</b> (${formattedSize})</span>
                <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-user"/></svg> ${AppState.escapeHtml(m.author_name || 'Сотрудник')}</span>
                <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-calendar"/></svg> ${createdDate}</span>
              </div>
            </div>
          </div>

          <!-- ACTIONS -->
          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
            <button class="btn btn-sm btn-primary btn-download-mat" data-id="${m.id}" data-filename="${AppState.escapeHtml(m.file_name)}" style="display: inline-flex; align-items: center; gap: 6px;">
              <span>⤓</span>
              <span>Скачать</span>
            </button>
            ${canManage ? `
              <button class="btn-icon btn-edit-mat" data-id="${m.id}" title="Изменить статус / версию" style="font-size: 13px; padding: 6px 8px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg></button>
              <button class="btn-icon btn-delete-mat" data-id="${m.id}" title="Удалить материал" style="font-size: 13px; padding: 6px 8px; color: var(--danger);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-trash'/></svg></button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('') + AppState.renderPaginationHtml(pg, { pageSizeOptions: [12, 24, 50] });

    AppState.bindPaginationEvents(container, {
      onPageChange: (p) => { matPage = p; filterAndRenderMaterials(containerEl); },
      onPageSizeChange: (sz) => { matPageSize = sz; matPage = 1; filterAndRenderMaterials(containerEl); }
    });

    // Bind Download
    container.querySelectorAll('.btn-download-mat').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const filename = btn.getAttribute('data-filename');
        btn.disabled = true;
        btn.textContent = 'Загрузка...';
        try {
          await API.downloadProjectMaterial(id, filename);
        } catch (e) {
          alert('Ошибка скачивания: ' + e.message);
        } finally {
          btn.disabled = false;
          btn.innerHTML = `<span>⤓</span><span>Скачать</span>`;
        }
      });
    });

    // Bind Edit
    container.querySelectorAll('.btn-edit-mat').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const mat = currentMaterials.find(m => m.id === id);
        if (mat) openEditMaterialModal(mat, containerEl);
      });
    });

    // Bind Delete
    container.querySelectorAll('.btn-delete-mat').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        if (confirm('Вы уверены, что хотите удалить этот проектный материал? Файл будет безвозвратно удален.')) {
          try {
            await API.deleteProjectMaterial(id);
            currentMaterials = currentMaterials.filter(m => m.id !== id);
            filterAndRenderMaterials(containerEl);
          } catch (e) {
            alert('Ошибка удаления: ' + e.message);
          }
        }
      });
    });
  }

  // ==========================================
  // MODALS
  // ==========================================

  // 1. DIRECTION MODAL (CREATE / EDIT)
  async function openDirectionModal(dir = null) {
    const isEdit = !!dir;
    let users = [];
    try {
      users = await API.getUsers();
    } catch (e) {}

    const userOptions = users.map(u => `
      <option value="${u.id}" ${dir && dir.manager_id === u.id ? 'selected' : ''}>${AppState.escapeHtml(u.full_name)} (${AppState.escapeHtml(u.department || 'Сотрудник')})
 </option>
    `).join('');

    const bodyHtml = `
      <form id="form-direction-modal">
        <div class="form-group">
          <label>Название направления <span style="color: var(--danger)">*</span></label>
          <input type="text" id="dir-name" required placeholder="Например: Информационные технологии и цифровизация" value="${dir ? AppState.escapeHtml(dir.name) : ''}">
        </div>

        <div class="grid-2" style="gap: 12px;">
          <div class="form-group">
            <label>Код направления</label>
            <input type="text" id="dir-code" placeholder="IT, RND, PROD..." value="${dir ? AppState.escapeHtml(dir.code || '') : ''}">
          </div>
          <div class="form-group">
            <label>Иконка</label>
            <select id="dir-icon" class="form-control">
              <option value="compass" ${!dir?.icon || (window.DF_EMOJI_MAP?.[dir.icon] || dir.icon) === 'compass' ? 'selected' : ''}>Направление (компас)</option>
              <option value="monitor" ${(window.DF_EMOJI_MAP?.[dir?.icon] || dir?.icon) === 'monitor' ? 'selected' : ''}>ИТ и разработка</option>
              <option value="flask" ${(window.DF_EMOJI_MAP?.[dir?.icon] || dir?.icon) === 'flask' ? 'selected' : ''}>Исследования и R&D</option>
              <option value="building" ${(window.DF_EMOJI_MAP?.[dir?.icon] || dir?.icon) === 'building' ? 'selected' : ''}>Инфраструктура</option>
              <option value="bar-chart" ${(window.DF_EMOJI_MAP?.[dir?.icon] || dir?.icon) === 'bar-chart' ? 'selected' : ''}>Аналитика</option>
              <option value="shield" ${(window.DF_EMOJI_MAP?.[dir?.icon] || dir?.icon) === 'shield' ? 'selected' : ''}>Безопасность</option>
              <option value="folder" ${(window.DF_EMOJI_MAP?.[dir?.icon] || dir?.icon) === 'folder' ? 'selected' : ''}>Общие проекты</option>
            </select>
          </div>
        </div>

        <div class="grid-2" style="gap: 12px;">
          <div class="form-group">
            <label>Цвет направления</label>
            <input type="color" id="dir-color" value="${dir ? (dir.color || '#3b82f6') : '#3b82f6'}" style="height: 42px; padding: 2px;">
          </div>
          <div class="form-group">
            <label>Руководитель направления</label>
            <select id="dir-manager">
              <option value="">-- Выберите руководителя --</option>
              ${userOptions}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label>Описание направления и цели</label>
          <textarea id="dir-description" rows="3" placeholder="Краткое описание стратегических целей, состава и компетенций направления...">${dir ? AppState.escapeHtml(dir.description || '') : ''}</textarea>
        </div>

        <div id="dir-modal-error" class="form-error hidden"></div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="AppState.closeModal()">Отмена</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Сохранить изменения' : 'Создать направление'}</button>
        </div>
      </form>
    `;

    AppState.openModal(isEdit ? 'Редактирование направления' : 'Создание нового направления', bodyHtml);

    document.getElementById('form-direction-modal')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('dir-modal-error');
      errBox.classList.add('hidden');

      const data = {
        name: document.getElementById('dir-name').value.trim(),
        code: document.getElementById('dir-code').value.trim(),
        icon: document.getElementById('dir-icon').value.trim() || 'compass',
        color: document.getElementById('dir-color').value,
        manager_id: document.getElementById('dir-manager').value || null,
        description: document.getElementById('dir-description').value.trim()
      };

      try {
        if (isEdit) {
          await API.updateDirection(dir.id, data);
        } else {
          await API.createDirection(data);
        }
        AppState.closeModal();
        const contentArea = document.getElementById('content-area');
        if (contentArea) render(contentArea);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
      }
    });
  }

  // 2. PROJECT UNDER DIRECTION MODAL
  function openProjectInDirectionModal(direction) {
    const bodyHtml = `
      <form id="form-proj-dir-modal">
        <div class="form-group">
          <label>Направление</label>
          <input type="text" disabled value="${AppState.escapeHtml(direction.name)}" style="background: var(--bg-subtle);">
        </div>

        <div class="form-group">
          <label>Название проекта <span style="color: var(--danger)">*</span></label>
          <input type="text" id="pdir-title" required placeholder="Например: Модернизация мобильного клиента">
        </div>

        <div class="form-group">
          <label>Описание проекта</label>
          <textarea id="pdir-description" rows="3" placeholder="Цели, состав рабочей группы и ожидаемые результаты..."></textarea>
        </div>

        <div class="grid-2" style="gap: 12px;">
          <div class="form-group">
            <label>Дата начала</label>
            <input type="date" id="pdir-start" value="${new Date().toISOString().slice(0, 10)}">
          </div>
          <div class="form-group">
            <label>Плановая дата сдачи</label>
            <input type="date" id="pdir-end">
          </div>
        </div>

        <div class="grid-2" style="gap: 12px;">
          <div class="form-group">
            <label>Статус</label>
            <select id="pdir-status">
              <option value="ACTIVE" selected>В работе (ACTIVE)</option>
              <option value="PLANNING">Планирование (PLANNING)</option>
              <option value="COMPLETED">Завершен (COMPLETED)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Git-репозиторий (опционально)</label>
            <input type="url" id="pdir-git" placeholder="https://github.com/...">
          </div>
        </div>

        <div id="pdir-error" class="form-error hidden"></div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="AppState.closeModal()">Отмена</button>
          <button type="submit" class="btn btn-primary">Создать проект</button>
        </div>
      </form>
    `;

    AppState.openModal(`Новый проект: ${direction.name}`, bodyHtml);

    document.getElementById('form-proj-dir-modal')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('pdir-error');
      errBox.classList.add('hidden');

      const data = {
        title: document.getElementById('pdir-title').value.trim(),
        description: document.getElementById('pdir-description').value.trim(),
        start_date: document.getElementById('pdir-start').value || null,
        end_date: document.getElementById('pdir-end').value || null,
        status: document.getElementById('pdir-status').value,
        git_url: document.getElementById('pdir-git').value.trim()
      };

      try {
        await API.createDirectionProject(direction.id, data);
        AppState.closeModal();
        const contentArea = document.getElementById('content-area');
        if (contentArea) renderProjectsLevel(contentArea);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
      }
    });
  }

  // 3. MATERIAL UPLOAD / ADD MODAL
  function openMaterialModal(project) {
    const bodyHtml = `
      <form id="form-material-upload">
        <div class="form-group">
          <label>Проект</label>
          <input type="text" disabled value="${AppState.escapeHtml(project.title)}" style="background: var(--bg-subtle);">
        </div>

        <div class="form-group">
          <label>Название материала <span style="color: var(--danger)">*</span></label>
          <input type="text" id="mat-title" required placeholder="Например: Архитектурное описание сервисов платформы">
        </div>

        <div class="grid-2" style="gap: 12px;">
          <div class="form-group">
            <label>Тип материала</label>
            <select id="mat-type">
              <option value="СПЕЦИФИКАЦИЯ" selected>ТЗ / Спецификация</option>
              <option value="ЧЕРТЕЖ">Чертеж / Схема</option>
              <option value="РЕГЛАМЕНТ">Регламент / Инструкция</option>
              <option value="ДОГОВОР">Договор / Соглашение</option>
              <option value="ОТЧЕТ">Финальный отчет</option>
              <option value="ПРЕЗЕНТАЦИЯ">Презентация</option>
              <option value="ДИЗАЙН">Дизайн-макет</option>
            </select>
          </div>
          <div class="form-group">
            <label>Версия</label>
            <input type="text" id="mat-version" value="1.0" placeholder="1.0, 2.1, 3.0-rc...">
          </div>
        </div>

        <div class="grid-2" style="gap: 12px;">
          <div class="form-group">
            <label>Статус материала</label>
            <select id="mat-status">
              <option value="APPROVED" selected>Утвержден (APPROVED)</option>
              <option value="IN_REVIEW">На согласовании (IN_REVIEW)</option>
              <option value="DRAFT">Черновик (DRAFT)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Файл материала (Word, Excel, PDF, Архив и др.)</label>
            <input type="file" id="mat-file" style="padding: 6px;">
          </div>
        </div>

        <div class="form-group">
          <label>Описание и аннотация материала</label>
          <textarea id="mat-desc" rows="3" placeholder="Краткое содержание документа или перечень содержащихся спецификаций..."></textarea>
        </div>

        <div id="mat-error" class="form-error hidden"></div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="AppState.closeModal()">Отмена</button>
          <button type="submit" class="btn btn-primary" id="btn-submit-mat">Загрузить материал</button>
        </div>
      </form>
    `;

    AppState.openModal(`Добавление материала: ${project.title}`, bodyHtml);

    document.getElementById('form-material-upload')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('mat-error');
      const submitBtn = document.getElementById('btn-submit-mat');
      errBox.classList.add('hidden');

      const title = document.getElementById('mat-title').value.trim();
      const material_type = document.getElementById('mat-type').value;
      const version = document.getElementById('mat-version').value.trim() || '1.0';
      const status = document.getElementById('mat-status').value;
      const description = document.getElementById('mat-desc').value.trim();
      const fileInput = document.getElementById('mat-file');

      const formData = new FormData();
      formData.append('title', title);
      formData.append('material_type', material_type);
      formData.append('version', version);
      formData.append('status', status);
      formData.append('description', description);

      if (fileInput.files.length > 0) {
        formData.append('file', fileInput.files[0]);
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Сохранение...';

      try {
        await API.uploadProjectMaterial(project.id, formData);
        AppState.closeModal();
        const contentArea = document.getElementById('content-area');
        if (contentArea) renderMaterialsLevel(contentArea);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Загрузить материал';
      }
    });
  }

  // 4. EDIT MATERIAL MODAL
  function openEditMaterialModal(material, containerEl) {
    const bodyHtml = `
      <form id="form-material-edit">
        <div class="form-group">
          <label>Название материала <span style="color: var(--danger)">*</span></label>
          <input type="text" id="edit-mat-title" required value="${AppState.escapeHtml(material.title)}">
        </div>

        <div class="grid-2" style="gap: 12px;">
          <div class="form-group">
            <label>Тип материала</label>
            <select id="edit-mat-type">
              <option value="СПЕЦИФИКАЦИЯ" ${material.material_type === 'СПЕЦИФИКАЦИЯ' ? 'selected' : ''}>ТЗ / Спецификация</option>
              <option value="ЧЕРТЕЖ" ${material.material_type === 'ЧЕРТЕЖ' ? 'selected' : ''}>Чертеж / Схема</option>
              <option value="РЕГЛАМЕНТ" ${material.material_type === 'РЕГЛАМЕНТ' ? 'selected' : ''}>Регламент / Инструкция</option>
              <option value="ДОГОВОР" ${material.material_type === 'ДОГОВОР' ? 'selected' : ''}>Договор / Соглашение</option>
              <option value="ОТЧЕТ" ${material.material_type === 'ОТЧЕТ' ? 'selected' : ''}>Финальный отчет</option>
              <option value="ПРЕЗЕНТАЦИЯ" ${material.material_type === 'ПРЕЗЕНТАЦИЯ' ? 'selected' : ''}>Презентация</option>
              <option value="ДИЗАЙН" ${material.material_type === 'ДИЗАЙН' ? 'selected' : ''}>Дизайн-макет</option>
            </select>
          </div>
          <div class="form-group">
            <label>Версия</label>
            <input type="text" id="edit-mat-version" value="${AppState.escapeHtml(material.version || '1.0')}">
          </div>
        </div>

        <div class="form-group">
          <label>Статус материала</label>
          <select id="edit-mat-status">
            <option value="APPROVED" ${material.status === 'APPROVED' ? 'selected' : ''}>Утвержден (APPROVED)</option>
            <option value="IN_REVIEW" ${material.status === 'IN_REVIEW' ? 'selected' : ''}>На согласовании (IN_REVIEW)</option>
            <option value="DRAFT" ${material.status === 'DRAFT' ? 'selected' : ''}>Черновик (DRAFT)</option>
            <option value="ARCHIVED" ${material.status === 'ARCHIVED' ? 'selected' : ''}>В архиве (ARCHIVED)</option>
          </select>
        </div>

        <div class="form-group">
          <label>Описание и аннотация материала</label>
          <textarea id="edit-mat-desc" rows="3">${AppState.escapeHtml(material.description || '')}</textarea>
        </div>

        <div id="edit-mat-error" class="form-error hidden"></div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="AppState.closeModal()">Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить</button>
        </div>
      </form>
    `;

    AppState.openModal('Редактирование материала', bodyHtml);

    document.getElementById('form-material-edit')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('edit-mat-error');
      errBox.classList.add('hidden');

      const data = {
        title: document.getElementById('edit-mat-title').value.trim(),
        material_type: document.getElementById('edit-mat-type').value,
        version: document.getElementById('edit-mat-version').value.trim() || '1.0',
        status: document.getElementById('edit-mat-status').value,
        description: document.getElementById('edit-mat-desc').value.trim()
      };

      try {
        const updated = await API.updateProjectMaterial(material.id, data);
        AppState.closeModal();
        const idx = currentMaterials.findIndex(m => m.id === material.id);
        if (idx !== -1) {
          currentMaterials[idx] = { ...currentMaterials[idx], ...updated };
        }
        filterAndRenderMaterials(containerEl);
      } catch (err) {
      }
    });
  }

  function updateHeaderAndActions(containerEl) {
    const currentUser = AppState.getCurrentUser();
    const canManage = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin' || currentUser?.role_code === 'manager';

    if (currentLevel === 'directions') {
      AppState.setHeader('Направления деятельности', 'Уровень 1: Выберите стратегическое направление компании для доступа к проектам и материалам');
      if (canManage) {
        AppState.setTopBarActions(`<button class="btn btn-primary" id="btn-create-direction">+ Создать направление</button>`);
        document.getElementById('btn-create-direction')?.addEventListener('click', () => openDirectionModal());
      } else {
        AppState.setTopBarActions('');
      }
    } else if (currentLevel === 'projects') {
      AppState.setHeader(`Проекты направления: ${selectedDirection?.name || ''}`, 'Уровень 2: Проекты выбранного направления');
      if (canManage) {
        AppState.setTopBarActions(`
          <button class="btn btn-secondary" id="btn-back-to-directions-top">← Все направления</button>
          <button class="btn btn-primary" id="btn-create-proj-in-dir">+ Создать проект</button>
        `);
        document.getElementById('btn-back-to-directions-top')?.addEventListener('click', () => {
          currentLevel = 'directions';
          selectedDirection = null;
          refreshView(containerEl || document.getElementById('view-panel-materials'));
        });
        document.getElementById('btn-create-proj-in-dir')?.addEventListener('click', () => openProjectInDirectionModal(selectedDirection));
      } else {
        AppState.setTopBarActions(`<button class="btn btn-secondary" id="btn-back-to-directions-top">← Все направления</button>`);
        document.getElementById('btn-back-to-directions-top')?.addEventListener('click', () => {
          currentLevel = 'directions';
          selectedDirection = null;
          refreshView(containerEl || document.getElementById('view-panel-materials'));
        });
      }
    } else if (currentLevel === 'materials') {
      AppState.setHeader(`База материалов: ${selectedProject?.title || ''}`, 'Уровень 3: База знаний и документов проекта');
      const canUpload = canManage;
      if (canUpload) {
        AppState.setTopBarActions(`
          <button class="btn btn-secondary" id="btn-back-to-projects-top">← К проектам</button>
          <button class="btn btn-primary" id="btn-upload-material"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-upload'/></svg> Добавить материал</button>
        `);
        document.getElementById('btn-back-to-projects-top')?.addEventListener('click', () => {
          currentLevel = 'projects';
          selectedProject = null;
          refreshView(containerEl || document.getElementById('view-panel-materials'));
        });
        document.getElementById('btn-upload-material')?.addEventListener('click', () => openMaterialModal(selectedProject));
      } else {
        AppState.setTopBarActions(`<button class="btn btn-secondary" id="btn-back-to-projects-top">← К проектам</button>`);
        document.getElementById('btn-back-to-projects-top')?.addEventListener('click', () => {
          currentLevel = 'projects';
          selectedProject = null;
          refreshView(containerEl || document.getElementById('view-panel-materials'));
        });
      }
    }
  }

  // OPEN DIRECTLY FOR SPECIFIC PROJECT (DEF-16: По кнопке материалы кидает на файлы проекта)
  async function openForProject(projectId) {
    try {
      const parsedId = parseInt(projectId, 10);
      const [projects, dirs] = await Promise.all([
        API.getProjects().catch(() => []),
        API.getDirections().catch(() => [])
      ]);

      const proj = projects.find(p => p.id === parsedId);
      if (!proj) {
        AppState.switchView('materials');
        return;
      }

      let dir = dirs.find(d => d.id === proj.direction_id);
      if (!dir) {
        dir = dirs[0] || { id: 1, name: 'Общее направление', code: 'DIR' };
      }

      selectedDirection = dir;
      selectedProject = proj;
      currentLevel = 'materials';

      AppState.switchView('materials');
      const container = document.getElementById('view-panel-materials');
      if (container) {
        await renderMaterialsLevel(container);
      }
    } catch (e) {
      console.error('Error opening materials for project:', e);
      AppState.switchView('materials');
    }
  }

  return {
    render,
    openForProject,
    onActivated: (containerEl) => {
      updateHeaderAndActions(containerEl);
    }
  };
})();
