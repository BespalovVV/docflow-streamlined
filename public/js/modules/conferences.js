// public/js/modules/conferences.js
window.ConferencesModule = (function() {
  let confSearchQuery = '';
  let confTimeFilter = 'all'; // 'all' | 'upcoming' | 'past'
  let confPage = 1;
  let confPageSize = 8;

  function updateHeaderAndActions() {
    AppState.setHeader('Конференции и встречи', 'Администрирование встреч, форматы участия и состав участников');

    const currentUser = AppState.getCurrentUser();
    const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin';

    if (isAdmin) {
      AppState.setTopBarActions(`
        <button class="btn btn-primary" id="btn-create-conf">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"></polygon>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
          <span>Запланировать конференцию</span>
        </button>
      `);
      document.getElementById('btn-create-conf')?.addEventListener('click', () => openConfModal());
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
        <div class="skeleton-card" style="min-height: 190px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div class="skeleton skeleton-title" style="width: 50%;"></div>
            <div class="skeleton" style="width: 80px; height: 22px; border-radius: 12px;"></div>
          </div>
          <div class="skeleton skeleton-text" style="width: 85%;"></div>
          <div class="skeleton skeleton-text" style="width: 65%;"></div>
          <div class="skeleton" style="height: 18px; width: 40%; margin-top: auto;"></div>
        </div>
        <div class="skeleton-card" style="min-height: 190px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div class="skeleton skeleton-title" style="width: 55%;"></div>
            <div class="skeleton" style="width: 80px; height: 22px; border-radius: 12px;"></div>
          </div>
          <div class="skeleton skeleton-text" style="width: 80%;"></div>
          <div class="skeleton skeleton-text" style="width: 60%;"></div>
          <div class="skeleton" style="height: 18px; width: 40%; margin-top: auto;"></div>
        </div>
      </div>
    `;

    try {
      const conferences = await API.getConferences();

      if (conferences.length === 0) {
        containerEl.innerHTML = `
          <div class="card" style="text-align: center; padding: 40px;">
            <div style="font-size: 40px; margin-bottom: 12px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-video'/></svg></div>
            <h3 style="font-size: 16px; font-weight: 600; color: var(--text-main); margin-bottom: 8px;">
              ${isAdmin ? 'Конференции еще не созданы' : 'Нет запланированных конференций'}
            </h3>
            <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 20px;">
              ${isAdmin ? 'Запланируйте видеовстречу или совещание и пригласите отдел или всю компанию.' : 'Встречи появятся здесь, когда вас добавят в список участников конференции.'}
            </p>
            ${isAdmin ? `<button class="btn btn-primary" id="btn-empty-create-conf"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-video"/></svg> Запланировать встречу</button>` : ''}
          </div>
        `;
        containerEl.querySelector('#btn-empty-create-conf')?.addEventListener('click', () => openConfModal());
        return;
      }

      containerEl.innerHTML = `
        <div class="card list-toolbar-card">
          <div class="list-toolbar-search">
            <input type="text" id="conf-search-input" class="list-search-input" placeholder="Поиск встреч по теме, формату, ссылке или участникам..." value="${AppState.escapeHtml(confSearchQuery)}" autocomplete="off">
          </div>
          <div class="list-toolbar-filters">
            <select id="conf-time-filter" class="list-filter-select">
              <option value="all" ${confTimeFilter === 'all' ? 'selected' : ''}>Все встречи</option>
              <option value="upcoming" ${confTimeFilter === 'upcoming' ? 'selected' : ''}>Предстоящие</option>
              <option value="past" ${confTimeFilter === 'past' ? 'selected' : ''}>Прошедшие</option>
            </select>
            <span id="conf-count-badge" class="badge badge-subtle" style="font-size: 12px;">${conferences.length}</span>
          </div>
        </div>
        <div id="conferences-list-mount"></div>
      `;

      const renderConfList = () => {
        const mountEl = containerEl.querySelector('#conferences-list-mount');
        if (!mountEl) return;

        const nowMs = Date.now();
        const q = (confSearchQuery || '').toLowerCase().trim();
        const filtered = conferences.filter(c => {
          const endMs = c.end_time ? new Date(c.end_time).getTime() : new Date(c.start_time).getTime();
          if (confTimeFilter === 'upcoming' && endMs < nowMs) return false;
          if (confTimeFilter === 'past' && endMs >= nowMs) return false;
          if (q) {
            const partsStr = Array.isArray(c.participants) ? c.participants.map(p => p.full_name || '').join(' ') : '';
            const hay = `${c.title || ''} ${c.description || ''} ${c.meeting_format || ''} ${c.location_or_link || ''} ${partsStr}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

        const countBadge = containerEl.querySelector('#conf-count-badge');
        if (countBadge) countBadge.textContent = `Найдено: ${filtered.length}`;

        if (filtered.length === 0) {
          mountEl.innerHTML = `
            <div class="card" style="text-align: center; padding: 36px;">
              <div style="font-size: 36px; margin-bottom: 8px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-video'/></svg></div>
              <h3 style="font-size: 15px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">Встречи не найдены</h3>
              <p class="text-muted" style="font-size: 13px;">Попробуйте изменить поисковый запрос или фильтр времени.</p>
            </div>
          `;
          return;
        }

        const pg = AppState.paginate(filtered, confPage, confPageSize);
        confPage = pg.page;

        mountEl.innerHTML = `
          <div class="grid-2">
            ${pg.items.map(c => {
              const loc = c.location_or_link || '';
              const isUrl = loc.startsWith('http://') || loc.startsWith('https://');
              const formatName = c.meeting_format || (isUrl ? 'Онлайн' : 'Очно');

              return `
                <div class="card">
                  <div class="card-header">
                    <span class="card-title"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-video'/></svg> ${AppState.escapeHtml(c.title)}</span>
                    <span class="badge badge-conf-internal"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-tag'/></svg> ${AppState.escapeHtml(formatName)}</span>
                  </div>
                  <p class="text-muted" style="font-size: 13px; margin-bottom: 12px;">${AppState.escapeHtml(c.description || 'Описание отсутствует')}</p>
                  
                  <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px;">
                    <div><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clock"/></svg> <strong>Время проведения:</strong> ${new Date(c.start_time).toLocaleString('ru-RU')} — ${new Date(c.end_time).toLocaleTimeString('ru-RU')}</div>
                    ${isUrl 
                      ? `<div><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-map-pin"/></svg> <strong>Ссылка на встречу:</strong> <a href="${AppState.escapeHtml(loc)}" target="_blank" style="color: var(--primary); text-decoration: underline; word-break: break-all;">${AppState.escapeHtml(loc)}</a></div>`
                      : `<div><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-map-pin"/></svg> <strong>Место проведения / Формат:</strong> <strong style="color: var(--text-main);">${AppState.escapeHtml(loc || formatName)}</strong></div>`
                    }
                  </div>

                  <div style="border-top: 1px solid var(--border-color); padding-top: 12px; margin-bottom: 12px;">
                    <div style="font-size: 12px; font-weight: 600; margin-bottom: 6px;">Участники конференции (${c.participants ? c.participants.length : 0}):</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                      ${c.participants && c.participants.length > 0 
                        ? c.participants.map(p => `<span class="badge badge-primary"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-user"/></svg> ${AppState.escapeHtml(p.full_name)} <span style="font-size: 10px; opacity: 0.7;">(${AppState.escapeHtml(p.department || '')})</span></span>`).join('')
                        : '<span class="text-muted" style="font-size: 11px;">Участники не назначены</span>'
                      }
                    </div>
                  </div>

                  ${isAdmin ? `
                    <div style="display: flex; gap: 8px; border-top: 1px solid var(--border-color); padding-top: 12px;">
                      <button class="btn btn-secondary btn-sm edit-conf-btn" data-id="${c.id}" style="flex: 1;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg> Редактировать</button>
                      <button class="btn btn-secondary btn-sm delete-conf-btn" data-id="${c.id}" style="color: var(--danger);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-trash'/></svg> Удалить</button>
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
          ${AppState.renderPaginationHtml(pg, { pageSizeOptions: [8, 16, 32] })}
        `;

        AppState.bindPaginationEvents(mountEl, {
          onPageChange: (p) => { confPage = p; renderConfList(); },
          onPageSizeChange: (sz) => { confPageSize = sz; confPage = 1; renderConfList(); }
        });

        if (isAdmin) {
          mountEl.querySelectorAll('.edit-conf-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const id = parseInt(btn.getAttribute('data-id'), 10);
              const conf = conferences.find(c => c.id === id);
              if (conf) openConfModal(conf);
            });
          });

          mountEl.querySelectorAll('.delete-conf-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const id = parseInt(btn.getAttribute('data-id'), 10);
              AppState.showConfirmModal({
                title: 'Удаление конференции',
                message: 'Вы действительно хотите удалить эту конференцию из базы данных?',
                confirmText: 'Удалить конференцию',
                cancelText: 'Отмена',
                onConfirm: async () => {
                  try {
                    await API.deleteConference(id);
                    AppState.emit('conferences-updated');
                    AppState.showAlert('Конференция удалена', 'success');
                    render(containerEl);
                  } catch (err) {
                    alert('Ошибка при удалении: ' + err.message);
                  }
                }
              });
            });
          });
        }
      };

      containerEl.querySelector('#conf-search-input')?.addEventListener('input', (e) => {
        confSearchQuery = e.target.value;
        confPage = 1;
        renderConfList();
      });
      containerEl.querySelector('#conf-time-filter')?.addEventListener('change', (e) => {
        confTimeFilter = e.target.value;
        confPage = 1;
        renderConfList();
      });

      renderConfList();

    } catch (err) {
      containerEl.innerHTML = `<div class="form-error">Ошибка: ${err.message}</div>`;
    }
  }

  async function openConfModal(confToEdit = null) {
    const isEdit = !!confToEdit;
    AppState.setModalTitle(isEdit ? 'Редактировать конференцию' : 'Новая конференция');
    
    const [users, dbFormats] = await Promise.all([
      API.getUsers(),
      API.getConferenceFormats().catch(() => [])
    ]);

    // Unique departments
    const departments = Array.from(new Set(users.map(u => u.department).filter(Boolean)));

    // Formats
    const defaultFormats = ['Онлайн (DocFlow Meet)', 'Очно в офисе', 'Гибрид', 'Внешняя ссылка (Zoom / Telemost)', 'Переговорная №1', 'Конференц-зал'];
    dbFormats.forEach(f => {
      if (f.name && !defaultFormats.includes(f.name)) defaultFormats.push(f.name);
    });

    let selectedParticipantIds = isEdit && confToEdit.participants ? confToEdit.participants.map(p => p.id) : [];
    let currentFormat = isEdit && confToEdit.meeting_format ? confToEdit.meeting_format : 'Онлайн (DocFlow Meet)';
    let initialLocation = isEdit ? confToEdit.location_or_link : 'https://meet.docflow.local/arch-review';

    let startDateStr = '';
    let startTimeStr = '10:00';
    let endTimeStr = '11:00';

    if (isEdit && confToEdit.start_time) {
      const s = new Date(confToEdit.start_time);
      startDateStr = AppState.formatDateRu ? AppState.formatDateRu(s) : s.toLocaleDateString('ru-RU');
      startTimeStr = s.toTimeString().substring(0, 5);
      if (confToEdit.end_time) {
        const e = new Date(confToEdit.end_time);
        endTimeStr = e.toTimeString().substring(0, 5);
      }
    } else {
      const now = new Date();
      startDateStr = AppState.formatDateRu ? AppState.formatDateRu(now) : now.toLocaleDateString('ru-RU');
    }

    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <form id="conf-form">
        <div class="form-group">
          <label>Тема конференции / встречи *</label>
          <input type="text" id="conf-title" required value="${isEdit ? AppState.escapeHtml(confToEdit.title) : ''}" placeholder="Например: Обсуждение архитектуры платформы">
        </div>

        <!-- ДАТА И ВРЕМЯ С КАЛЕНДАРИКОМ (DEF-08) -->
        <div class="form-group" style="background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label style="margin: 0; font-weight: 600; font-size: 13px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-calendar'/></svg> Дата и время проведения</label>
            <span style="font-size: 11px; color: var(--text-muted);">Формат ДД.ММ.ГГГГ</span>
          </div>

          <div class="conf-datetime-grid">
            <div style="position: relative;">
              <input type="text" id="conf-date-input" class="form-control" placeholder="ДД.ММ.ГГГГ" value="${startDateStr}" maxlength="10" autocomplete="off" style="font-weight: 500; font-size: 13px;">
              <input type="date" id="conf-date-native" tabindex="-1" style="position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; left: 0; bottom: 0;">
            </div>
            <button type="button" class="btn btn-secondary" id="btn-pick-conf-calendar" title="Выбрать дату в календаре" style="padding: 7px 11px; font-size: 13px; white-space: nowrap;">
              <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-calendar"/></svg> Календарь
            </button>
            <div>
              <input type="time" id="conf-time-start" class="form-control" value="${startTimeStr}" title="Время начала (ЧЧ:ММ)" style="font-size: 13px;">
            </div>
            <div>
              <input type="time" id="conf-time-end" class="form-control" value="${endTimeStr}" title="Время окончания (ЧЧ:ММ)" style="font-size: 13px;">
            </div>
          </div>

          <div style="display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; align-items: center;">
            <span style="font-size: 11px; color: var(--text-muted);">Быстро:</span>
            <button type="button" class="btn btn-secondary btn-sm conf-date-preset-btn" data-preset="today" style="font-size: 11px; padding: 2px 7px;">Сегодня</button>
            <button type="button" class="btn btn-secondary btn-sm conf-date-preset-btn" data-preset="tomorrow" style="font-size: 11px; padding: 2px 7px;">Завтра</button>
            <button type="button" class="btn btn-secondary btn-sm conf-date-preset-btn" data-preset="week" style="font-size: 11px; padding: 2px 7px;">+7 дней</button>
          </div>
        </div>

        <!-- MEETING FORMAT SELECTION & CUSTOM FORMAT CREATION -->
        <div class="form-group">
          <label>Формат участия / встречи *</label>
          <div style="display: flex; gap: 8px;">
            <select id="conf-format" style="flex: 1;">
              ${defaultFormats.map(fmt => `
                <option value="${AppState.escapeHtml(fmt)}" ${fmt === currentFormat ? 'selected' : ''}>${AppState.escapeHtml(fmt)}</option>
              `).join('')}
              <option value="__CUSTOM__">+ Свой вариант формата...</option>
            </select>
          </div>
        </div>

        <div id="custom-format-box" class="form-group hidden" style="background: var(--bg-subtle); padding: 12px; border-radius: 8px; border: 1px dashed var(--border-color);">
          <label style="font-size: 12px; font-weight: 600;">Название нового формата *</label>
          <div style="display: flex; gap: 8px; margin-top: 4px;">
            <input type="text" id="custom-format-input" placeholder="Например: Выездная сессия в технопарке" style="flex: 1;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-save-custom-format">Сохранить в список</button>
          </div>
        </div>

        <div class="form-group">
          <label id="conf-location-label">Место проведения или ссылка на встречу *</label>
          <input type="text" id="conf-link" required value="${AppState.escapeHtml(initialLocation)}" placeholder="https://meet.docflow.local/... или Зал переговоров">
        </div>

        <!-- PARTICIPANTS SELECTION WITH BULK DEPARTMENT / ALL -->
        <div class="form-group">
          <label>Участники конференции</label>
          
          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; align-items: center;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-conf-add-all">
              <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-users"/></svg> Добавить всех (${users.length} сотр.)
            </button>
            ${departments.length > 0 ? `
              <select id="conf-dept-select" style="font-size: 12px; padding: 4px 8px; border-radius: 4px;">
                <option value="">Добавить весь отдел...</option>
                ${departments.map(d => `<option value="${AppState.escapeHtml(d)}">${AppState.escapeHtml(d)}</option>`).join('')}
              </select>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-conf-add-dept">
                + Добавить отдел
              </button>
            ` : ''}
            <button type="button" class="btn btn-secondary btn-sm" id="btn-conf-clear-parts" style="color: var(--danger);">
              ✕ Очистить
            </button>
          </div>

          <div id="conf-participants-chips" class="participant-chips" style="margin-bottom: 10px;"></div>

          <div class="user-search-wrapper" style="position: relative;">
            <input type="text" id="participant-search-input" class="user-search-input" placeholder="Начните вводить имя или отдел сотрудника..." autocomplete="off">
            <div id="participant-search-dropdown" class="user-search-dropdown"></div>
          </div>
        </div>

        <div class="form-group">
          <label>Описание / Повестка дня</label>
          <textarea id="conf-desc" rows="3" placeholder="Вопросы для обсуждения...">${isEdit ? AppState.escapeHtml(confToEdit.description || '') : ''}</textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block">${isEdit ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-save"/></svg> Сохранить изменения' : 'Запланировать конференцию'}</button>
      </form>
    `;
    AppState.openModal(null, null, 'md');

    // Date & Time picker helpers (DEF-08)
    const confDateInput = document.getElementById('conf-date-input');
    const confDateNative = document.getElementById('conf-date-native');
    const btnPickConfCal = document.getElementById('btn-pick-conf-calendar');

    btnPickConfCal?.addEventListener('click', () => {
      if (confDateNative.showPicker) confDateNative.showPicker();
      else confDateNative.click();
    });

    confDateNative?.addEventListener('change', () => {
      if (confDateNative.value) {
        const [yyyy, mm, dd] = confDateNative.value.split('-');
        confDateInput.value = `${dd}.${mm}.${yyyy}`;
      }
    });

    confDateInput?.addEventListener('input', (e) => {
      let v = e.target.value.replace(/[^0-9.]/g, '');
      if (v.length === 2 && !v.includes('.')) v += '.';
      if (v.length === 5 && v.split('.').length === 2) v += '.';
      e.target.value = v;
    });

    modalBody.querySelectorAll('.conf-date-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-preset');
        const now = new Date();
        if (preset === 'today') {
          confDateInput.value = AppState.formatDateRu ? AppState.formatDateRu(now) : now.toLocaleDateString('ru-RU');
        } else if (preset === 'tomorrow') {
          const t = new Date(now.getTime() + 86400000);
          confDateInput.value = AppState.formatDateRu ? AppState.formatDateRu(t) : t.toLocaleDateString('ru-RU');
        } else if (preset === 'week') {
          const w = new Date(now.getTime() + 7 * 86400000);
          confDateInput.value = AppState.formatDateRu ? AppState.formatDateRu(w) : w.toLocaleDateString('ru-RU');
        }
      });
    });

    const formatSelect = document.getElementById('conf-format');
    const customFormatBox = document.getElementById('custom-format-box');
    const customFormatInput = document.getElementById('custom-format-input');
    const saveCustomFormatBtn = document.getElementById('btn-save-custom-format');

    formatSelect?.addEventListener('change', () => {
      if (formatSelect.value === '__CUSTOM__') {
        customFormatBox.classList.remove('hidden');
        customFormatInput.focus();
      } else {
        customFormatBox.classList.add('hidden');
      }
    });

    saveCustomFormatBtn?.addEventListener('click', async () => {
      const val = customFormatInput.value.trim();
      if (!val) return;
      try {
        await API.createConferenceFormat(val);
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = `${val}`;
        opt.selected = true;
        formatSelect.insertBefore(opt, formatSelect.lastElementChild);
        customFormatBox.classList.add('hidden');
        AppState.showAlert(`Формат "${val}" сохранен`, 'success');
      } catch (e) {
        alert('Ошибка сохранения формата: ' + e.message);
      }
    });

    const renderParticipantChips = () => {
      const chipsEl = document.getElementById('conf-participants-chips');
      if (!chipsEl) return;
      if (selectedParticipantIds.length === 0) {
        chipsEl.innerHTML = '<span class="text-muted" style="font-size: 12px;">Участники не выбраны. Выберите из поиска или добавьте отдел.</span>';
        return;
      }
      chipsEl.innerHTML = selectedParticipantIds.map(id => {
        const u = users.find(user => user.id === id);
        return u ? `
          <div class="chip" style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 16px; font-size: 12px;">
            <span>${AppState.escapeHtml(u.full_name)}</span>
            <button type="button" class="chip-remove" data-id="${u.id}" style="border: none; background: transparent; cursor: pointer; color: var(--danger); font-size: 13px;">&times;</button>
          </div>
        ` : '';
      }).join('');

      chipsEl.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const uid = parseInt(btn.getAttribute('data-id'), 10);
          selectedParticipantIds = selectedParticipantIds.filter(id => id !== uid);
          renderParticipantChips();
        });
      });
    };

    renderParticipantChips();

    // Bulk buttons
    document.getElementById('btn-conf-add-all')?.addEventListener('click', () => {
      selectedParticipantIds = users.map(u => u.id);
      renderParticipantChips();
    });

    document.getElementById('btn-conf-add-dept')?.addEventListener('click', () => {
      const dept = document.getElementById('conf-dept-select')?.value;
      if (!dept) {
        alert('Выберите отдел из списка');
        return;
      }
      const deptUserIds = users.filter(u => u.department === dept).map(u => u.id);
      selectedParticipantIds = Array.from(new Set([...selectedParticipantIds, ...deptUserIds]));
      renderParticipantChips();
    });

    document.getElementById('btn-conf-clear-parts')?.addEventListener('click', () => {
      selectedParticipantIds = [];
      renderParticipantChips();
    });

    // Participant search
    const partSearchInput = document.getElementById('participant-search-input');
    const partDropdown = document.getElementById('participant-search-dropdown');

    const renderPartDropdown = (query = '') => {
      const q = query.toLowerCase().trim();
      const available = users.filter(u => !selectedParticipantIds.includes(u.id));
      const filtered = available.filter(u => 
        u.full_name.toLowerCase().includes(q) || 
        (u.department || '').toLowerCase().includes(q) || 
        u.email.toLowerCase().includes(q)
      );

      if (filtered.length === 0) {
        partDropdown.innerHTML = `<div class="user-search-item text-muted">Сотрудники не найдены</div>`;
      } else {
        partDropdown.innerHTML = filtered.map(u => `
          <div class="user-search-item" data-id="${u.id}">
            <div>
              <div style="font-weight: 600; font-size: 13px;">${AppState.escapeHtml(u.full_name)}</div>
              <div style="font-size: 11px; color: var(--text-muted);">${AppState.escapeHtml(u.department || 'Сотрудник')} &bull; ${AppState.escapeHtml(u.email)}</div>
            </div>
          </div>
        `).join('');
      }
      partDropdown.classList.add('open');
    };

    partSearchInput?.addEventListener('focus', () => renderPartDropdown(partSearchInput.value));
    partSearchInput?.addEventListener('input', (e) => renderPartDropdown(e.target.value));

    partDropdown?.addEventListener('click', (e) => {
      const item = e.target.closest('.user-search-item');
      if (item && item.getAttribute('data-id')) {
        const id = parseInt(item.getAttribute('data-id'), 10);
        if (!selectedParticipantIds.includes(id)) {
          selectedParticipantIds.push(id);
          renderParticipantChips();
        }
        partSearchInput.value = '';
        partDropdown.classList.remove('open');
      }
    });

    // Submit form
    document.getElementById('conf-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      let chosenFormat = formatSelect.value;
      if (chosenFormat === '__CUSTOM__') {
        chosenFormat = customFormatInput.value.trim() || 'Свой формат';
      }

      const dateStr = confDateInput.value.trim();
      const startTime = document.getElementById('conf-time-start').value.trim() || '10:00';
      const endTime = document.getElementById('conf-time-end').value.trim() || '11:00';

      let startIso = null;
      let endIso = null;

      if (dateStr) {
        if (typeof AppState.parseRuDateTime === 'function') {
          startIso = AppState.parseRuDateTime(dateStr, startTime);
          endIso = AppState.parseRuDateTime(dateStr, endTime);
        } else {
          const parts = dateStr.split('.');
          if (parts.length === 3) {
            startIso = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T${startTime}:00`).toISOString();
            endIso = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T${endTime}:00`).toISOString();
          }
        }
      }

      if (!startIso) {
        alert('Пожалуйста, укажите корректную дату в формате ДД.ММ.ГГГГ');
        return;
      }

      const payload = {
        title: document.getElementById('conf-title').value.trim(),
        start_time: startIso,
        end_time: endIso || startIso,
        meeting_format: chosenFormat,
        location_or_link: document.getElementById('conf-link').value.trim(),
        description: document.getElementById('conf-desc').value.trim(),
        participant_ids: selectedParticipantIds
      };

      try {
        if (isEdit) {
          await API.updateConference(confToEdit.id, payload);
          AppState.showAlert('Конференция обновлена', 'success');
        } else {
          await API.createConference(payload);
          AppState.showAlert('Конференция запланирована', 'success');
        }
        AppState.closeModal();
        AppState.emit('conferences-updated');
        render(document.getElementById('view-panel-conferences'));
      } catch (err) {
        alert('Ошибка при сохранении конференции: ' + err.message);
      }
    });
  }

  return {
    render: render,
    onActivated: () => {
      updateHeaderAndActions();
    },
    openConfModal: openConfModal
  };
})();
