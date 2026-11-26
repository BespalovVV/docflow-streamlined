// public/js/modules/dashboard.js
// Дашборд руководителя: аналитика, KPI отделов, статус проектов и экспорт отчетов

window.DashboardModule = (function() {
  function updateHeaderAndActions(panelEl) {
    const currentUser = AppState.getCurrentUser();
    const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin';
    AppState.setHeader(
      isAdmin ? 'Дашборд руководителя' : 'Рабочий стол',
      isAdmin ? 'Аналитика эффективности компании, контроль сроков и статус проектов' : 'Сводка по вашим задачам и активным проектам'
    );
    AppState.setTopBarActions(`
      ${isAdmin ? `
      <button class="btn btn-secondary" id="btn-export-tasks-report" title="Скачать подробный реестр задач в Excel (CSV)">
        <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-inbox"/></svg> Экспорт задач (Excel)
      </button>
      <button class="btn btn-secondary" id="btn-export-summary-report" title="Скачать сводку эффективности отделов">
        <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-bar-chart"/></svg> KPI отделов
      </button>
      ` : ''}
      <button class="btn btn-primary" id="btn-refresh-dashboard">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
        <span>Обновить</span>
      </button>
    `);

    document.getElementById('btn-refresh-dashboard')?.addEventListener('click', () => {
      render(panelEl || document.getElementById('view-panel-dashboard'));
    });

    document.getElementById('btn-export-tasks-report')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-export-tasks-report');
      if (btn) btn.disabled = true;
      try {
        await API.exportTasksReport();
        AppState.showAlert('Реестр задач успешно выгружен в формате Excel (CSV)', 'success');
      } catch (err) {
        alert('Ошибка при экспорте задач: ' + err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    document.getElementById('btn-export-summary-report')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-export-summary-report');
      if (btn) btn.disabled = true;
      try {
        await API.exportSummaryReport();
        AppState.showAlert('Сводный отчёт KPI успешно выгружен в формате Excel (CSV)', 'success');
      } catch (err) {
        alert('Ошибка при экспорте сводки: ' + err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  async function render(panelEl) {
    if (!AppState.isAdmin()) {
      AppState.setHeader('Дашборд', 'Доступ ограничен');
      AppState.setTopBarActions('');
      panelEl.innerHTML = `
        <div class="card" style="padding: 48px 24px; text-align: center; max-width: 540px; margin: 40px auto;">
          <div style="font-size: 54px; margin-bottom: 16px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-lock'/></svg></div>
          <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 8px;">Доступ ограничен</h2>
          <p style="color: var(--text-secondary); margin-bottom: 24px; font-size: 14px; line-height: 1.5;">
            Аналитический дашборд руководителя доступен только пользователям с ролью <strong>Администратор</strong>.
          </p>
          <a href="#tasks" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 8px;">
            <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clipboard"/></svg> Перейти к моим задачам</span>
          </a>
        </div>
      `;
      return;
    }

    updateHeaderAndActions(panelEl);

    panelEl.innerHTML = `
      <div class="grid-4" style="margin-bottom: 20px;">
        <div class="skeleton-card" style="height: 100px;"></div>
        <div class="skeleton-card" style="height: 100px;"></div>
        <div class="skeleton-card" style="height: 100px;"></div>
        <div class="skeleton-card" style="height: 100px;"></div>
      </div>
      <div class="grid-2" style="margin-bottom: 20px;">
        <div class="skeleton-card" style="height: 280px;"></div>
        <div class="skeleton-card" style="height: 280px;"></div>
      </div>
    `;

    try {
      const [reportsData, mailData] = await Promise.all([
        API.getDashboardReports().catch(() => null),
        API.getMail('inbox').catch(() => ({ unreadCount: 0 }))
      ]);

      const t = reportsData?.tasks || {};
      const counts = reportsData?.counts || {};
      const departments = reportsData?.departments || [];
      const projects = reportsData?.projects || [];
      const workload = reportsData?.workload || [];

      const totalTasks = t.total_tasks || 0;
      const doneTasks = t.done_tasks || 0;
      const inProgressTasks = t.in_progress_tasks || 0;
      const reviewTasks = t.review_tasks || 0;
      const todoTasks = t.todo_tasks || 0;
      const overdueTasks = t.overdue_tasks || 0;
      const unreadMail = mailData.unreadCount || 0;

      const completionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

      panelEl.innerHTML = `
        <!-- KPI METRICS ROW -->
        <div class="grid-4" style="margin-bottom: 20px;">
          <div class="card stat-card" style="border-top: 4px solid var(--primary);">
            <div class="stat-icon"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-clipboard'/></svg></div>
            <div class="stat-value">${totalTasks}</div>
            <div class="stat-label">Всего задач в системе</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
              Закрыто: <strong style="color: #10b981;">${doneTasks} (${completionRate}%)</strong>
            </div>
          </div>

          <div class="card stat-card" style="border-top: 4px solid #f59e0b;">
            <div class="stat-icon"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-zap'/></svg></div>
            <div class="stat-value" style="color: #f59e0b;">${inProgressTasks + reviewTasks}</div>
            <div class="stat-label">Задач в активной работе</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
              В работе: <strong>${inProgressTasks}</strong> &bull; На проверке: <strong>${reviewTasks}</strong>
            </div>
          </div>

          <div class="card stat-card" style="border-top: 4px solid ${overdueTasks > 0 ? '#ef4444' : '#10b981'};">
            <div class="stat-icon">${overdueTasks > 0 ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-alert-triangle"/></svg>' : '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-check-circle"/></svg>'}</div>
            <div class="stat-value" style="color: ${overdueTasks > 0 ? '#ef4444' : '#10b981'};">
              ${overdueTasks}
            </div>
            <div class="stat-label">Просроченных дедлайнов</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
              ${overdueTasks > 0 ? '<span style="color: #ef4444; font-weight: 600;">Требует внимания</span>' : 'Все задачи в графике'}
            </div>
          </div>

          <div class="card stat-card" style="border-top: 4px solid #8b5cf6;">
            <div class="stat-icon"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-folder'/></svg></div>
            <div class="stat-value" style="color: #8b5cf6;">${projects.length}</div>
            <div class="stat-label">Проектов и направлений</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
              Документов: <strong>${counts.documents_count || 0}</strong> &bull; Встреч: <strong>${counts.upcoming_conferences_count || 0}</strong>
            </div>
          </div>
        </div>

        <!-- TASK EXECUTION PROGRESS BAR -->
        <div class="card" style="margin-bottom: 20px; padding: 16px 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
            <div>
              <strong style="font-size: 15px; color: var(--text-main);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-bar-chart'/></svg> Статус выполнения поручений</strong>
              <span class="text-muted" style="font-size: 12px; margin-left: 8px;">Общий прогресс: ${completionRate}%</span>
            </div>
            <div style="display: flex; gap: 14px; font-size: 12px; flex-wrap: wrap;">
              <span style="display: flex; align-items: center; gap: 6px;">
                <span style="width: 10px; height: 10px; border-radius: 2px; background: #10b981;"></span> Выполнено (${doneTasks})
              </span>
              <span style="display: flex; align-items: center; gap: 6px;">
                <span style="width: 10px; height: 10px; border-radius: 2px; background: #3b82f6;"></span> В работе (${inProgressTasks})
              </span>
              <span style="display: flex; align-items: center; gap: 6px;">
                <span style="width: 10px; height: 10px; border-radius: 2px; background: #8b5cf6;"></span> На проверке (${reviewTasks})
              </span>
              <span style="display: flex; align-items: center; gap: 6px;">
                <span style="width: 10px; height: 10px; border-radius: 2px; background: #64748b;"></span> К исполнению (${todoTasks})
              </span>
            </div>
          </div>

          <!-- Multi-segment visual progress bar -->
          <div style="height: 12px; width: 100%; background: rgba(255,255,255,0.08); border-radius: 6px; overflow: hidden; display: flex;">
            ${totalTasks > 0 ? `
              <div style="width: ${(doneTasks / totalTasks) * 100}%; background: #10b981;" title="Выполнено: ${doneTasks}"></div>
              <div style="width: ${(inProgressTasks / totalTasks) * 100}%; background: #3b82f6;" title="В работе: ${inProgressTasks}"></div>
              <div style="width: ${(reviewTasks / totalTasks) * 100}%; background: #8b5cf6;" title="На проверке: ${reviewTasks}"></div>
              <div style="width: ${(todoTasks / totalTasks) * 100}%; background: #64748b;" title="К исполнению: ${todoTasks}"></div>
            ` : '<div style="width: 100%; background: #64748b; opacity: 0.3;"></div>'}
          </div>
        </div>

        <!-- MAIN 2-COLUMN SECTION -->
        <div class="grid-2" style="margin-bottom: 20px;">
          <!-- 1. KPI & DEPARTMENT EFFICIENCY -->
          <div class="card" style="display: flex; flex-direction: column;">
            <div class="card-header" style="border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 14px;">
              <span class="card-title"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-building'/></svg> Эффективность по подразделениям</span>
              <button class="btn btn-secondary btn-sm" id="btn-goto-users">Сотрудники ➔</button>
            </div>

            ${departments.length === 0 ? '<div class="text-muted" style="padding: 20px;">Нет данных по отделам</div>' : `
              <div style="display: flex; flex-direction: column; gap: 14px; flex: 1;">
                ${departments.map(d => {
                  return `
                    <div style="padding: 10px 12px; background: var(--bg-subtle); border-radius: 8px; border: 1px solid var(--border-color);">
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <div>
                          <strong style="font-size: 13px; color: var(--text-main);">${AppState.escapeHtml(d.department)}</strong>
                          <span class="text-muted" style="font-size: 11px; margin-left: 6px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-users'/></svg> ${d.employees_count} сотр.</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                          ${d.overdue_tasks > 0 ? `<span class="badge badge-danger" style="font-size: 10px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-alert-triangle"/></svg> ${d.overdue_tasks} проср.</span>` : ''}
                          <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-weight: 700; font-size: 11px;">
                            ${d.efficiency}%
                          </span>
                        </div>
                      </div>
                      
                      <!-- Mini bar -->
                      <div style="height: 6px; width: 100%; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden;">
                        <div style="height: 100%; width: ${d.efficiency}%; background: linear-gradient(90deg, #3b82f6, #10b981); border-radius: 3px;"></div>
                      </div>

                      <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                        <span>Закрыто: <strong>${d.done_tasks}</strong> из ${d.total_tasks}</span>
                        <span>В работе: <strong>${d.active_tasks}</strong></span>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <!-- 2. PROJECT HEALTH & STATUS -->
          <div class="card" style="display: flex; flex-direction: column;">
            <div class="card-header" style="border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 14px;">
              <span class="card-title"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-folder'/></svg> Статус и прогресс проектов</span>
              <button class="btn btn-secondary btn-sm" id="btn-goto-projects">Все проекты ➔</button>
            </div>

            ${projects.length === 0 ? '<div class="text-muted" style="padding: 20px;">Нет активных проектов</div>' : `
              <div style="display: flex; flex-direction: column; gap: 12px; flex: 1;">
                ${projects.map(p => {
                  const isOverdue = p.deadlineStatus === 'OVERDUE';
                  const dateStr = p.end_date ? new Date(p.end_date).toLocaleDateString('ru-RU') : 'Без срока';

                  return `
                    <div style="padding: 12px; background: var(--bg-subtle); border-radius: 8px; border: 1px solid var(--border-color);">
                      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
                        <div style="min-width: 0; flex: 1;">
                          <div style="font-weight: 600; font-size: 13px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder"/></svg> ${AppState.escapeHtml(p.title)}
                          </div>
                          <div style="font-size: 11px; color: var(--text-muted);">
                            ${p.direction_name ? `Направление: <span style="color: ${p.direction_color || 'var(--primary)'}; font-weight: 500;">${AppState.escapeHtml(p.direction_name)}</span> &bull; ` : ''}
                            Руководитель: ${AppState.escapeHtml(p.manager_name || 'Не назначен')}
                          </div>
                        </div>

                        <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                          ${isOverdue ? `<span class="badge badge-danger" style="font-size: 10px;">Просрочен</span>` : ''}
                          <span class="badge ${p.status === 'ACTIVE' ? 'badge-primary' : 'badge-subtle'}" style="font-size: 10px;">${p.status}</span>
                        </div>
                      </div>

                      <!-- Project Progress Bar -->
                      <div style="height: 6px; width: 100%; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; margin: 8px 0;">
                        <div style="height: 100%; width: ${p.progress}%; background: #3b82f6; border-radius: 3px;"></div>
                      </div>

                      <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
                        <span>Выполнено задач: <strong>${p.done_tasks} / ${p.total_tasks} (${p.progress}%)</strong></span>
                        <span>Срок: <strong style="color: ${isOverdue ? '#ef4444' : 'var(--text-main)'};">${dateStr}</strong></span>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>
        </div>

        <!-- TEAM WORKLOAD TABLE -->
        <div class="card">
          <div class="card-header" style="border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 14px;">
            <div>
              <span class="card-title"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-users'/></svg> Загрузка сотрудников и исполнительская дисциплина</span>
              <span class="text-muted" style="font-size: 12px; margin-left: 8px;">Контроль распределения задач</span>
            </div>
            <button class="btn btn-secondary btn-sm" id="btn-goto-tasks">Перейти к задачам ➔</button>
          </div>

          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
              <thead>
                <tr style="border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 11px; text-transform: uppercase;">
                  <th style="padding: 8px 12px;">Сотрудник</th>
                  <th style="padding: 8px 12px;">Отдел / Должность</th>
                  <th style="padding: 8px 12px; text-align: center;">В работе</th>
                  <th style="padding: 8px 12px; text-align: center;">Завершено</th>
                  <th style="padding: 8px 12px; text-align: center;">Просрочено</th>
                  <th style="padding: 8px 12px; text-align: right;">Нагрузка</th>
                </tr>
              </thead>
              <tbody>
                ${workload.map(u => {
                  const hasOverdue = u.overdue_tasks > 0;
                  return `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                      <td style="padding: 10px 12px;">
                        <strong style="color: var(--text-main); font-size: 13px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-user'/></svg> ${AppState.escapeHtml(u.full_name)}</strong>
                        <div style="font-size: 11px; color: var(--text-muted);">${AppState.escapeHtml(u.email)}</div>
                      </td>
                      <td style="padding: 10px 12px;">
                        <div style="font-weight: 500;">${AppState.escapeHtml(u.position || 'Сотрудник')}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${AppState.escapeHtml(u.department || 'Общий отдел')}</div>
                      </td>
                      <td style="padding: 10px 12px; text-align: center;">
                        <span class="badge ${u.active_tasks > 0 ? 'badge-primary' : 'badge-subtle'}">${u.active_tasks}</span>
                      </td>
                      <td style="padding: 10px 12px; text-align: center;">
                        <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">${u.done_tasks}</span>
                      </td>
                      <td style="padding: 10px 12px; text-align: center;">
                        ${hasOverdue 
                          ? `<span class="badge badge-danger"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-alert-triangle"/></svg> ${u.overdue_tasks}</span>` 
                          : '<span style="color: #10b981; font-size: 11px;">✓ Нет</span>'}
                      </td>
                      <td style="padding: 10px 12px; text-align: right;">
                        <span class="text-muted" style="font-size: 12px;">Всего: <strong>${u.total_tasks}</strong></span>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // Quick navigation button listeners
      document.getElementById('btn-goto-users')?.addEventListener('click', () => AppState.switchView('users'));
      document.getElementById('btn-goto-projects')?.addEventListener('click', () => AppState.switchView('projects'));
      document.getElementById('btn-goto-tasks')?.addEventListener('click', () => AppState.switchView('tasks'));

    } catch (err) {
      console.error('Dashboard render error:', err);
      panelEl.innerHTML = `<div class="form-error">Ошибка формирования аналитического дашборда: ${AppState.escapeHtml(err.message)}</div>`;
    }
  }

  return {
    render: render,
    onActivated: function(panelEl) {
      updateHeaderAndActions(panelEl);
    }
  };
})();
