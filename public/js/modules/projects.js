// public/js/modules/projects.js
window.ProjectsModule = (function() {
  let projectsSearchQuery = '';
  let projectsStatusFilter = 'ALL';
  let projectsPage = 1;
  let projectsPageSize = 8;

  function updateHeaderAndActions() {
    AppState.setHeader('Проекты компании', 'Управление направлениями, задачами и участниками проектных команд');

    const currentUser = AppState.getCurrentUser();
    const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin';

    if (isAdmin) {
      AppState.setTopBarActions(`<button class="btn btn-primary" id="btn-create-project"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder"/></svg> Создать проект</button>`);
      document.getElementById('btn-create-project')?.addEventListener('click', () => openProjectModal());
    } else {
      AppState.setTopBarActions('');
    }
  }

  async function render(containerEl) {
    updateHeaderAndActions();
    const currentUser = AppState.getCurrentUser();
    const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin';

    containerEl.innerHTML = `
      <div class="grid-2">
        <div class="skeleton-card" style="min-height: 200px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div class="skeleton skeleton-title" style="width: 50%;"></div>
            <div class="skeleton" style="width: 70px; height: 22px; border-radius: 12px;"></div>
          </div>
          <div class="skeleton skeleton-text" style="width: 85%;"></div>
          <div class="skeleton skeleton-text" style="width: 60%;"></div>
          <div class="skeleton" style="height: 24px; width: 45%; margin-top: auto; border-radius: 4px;"></div>
        </div>
        <div class="skeleton-card" style="min-height: 200px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div class="skeleton skeleton-title" style="width: 55%;"></div>
            <div class="skeleton" style="width: 70px; height: 22px; border-radius: 12px;"></div>
          </div>
          <div class="skeleton skeleton-text" style="width: 90%;"></div>
          <div class="skeleton skeleton-text" style="width: 70%;"></div>
          <div class="skeleton" style="height: 24px; width: 45%; margin-top: auto; border-radius: 4px;"></div>
        </div>
      </div>
    `;

    try {
      const [projects, stats] = await Promise.all([
        API.getProjects(),
        API.request('/api/projects/meta/stats').catch(() => ({ totalCompanyProjects: 0, myAssignedProjects: 0 }))
      ]);

      // DEF-05: Информативное пустое состояние с пояснением причины и инструкцией
      if (projects.length === 0) {
        const hasCompanyProjects = stats.totalCompanyProjects > 0;
        containerEl.innerHTML = `
          <div class="card" style="max-width: 680px; margin: 30px auto; padding: 36px 28px; text-align: center; border-radius: 12px; background: var(--bg-card); border: 1px solid var(--border-color); box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1);">
            <div style="width: 64px; height: 64px; margin: 0 auto 16px; border-radius: 16px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.25); display: flex; align-items: center; justify-content: center; font-size: 30px;">
              <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder"/></svg>
            </div>

            <h3 style="font-size: 18px; font-weight: 700; color: var(--text-main); margin-bottom: 10px;">
              ${isAdmin ? 'Проекты компании еще не созданы' : 'У вас пока нет назначенных проектов'}
            </h3>

            <p style="color: var(--text-muted); font-size: 13.5px; line-height: 1.5; margin-bottom: 18px;">
              ${isAdmin 
                ? 'Создайте первый проект компании для объединения задач, распределения исполнителей и структурирования материалов.'
                : 'В соответствии с политикой разграничения доступа (RBAC), сотрудники видят только те проекты, в которых они задействованы как исполнители задач или участники проектной группы.'
              }
            </p>

            ${(!isAdmin && hasCompanyProjects) ? `
              <div style="background: var(--bg-subtle); padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 20px; font-size: 12.5px; color: var(--text-main); text-align: left;">
                <div style="font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; color: var(--primary);">
                  ℹ️ В компании открыто проектов: ${stats.totalCompanyProjects}
                </div>
                <div style="color: var(--text-muted); line-height: 1.4;">
                  <strong>Как получить доступ к нужному проекту:</strong>
                  <ol style="margin: 6px 0 0 18px; padding: 0;">
                    <li>Свяжитесь с вашим прямым руководителем или администратором системы;</li>
                    <li>Попросите назначить вам задачу в рамках интересующего проекта;</li>
                    <li>После постановки задачи проект автоматически появится в этом реестре.</li>
                  </ol>
                </div>
              </div>
            ` : ''}

            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
              ${isAdmin ? `
                <button class="btn btn-primary" id="btn-empty-create-proj">+ Создать первый проект</button>
              ` : `
                <button class="btn btn-primary" id="btn-request-project-access"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-mail'/></svg> Написать администратору</button>
                <button class="btn btn-secondary" id="btn-open-materials-from-empty"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-compass'/></svg> Направления и материалы</button>
              `}
            </div>
          </div>
        `;

        containerEl.querySelector('#btn-empty-create-proj')?.addEventListener('click', () => openProjectModal());
        containerEl.querySelector('#btn-request-project-access')?.addEventListener('click', () => {
          if (window.MailModule) {
            AppState.switchView('mail');
            setTimeout(() => {
              window.MailModule.openComposeModal({
                to: 'admin@docflow.local',
                subject: 'Запрос на подключение к проекту'
              });
            }, 100);
          }
        });
        containerEl.querySelector('#btn-open-materials-from-empty')?.addEventListener('click', () => {
          AppState.switchView('materials');
        });
        return;
      }

      // Fetch details for all projects in parallel
      const detailedProjects = await Promise.all(
        projects.map(async (p) => {
          try {
            const details = await API.getProjectDetails(p.id);
            return { ...p, tasks: details.tasks || [], participants: details.participants || [] };
          } catch (e) {
            return { ...p, tasks: [], participants: [] };
          }
        })
      );

      containerEl.innerHTML = `
        <div class="card list-toolbar-card">
          <div class="list-toolbar-search">
            <input type="text" id="projects-search-input" class="list-search-input" placeholder="Поиск проектов по названию, направлению или участнику..." value="${AppState.escapeHtml(projectsSearchQuery)}" autocomplete="off">
          </div>
          <div class="list-toolbar-filters">
            <select id="projects-status-filter" class="list-filter-select">
              <option value="ALL" ${projectsStatusFilter === 'ALL' ? 'selected' : ''}>Все статусы</option>
              <option value="ACTIVE" ${projectsStatusFilter === 'ACTIVE' ? 'selected' : ''}>Активные</option>
              <option value="ON_HOLD" ${projectsStatusFilter === 'ON_HOLD' ? 'selected' : ''}>Приостановлены</option>
              <option value="COMPLETED" ${projectsStatusFilter === 'COMPLETED' ? 'selected' : ''}>Завершены</option>
            </select>
            <span id="projects-count-badge" class="badge badge-subtle" style="font-size: 12px;">${detailedProjects.length}</span>
          </div>
        </div>
        <div id="projects-list-mount"></div>
      `;

      const renderProjectsList = () => {
        const mountEl = containerEl.querySelector('#projects-list-mount');
        if (!mountEl) return;

        const q = (projectsSearchQuery || '').toLowerCase().trim();
        const filtered = detailedProjects.filter(p => {
          if (projectsStatusFilter !== 'ALL' && (p.status || 'ACTIVE') !== projectsStatusFilter) return false;
          if (q) {
            const partsStr = (p.participants || []).map(u => u.full_name || '').join(' ');
            const hay = `${p.title || ''} ${p.description || ''} ${p.direction_name || ''} ${partsStr}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

        const countBadge = containerEl.querySelector('#projects-count-badge');
        if (countBadge) countBadge.textContent = `Найдено: ${filtered.length}`;

        if (filtered.length === 0) {
          mountEl.innerHTML = `
            <div class="card" style="text-align: center; padding: 36px;">
              <div style="font-size: 36px; margin-bottom: 8px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-folder'/></svg></div>
              <h3 style="font-size: 15px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">Проекты не найдены</h3>
              <p class="text-muted" style="font-size: 13px;">Попробуйте изменить поисковый запрос или фильтр статуса.</p>
            </div>
          `;
          return;
        }

        const pg = AppState.paginate(filtered, projectsPage, projectsPageSize);
        projectsPage = pg.page;

        mountEl.innerHTML = `
          <div class="grid-2" style="gap: 20px;">
            ${pg.items.map(p => {
              const totalTasks = p.tasks.length;
              const doneTasks = p.tasks.filter(t => t.status === 'DONE').length;
              const inProgressTasks = p.tasks.filter(t => t.status === 'IN_PROGRESS').length;
              const todoTasks = p.tasks.filter(t => t.status === 'TODO').length;

              return `
                <div class="card project-card" data-id="${p.id}" style="display: flex; flex-direction: column; justify-content: space-between; border-radius: 10px;">
                  <div>
                    <div class="card-header" style="margin-bottom: 8px;">
                      <span class="card-title" style="font-size: 16px; font-weight: 700; color: var(--text-main);">
                        <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder"/></svg> ${AppState.escapeHtml(p.title)}
                      </span>
                      <span class="badge badge-active">${p.status || 'ACTIVE'}</span>
                    </div>

                    <div style="margin-bottom: 10px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                      <span class="badge" style="background: rgba(59, 130, 246, 0.12); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.25); font-size: 11px;">
                        <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-compass"/></svg> ${AppState.escapeHtml(p.direction_name || 'Общее направление')}
                      </span>
                    </div>

                    <p class="text-muted" style="font-size: 13px; margin-bottom: 14px; line-height: 1.4;">
                      ${AppState.escapeHtml(p.description || 'Описание проекта отсутствует')}
                    </p>

                    <div style="background: var(--bg-subtle); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 14px;">
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-size: 12px; font-weight: 600; color: var(--text-main);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-clipboard'/></svg> Задачи проекта (${totalTasks}):</span>
                        <span style="font-size: 11px; color: var(--text-muted);">${doneTasks} из ${totalTasks} выполнено</span>
                      </div>

                      ${totalTasks > 0 ? `
                        <div style="display: flex; gap: 4px; height: 6px; border-radius: 3px; overflow: hidden; background: rgba(255,255,255,0.05); margin-bottom: 8px;">
                          <div style="width: ${(doneTasks / totalTasks) * 100}%; background: #10b981;" title="Завершено: ${doneTasks}"></div>
                          <div style="width: ${(inProgressTasks / totalTasks) * 100}%; background: #3b82f6;" title="В работе: ${inProgressTasks}"></div>
                          <div style="width: ${(todoTasks / totalTasks) * 100}%; background: #6b7280;" title="К исполнению: ${todoTasks}"></div>
                        </div>
                      ` : `
                        <div style="font-size: 12px; color: var(--text-muted);">В проекте пока нет привязанных задач</div>
                      `}

                      <button class="btn btn-secondary btn-sm view-project-tasks-btn" data-id="${p.id}" style="width: 100%; font-size: 12px; margin-top: 4px;">
                        <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-eye"/></svg> Просмотреть список задач (${totalTasks})
                      </button>
                    </div>

                    <div style="margin-bottom: 16px;">
                      <div style="font-size: 12px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">
                        <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-users"/></svg> Участники проекта (${p.participants.length}):
                      </div>
                      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${p.participants.length > 0 ? p.participants.map(part => `
                          <span class="badge badge-subtle" style="font-size: 11px; padding: 4px 8px;">
                            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-user"/></svg> ${AppState.escapeHtml(part.full_name)} 
                            <span style="opacity: 0.7; font-size: 10px;">(${AppState.escapeHtml(part.department || 'Сотрудник')})</span>
                          </span>
                        `).join('') : `
                          <span class="text-muted" style="font-size: 11px;">Нет назначенных исполнителей</span>
                        `}
                      </div>
                    </div>
                  </div>

                  <div style="border-top: 1px solid var(--border-color); padding-top: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <button class="btn btn-primary btn-sm add-task-to-proj-btn" data-id="${p.id}">
                      + Добавить задачу
                    </button>
                    <button class="btn btn-secondary btn-sm open-proj-materials-btn" data-id="${p.id}">
                      <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder"/></svg> Материалы
                    </button>
                    ${isAdmin ? `
                      <button class="btn btn-secondary btn-sm edit-proj-btn" data-id="${p.id}" title="Редактировать"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg></button>
                      <button class="btn btn-secondary btn-sm delete-proj-btn" data-id="${p.id}" title="Удалить" style="color: var(--danger);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-trash'/></svg></button>
                    ` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          ${AppState.renderPaginationHtml(pg, { pageSizeOptions: [8, 16, 32] })}
        `;

        AppState.bindPaginationEvents(mountEl, {
          onPageChange: (p) => { projectsPage = p; renderProjectsList(); },
          onPageSizeChange: (sz) => { projectsPageSize = sz; projectsPage = 1; renderProjectsList(); }
        });

        mountEl.querySelectorAll('.view-project-tasks-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.getAttribute('data-id'), 10);
            const proj = detailedProjects.find(p => p.id === id);
            if (proj) openProjectTasksModal(proj);
          });
        });

        mountEl.querySelectorAll('.add-task-to-proj-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.getAttribute('data-id'), 10);
            if (window.TasksModule) {
              window.TasksModule.openTaskModal(null, { defaultProjectId: id });
            }
          });
        });

        mountEl.querySelectorAll('.open-proj-materials-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.getAttribute('data-id'), 10);
            if (window.MaterialsModule && window.MaterialsModule.openForProject) {
              window.MaterialsModule.openForProject(id);
            } else {
              AppState.switchView('materials');
            }
          });
        });

        if (isAdmin) {
          mountEl.querySelectorAll('.edit-proj-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const id = parseInt(btn.getAttribute('data-id'), 10);
              const proj = detailedProjects.find(p => p.id === id);
              if (proj) openProjectModal(proj, containerEl);
            });
          });

          mountEl.querySelectorAll('.delete-proj-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const id = parseInt(btn.getAttribute('data-id'), 10);
              AppState.showConfirmModal({
                title: 'Удаление проекта',
                message: 'Вы действительно хотите удалить этот проект из базы данных?',
                confirmText: 'Удалить проект',
                cancelText: 'Отмена',
                onConfirm: async () => {
                  try {
                    await API.deleteProject(id);
                    AppState.showAlert('Проект удален', 'success');
                    render(containerEl);
                  } catch (err) {
                    alert('Ошибка при удалении проекта: ' + err.message);
                  }
                }
              });
            });
          });
        }
      };

      containerEl.querySelector('#projects-search-input')?.addEventListener('input', (e) => {
        projectsSearchQuery = e.target.value;
        projectsPage = 1;
        renderProjectsList();
      });
      containerEl.querySelector('#projects-status-filter')?.addEventListener('change', (e) => {
        projectsStatusFilter = e.target.value;
        projectsPage = 1;
        renderProjectsList();
      });

      renderProjectsList();

    } catch (err) {
      containerEl.innerHTML = `<div class="form-error">Ошибка: ${AppState.escapeHtml(err.message)}</div>`;
    }
  }

  function openProjectTasksModal(project) {
    AppState.setModalTitle(`<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clipboard"/></svg> Задачи проекта: ${project.title}`);
    const modalBody = document.getElementById('modal-body');

    modalBody.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 14px; font-weight: 700; color: var(--text-main);">${AppState.escapeHtml(project.title)}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${project.tasks.length} задач &bull; ${project.participants.length} участников</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-go-tasks-filtered">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-link"/></svg> Открыть в разделе "Задачи"
          </button>
        </div>

        <!-- PARTICIPANTS LIST -->
        <div style="background: var(--bg-subtle); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-color);">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-users"/></svg> Участники команды проекта:
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${project.participants.length > 0 ? project.participants.map(u => `
              <span class="badge badge-primary" style="font-size: 11px;">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-user"/></svg> ${AppState.escapeHtml(u.full_name)} <span style="opacity: 0.8; font-size: 10px;">(${AppState.escapeHtml(u.department || '')})</span>
              </span>
            `).join('') : `
              <span class="text-muted" style="font-size: 11px;">Нет участников</span>
            `}
          </div>
        </div>

        <!-- TASKS LIST -->
        <div style="display: flex; flex-direction: column; gap: 8px; max-height: 350px; overflow-y: auto;">
          ${project.tasks.length > 0 ? project.tasks.map(t => {
            let statusBadge = `<span class="badge badge-subtle">${t.status}</span>`;
            if (t.status === 'DONE') statusBadge = `<span class="badge badge-active" style="background: rgba(16, 185, 129, 0.2); color: #10b981;">Завершено</span>`;
            if (t.status === 'IN_PROGRESS') statusBadge = `<span class="badge badge-active">В работе</span>`;

            return `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border-color);">
                <div>
                  <div style="font-weight: 600; font-size: 13px; color: var(--text-main);">${AppState.escapeHtml(t.title)}</div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                    <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-user"/></svg> ${AppState.escapeHtml(t.assignee_name || 'Не назначен')} &bull; Срок: ${t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : 'Бессрочно'}
                  </div>
                </div>
                <div>
                  ${statusBadge}
                </div>
              </div>
            `;
          }).join('') : `
            <div class="text-muted" style="text-align: center; padding: 20px;">В проекте пока нет задач</div>
          `}
        </div>

        <div style="display: flex; justify-content: flex-end;">
          <button class="btn btn-primary" id="btn-modal-add-task-to-proj">+ Добавить задачу в проект</button>
        </div>
      </div>
    `;
    AppState.openModal();

    document.getElementById('btn-modal-add-task-to-proj')?.addEventListener('click', () => {
      AppState.closeModal();
      if (window.TasksModule) {
        window.TasksModule.openTaskModal(null, { defaultProjectId: project.id });
      }
    });

    document.getElementById('btn-go-tasks-filtered')?.addEventListener('click', () => {
      AppState.closeModal();
      AppState.switchView('tasks');
    });
  }

  async function openProjectModal(projectToEdit = null, containerEl = null) {
    const isEdit = !!projectToEdit;
    AppState.setModalTitle(isEdit ? 'Редактировать проект' : 'Создать проект');

    const directions = await API.getDirections().catch(() => []);

    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <form id="project-form">
        <div class="form-group">
          <label>Название проекта *</label>
          <input type="text" id="proj-title" required value="${isEdit ? AppState.escapeHtml(projectToEdit.title) : ''}" placeholder="Внедрение нового ИТ-контура">
        </div>

        <!-- DEF-05: ПРИВЯЗКА К СТРАТЕГИЧЕСКОМУ НАПРАВЛЕНИЮ -->
        <div class="form-group">
          <label>Стратегическое направление компании *</label>
          <select id="proj-direction" style="font-weight: 500;">
            <option value="">Без направления (общекорпоративный проект)</option>
            ${directions.map(d => `
              <option value="${d.id}" ${isEdit && projectToEdit.direction_id == d.id ? 'selected' : ''}>${AppState.escapeHtml(d.name)}
 </option>
            `).join('')}
          </select>
          <small class="text-muted" style="font-size: 11px; margin-top: 4px; display: block;">
            Обеспечивает сквозную структуру: <strong>Направление &rarr; Проект &rarr; Материалы</strong>
          </small>
        </div>

        <div class="form-group">
          <label>Статус</label>
          <select id="proj-status">
            <option value="ACTIVE" ${!isEdit || projectToEdit.status === 'ACTIVE' ? 'selected' : ''}>Активен</option>
            <option value="ON_HOLD" ${isEdit && projectToEdit.status === 'ON_HOLD' ? 'selected' : ''}>Приостановлен</option>
            <option value="COMPLETED" ${isEdit && projectToEdit.status === 'COMPLETED' ? 'selected' : ''}>Завершен</option>
          </select>
        </div>

        <div class="form-group">
          <label>Описание проекта</label>
          <textarea id="proj-desc" rows="3" placeholder="Цели, назначение и состав направления...">${isEdit ? AppState.escapeHtml(projectToEdit.description || '') : ''}</textarea>
        </div>

        <button type="submit" class="btn btn-primary btn-block">${isEdit ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-save"/></svg> Сохранить изменения' : 'Создать проект'}</button>
      </form>
    `;
    AppState.openModal();

    document.getElementById('project-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        title: document.getElementById('proj-title').value.trim(),
        direction_id: document.getElementById('proj-direction').value || null,
        status: document.getElementById('proj-status').value,
        description: document.getElementById('proj-desc').value.trim()
      };

      try {
        if (isEdit) {
          await API.updateProject(projectToEdit.id, payload);
          AppState.showAlert('Проект обновлен', 'success');
        } else {
          await API.createProject(payload);
          AppState.showAlert('Проект создан', 'success');
        }
        AppState.closeModal();
        const targetContainer = containerEl || document.getElementById('view-panel-projects');
        if (targetContainer) render(targetContainer);
      } catch (err) {
        alert('Ошибка при сохранении проекта: ' + err.message);
      }
    });
  }

  return {
    render: render,
    onActivated: () => {
      updateHeaderAndActions();
    },
    openProjectModal: openProjectModal,
    openProjectTasksModal: openProjectTasksModal
  };
})();
