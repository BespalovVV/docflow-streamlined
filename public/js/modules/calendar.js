// public/js/modules/calendar.js
window.CalendarModule = (function() {
  let calendarFeedData = [];
  let calendarBaseDate = new Date();
  let calendarViewMode = 'google'; // 'google' (Google Calendar hourly week grid) or 'month' (month overview)
  let filterTasks = true;
  let filterConfs = true;
  let selectedMiniDate = new Date();
  let isCalendarSidebarCollapsed = localStorage.getItem('docflow_cal_sidebar_collapsed') === 'true';
  let isMiniCalendarCollapsed = localStorage.getItem('docflow_mini_cal_collapsed') === 'true';

  const monthNamesRu = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];
  const weekDaysShort = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const weekDaysMonFirst = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  function formatDateIso(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getWeekDays(refDate) {
    const d = new Date(refDate);
    const dayOfWeek = (d.getDay() + 6) % 7; // Monday = 0
    const monday = new Date(d);
    monday.setDate(d.getDate() - dayOfWeek);
    monday.setHours(0, 0, 0, 0);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(monday);
      dayDate.setDate(monday.getDate() + i);
      days.push(dayDate);
    }
    return days;
  }

  function buildMiniMonthGrid(year, month) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    // Sunday first as in Google Calendar
    const startDayOfWeek = firstDay.getDay(); // 0 is Sunday
    const totalDays = lastDay.getDate();
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    const days = [];
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      const dObj = new Date(year, month - 1, dayNum);
      days.push({ day: dayNum, date: dObj, dateStr: formatDateIso(dObj), isCurrentMonth: false });
    }
    for (let d = 1; d <= totalDays; d++) {
      const dObj = new Date(year, month, d);
      days.push({ day: d, date: dObj, dateStr: formatDateIso(dObj), isCurrentMonth: true });
    }
    const remaining = 35 - days.length > 0 ? 35 - days.length : (42 - days.length);
    for (let d = 1; d <= remaining; d++) {
      const dObj = new Date(year, month + 1, d);
      days.push({ day: d, date: dObj, dateStr: formatDateIso(dObj), isCurrentMonth: false });
    }
    return days;
  }

  function getPeriodTitle() {
    if (calendarViewMode === 'google') {
      const days = getWeekDays(calendarBaseDate);
      const start = days[0];
      const end = days[6];
      if (start.getMonth() === end.getMonth()) {
        return `${start.getDate()} – ${end.getDate()} ${monthNamesRu[start.getMonth()]} ${start.getFullYear()}`;
      } else if (start.getFullYear() === end.getFullYear()) {
        return `${start.getDate()} ${monthNamesRu[start.getMonth()].slice(0, 3)} – ${end.getDate()} ${monthNamesRu[end.getMonth()].slice(0, 3)} ${start.getFullYear()}`;
      } else {
        return `${start.getDate()} ${monthNamesRu[start.getMonth()].slice(0, 3)} ${start.getFullYear()} – ${end.getDate()} ${monthNamesRu[end.getMonth()].slice(0, 3)} ${end.getFullYear()}`;
      }
    } else {
      return `${monthNamesRu[calendarBaseDate.getMonth()]} ${calendarBaseDate.getFullYear()}`;
    }
  }

  function updateHeaderAndActions(containerEl) {
    const currentUser = AppState.getCurrentUser();
    const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin';

    AppState.setHeader('Календарь и расписание', 'Google-style расписание по часам, задачи и конференции');

    AppState.setTopBarActions(`
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
        ${isAdmin ? `<button class="btn btn-primary btn-sm" id="btn-topbar-cal-create" style="border-radius: 8px; font-weight: 600;">+ Создать</button>` : ''}
        <button class="btn btn-secondary btn-sm" id="btn-toggle-cal-sidebar" title="${isCalendarSidebarCollapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'}" style="border-radius: 8px; font-weight: 600;">
          ${isCalendarSidebarCollapsed ? '▶ Панель' : '◀ Панель'}
        </button>

        <!-- БЛОК НАВИГАЦИИ ПО ДАТЕ (СЕГОДНЯ + СТРЕЛКИ + ТЕКУЩИЙ ПЕРИОД) -->
        <div style="display: inline-flex; align-items: center; gap: 6px; background: var(--bg-card); padding: 3px 6px; border-radius: 8px; border: 1px solid var(--border-color);">
          <button class="btn btn-secondary btn-sm" id="btn-cal-today" title="Перейти к сегодняшней дате" style="font-weight: 600; padding: 4px 10px; border-radius: 6px;">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-sun"/></svg> Сегодня
          </button>
          <div style="display: inline-flex; align-items: center; gap: 2px;">
            <button class="btn-icon" id="btn-cal-prev" title="Предыдущий период" style="width: 28px; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; cursor: pointer;">◀</button>
            <button class="btn-icon" id="btn-cal-next" title="Следующий период" style="width: 28px; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; cursor: pointer;">▶</button>
          </div>
          <span id="cal-period-label" style="font-size: 13px; font-weight: 700; color: var(--text-main); padding: 0 8px; white-space: nowrap;">
            ${getPeriodTitle()}
          </span>
        </div>

        <!-- СЕГМЕНТИРОВАННЫЙ ПЕРЕКЛЮЧАТЕЛЬ РЕЖИМОВ СЕТКИ -->
        <div style="display: inline-flex; background: var(--bg-subtle); padding: 3px; border-radius: 8px; border: 1px solid var(--border-color);">
          <button class="btn btn-sm ${calendarViewMode === 'google' ? 'btn-primary' : 'btn-secondary'}" id="btn-toggle-view-google" style="border-radius: 6px; font-weight: 600; padding: 4px 12px; ${calendarViewMode === 'google' ? '' : 'background: transparent; border-color: transparent; color: var(--text-muted);'}">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-calendar"/></svg> По часам
          </button>
          <button class="btn btn-sm ${calendarViewMode === 'month' ? 'btn-primary' : 'btn-secondary'}" id="btn-toggle-view-month" style="border-radius: 6px; font-weight: 600; padding: 4px 12px; ${calendarViewMode === 'month' ? '' : 'background: transparent; border-color: transparent; color: var(--text-muted);'}">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-calendar"/></svg> Месяц
          </button>
        </div>
      </div>
    `);

    document.getElementById('btn-toggle-cal-sidebar')?.addEventListener('click', () => {
      isCalendarSidebarCollapsed = !isCalendarSidebarCollapsed;
      localStorage.setItem('docflow_cal_sidebar_collapsed', isCalendarSidebarCollapsed);
      render(containerEl || document.getElementById('view-panel-calendar'));
    });

    document.getElementById('btn-topbar-cal-create')?.addEventListener('click', () => {
      if (window.TasksModule) {
        window.TasksModule.openTaskModal(null, {
          fromCalendar: true,
          defaultDate: calendarBaseDate
        });
      }
    });

    document.getElementById('btn-toggle-view-google')?.addEventListener('click', () => {
      calendarViewMode = 'google';
      render(containerEl || document.getElementById('view-panel-calendar'));
    });

    document.getElementById('btn-toggle-view-month')?.addEventListener('click', () => {
      calendarViewMode = 'month';
      render(containerEl || document.getElementById('view-panel-calendar'));
    });

    document.getElementById('btn-cal-today')?.addEventListener('click', () => {
      calendarBaseDate = new Date();
      selectedMiniDate = new Date();
      render(containerEl || document.getElementById('view-panel-calendar'));
    });

    document.getElementById('btn-cal-prev')?.addEventListener('click', () => {
      if (calendarViewMode === 'google') {
        calendarBaseDate.setDate(calendarBaseDate.getDate() - 7);
      } else {
        calendarBaseDate.setMonth(calendarBaseDate.getMonth() - 1);
      }
      render(containerEl || document.getElementById('view-panel-calendar'));
    });

    document.getElementById('btn-cal-next')?.addEventListener('click', () => {
      if (calendarViewMode === 'google') {
        calendarBaseDate.setDate(calendarBaseDate.getDate() + 7);
      } else {
        calendarBaseDate.setMonth(calendarBaseDate.getMonth() + 1);
      }
      render(containerEl || document.getElementById('view-panel-calendar'));
    });
  }

  async function render(containerEl) {
    updateHeaderAndActions(containerEl);

    containerEl.innerHTML = `
      <div class="google-calendar-layout" style="display: flex; gap: 16px; height: calc(100dvh - 190px); min-height: 440px;">
        <div class="skeleton-card" style="width: 250px; flex-shrink: 0; height: 100%;">
          <div class="skeleton skeleton-btn" style="width: 100%; height: 38px; margin-bottom: 12px;"></div>
          <div class="skeleton" style="height: 180px; width: 100%; margin-bottom: 16px; border-radius: 8px;"></div>
          <div class="skeleton skeleton-title" style="width: 60%; margin-bottom: 10px;"></div>
          <div class="skeleton skeleton-text" style="width: 80%;"></div>
          <div class="skeleton skeleton-text" style="width: 90%;"></div>
        </div>
        <div class="skeleton-card" style="flex: 1; height: 100%; display: flex; flex-direction: column;">
          <div style="display: flex; gap: 12px; margin-bottom: 16px;">
            <div class="skeleton" style="width: 120px; height: 34px;"></div>
            <div class="skeleton" style="width: 120px; height: 34px;"></div>
            <div class="skeleton" style="width: 80px; height: 34px; margin-left: auto;"></div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; flex: 1;">
            <div class="skeleton" style="height: 100%; opacity: 0.8;"></div>
            <div class="skeleton" style="height: 100%; opacity: 0.8;"></div>
            <div class="skeleton" style="height: 100%; opacity: 0.8;"></div>
            <div class="skeleton" style="height: 100%; opacity: 0.8;"></div>
            <div class="skeleton" style="height: 100%; opacity: 0.8;"></div>
            <div class="skeleton" style="height: 100%; opacity: 0.8;"></div>
            <div class="skeleton" style="height: 100%; opacity: 0.8;"></div>
          </div>
        </div>
      </div>
    `;

    try {
      calendarFeedData = await API.getCalendarFeed();
      renderCalendarView(containerEl);
    } catch (err) {
      containerEl.innerHTML = `<div class="form-error">Ошибка загрузки календаря: ${AppState.escapeHtml(err.message)}</div>`;
    }
  }

  async function refreshFeed() {
    try {
      calendarFeedData = await API.getCalendarFeed();
      const containerEl = document.getElementById('view-panel-calendar');
      if (containerEl && AppState.getCurrentView() === 'calendar') {
        renderCalendarView(containerEl);
      }
    } catch (e) {}
  }

  function renderCalendarView(containerEl) {
    const currentUser = AppState.getCurrentUser();
    const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin';
    const today = new Date();
    const todayIso = formatDateIso(today);

    // Filter feed
    const events = calendarFeedData.filter(e => {
      if (e.type === 'TASK' && !filterTasks) return false;
      if (e.type === 'CONFERENCE' && !filterConfs) return false;
      return true;
    });

    if (calendarViewMode === 'google') {
      renderGoogleWeekView(containerEl, events, today, todayIso, isAdmin);
    } else {
      renderMonthOverview(containerEl, events, today, todayIso, isAdmin);
    }
  }

  // GOOGLE CALENDAR HOURLY WEEK GRID
  function renderGoogleWeekView(containerEl, events, today, todayIso, isAdmin) {
    const weekDays = getWeekDays(calendarBaseDate);
    const miniDays = buildMiniMonthGrid(calendarBaseDate.getFullYear(), calendarBaseDate.getMonth());
    const hours = Array.from({ length: 24 }, (_, i) => i);

    // Current time indicator calculation
    const currentHour = today.getHours();
    const currentMinute = today.getMinutes();
    const currentMinutesFromMidnight = currentHour * 60 + currentMinute;
    const currentLineTopPx = Math.round((currentMinutesFromMidnight / 60) * 52); // each hour is 52px high

    containerEl.innerHTML = `
      <div class="google-calendar-layout" style="display: flex; gap: 16px; height: calc(100dvh - 190px); min-height: 440px; user-select: none;">
        
        <!-- LEFT CONTROL PANEL (GOOGLE STYLE) -->
        <div class="gcal-sidebar card" style="width: 250px; flex-shrink: 0; padding: 14px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); display: ${isCalendarSidebarCollapsed ? 'none' : 'flex'}; flex-direction: column; gap: 14px; overflow-y: auto;">
          
          <!-- + CREATE BUTTON -->
          ${isAdmin ? `
            <div style="position: relative;">
              <button class="btn btn-primary btn-block" id="btn-gcal-create" style="display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; padding: 10px 16px; border-radius: 24px; box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);">
                <span style="font-size: 18px; font-weight: 700;">+</span>
                <span>Создать</span>
              </button>
            </div>
          ` : ''}

          <!-- MINI MONTH CALENDAR -->
          <div class="gcal-mini-month" style="background: var(--bg-subtle); padding: 10px; border-radius: 10px; border: 1px solid var(--border-color);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 13px; font-weight: 700; color: var(--text-main);">
                ${monthNamesRu[calendarBaseDate.getMonth()]} ${calendarBaseDate.getFullYear()}
              </span>
              <div style="display: flex; gap: 2px;">
                <button class="btn-icon" id="btn-mini-prev" style="padding: 2px 6px; font-size: 11px;">◀</button>
                <button class="btn-icon" id="btn-mini-next" style="padding: 2px 6px; font-size: 11px;">▶</button>
              </div>
            </div>

            <!-- WEEKDAY LABELS (Sun-Sat) -->
            <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 10px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">
              ${weekDaysShort.map(w => `<span>${w}</span>`).join('')}
            </div>

            <!-- DAYS GRID -->
            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center;">
              ${miniDays.map(item => {
                const isToday = item.dateStr === todayIso;
                const isSelected = item.dateStr === formatDateIso(calendarBaseDate);
                let bg = 'transparent';
                let color = item.isCurrentMonth ? 'var(--text-main)' : 'var(--text-muted)';
                let border = 'none';

                if (isToday) {
                  bg = 'var(--primary)';
                  color = '#ffffff';
                } else if (isSelected) {
                  bg = 'rgba(59, 130, 246, 0.2)';
                  border = '1px solid var(--primary)';
                }

                return `
                  <div class="mini-day-cell" data-date="${item.dateStr}" style="padding: 4px 0; font-size: 11px; border-radius: 50%; cursor: pointer; background: ${bg}; color: ${color}; border: ${border}; opacity: ${item.isCurrentMonth ? 1 : 0.4};">
                    ${item.day}
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- CALENDARS FILTER CHECKBOXES -->
          <div style="border-top: 1px solid var(--border-color); padding-top: 10px;">
            <div style="font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 8px; text-transform: uppercase;">
              Мои календари
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; color: var(--text-main);">
                <input type="checkbox" id="chk-filter-tasks" ${filterTasks ? 'checked' : ''} style="accent-color: #3b82f6;">
                <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clipboard"/></svg> Задачи и поручения</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; color: var(--text-main);">
                <input type="checkbox" id="chk-filter-confs" ${filterConfs ? 'checked' : ''} style="accent-color: #10b981;">
                <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-video"/></svg> Конференции и встречи</span>
              </label>
            </div>
          </div>

          <div style="margin-top: auto; font-size: 11px; color: var(--text-muted); background: var(--bg-subtle); padding: 8px 10px; border-radius: 6px; border-left: 3px solid var(--primary);">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-lightbulb"/></svg> <strong>Совет:</strong> Нажмите <strong>ПКМ (правой кнопкой мыши)</strong> на свободное время или событие, чтобы открыть меню быстрых действий!
          </div>
        </div>

        <!-- RIGHT HOURLY WEEK GRID -->
        <div class="gcal-main-grid card" style="flex: 1; min-width: 0; padding: 0; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); display: flex; flex-direction: column; overflow: hidden; position: relative;">
          
          <!-- SCROLLABLE HOURLY TIME GRID WITH INTEGRATED STICKY HEADER -->
          <div id="gcal-scroll-pane" style="flex: 1; min-width: 0; overflow-y: auto; overflow-x: auto; position: relative;">
            
            <!-- DAYS HEADER (STICKY AT TOP INSIDE SCROLL PANE SO COLUMNS ALIGN 1:1 WITH SCROLLBAR) -->
            <div class="gcal-days-header" style="display: flex; min-width: 616px; border-bottom: 1px solid var(--border-color); background: var(--bg-card); position: sticky; top: 0; z-index: 20; box-shadow: 0 1px 4px rgba(0,0,0,0.06);">
              <div class="gcal-time-header-cell" style="width: 56px; min-width: 56px; flex-shrink: 0; padding: 10px 4px; text-align: center; font-size: 11px; font-weight: 600; color: var(--text-muted); border-right: 1px solid var(--border-color); position: sticky; left: 0; z-index: 25; background: var(--bg-card); box-shadow: 2px 0 4px rgba(0,0,0,0.05);">
                МСК
              </div>
              <div class="gcal-days-header-grid" style="flex: 1; min-width: 560px; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr));">
                ${weekDays.map(d => {
                  const isToday = formatDateIso(d) === todayIso;
                  const dayNum = d.getDate();
                  const dayName = weekDaysMonFirst[(d.getDay() + 6) % 7];
                  return `
                    <div style="text-align: center; padding: 8px 4px; border-right: 1px solid var(--border-color); background: ${isToday ? 'rgba(59, 130, 246, 0.08)' : 'transparent'}; min-width: 0;">
                      <div style="font-size: 11px; font-weight: 600; color: ${isToday ? 'var(--primary)' : 'var(--text-muted)'}; text-transform: uppercase;">
                        ${dayName}
                      </div>
                      <div style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; font-size: 15px; font-weight: 700; margin-top: 2px; background: ${isToday ? 'var(--primary)' : 'transparent'}; color: ${isToday ? '#ffffff' : 'var(--text-main)'};">
                        ${dayNum}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>

            <!-- HOURLY BODY -->
            <div style="display: flex; height: ${24 * 52}px; position: relative; min-width: 616px;">
              
              <!-- TIME LABELS COLUMN -->
              <div class="gcal-time-col" style="width: 56px; min-width: 56px; flex-shrink: 0; border-right: 1px solid var(--border-color); background: var(--bg-card); position: sticky; left: 0; z-index: 10; box-shadow: 2px 0 4px rgba(0,0,0,0.05);">
                ${hours.map(h => `
                  <div style="height: 52px; box-sizing: border-box; padding-right: 6px; text-align: right; font-size: 11px; font-weight: 500; color: var(--text-muted); transform: translateY(-7px);">
                    ${h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
                  </div>
                `).join('')}
              </div>

              <!-- 7 DAYS COLUMNS (EXACT SAME minmax(0, 1fr) AS HEADER) -->
              <div class="gcal-days-grid" style="flex: 1; min-width: 560px; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); position: relative;">
                ${weekDays.map(d => {
                  const dIso = formatDateIso(d);
                  const isToday = dIso === todayIso;

                  // Find events for this day
                  const dayEvents = events.filter(e => {
                    if (!e.event_date) return false;
                    return formatDateIso(new Date(e.event_date)) === dIso;
                  });

                  return `
                    <div class="gcal-day-column" data-date="${dIso}" style="border-right: 1px solid var(--border-color); position: relative; height: 100%; min-width: 0; background: ${isToday ? 'rgba(59, 130, 246, 0.02)' : 'transparent'};">
                      
                      <!-- HOUR HORIZONTAL GUIDELINES -->
                      ${hours.map(h => `
                        <div class="gcal-hour-cell" data-date="${dIso}" data-hour="${h}" style="height: 52px; box-sizing: border-box; border-bottom: 1px solid var(--border-color); opacity: 0.6; cursor: pointer;"></div>
                      `).join('')}

                      <!-- CURRENT TIME RED LINE (if today) -->
                      ${isToday ? `
                        <div style="position: absolute; top: ${currentLineTopPx}px; left: 0; right: 0; z-index: 8; pointer-events: none; display: flex; align-items: center;">
                          <div style="width: 10px; height: 10px; border-radius: 50%; background: #ef4444; margin-left: -5px; box-shadow: 0 0 6px rgba(239, 68, 68, 0.8);"></div>
                          <div style="flex: 1; height: 2px; background: #ef4444;"></div>
                        </div>
                      ` : ''}

                      <!-- EVENT CARDS POSITIONED IN COLUMN -->
                      ${dayEvents.map(e => {
                        const evDate = new Date(e.event_date);
                        const h = evDate.getHours();
                        const m = evDate.getMinutes();
                        const topPx = Math.round((h * 60 + m) / 60 * 52);
                        const isConf = e.type === 'CONFERENCE';
                        const bg = isConf ? 'rgba(16, 185, 129, 0.92)' : 'rgba(59, 130, 246, 0.92)';
                        const border = isConf ? '#059669' : '#2563eb';

                        return `
                          <div class="gcal-event-card" data-id="${e.id}" data-type="${e.type}" style="position: absolute; top: ${topPx}px; left: 2px; right: 2px; min-height: 44px; background: ${bg}; border-left: 3px solid ${border}; border-radius: 4px; padding: 4px 6px; color: #ffffff; font-size: 11px; z-index: 4; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.25); overflow: hidden;">
                            <div style="font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">
                              ${isConf ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-video"/></svg> ' : '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clipboard"/></svg> '}${AppState.escapeHtml(e.title)}
                            </div>
                            <div style="opacity: 0.9; font-size: 10px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                              ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${e.category ? `• ${AppState.escapeHtml(e.category)}` : ''}
                            </div>
                          </div>
                        `;
                      }).join('')}

                    </div>
                  `;
                }).join('')}
              </div>

            </div>
          </div>

        </div>
      </div>
    `;

    // Scroll to current work hours (e.g. 8:00 AM) automatically
    setTimeout(() => {
      const scrollPane = containerEl.querySelector('#gcal-scroll-pane');
      if (scrollPane) {
        const targetHour = Math.max(0, today.getHours() - 1);
        scrollPane.scrollTop = targetHour * 52;
      }
    }, 50);

    bindGoogleViewEvents(containerEl, isAdmin);
  }

  // CONTEXT MENU HELPER
  function closeContextMenu() {
    const existing = document.getElementById('calendar-context-menu');
    if (existing) existing.remove();
  }

  function showContextMenu(e, items) {
    e.preventDefault();
    e.stopPropagation();
    closeContextMenu();

    const menu = document.createElement('div');
    menu.id = 'calendar-context-menu';
    menu.style.cssText = `
      position: fixed;
      top: ${Math.min(e.clientY, window.innerHeight - (items.length * 40 + 20))}px;
      left: ${Math.min(e.clientX, window.innerWidth - 220)}px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
      z-index: 10000;
      padding: 6px;
      min-width: 200px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 13px;
    `;

    items.forEach(item => {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height: 1px; background: var(--border-color); margin: 4px 0;';
        menu.appendChild(sep);
        return;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 10px;
        background: transparent;
        border: none;
        border-radius: 6px;
        color: ${item.danger ? 'var(--danger, #ef4444)' : 'var(--text-main)'};
        cursor: pointer;
        text-align: left;
        font-size: 12.5px;
        font-weight: 500;
        transition: background 0.15s ease;
      `;
      btn.innerHTML = `<span>${item.icon || ''}</span> <span>${item.label}</span>`;
      btn.onmouseenter = () => { btn.style.background = item.danger ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-subtle)'; };
      btn.onmouseleave = () => { btn.style.background = 'transparent'; };
      btn.onclick = () => {
        closeContextMenu();
        item.onClick();
      };
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    const onDocClick = (ev) => {
      if (!menu.contains(ev.target)) {
        closeContextMenu();
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('contextmenu', onDocClick);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', onDocClick);
      document.addEventListener('contextmenu', onDocClick);
    }, 10);
  }

  function bindGoogleViewEvents(containerEl, isAdmin) {
    // Mini month navigation
    containerEl.querySelector('#btn-mini-prev')?.addEventListener('click', () => {
      calendarBaseDate.setMonth(calendarBaseDate.getMonth() - 1);
      render(containerEl);
    });

    containerEl.querySelector('#btn-mini-next')?.addEventListener('click', () => {
      calendarBaseDate.setMonth(calendarBaseDate.getMonth() + 1);
      render(containerEl);
    });

    // Mini month cell clicks
    containerEl.querySelectorAll('.mini-day-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const dateStr = cell.getAttribute('data-date');
        if (dateStr) {
          const parts = dateStr.split('-');
          calendarBaseDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          render(containerEl);
        }
      });
    });

    // Checkboxes filters
    containerEl.querySelector('#chk-filter-tasks')?.addEventListener('change', (e) => {
      filterTasks = e.target.checked;
      render(containerEl);
    });

    containerEl.querySelector('#chk-filter-confs')?.addEventListener('change', (e) => {
      filterConfs = e.target.checked;
      render(containerEl);
    });

    // Create button in sidebar
    containerEl.querySelector('#btn-gcal-create')?.addEventListener('click', () => {
      if (window.TasksModule) {
        window.TasksModule.openTaskModal(null, {
          fromCalendar: true,
          defaultDate: calendarBaseDate
        });
      }
    });

    // RIGHT CLICK (ПКМ) & DOUBLE CLICK ON HOUR CELLS -> CONTEXT MENU
    containerEl.querySelectorAll('.gcal-hour-cell').forEach(cell => {
      const getSlotData = () => {
        const dateStr = cell.getAttribute('data-date');
        const hour = parseInt(cell.getAttribute('data-hour') || '10', 10);
        const parts = dateStr.split('-');
        const targetDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), hour, 0);
        const timeStr = `${String(hour).padStart(2, '0')}:00`;
        return { targetDate, timeStr, dateStr };
      };

      // Right-click (ПКМ) -> Action menu (Пункт 8)
      cell.addEventListener('contextmenu', (e) => {
        const slot = getSlotData();
        const menuItems = [
          {
            icon: dfIcon('clipboard', 16),
            label: `Создать задачу на ${slot.timeStr}`,
            onClick: () => {
              if (window.TasksModule) {
                window.TasksModule.openTaskModal(null, {
                  fromCalendar: true,
                  defaultDate: slot.targetDate,
                  defaultTime: slot.timeStr
                });
              }
            }
          },
          {
            icon: dfIcon('video', 16),
            label: `Запланировать встречу на ${slot.timeStr}`,
            onClick: () => {
              if (window.ConferencesModule && window.ConferencesModule.openScheduleModal) {
                window.ConferencesModule.openScheduleModal(slot.dateStr, slot.timeStr);
              } else {
                AppState.switchView('conferences');
              }
            }
          }
        ];
        showContextMenu(e, menuItems);
      });

      // Double-click (Двойной клик) -> Create task
      cell.addEventListener('dblclick', (e) => {
        e.preventDefault();
        const slot = getSlotData();
        if (window.TasksModule) {
          window.TasksModule.openTaskModal(null, {
            fromCalendar: true,
            defaultDate: slot.targetDate,
            defaultTime: slot.timeStr
          });
        }
      });
    });

    // EVENT CARDS CLICK & CONTEXT MENU (ПКМ)
    containerEl.querySelectorAll('.gcal-event-card').forEach(card => {
      const id = parseInt(card.getAttribute('data-id'), 10);
      const type = card.getAttribute('data-type');
      const event = calendarFeedData.find(ev => ev.id === id && ev.type === type);

      // Left click -> Details modal
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        if (event) showEventDetailsModal(event);
      });

      // Right click (ПКМ) -> Event Actions Menu (Пункт 8: Удалить встречу, изменить, создать новую)
      card.addEventListener('contextmenu', (e) => {
        if (!event) return;
        const isConf = event.type === 'CONFERENCE';
        const menuItems = [
          {
            icon: dfIcon('eye', 16),
            label: 'Просмотреть детали',
            onClick: () => showEventDetailsModal(event)
          },
          {
            icon: dfIcon('pencil', 16),
            label: isConf ? 'Изменить встречу' : 'Редактировать задачу',
            onClick: () => {
              if (isConf) {
                if (window.ConferencesModule && window.ConferencesModule.openScheduleModal) {
                  window.ConferencesModule.openScheduleModal(null, null, event);
                } else {
                  AppState.switchView('conferences');
                }
              } else {
                if (window.TasksModule) {
                  window.TasksModule.openTaskModal(event, { fromCalendar: true });
                }
              }
            }
          },
          {
            icon: '+',
            label: 'Создать новую задачу рядом',
            onClick: () => {
              if (window.TasksModule) {
                window.TasksModule.openTaskModal(null, {
                  fromCalendar: true,
                  defaultDate: new Date(event.event_date)
                });
              }
            }
          },
          { separator: true },
          {
            icon: dfIcon('trash', 16),
            label: isConf ? 'Удалить встречу' : 'Удалить задачу',
            danger: true,
            onClick: async () => {
              if (confirm(`Вы уверены, что хотите удалить ${isConf ? 'встречу' : 'задачу'} "${event.title}"?`)) {
                try {
                  if (isConf) {
                    await API.deleteConference(event.id);
                  } else {
                    await API.deleteTask(event.id);
                  }
                  AppState.showAlert(`${isConf ? 'Встреча' : 'Задача'} удалена`, 'success');
                  refreshFeed();
                } catch (err) {
                  alert('Ошибка удаления: ' + err.message);
                }
              }
            }
          }
        ];
        showContextMenu(e, menuItems);
      });
    });
  }

  // MONTH OVERVIEW (ALTERNATIVE VIEW)
  function renderMonthOverview(containerEl, events, today, todayIso, isAdmin) {
    const year = calendarBaseDate.getFullYear();
    const month = calendarBaseDate.getMonth();
    const days = buildMiniMonthGrid(year, month);

    containerEl.innerHTML = `
      <div class="calendar-month-overview card" style="padding: 18px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
          <h2 style="font-size: 18px; font-weight: 700; color: var(--text-main); margin: 0;">
            <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-calendar"/></svg> ${monthNamesRu[month]} ${year}
          </h2>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary btn-sm" id="btn-month-prev">◀ Предыдущий</button>
            <button class="btn btn-secondary btn-sm" id="btn-month-next">Следующий ▶</button>
          </div>
        </div>

        <!-- DAYS OF WEEK HEADER: STRICT repeat(7, minmax(0, 1fr)) TO PREVENT THU/FRI COLLAPSE (DEF-17) -->
        <div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); text-align: center; font-size: 12px; font-weight: 700; color: var(--text-muted); margin-bottom: 8px;">
          ${weekDaysShort.map(w => `<div style="padding: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${w}</div>`).join('')}
        </div>

        <!-- DAYS OF MONTH GRID: STRICT repeat(7, minmax(0, 1fr)) WITH min-width: 0 (DEF-17) -->
        <div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px;">
          ${days.map(d => {
            const isToday = d.dateStr === todayIso;
            const dayEvents = events.filter(e => e.event_date && formatDateIso(new Date(e.event_date)) === d.dateStr);

            return `
              <div class="month-day-cell-card" data-date="${d.dateStr}" style="min-height: 95px; padding: 6px 8px; border-radius: 8px; background: ${isToday ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-subtle)'}; border: 1px solid ${isToday ? 'var(--primary)' : 'var(--border-color)'}; opacity: ${d.isCurrentMonth ? 1 : 0.4}; cursor: pointer; display: flex; flex-direction: column; min-width: 0; overflow: hidden; box-sizing: border-box;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <span style="font-weight: 700; font-size: 12px; color: ${isToday ? 'var(--primary)' : 'var(--text-main)'};">${d.day}</span>
                  ${dayEvents.length > 0 ? `<span class="badge badge-subtle" style="font-size: 9.5px; padding: 1px 4px;">${dayEvents.length}</span>` : ''}
                </div>
                <div style="display: flex; flex-direction: column; gap: 3px; min-width: 0; overflow: hidden;">
                  ${dayEvents.slice(0, 3).map(e => `
                    <div class="month-event-chip" data-id="${e.id}" data-type="${e.type}" title="${AppState.escapeHtml(e.title)}" style="font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 2px 4px; border-radius: 3px; background: ${e.type === 'CONFERENCE' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.2)'}; color: var(--text-main); min-width: 0; max-width: 100%;">
                      ${e.type === 'CONFERENCE' ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-video"/></svg>' : '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clipboard"/></svg>'} ${AppState.escapeHtml(e.title)}
                    </div>
                  `).join('')}
                  ${dayEvents.length > 3 ? `<div style="font-size: 9.5px; color: var(--text-muted); text-align: center;">+ еще ${dayEvents.length - 3}</div>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    containerEl.querySelector('#btn-month-prev')?.addEventListener('click', () => {
      calendarBaseDate.setMonth(calendarBaseDate.getMonth() - 1);
      render(containerEl);
    });

    containerEl.querySelector('#btn-month-next')?.addEventListener('click', () => {
      calendarBaseDate.setMonth(calendarBaseDate.getMonth() + 1);
      render(containerEl);
    });

    // Click on event chip in month view
    containerEl.querySelectorAll('.month-event-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(chip.getAttribute('data-id'), 10);
        const type = chip.getAttribute('data-type');
        const ev = calendarFeedData.find(item => item.id === id && item.type === type);
        if (ev) showEventDetailsModal(ev);
      });
    });

    // Right-click (ПКМ) on month card -> Actions menu
    containerEl.querySelectorAll('.month-day-cell-card').forEach(cell => {
      cell.addEventListener('contextmenu', (e) => {
        const dateStr = cell.getAttribute('data-date');
        const parts = dateStr.split('-');
        const targetDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0);

        const menuItems = [
          {
            icon: dfIcon('clipboard', 16),
            label: `Создать задачу на ${parts[2]}.${parts[1]}.${parts[0]}`,
            onClick: () => {
              if (window.TasksModule) {
                window.TasksModule.openTaskModal(null, {
                  fromCalendar: true,
                  defaultDate: targetDate,
                  defaultTime: '12:00'
                });
              }
            }
          },
          {
            icon: dfIcon('video', 16),
            label: 'Запланировать встречу',
            onClick: () => {
              if (window.ConferencesModule && window.ConferencesModule.openScheduleModal) {
                window.ConferencesModule.openScheduleModal(dateStr, '12:00');
              } else {
                AppState.switchView('conferences');
              }
            }
          }
        ];
        showContextMenu(e, menuItems);
      });
    });
  }

  function showEventDetailsModal(event) {
    const isConf = event.type === 'CONFERENCE';
    AppState.setModalTitle(isConf ? 'Детали конференции' : '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clipboard"/></svg> Детали задачи');
    const modalBody = document.getElementById('modal-body');

    const formattedTime = AppState.formatDateTimeHumanRu(event.event_date) || AppState.formatDateTimeRu(event.event_date);

    modalBody.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div>
          <h3 style="font-size: 18px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">
            ${AppState.escapeHtml(event.title)}
          </h3>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <span class="badge ${isConf ? 'badge-active' : 'badge-primary'}">${isConf ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-video"/></svg> Конференция' : '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clipboard"/></svg> Задача'}</span>
            ${event.priority ? `<span class="badge badge-warning">Приоритет: ${event.priority}</span>` : ''}
            ${event.category ? `<span class="badge badge-subtle">Категория: ${AppState.escapeHtml(event.category)}</span>` : ''}
          </div>
        </div>

        <div style="background: var(--bg-subtle); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); font-size: 13px; display: flex; flex-direction: column; gap: 6px;">
          <div><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clock"/></svg> <strong>Время:</strong> ${formattedTime}</div>
          ${event.assignee_name ? `<div><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-user"/></svg> <strong>Исполнитель:</strong> ${AppState.escapeHtml(event.assignee_name)}</div>` : ''}
          ${event.location_or_link ? `
            <div><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-map-pin"/></svg> <strong>Место/Ссылка:</strong> 
              ${event.location_or_link.startsWith('http') 
                ? `<a href="${AppState.escapeHtml(event.location_or_link)}" target="_blank" style="color: var(--primary); text-decoration: underline;">${AppState.escapeHtml(event.location_or_link)}</a>`
                : AppState.escapeHtml(event.location_or_link)
              }
            </div>
          ` : ''}
        </div>

        ${event.description ? `
          <div>
            <div style="font-weight: 600; font-size: 13px; color: var(--text-muted); margin-bottom: 4px;">Описание:</div>
            <div style="font-size: 13px; color: var(--text-main); line-height: 1.5; white-space: pre-wrap;">${AppState.escapeHtml(event.description)}</div>
          </div>
        ` : ''}

        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
          <button class="btn btn-secondary" onclick="AppState.closeModal()">Закрыть</button>
        </div>
      </div>
    `;
    AppState.openModal();
  }

  return {
    render: render,
    onActivated: (containerEl) => {
      updateHeaderAndActions(containerEl);
    },
    refreshFeed: refreshFeed
  };
})();
