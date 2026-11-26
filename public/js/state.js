// public/js/state.js
window.AppState = {
  currentUser: null,
  currentView: 'dashboard',
  activeMailFolder: 'inbox',
  selectedMailId: null,
  mailSearchQuery: '',
  
  // Documents / ONLYOFFICE state
  activeDocumentId: null,
  loadedDocEditor: null,
  
  // Calendar state
  calendarBaseDate: new Date(),
  calendarPeriodMode: 'week',
  calendarSelectedSingleDate: null,
  calendarCustomStart: '',
  calendarCustomEnd: '',
  calendarTypeFilter: 'all',
  calendarFeedData: [],
  
  // Cached view panels DOM
  viewPanels: {},

  // User Getters/Setters
  setCurrentUser: function(user) {
    this.currentUser = user;
  },

  getCurrentUser: function() {
    return this.currentUser;
  },

  // View Navigation Getters/Setters
  setCurrentView: function(view) {
    this.currentView = view;
  },

  getCurrentView: function() {
    return this.currentView || 'dashboard';
  },

  // UI Header & Actions Updates
  setHeader: function(title, subtitle) {
    const t = document.getElementById('view-title');
    const s = document.getElementById('view-subtitle');
    if (t) t.textContent = title || '';
    if (s) s.textContent = subtitle || '';
  },

  setTopBarActions: function(html) {
    const el = document.getElementById('top-bar-actions');
    if (el) el.innerHTML = html || '';
  },

  // Modal Dialog Helpers
  openModal: function(title, content, size = 'md') {
    if (title) this.setModalTitle(title);
    if (content !== undefined && content !== null) {
      const modalBody = document.getElementById('modal-body');
      if (modalBody) {
        if (typeof content === 'string') {
          modalBody.innerHTML = content;
        } else if (content instanceof HTMLElement) {
          modalBody.innerHTML = '';
          modalBody.appendChild(content);
        }
      }
    }
    const m = document.getElementById('modal-container');
    const w = m?.querySelector('.modal-window');
    if (w) {
      w.classList.remove('modal-sm', 'modal-md', 'modal-lg');
      w.classList.add(`modal-${size || 'md'}`);
    }
    if (m) m.classList.remove('hidden');
  },

  closeModal: function() {
    const m = document.getElementById('modal-container');
    if (m) m.classList.add('hidden');
    // Закрываем также любые другие открытые модалки или оверлеи
    document.querySelectorAll('.modal-overlay:not(#modal-container)').forEach(el => el.classList.add('hidden'));
  },

  setModalTitle: function(title) {
    const t = document.getElementById('modal-title');
    if (t) t.textContent = title || '';
  },

  showConfirmModal: function(options) {
    const {
      title = 'Подтверждение действия',
      message = 'Вы действительно хотите выполнить это действие?',
      confirmText = 'Удалить',
      cancelText = 'Отмена',
      onConfirm
    } = options || {};

    this.setModalTitle(title);
    const modalBody = document.getElementById('modal-body');
    if (modalBody) {
      modalBody.innerHTML = `
        <div style="margin-bottom: 24px; color: var(--text-main); font-size: 14px; line-height: 1.6;">
          <div style="font-size: 36px; text-align: center; margin-bottom: 12px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-alert-triangle'/></svg></div>
          <p style="text-align: center; font-weight: 500;">${this.escapeHtml(message)}</p>
        </div>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button class="btn btn-secondary" id="confirm-cancel-btn">${this.escapeHtml(cancelText)}</button>
          <button class="btn btn-primary" id="confirm-ok-btn" style="background-color: var(--danger); border-color: var(--danger);">${this.escapeHtml(confirmText)}</button>
        </div>
      `;
    }
    this.openModal();

    document.getElementById('confirm-cancel-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('confirm-ok-btn')?.addEventListener('click', async () => {
      this.closeModal();
      if (typeof onConfirm === 'function') {
        await onConfirm();
      }
    });
  },

  // Toast Alert Notification Helper (replaces browser alerts)
  showAlert: function(message, type = 'success') {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 400px;
        pointer-events: none;
      `;
      document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.style.cssText = `
      pointer-events: auto;
      background: ${type === 'danger' || type === 'error' ? 'rgba(239, 68, 68, 0.95)' : type === 'warning' ? 'rgba(245, 158, 11, 0.95)' : 'rgba(16, 185, 129, 0.95)'};
      color: #ffffff;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      transition: all 0.25s ease;
    `;

    toast.innerHTML = `
      <span>${this.escapeHtml(message)}</span>
      <span style="cursor: pointer; opacity: 0.8; font-size: 16px; margin-left: 8px;" onclick="this.parentElement.remove()">✕</span>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  },

  // HTML Escaping Utility
  escapeHtml: function(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  // Safely destroy active ONLYOFFICE editor instance before switching or reloading documents
  destroyActiveDocEditor: function() {
    if (this.loadedDocEditor) {
      try {
        if (typeof this.loadedDocEditor.destroyEditor === 'function') {
          this.loadedDocEditor.destroyEditor();
        }
      } catch (err) {
        console.warn('[ONLYOFFICE] Warning during destroyEditor:', err);
      }
      this.loadedDocEditor = null;
    }
  },

  // Event Bus (PubSub) для реактивного динамического обновления интерфейса
  _listeners: {},
  on: function(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  },
  off: function(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  },
  emit: function(event, data) {
    if (!this._listeners[event]) return;
    this._listeners[event].forEach(cb => {
      try { cb(data); } catch (e) { console.error(`Event error [${event}]:`, e); }
    });
  },

  // Утилиты работы с датами в российском формате (День.Месяц.Год: ДД.ММ.ГГГГ)
  formatDateRu: function(dateOrStr) {
    if (!dateOrStr) return '';
    const d = new Date(dateOrStr);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}.${month}.${year}`;
  },

  formatTimeRu: function(dateOrStr) {
    if (!dateOrStr) return '18:00';
    const d = new Date(dateOrStr);
    if (isNaN(d.getTime())) return '18:00';
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${mins}`;
  },

  formatDateTimeRu: function(dateOrStr) {
    if (!dateOrStr) return 'Не задан';
    const d = new Date(dateOrStr);
    if (isNaN(d.getTime())) return 'Не задан';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} в ${hours}:${mins}`;
  },

  formatDateTimeHumanRu: function(dateOrStr) {
    if (!dateOrStr) return '';
    const d = new Date(dateOrStr);
    if (isNaN(d.getTime())) return '';
    const monthNames = [
      'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ];
    const daysWeek = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${daysWeek[d.getDay()]}, ${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()} г., ${hours}:${mins}`;
  },

  parseRuDateTime: function(dateStr, timeStr = '18:00') {
    if (!dateStr || !dateStr.trim()) return null;
    const trimmed = dateStr.trim();
    let day, month, year;
    if (trimmed.includes('.')) {
      const parts = trimmed.split('.');
      if (parts.length >= 3) {
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        year = parseInt(parts[2], 10);
        if (year < 100) year += 2000;
      }
    } else if (trimmed.includes('-')) {
      const parts = trimmed.split('-');
      if (parts.length >= 3) {
        if (parts[0].length === 4) {
          year = parseInt(parts[0], 10);
          month = parseInt(parts[1], 10) - 1;
          day = parseInt(parts[2], 10);
        } else {
          day = parseInt(parts[0], 10);
          month = parseInt(parts[1], 10) - 1;
          year = parseInt(parts[2], 10);
        }
      }
    }
    if (!day || month === undefined || !year || isNaN(day) || isNaN(month) || isNaN(year)) return null;
    let hours = 18, mins = 0;
    if (timeStr && timeStr.includes(':')) {
      const tParts = timeStr.split(':');
      hours = parseInt(tParts[0], 10) || 0;
      mins = parseInt(tParts[1], 10) || 0;
    }
    const d = new Date(year, month, day, hours, mins, 0, 0);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  },

  formatFileSize: function(bytes) {
    if (!bytes || bytes === 0) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + (sizes[i] || 'Б');
  },

  isAdmin: function() {
    const user = this.getCurrentUser();
    return user?.role === 'ADMIN' || user?.role_code === 'admin';
  },

  // Единая пагинация для всех длинных списков
  paginate: function(items, page = 1, pageSize = 15) {
    const list = Array.isArray(items) ? items : [];
    const safeSize = Math.max(1, parseInt(pageSize, 10) || 15);
    const totalItems = list.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / safeSize));
    const safePage = Math.min(Math.max(1, parseInt(page, 10) || 1), totalPages);
    const startIdx = (safePage - 1) * safeSize;
    const endIdx = Math.min(startIdx + safeSize, totalItems);
    return {
      items: list.slice(startIdx, endIdx),
      page: safePage,
      pageSize: safeSize,
      totalItems,
      totalPages,
      startIdx,
      endIdx
    };
  },

  renderPaginationHtml: function(pg, options = {}) {
    if (!pg || pg.totalItems === 0) return '';
    const sizeOptions = options.pageSizeOptions || [10, 15, 30, 50];
    const minSize = Math.min(...sizeOptions);
    if (pg.totalItems <= minSize && pg.totalPages <= 1) return '';

    const { page, pageSize, totalItems, totalPages, startIdx, endIdx } = pg;
    const pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      const from = Math.max(2, page - 1);
      const to = Math.min(totalPages - 1, page + 1);
      for (let i = from; i <= to; i++) pages.push(i);
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }

    return `
      <div class="pagination-bar" role="navigation" aria-label="Постраничная навигация">
        <div class="pagination-info">
          Показано <strong>${startIdx + 1}–${endIdx}</strong> из <strong>${totalItems}</strong>
        </div>
        <div class="pagination-controls">
          <label class="pagination-size-label">
            <span>На стр.:</span>
            <select class="pagination-size-select" aria-label="Элементов на странице">
              ${sizeOptions.map(sz => `<option value="${sz}" ${sz === pageSize ? 'selected' : ''}>${sz}</option>`).join('')}
            </select>
          </label>
          ${totalPages > 1 ? `
            <div class="pagination-pages">
              <button type="button" class="pagination-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} title="Предыдущая" aria-label="Предыдущая страница">‹</button>
              ${pages.map(p => p === '...'
                ? `<span class="pagination-ellipsis">…</span>`
                : `<button type="button" class="pagination-btn ${p === page ? 'active' : ''}" data-page="${p}" ${p === page ? 'aria-current="page"' : ''}>${p}</button>`
              ).join('')}
              <button type="button" class="pagination-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''} title="Следующая" aria-label="Следующая страница">›</button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  },

  bindPaginationEvents: function(containerEl, { onPageChange, onPageSizeChange } = {}) {
    if (!containerEl) return;
    containerEl.querySelectorAll('.pagination-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const p = parseInt(btn.getAttribute('data-page'), 10);
        if (p && typeof onPageChange === 'function') onPageChange(p);
      });
    });
    containerEl.querySelectorAll('.pagination-size-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const sz = parseInt(e.target.value, 10);
        if (sz && typeof onPageSizeChange === 'function') onPageSizeChange(sz);
      });
    });
  }
};

// Global Helper functions
window.escapeHtml = window.AppState.escapeHtml;

window.formatDateIso = function(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

window.parseDateIso = function(str) {
  if (!str) return null;
  const parts = str.split('-');
  if (parts.length < 3) return null;
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
};
