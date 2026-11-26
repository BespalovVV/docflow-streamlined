// public/js/app.js
(function() {
  const authScreen = document.getElementById('auth-screen');
  const appScreen = document.getElementById('app-screen');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const twoFaSetupForm = document.getElementById('twofa-setup-form');
  const twoFaVerifyForm = document.getElementById('twofa-verify-form');
  const contentArea = document.getElementById('content-area');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalContainer = document.getElementById('modal-container');

  let pending2FA = {
    preAuthToken: null,
    email: '',
    manualSecret: '',
    pendingToken: null,
    pendingUser: null,
    backupCodes: []
  };

  function resetPending2FA() {
    pending2FA = {
      preAuthToken: null,
      email: '',
      manualSecret: '',
      pendingToken: null,
      pendingUser: null,
      backupCodes: []
    };
  }

  function setAuthStep(step) {
    const steps = {
      login: document.getElementById('auth-step-login'),
      setup: document.getElementById('auth-step-2fa-setup'),
      backup: document.getElementById('auth-step-2fa-backup'),
      verify: document.getElementById('auth-step-2fa-verify')
    };
    Object.entries(steps).forEach(([key, el]) => {
      if (!el) return;
      if (key === step) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });

    if (step === 'login') {
      resetPending2FA();
      loginError?.classList.add('hidden');
      document.getElementById('twofa-setup-error')?.classList.add('hidden');
      document.getElementById('twofa-verify-error')?.classList.add('hidden');
    } else if (step === 'setup') {
      document.getElementById('twofa-setup-error')?.classList.add('hidden');
      const inp = document.getElementById('twofa-setup-code');
      if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 40); }
    } else if (step === 'verify') {
      document.getElementById('twofa-verify-error')?.classList.add('hidden');
      const inp = document.getElementById('twofa-verify-code');
      if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 40); }
    }
  }

  const validViews = ['dashboard', 'mail', 'messenger', 'projects', 'materials', 'directions', 'tasks', 'calendar', 'conferences', 'documents', 'users'];
  const modulesMap = {
    dashboard: window.DashboardModule,
    mail: window.MailModule,
    messenger: window.MessengerModule,
    projects: window.ProjectsModule,
    materials: window.MaterialsModule,
    directions: window.MaterialsModule,
    tasks: window.TasksModule,
    calendar: window.CalendarModule,
    conferences: window.ConferencesModule,
    documents: window.DocumentsModule,
    users: window.UsersModule
  };

  // INIT APP
  document.addEventListener('DOMContentLoaded', async () => {
    document.documentElement.removeAttribute('data-palette');
    localStorage.removeItem('docflow_palette');
    initTheme();
    syncNavAccessibility();
    initSidebarTouchGestures();
    initPwaInstall();
    bindEvents();
    initPanels();
    await checkAuth();
  });

  // THEME MANAGEMENT (DARK / LIGHT)
  function initTheme() {
    const savedTheme = localStorage.getItem('docflow_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme === 'dark' || savedTheme === 'light'
      ? savedTheme
      : (prefersDark ? 'dark' : 'light');
    applyTheme(initialTheme, false);
  }

  function applyTheme(theme, animateTransition = false) {
    const cleanTheme = theme === 'dark' ? 'dark' : 'light';
    const commit = () => {
      document.documentElement.setAttribute('data-theme', cleanTheme);
      localStorage.setItem('docflow_theme', cleanTheme);
      updateThemeButtonUI(cleanTheme);
    };

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (animateTransition && !reduceMotion && typeof document.startViewTransition === 'function') {
      document.startViewTransition(commit);
    } else {
      commit();
    }
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme, true);
  }

  function updateThemeButtonUI(theme) {
    const isLight = theme !== 'dark';
    const btnIds = ['btn-theme-toggle', 'btn-auth-theme-toggle', 'btn-sidebar-theme-toggle'];
    btnIds.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.setAttribute('aria-pressed', isLight ? 'false' : 'true');
    });

    // Top-bar button
    const iconEl = document.getElementById('theme-toggle-icon');
    const textEl = document.getElementById('theme-toggle-text');
    const themeSvg = typeof dfIcon === 'function' ? dfIcon(isLight ? 'sun' : 'moon', 16) : '';
    if (iconEl) iconEl.innerHTML = themeSvg;
    if (textEl) textEl.textContent = isLight ? 'Светлая' : 'Тёмная';

    // Auth-bar button
    const authIconEl = document.getElementById('auth-theme-icon');
    const authTextEl = document.getElementById('auth-theme-text');
    if (authIconEl) authIconEl.innerHTML = themeSvg;
    if (authTextEl) authTextEl.textContent = isLight ? 'Светлая' : 'Тёмная';

    // Sidebar button (mobile / tablet)
    const sidebarIconEl = document.getElementById('sidebar-theme-icon');
    const sidebarTextEl = document.getElementById('sidebar-theme-text');
    if (sidebarIconEl) sidebarIconEl.innerHTML = themeSvg;
    if (sidebarTextEl) sidebarTextEl.textContent = isLight ? 'Светлая тема' : 'Тёмная тема';
  }

  // ACCESSIBILITY & NAVIGATION STATE SYNC (выдвижное меню <= 1024px, док <= 768px)
  function syncNavAccessibility() {
    const isDrawerMode = window.innerWidth <= 1024;
    const isMobileDock = window.innerWidth <= 768;
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const mobileNav = document.getElementById('mobile-bottom-nav');
    const sidebarThemeWrapper = document.getElementById('sidebar-theme-wrapper');

    if (mobileNav) {
      if (isMobileDock) {
        mobileNav.removeAttribute('hidden');
        mobileNav.setAttribute('aria-hidden', 'false');
      } else {
        mobileNav.setAttribute('hidden', '');
        mobileNav.setAttribute('aria-hidden', 'true');
      }
    }

    if (isDrawerMode) {
      const isOpen = sidebar && sidebar.classList.contains('open');
      if (sidebar) sidebar.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
      if (backdrop) backdrop.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
      if (sidebarThemeWrapper) sidebarThemeWrapper.setAttribute('aria-hidden', isMobileDock ? 'false' : 'true');
    } else {
      if (sidebar) {
        sidebar.removeAttribute('hidden');
        sidebar.setAttribute('aria-hidden', 'false');
      }
      if (backdrop) backdrop.setAttribute('aria-hidden', 'true');
      if (sidebarThemeWrapper) sidebarThemeWrapper.setAttribute('aria-hidden', 'true');
    }
  }

  // MOBILE SIDEBAR DRAWER
  function openMobileSidebar() {
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar) sidebar.classList.add('open');
    if (backdrop) {
      backdrop.classList.remove('hidden');
      backdrop.classList.add('active');
    }
    syncNavAccessibility();
  }

  function closeMobileSidebar() {
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) {
      backdrop.classList.remove('active');
      backdrop.classList.add('hidden');
    }
    syncNavAccessibility();
  }

  // SWIPE GESTURES FOR MOBILE DRAWER SIDEBAR (OPEN / CLOSE BY FINGER SWIPE)
  function initSidebarTouchGestures() {
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!sidebar) return;

    const EDGE_THRESHOLD = 36;
    const SWIPE_TRIGGER_PX = 56;
    const VELOCITY_TRIGGER = 0.35;

    let tracking = false;
    let mode = null; // 'open' | 'close'
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let lastX = 0;
    let lockedHorizontal = false;
    let drawerWidth = 264;

    const isBlockingOverlayOpen = () => {
      if (!authScreen || !authScreen.classList.contains('hidden')) return true;
      if (document.querySelector('.modal-overlay:not(.hidden)')) return true;
      return false;
    };

    const resetSwipeStyles = () => {
      sidebar.classList.remove('is-swiping');
      sidebar.style.removeProperty('transform');
      if (backdrop) {
        backdrop.classList.remove('is-swiping');
        backdrop.style.removeProperty('opacity');
      }
    };

    document.addEventListener('touchstart', (e) => {
      if (window.innerWidth > 1024 || e.touches.length !== 1 || isBlockingOverlayOpen()) {
        tracking = false;
        return;
      }
      const touch = e.touches[0];
      const isOpen = sidebar.classList.contains('open');

      if (!isOpen && touch.clientX <= EDGE_THRESHOLD) {
        mode = 'open';
      } else if (isOpen && (e.target.closest('#app-sidebar') || e.target === backdrop || touch.clientX <= sidebar.getBoundingClientRect().right + 40)) {
        mode = 'close';
      } else {
        tracking = false;
        return;
      }

      tracking = true;
      lockedHorizontal = false;
      startX = touch.clientX;
      lastX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      drawerWidth = sidebar.getBoundingClientRect().width || 264;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!tracking || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      lastX = touch.clientX;

      if (!lockedHorizontal) {
        if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
          tracking = false;
          resetSwipeStyles();
          return;
        }
        if (Math.abs(dx) < 10) return;
        if ((mode === 'open' && dx <= 0) || (mode === 'close' && dx >= 0)) {
          tracking = false;
          return;
        }
        if (Math.abs(dx) > Math.abs(dy) * 1.25) {
          lockedHorizontal = true;
          sidebar.classList.add('is-swiping');
          if (backdrop) {
            backdrop.classList.remove('hidden');
            backdrop.classList.add('is-swiping');
          }
        } else {
          return;
        }
      }

      if (mode === 'open') {
        const clamped = Math.max(0, Math.min(drawerWidth, dx));
        sidebar.style.transform = `translateX(${clamped - drawerWidth}px)`;
        if (backdrop) {
          backdrop.style.opacity = String((clamped / drawerWidth) * 1);
        }
      } else if (mode === 'close') {
        const clamped = Math.min(0, Math.max(-drawerWidth, dx));
        sidebar.style.transform = `translateX(${clamped}px)`;
        if (backdrop) {
          backdrop.style.opacity = String(Math.max(0, 1 + clamped / drawerWidth));
        }
      }
    }, { passive: true });

    const finishSwipe = () => {
      if (!tracking) return;
      const wasLocked = lockedHorizontal;
      const dx = lastX - startX;
      const elapsed = Math.max(1, Date.now() - startTime);
      const velocity = Math.abs(dx) / elapsed;
      const swipeMode = mode;

      tracking = false;
      lockedHorizontal = false;
      mode = null;
      resetSwipeStyles();

      if (!wasLocked) return;

      if (swipeMode === 'open') {
        if (dx > SWIPE_TRIGGER_PX || (dx > 24 && velocity > VELOCITY_TRIGGER)) {
          openMobileSidebar();
        } else {
          closeMobileSidebar();
        }
      } else if (swipeMode === 'close') {
        if (dx < -SWIPE_TRIGGER_PX || (dx < -24 && velocity > VELOCITY_TRIGGER)) {
          closeMobileSidebar();
        } else {
          openMobileSidebar();
        }
      }
    };

    document.addEventListener('touchend', finishSwipe, { passive: true });
    document.addEventListener('touchcancel', finishSwipe, { passive: true });
  }

  // PWA INSTALLATION (ICON ON HOME SCREEN + SERVICE WORKER)
  let deferredPwaPrompt = null;

  function isPwaStandalone() {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function updatePwaInstallButtonsVisibility() {
    const installed = isPwaStandalone();
    const sidebarWrap = document.getElementById('sidebar-pwa-wrapper');
    const authBtn = document.getElementById('btn-auth-install-pwa');
    if (sidebarWrap) sidebarWrap.classList.toggle('hidden', installed);
    if (authBtn) authBtn.classList.toggle('hidden', installed);
  }

  function showManualPwaInstallModal() {
    const ua = navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const bodyHtml = `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div style="display: flex; align-items: center; gap: 14px; padding: 12px; border-radius: 14px; background: var(--surface-raised); border: 1px solid var(--line);">
          <img src="/assets/icon-192.png" alt="DocFlow" width="56" height="56" style="border-radius: 14px; flex-shrink: 0; border: 1px solid var(--line);">
          <div>
            <div style="font-size: 16px; font-weight: 700; color: var(--ink);">DocFlow Workspace</div>
            <div style="font-size: 12.5px; color: var(--muted);">Добавляет иконку на рабочий стол и открывается как отдельное приложение.</div>
          </div>
        </div>
        ${isIos ? `
          <div style="font-size: 13.5px; line-height: 1.55; color: var(--ink);">
            <strong>На iPhone / iPad (Safari):</strong>
            <ol style="margin: 8px 0 0 18px; padding: 0; display: flex; flex-direction: column; gap: 6px;">
              <li>Нажмите кнопку <strong>«Поделиться»</strong> (квадрат со стрелкой вверх) на нижней панели Safari.</li>
              <li>Прокрутите вниз и выберите <strong>«На экран „Домой“»</strong>.</li>
              <li>Нажмите <strong>«Добавить»</strong> — иконка DocFlow появится на экране телефона.</li>
            </ol>
          </div>
        ` : `
          <div style="font-size: 13.5px; line-height: 1.55; color: var(--ink);">
            <strong>На Android (Chrome / Edge / Яндекс Браузер):</strong>
            <ol style="margin: 8px 0 0 18px; padding: 0; display: flex; flex-direction: column; gap: 6px;">
              <li>Откройте меню браузера (<strong>⋮</strong> в правом верхнем углу).</li>
              <li>Выберите <strong>«Установить приложение»</strong> или <strong>«Добавить на главный экран»</strong>.</li>
              <li>Подтвердите установку — на телефоне создастся иконка приложения DocFlow.</li>
            </ol>
            <p style="margin: 10px 0 0; font-size: 12px; color: var(--muted);">
              Примечание: на удалённом телефоне в локальной сети кнопка автоустановки срабатывает автоматически по HTTPS (или на localhost).
            </p>
          </div>
        `}
        <div style="display: flex; justify-content: flex-end; padding-top: 6px;">
          <button type="button" class="btn btn-primary" onclick="AppState.closeModal()">Понятно</button>
        </div>
      </div>
    `;

    if (window.AppState && typeof AppState.openModal === 'function' && AppState.getCurrentUser()) {
      AppState.openModal('Установить DocFlow на телефон', bodyHtml, 'sm');
      return;
    }

    // Fallback when on login screen before auth
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalContainer = document.getElementById('modal-container');
    if (modalTitle && modalBody && modalContainer) {
      modalTitle.textContent = 'Установить DocFlow на телефон';
      modalBody.innerHTML = bodyHtml;
      modalContainer.classList.remove('hidden');
    }
  }

  async function triggerPwaInstall() {
    closeMobileSidebar();
    if (deferredPwaPrompt) {
      try {
        deferredPwaPrompt.prompt();
        const choice = await deferredPwaPrompt.userChoice;
        if (choice?.outcome === 'accepted') {
          deferredPwaPrompt = null;
          updatePwaInstallButtonsVisibility();
        }
      } catch (e) {
        showManualPwaInstallModal();
      }
      return;
    }
    showManualPwaInstallModal();
  }

  function initPwaInstall() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    updatePwaInstallButtonsVisibility();

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPwaPrompt = e;
      updatePwaInstallButtonsVisibility();
    });

    window.addEventListener('appinstalled', () => {
      deferredPwaPrompt = null;
      updatePwaInstallButtonsVisibility();
      AppState?.showAlert?.('DocFlow установлен на устройство!', 'success');
    });

    document.querySelectorAll('.pwa-install-trigger').forEach(btn => {
      btn.addEventListener('click', triggerPwaInstall);
    });
  }

  // BOOKMARKS MANAGER (DEF-20: Настраиваемые закладки в левом меню)
  const BookmarksManager = {
    loadBookmarks() {
      try {
        const stored = localStorage.getItem('docflow_user_bookmarks');
        if (stored) return JSON.parse(stored);
      } catch (e) {}
      return [
        { id: 'bm_default_1', title: 'График уборки 220', icon: 'file-edit', target: '#documents' }
      ];
    },
    saveBookmarks(list) {
      localStorage.setItem('docflow_user_bookmarks', JSON.stringify(list));
      this.renderBookmarks();
    },
    renderBookmarks() {
      const container = document.getElementById('sidebar-bookmarks-list');
      if (!container) return;
      const list = this.loadBookmarks();
      if (list.length === 0) {
        container.innerHTML = `<span style="font-size: 11px; color: var(--text-muted); padding: 4px 8px; font-style: italic;">Закладок пока нет</span>`;
        return;
      }
      container.innerHTML = list.map(bm => `
        <div class="sidebar-bookmark-item" data-id="${bm.id}" data-target="${AppState.escapeHtml(bm.target || '#documents')}" data-doc-id="${bm.docId || ''}" title="${AppState.escapeHtml(bm.title)}">
          <span style="display: inline-flex; align-items: center; flex-shrink: 0;">${typeof dfIcon === 'function' ? dfIcon(bm.icon || 'pin', 14) : ''}</span>
          <span class="sidebar-bookmark-title" style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;">
            ${AppState.escapeHtml(bm.title)}
          </span>
          <button type="button" class="sidebar-bookmark-remove" data-id="${bm.id}" title="Удалить закладку">&times;</button>
        </div>
      `).join('');

      container.querySelectorAll('.sidebar-bookmark-item').forEach(item => {
        item.querySelector('.sidebar-bookmark-title')?.addEventListener('click', () => {
          const docId = item.getAttribute('data-doc-id');
          const target = item.getAttribute('data-target');
          if (docId) {
            window.open(`/editor.html?id=${docId}`, '_blank');
          } else if (target && target.startsWith('#')) {
            AppState.switchView(target.replace('#', ''));
          } else if (target) {
            window.open(target, '_blank');
          }
        });
        item.querySelector('.sidebar-bookmark-remove')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = item.getAttribute('data-id');
          const cur = BookmarksManager.loadBookmarks().filter(b => b.id !== id);
          BookmarksManager.saveBookmarks(cur);
        });
      });
    },
    async openAddModal() {
      AppState.setModalTitle('Добавить закладку в меню');
      const modalBody = document.getElementById('modal-body');
      let docs = [];
      try {
        docs = await API.getDocuments();
      } catch (e) {}

      modalBody.innerHTML = `
        <form id="add-bookmark-form">
          <div class="form-group">
            <label>Привязать документ из хранилища (необязательно)</label>
            <select id="bm-doc-select" style="font-weight: 500;">
              <option value="">-- Произвольная ссылка или раздел --</option>
              ${docs.map(d => `<option value="${d.id}" data-title="${AppState.escapeHtml(d.title)}">${AppState.escapeHtml(d.title)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Название закладки *</label>
            <input type="text" id="bm-title" required placeholder="Например: График уборки 220">
          </div>
          <div class="form-group">
            <label>Иконка (код SVG)</label>
            <select id="bm-icon">
              <option value="pin">Закрепить</option>
              <option value="file-edit">Документ</option>
              <option value="folder">Папка</option>
              <option value="star">Избранное</option>
              <option value="calendar">Календарь</option>
              <option value="clipboard">Задача</option>
            </select>
          </div>
          <div class="form-group" id="bm-custom-url-group">
            <label>Раздел платформы или ссылка</label>
            <input type="text" id="bm-target" placeholder="#documents, #tasks, #calendar..." value="#documents">
          </div>
          <button type="submit" class="btn btn-primary btn-block">+ Закрепить в меню</button>
        </form>
      `;
      AppState.openModal(null, null, 'sm');

      const select = document.getElementById('bm-doc-select');
      const titleInput = document.getElementById('bm-title');
      const targetInput = document.getElementById('bm-target');
      const customGroup = document.getElementById('bm-custom-url-group');

      select?.addEventListener('change', () => {
        const opt = select.selectedOptions[0];
        if (select.value) {
          titleInput.value = opt.getAttribute('data-title');
          customGroup.style.display = 'none';
        } else {
          customGroup.style.display = 'block';
        }
      });

      document.getElementById('add-bookmark-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const docId = select?.value || null;
        const title = titleInput.value.trim();
        const icon = document.getElementById('bm-icon').value.trim() || 'pin';
        const target = docId ? `/editor.html?id=${docId}` : (targetInput.value.trim() || '#documents');

        const cur = BookmarksManager.loadBookmarks();
        cur.push({
          id: 'bm_' + Date.now(),
          title,
          icon,
          target,
          docId: docId ? parseInt(docId, 10) : null
        });
        BookmarksManager.saveBookmarks(cur);
        AppState.closeModal();
        AppState.showAlert(`Закладка "${title}" закреплена в меню`, 'success');
      });
    }
  };

  function bindEvents() {
    loginForm?.addEventListener('submit', handleLogin);
    twoFaSetupForm?.addEventListener('submit', handle2FASetupConfirm);
    twoFaVerifyForm?.addEventListener('submit', handle2FAVerify);
    document.getElementById('btn-2fa-setup-back')?.addEventListener('click', () => setAuthStep('login'));
    document.getElementById('btn-2fa-verify-back')?.addEventListener('click', () => setAuthStep('login'));

    document.getElementById('btn-copy-2fa-secret')?.addEventListener('click', async () => {
      if (!pending2FA.manualSecret) return;
      try {
        await navigator.clipboard.writeText(pending2FA.manualSecret);
        AppState.showAlert('Ключ 2FA скопирован в буфер обмена', 'success');
      } catch (e) {}
    });

    document.getElementById('btn-copy-backup-codes')?.addEventListener('click', async () => {
      if (!pending2FA.backupCodes.length) return;
      try {
        await navigator.clipboard.writeText(pending2FA.backupCodes.join('\n'));
        AppState.showAlert('Резервные коды скопированы', 'success');
      } catch (e) {}
    });

    document.getElementById('btn-download-backup-codes')?.addEventListener('click', () => {
      if (!pending2FA.backupCodes.length) return;
      const content = [
        'DocFlow Workspace — Одноразовые резервные коды 2FA',
        `Аккаунт: ${pending2FA.email}`,
        `Созданы: ${new Date().toLocaleString('ru-RU')}`,
        '',
        ...pending2FA.backupCodes,
        '',
        'Каждый код можно использовать только один раз.'
      ].join('\n');
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `docflow-backup-codes-${(pending2FA.email || 'user').split('@')[0]}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    document.getElementById('btn-2fa-backup-continue')?.addEventListener('click', () => {
      if (pending2FA.pendingToken && pending2FA.pendingUser) {
        const { pendingToken, pendingUser } = pending2FA;
        resetPending2FA();
        completeAuthenticatedLogin(pendingToken, pendingUser);
      } else {
        setAuthStep('login');
      }
    });

    document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
    document.getElementById('btn-sso-labspace')?.addEventListener('click', () => {
      window.location.href = '/api/sso/login';
    });
    document.getElementById('btn-topbar-labspace')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-topbar-labspace');
      try {
        if (btn) btn.disabled = true;
        const data = await API.getLabspaceSsoUrl();
        if (data?.redirectUrl) {
          window.location.href = data.redirectUrl;
        }
      } catch (err) {
        AppState.showAlert(err.message || 'Не удалось выполнить переход в LabSpace', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    modalCloseBtn?.addEventListener('click', () => AppState.closeModal());

    // Закрытие модального окна при клике на оверлей (полупрозрачный фон)
    modalContainer?.addEventListener('click', (e) => {
      if (e.target === modalContainer) {
        AppState.closeModal();
      }
    });

    // Закрытие модального окна по нажатию Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        AppState.closeModal();
      }
    });

    // Window resize accessibility sync
    window.addEventListener('resize', syncNavAccessibility);

    // Theme toggle buttons (top-bar, auth-bar & mobile sidebar)
    document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);
    document.getElementById('btn-auth-theme-toggle')?.addEventListener('click', toggleTheme);
    document.getElementById('btn-sidebar-theme-toggle')?.addEventListener('click', () => {
      toggleTheme();
      // Close sidebar after toggling on mobile
      closeMobileSidebar();
    });

    // Mobile sidebar toggles
    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', openMobileSidebar);
    document.getElementById('btn-close-sidebar')?.addEventListener('click', closeMobileSidebar);
    document.getElementById('sidebar-backdrop')?.addEventListener('click', closeMobileSidebar);

    // Desktop sidebar collapse toggle (DEF-10)
    const btnCollapseSidebar = document.getElementById('btn-desktop-collapse-sidebar');
    const appSidebar = document.getElementById('app-sidebar');
    if (localStorage.getItem('docflow_sidebar_collapsed') === 'true') {
      appSidebar?.classList.add('collapsed');
    }
    btnCollapseSidebar?.addEventListener('click', () => {
      const isCollapsed = appSidebar?.classList.toggle('collapsed');
      localStorage.setItem('docflow_sidebar_collapsed', isCollapsed ? 'true' : 'false');
    });

    // Bookmarks Manager & button (DEF-20)
    BookmarksManager.renderBookmarks();
    document.getElementById('btn-add-sidebar-bookmark')?.addEventListener('click', () => {
      BookmarksManager.openAddModal();
    });

    // DocFlow AI Assistant Dialog (только из бокового меню)
    const btnSidebarAI = document.getElementById('btn-sidebar-ai');
    const aiChatWindow = document.getElementById('ai-chat-window');
    const btnCloseAI = document.getElementById('btn-close-ai-chat');
    const btnClearAI = document.getElementById('btn-clear-ai-chat');
    const btnExpandAI = document.getElementById('btn-expand-ai-chat');
    const aiChatForm = document.getElementById('ai-chat-form');
    const aiChatInput = document.getElementById('ai-chat-input');
    const aiSendBtn = document.getElementById('btn-send-ai-chat');
    const aiMessages = document.getElementById('ai-chat-messages');
    const aiSubtitle = document.getElementById('ai-status-subtitle');
    const aiScopeButtons = document.querySelectorAll('.ai-scope-btn');

    let aiCurrentScope = 'all';
    let aiIsBusy = false;
    let aiStatusLoaded = false;

    const SCOPE_PLACEHOLDERS = {
      all: 'Спросите по базе знаний или задачам...',
      document: 'Спросите по документам на Диске...',
      project_material: 'Спросите по материалам проектов...',
      mail_attachment: 'Спросите по вложениям почты...'
    };

    const getAIHistoryKey = () => {
      const uid = AppState.getCurrentUser()?.id;
      return uid ? `docflow_ai_history_${uid}` : null;
    };

    const loadAIHistory = () => {
      const key = getAIHistoryKey();
      if (!key) return [];
      try {
        const raw = sessionStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    };

    const saveAIHistory = (entries) => {
      const key = getAIHistoryKey();
      if (!key) return;
      try {
        sessionStorage.setItem(key, JSON.stringify(entries.slice(-20)));
      } catch (e) {}
    };

    const formatAIMarkdown = (text) => {
      const escaped = AppState.escapeHtml(text || '');
      return escaped
        .replace(/^---$/gm, '<hr>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/•/g, '&bull;');
    };

    const copyTextWithFeedback = async (btn, text) => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        const prev = btn.textContent;
        btn.textContent = 'Скопировано';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = prev;
          btn.classList.remove('copied');
        }, 1600);
      } catch (e) {}
    };

    const appendUserBubble = (text) => {
      if (!aiMessages) return;
      const userBubble = document.createElement('div');
      userBubble.className = 'ai-msg ai-msg-user';
      userBubble.textContent = text;
      aiMessages.appendChild(userBubble);
    };

    const resolveModeBadge = (res) => {
      if (res.isFallbackNearest) {
        return { cls: 'ai-mode-badge--warning', icon: 'search', text: 'Ближайший вариант' };
      }
      if (res.mode === 'rag_extractive' || res.mode === 'hybrid') {
        return { cls: 'ai-mode-badge--success', icon: 'sparkles', text: 'Ответ по базе знаний' };
      }
      if (res.mode === 'platform_analytics') {
        return { cls: 'ai-mode-badge--info', icon: 'bar-chart', text: 'Аналитика задач' };
      }
      return { cls: 'ai-mode-badge--neutral', icon: 'bot', text: 'Подсказка' };
    };

    const appendBotBubble = (res) => {
      if (!aiMessages) return;
      const botBubble = document.createElement('div');
      botBubble.className = 'ai-msg ai-msg-bot';

      const topRow = document.createElement('div');
      topRow.className = 'ai-msg-top';

      const badgeInfo = resolveModeBadge(res);
      const badge = document.createElement('span');
      badge.className = `ai-mode-badge ${badgeInfo.cls}`;
      badge.innerHTML = `${typeof dfIcon === 'function' ? dfIcon(badgeInfo.icon, 13) : ''} <span>${badgeInfo.text}</span>`;
      topRow.appendChild(badge);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'ai-copy-btn';
      copyBtn.textContent = 'Копировать';
      copyBtn.title = 'Скопировать ответ';
      copyBtn.addEventListener('click', () => copyTextWithFeedback(copyBtn, res.answer || ''));
      topRow.appendChild(copyBtn);

      botBubble.appendChild(topRow);

      const bodyEl = document.createElement('div');
      bodyEl.className = 'ai-msg-body';
      bodyEl.innerHTML = formatAIMarkdown(res.answer || '');
      botBubble.appendChild(bodyEl);

      // Кликабельные карточки источников (Документы / Материалы / Вложения почты)
      if (Array.isArray(res.sources) && res.sources.length > 0) {
        const sourcesBox = document.createElement('div');
        sourcesBox.className = 'ai-sources-box';

        const srcTitle = document.createElement('div');
        srcTitle.className = 'ai-sources-title';
        srcTitle.textContent = res.isFallbackNearest ? 'Ближайшие источники:' : 'Источники ответа:';
        sourcesBox.appendChild(srcTitle);

        res.sources.slice(0, 4).forEach(src => {
          const card = document.createElement('div');
          card.className = 'ai-source-card';

          const left = document.createElement('div');
          left.className = 'ai-source-info';
          const sectionSuffix = src.section ? ` • ${src.section}` : '';
          left.innerHTML = `
            <div class="ai-source-title" title="${AppState.escapeHtml(src.title)}">
              [${src.index}] ${typeof dfIcon === 'function' ? dfIcon(src.source_icon || 'file-text', 13) : ''} ${AppState.escapeHtml(src.title)}
            </div>
            <div class="ai-source-meta">
              ${AppState.escapeHtml(src.source_label || 'Документ')}${AppState.escapeHtml(sectionSuffix)} &bull; ~${src.similarityPercent || 0}%
            </div>
          `;

          const openBtn = document.createElement('button');
          openBtn.type = 'button';
          openBtn.className = 'btn btn-secondary btn-sm ai-source-btn';
          openBtn.textContent = src.source_type === 'document' ? 'Открыть' : 'Скачать';
          openBtn.onclick = () => {
            if (src.source_type === 'document') {
              closeAIChat(false);
              window.open(`/editor.html?id=${src.source_id}`, '_blank');
            } else if (src.source_type === 'project_material') {
              API.downloadProjectMaterial(src.source_id, src.title);
            } else if (src.source_type === 'mail_attachment') {
              window.open(API.downloadAttachmentUrl(src.source_id), '_blank');
            }
          };

          card.appendChild(left);
          card.appendChild(openBtn);
          sourcesBox.appendChild(card);
        });

        botBubble.appendChild(sourcesBox);
      }

      // Suggested Action Button
      if (res.suggestedAction) {
        const act = res.suggestedAction;
        const actBtn = document.createElement('button');
        actBtn.type = 'button';
        actBtn.className = 'btn btn-primary btn-sm ai-action-btn';
        actBtn.textContent = act.label;
        actBtn.onclick = () => {
          closeAIChat(false);
          if (act.type === 'create_task') {
            if (window.TasksModule) {
              window.TasksModule.openTaskModal(null, { defaultAssigneeId: act.assignee_id });
            }
          } else if (act.type === 'open_tasks') {
            AppState.switchView('tasks');
          } else if (act.type === 'open_users_stats') {
            AppState.switchView('users');
          } else if (act.type === 'open_document' && act.doc_id) {
            window.open(`/editor.html?id=${act.doc_id}`, '_blank');
          } else if (act.type === 'open_documents') {
            AppState.switchView('documents');
          } else if (act.type === 'download_file' && act.url) {
            const token = API.getToken();
            const sep = act.url.includes('?') ? '&' : '?';
            window.open(`${act.url}${token ? `${sep}token=${encodeURIComponent(token)}` : ''}`, '_blank');
          }
        };
        botBubble.appendChild(actBtn);
      }

      if (typeof res.latencyMs === 'number' && res.latencyMs >= 0) {
        const metaEl = document.createElement('div');
        metaEl.className = 'ai-msg-meta';
        metaEl.textContent = `Обработано за ${(res.latencyMs / 1000).toFixed(2)} с`;
        botBubble.appendChild(metaEl);
      }

      aiMessages.appendChild(botBubble);
    };

    const renderAIWelcome = () => {
      if (!aiMessages) return;
      aiMessages.innerHTML = '';
      const welcome = document.createElement('div');
      welcome.className = 'ai-msg ai-msg-bot ai-msg-welcome';
      welcome.innerHTML = `
        <div class="ai-msg-top">
          <span class="ai-mode-badge ai-mode-badge--neutral"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-bot'/></svg> DocFlow AI</span>
        </div>
        <div class="ai-msg-body">Привет! Помогу найти точные цитаты в ваших <strong>документах, материалах проектов и вложениях почты</strong>, а также подскажу загрузку отделов и просроченные задачи.</div>
      `;
      aiMessages.appendChild(welcome);
    };

    const restoreAIHistoryIfEmpty = () => {
      if (!aiMessages || aiMessages.children.length > 0) return;
      renderAIWelcome();
      const history = loadAIHistory();
      history.forEach(item => {
        if (item.q) appendUserBubble(item.q);
        if (item.res) appendBotBubble(item.res);
      });
      aiMessages.scrollTop = aiMessages.scrollHeight;
    };

    const loadAIStatus = async () => {
      if (aiStatusLoaded || !aiSubtitle) return;
      aiStatusLoaded = true;
      try {
        const st = await API.getSearchStatus();
        const totalChunks = Number(st?.chunks?.total ?? st?.totalChunks ?? 0);
        const isProc = Boolean(st?.queue?.isProcessing);
        if (isProc) {
          aiSubtitle.textContent = 'Идёт фоновая индексация базы знаний...';
        } else if (totalChunks > 0) {
          aiSubtitle.textContent = `Нейропоиск готов • ${totalChunks} фрагментов`;
        } else {
          aiSubtitle.textContent = 'Поиск по базе знаний и задачам';
        }
      } catch (e) {
        aiSubtitle.textContent = 'Поиск по базе знаний и задачам';
      }
    };

    const syncAIExpandedAria = (isOpen) => {
      btnSidebarAI?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      btnSidebarAI?.classList.toggle('active', isOpen);
    };

    const openAIChat = () => {
      if (!aiChatWindow) return;
      restoreAIHistoryIfEmpty();
      loadAIStatus();
      aiChatWindow.classList.remove('hidden');
      syncAIExpandedAria(true);
      setTimeout(() => aiChatInput?.focus(), 50);
    };

    const closeAIChat = (restoreFocus = false) => {
      if (!aiChatWindow) return;
      aiChatWindow.classList.add('hidden');
      syncAIExpandedAria(false);
      if (restoreFocus) btnSidebarAI?.focus();
    };

    btnSidebarAI?.addEventListener('click', () => {
      if (window.innerWidth <= 1024) {
        closeMobileSidebar();
      }
      if (aiChatWindow?.classList.contains('hidden')) {
        openAIChat();
      } else {
        closeAIChat(false);
      }
    });

    btnCloseAI?.addEventListener('click', () => closeAIChat(true));

    btnClearAI?.addEventListener('click', () => {
      const key = getAIHistoryKey();
      if (key) {
        try { sessionStorage.removeItem(key); } catch (e) {}
      }
      renderAIWelcome();
      aiChatInput?.focus();
    });

    btnExpandAI?.addEventListener('click', () => {
      if (!aiChatWindow) return;
      const expanded = aiChatWindow.classList.toggle('is-expanded');
      btnExpandAI.textContent = expanded ? '⤡' : '⤢';
      btnExpandAI.title = expanded ? 'Свернуть окно' : 'Развернуть окно';
      btnExpandAI.setAttribute('aria-label', btnExpandAI.title);
    });

    aiScopeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const scope = btn.getAttribute('data-scope') || 'all';
        aiCurrentScope = scope;
        aiScopeButtons.forEach(b => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        if (aiChatInput) {
          aiChatInput.placeholder = SCOPE_PLACEHOLDERS[scope] || SCOPE_PLACEHOLDERS.all;
          aiChatInput.focus();
        }
      });
    });

    const setAIBusyState = (busy) => {
      aiIsBusy = busy;
      if (aiSendBtn) aiSendBtn.disabled = busy;
      if (aiMessages) aiMessages.setAttribute('aria-busy', busy ? 'true' : 'false');
    };

    const submitAIQuery = async (queryText) => {
      if (aiIsBusy || !queryText || !queryText.trim()) return;
      const q = queryText.trim();
      restoreAIHistoryIfEmpty();
      if (aiChatInput) aiChatInput.value = '';

      appendUserBubble(q);

      const loadingBubble = document.createElement('div');
      loadingBubble.className = 'ai-msg ai-msg-bot ai-typing';
      loadingBubble.innerHTML = `
        <span class="ai-typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
        <span>DocFlow AI анализирует базу...</span>
      `;
      aiMessages?.appendChild(loadingBubble);
      if (aiMessages) aiMessages.scrollTop = aiMessages.scrollHeight;

      setAIBusyState(true);
      try {
        const askOptions = aiCurrentScope !== 'all' ? { sourceTypes: [aiCurrentScope] } : {};
        const res = await API.askAI(q, askOptions);
        loadingBubble.remove();

        appendBotBubble(res);
        const history = loadAIHistory();
        history.push({ q, res });
        saveAIHistory(history);

        if (aiMessages) aiMessages.scrollTop = aiMessages.scrollHeight;
      } catch (err) {
        loadingBubble.className = 'ai-msg ai-msg-bot ai-msg-error';
        loadingBubble.textContent = 'Ошибка: '+ (err.message || 'Не удалось получить ответ');
      } finally {
        setAIBusyState(false);
        aiChatInput?.focus();
      }
    };

    aiChatForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      submitAIQuery(aiChatInput?.value);
    });

    // Global outside click handler: close any open user-search-dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.user-search-wrapper')) {
        document.querySelectorAll('.user-search-dropdown.open').forEach(el => el.classList.remove('open'));
      }
    });

    // Global escape key handler: close dropdowns & AI chat window
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.user-search-dropdown.open').forEach(el => el.classList.remove('open'));
        if (aiChatWindow && !aiChatWindow.classList.contains('hidden')) {
          closeAIChat(true);
        }
      }
    });

    window.addEventListener('auth-unauthorized', () => {
      showAuthScreen();
    });

    // Global Ctrl+K / Cmd+K shortcut: focus smart search inside Documents (Google Drive style)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        if (!AppState.getCurrentUser()) return;
        e.preventDefault();
        if (AppState.getCurrentView() !== 'documents') {
          switchView('documents');
        }
        setTimeout(() => window.DocumentsModule?.focusSearch?.(), 60);
      }
    });

    window.addEventListener('hashchange', () => {
      AppState.closeModal();
      const rawHash = (window.location.hash || '').replace('#', '').trim();
      if (rawHash === 'search') {
        switchView('documents');
        setTimeout(() => window.DocumentsModule?.focusSearch?.(), 60);
        return;
      }
      const view = getInitialView();
      if (view !== AppState.getCurrentView()) {
        switchView(view);
      }
    });

    window.addEventListener('popstate', () => {
      AppState.closeModal();
    });

    // Navigation item clicks (closes mobile drawer automatically)
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = item.getAttribute('data-view');
        closeMobileSidebar();
        if (!targetView || AppState.getCurrentView() === targetView) {
          return;
        }
        switchView(targetView);
      });
    });

    // Mobile bottom dock navigation clicks
    document.querySelectorAll('.mobile-nav-item[data-view]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = item.getAttribute('data-view');
        closeMobileSidebar();
        if (AppState.getCurrentView() === targetView) return;
        switchView(targetView);
      });
    });

    document.getElementById('btn-mobile-open-menu')?.addEventListener('click', () => {
      openMobileSidebar();
    });

    // Реактивное динамическое обновление интерфейса при событиях изменения данных
    AppState.on('tasks-updated', () => {
      const current = AppState.getCurrentView();
      const panel = document.getElementById('view-panel-tasks');
      if (current === 'tasks') {
        window.TasksModule?.render(panel);
      } else if (panel) {
        panel.dataset.rendered = 'false';
      }
      if (current === 'calendar') {
        window.CalendarModule?.refreshFeed();
      } else if (current === 'dashboard') {
        window.DashboardModule?.render(document.getElementById('view-panel-dashboard'));
      }
    });

    AppState.on('conferences-updated', () => {
      const current = AppState.getCurrentView();
      const panel = document.getElementById('view-panel-conferences');
      if (current === 'conferences') {
        window.ConferencesModule?.render(panel);
      } else if (panel) {
        panel.dataset.rendered = 'false';
      }
      if (current === 'calendar') {
        window.CalendarModule?.refreshFeed();
      } else if (current === 'dashboard') {
        window.DashboardModule?.render(document.getElementById('view-panel-dashboard'));
      }
    });

    AppState.on('projects-updated', () => {
      const current = AppState.getCurrentView();
      const panel = document.getElementById('view-panel-projects');
      if (current === 'projects') {
        window.ProjectsModule?.render(panel);
      } else if (panel) {
        panel.dataset.rendered = 'false';
      }
      if (current === 'dashboard') {
        window.DashboardModule?.render(document.getElementById('view-panel-dashboard'));
      }
    });

    AppState.on('documents-updated', () => {
      const current = AppState.getCurrentView();
      const panel = document.getElementById('view-panel-documents');
      if (current === 'documents') {
        window.DocumentsModule?.render(panel);
      } else if (panel) {
        panel.dataset.rendered = 'false';
      }
    });
  }

  function initPanels() {
    contentArea.innerHTML = '';
    validViews.forEach(view => {
      const panel = document.createElement('div');
      panel.id = `view-panel-${view}`;
      panel.className = 'view-panel';
      panel.style.display = 'none';
      contentArea.appendChild(panel);
    });
  }

  function getInitialView() {
    const isUserAdmin = AppState.isAdmin();
    const hash = (window.location.hash || '').replace('#', '').trim();
    if (hash === 'search') return 'documents';
    if (validViews.includes(hash)) {
      if (hash === 'dashboard' && !isUserAdmin) {
        return 'tasks';
      }
      return hash;
    }
    const saved = localStorage.getItem('docflow_active_view');
    if (saved === 'search') return 'documents';
    if (saved && validViews.includes(saved)) {
      if (saved === 'dashboard' && !isUserAdmin) {
        return 'tasks';
      }
      return saved;
    }
    return isUserAdmin ? 'dashboard' : 'tasks';
  }

  function parseJwtPayloadUnsafe(token) {
    try {
      const part = String(token || '').split('.')[1];
      if (!part) return null;
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const bin = atob(padded);
      const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      return null;
    }
  }

  function showSsoLinkBanner(linkToken) {
    const banner = document.getElementById('sso-link-banner');
    if (!banner) return;
    if (!linkToken) {
      banner.classList.add('hidden');
      banner.textContent = '';
      return;
    }
    const info = parseJwtPayloadUnsafe(linkToken);
    const hint = info?.email ? ` (${info.email})` : '';
    banner.textContent = `Аккаунт LabSpace${hint} ещё не привязан к DocFlow. Войдите один раз в свой аккаунт DocFlow (логин и 2FA), чтобы завершить привязку.`;
    banner.classList.remove('hidden');
  }

  async function finalizePendingSsoLink() {
    const linkToken = sessionStorage.getItem('docflow_sso_link');
    if (!linkToken) return false;
    try {
      await API.completeSsoLink(linkToken);
      sessionStorage.removeItem('docflow_sso_link');
      showSsoLinkBanner(null);
      AppState.showAlert('Аккаунт LabSpace успешно привязан к вашей учётной записи DocFlow', 'success');
      return true;
    } catch (err) {
      sessionStorage.removeItem('docflow_sso_link');
      showSsoLinkBanner(null);
      AppState.showAlert(err.message || 'Не удалось привязать аккаунт LabSpace', 'error');
      return false;
    }
  }

  async function checkAuth() {
    const params = new URLSearchParams(window.location.search);
    const ssoCode = params.get('sso_code');
    const ssoLink = params.get('sso_link');
    const ssoError = params.get('sso_error');
    const ssoAuthorize = params.get('sso_authorize');

    if (ssoCode || ssoLink || ssoError || ssoAuthorize) {
      const cleanUrl = window.location.pathname + (window.location.hash || '');
      window.history.replaceState({}, document.title, cleanUrl);
    }

    if (ssoAuthorize === '1') {
      sessionStorage.setItem('docflow_sso_authorize', '1');
    }

    if (ssoError) {
      sessionStorage.removeItem('docflow_sso_authorize');
      showAuthScreen();
      if (loginError) {
        loginError.textContent = ssoError;
        loginError.classList.remove('hidden');
      }
      return;
    }

    if (ssoCode) {
      try {
        const data = await API.exchangeSsoCode(ssoCode);
        await completeAuthenticatedLogin(data.token, data.user);
        return;
      } catch (err) {
        showAuthScreen();
        if (loginError) {
          loginError.textContent = err.message || 'Ошибка сквозного входа через LabSpace';
          loginError.classList.remove('hidden');
        }
        return;
      }
    }

    if (ssoLink) {
      sessionStorage.setItem('docflow_sso_link', ssoLink);
    }

    const token = API.getToken();
    if (!token) {
      showAuthScreen();
      showSsoLinkBanner(sessionStorage.getItem('docflow_sso_link'));
      return;
    }

    showAppScreen();

    try {
      const me = await API.getMe();
      AppState.setCurrentUser(me);
      updateUserUI();
      await finalizePendingSsoLink();
      if (sessionStorage.getItem('docflow_sso_authorize') === '1') {
        sessionStorage.removeItem('docflow_sso_authorize');
        window.location.href = '/api/sso/labspace?resume=1';
        return;
      }
      switchView(getInitialView());
    } catch (err) {
      API.clearToken();
      showAuthScreen();
      showSsoLinkBanner(sessionStorage.getItem('docflow_sso_link'));
    }
  }

  async function completeAuthenticatedLogin(token, user) {
    API.setToken(token);
    AppState.setCurrentUser(user);
    updateUserUI();
    showAppScreen();
    await finalizePendingSsoLink();
    if (sessionStorage.getItem('docflow_sso_authorize') === '1') {
      sessionStorage.removeItem('docflow_sso_authorize');
      window.location.href = '/api/sso/labspace?resume=1';
      return;
    }
    const isUserAdmin = AppState.isAdmin();
    switchView(isUserAdmin ? 'dashboard' : 'tasks');
  }

  async function handleLogin(e) {
    e.preventDefault();
    loginError.classList.add('hidden');

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
      const data = await API.login(email, password);

      if (data.requires2FASetup) {
        pending2FA.preAuthToken = data.preAuthToken;
        pending2FA.email = data.email || email;
        pending2FA.manualSecret = data.manualSecret || '';
        const emailEl = document.getElementById('twofa-setup-email');
        const qrImg = document.getElementById('twofa-qr-img');
        const secretEl = document.getElementById('twofa-manual-secret');
        if (emailEl) emailEl.textContent = pending2FA.email;
        if (qrImg) qrImg.src = data.qrDataUrl || '';
        if (secretEl) secretEl.textContent = pending2FA.manualSecret;
        setAuthStep('setup');
        return;
      }

      if (data.requires2FA) {
        pending2FA.preAuthToken = data.preAuthToken;
        pending2FA.email = data.email || email;
        const verifyEmailEl = document.getElementById('twofa-verify-email');
        if (verifyEmailEl) verifyEmailEl.textContent = pending2FA.email;
        setAuthStep('verify');
        return;
      }

      completeAuthenticatedLogin(data.token, data.user);
    } catch (err) {
      loginError.textContent = err.message;
      loginError.classList.remove('hidden');
    }
  }

  async function handle2FASetupConfirm(e) {
    e.preventDefault();
    const errEl = document.getElementById('twofa-setup-error');
    const codeInput = document.getElementById('twofa-setup-code');
    errEl?.classList.add('hidden');

    try {
      const data = await API.confirm2FASetup(pending2FA.preAuthToken, codeInput?.value || '');
      pending2FA.pendingToken = data.token;
      pending2FA.pendingUser = data.user;
      pending2FA.backupCodes = Array.isArray(data.backupCodes) ? data.backupCodes : [];

      const grid = document.getElementById('twofa-backup-codes-grid');
      if (grid) {
        grid.innerHTML = pending2FA.backupCodes
          .map(code => `<div class="twofa-backup-item">${AppState.escapeHtml(code)}</div>`)
          .join('');
      }
      setAuthStep('backup');
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    }
  }

  async function handle2FAVerify(e) {
    e.preventDefault();
    const errEl = document.getElementById('twofa-verify-error');
    const codeInput = document.getElementById('twofa-verify-code');
    errEl?.classList.add('hidden');

    try {
      const data = await API.verify2FA(pending2FA.preAuthToken, codeInput?.value || '');
      resetPending2FA();
      completeAuthenticatedLogin(data.token, data.user);
      if (data.usedBackupCode) {
        AppState.showAlert(
          `Вход выполнен по резервному коду. Осталось резервных кодов: ${data.remainingBackupCodes ?? 0}`,
          'warning'
        );
      }
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) {}
    API.clearToken();
    sessionStorage.removeItem('docflow_sso_link');
    sessionStorage.removeItem('docflow_sso_authorize');
    AppState.setCurrentUser(null);
    showAuthScreen();
  }

  function showAuthScreen() {
    document.title = 'Вход в систему — DocFlow';
    setAuthStep('login');
    document.getElementById('ai-chat-window')?.classList.add('hidden');
    document.getElementById('ai-assistant-widget')?.classList.add('hidden');
    document.getElementById('btn-sidebar-ai')?.setAttribute('aria-expanded', 'false');
    document.getElementById('btn-sidebar-ai')?.classList.remove('active');
    const aiMsgs = document.getElementById('ai-chat-messages');
    if (aiMsgs) aiMsgs.innerHTML = '';
    authScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
  }

  function showAppScreen() {
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    document.getElementById('ai-assistant-widget')?.classList.remove('hidden');
    updateMailBadge();
    setupMailAutoRefresh();
  }

  function updateUserUI() {
    const currentUser = AppState.getCurrentUser();
    if (!currentUser) return;
    document.getElementById('user-display-name').textContent = currentUser.full_name;
    document.getElementById('user-display-role').textContent = currentUser.role_name || (currentUser.role === 'ADMIN' ? 'Администратор' : 'Сотрудник');
    
    const initials = currentUser.full_name
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
    document.getElementById('user-avatar-initials').textContent = initials;

    // Доступ к дашборду только для администратора
    const isUserAdmin = AppState.isAdmin();
    const desktopDashboardNav = document.querySelector('.nav-item[data-view="dashboard"]');
    if (desktopDashboardNav) {
      desktopDashboardNav.style.display = isUserAdmin ? '' : 'none';
    }
    const mobileDashboardNav = document.querySelector('.mobile-nav-item[data-view="dashboard"]');
    if (mobileDashboardNav) {
      mobileDashboardNav.style.display = isUserAdmin ? '' : 'none';
    }
  }
  window.updateDocflowUserUI = updateUserUI;

  function switchView(viewName) {
    AppState.closeModal();
    if (!validViews.includes(viewName)) return;

    // Защита перехода на дашборд для пользователей без прав ADMIN
    if (viewName === 'dashboard' && !AppState.isAdmin()) {
      AppState.showAlert('Раздел "Дашборд" доступен только Администратору', 'error');
      switchView('tasks');
      return;
    }

    AppState.setCurrentView(viewName);
    document.body.setAttribute('data-current-view', viewName);
    const aiWidgetEl = document.getElementById('ai-assistant-widget');
    if (aiWidgetEl && !aiWidgetEl.classList.contains('is-dragging')) {
      aiWidgetEl.style.removeProperty('bottom');
      aiWidgetEl.style.removeProperty('right');
    }

    const pageTitlesMap = {
      dashboard: 'Панель управления — DocFlow',
      search: 'Умный поиск по документам — DocFlow',
      mail: 'Почта — DocFlow',
      messenger: 'Мессенджер — DocFlow',
      projects: 'Проекты — DocFlow',
      materials: 'Направления и база материалов — DocFlow',
      directions: 'Направления и база материалов — DocFlow',
      tasks: 'Задачи и поручения — DocFlow',
      calendar: 'Календарь — DocFlow',
      conferences: 'Конференции — DocFlow',
      documents: 'Документы — DocFlow',
      users: 'Команда и структура — DocFlow'
    };
    document.title = pageTitlesMap[viewName] || 'DocFlow — Единая платформа';

    try {
      localStorage.setItem('docflow_active_view', viewName);
      if (window.location.hash !== '#' + viewName) {
        window.location.hash = viewName;
      }
    } catch (e) {}

    // Highlight nav item (desktop sidebar & mobile bottom dock) + aria-current="page"
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(item => {
      if (item.getAttribute('data-view') === viewName) {
        item.classList.add('active');
        item.setAttribute('aria-current', 'page');
      } else {
        item.classList.remove('active');
        item.removeAttribute('aria-current');
      }
    });

    // Stop messenger polling if navigating away
    if (viewName !== 'messenger' && window.MessengerModule && typeof window.MessengerModule.stopPolling === 'function') {
      window.MessengerModule.stopPolling();
    }

    // Toggle panels
    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.style.display = 'none';
    });

    const activePanel = document.getElementById(`view-panel-${viewName}`);
    if (activePanel) {
      activePanel.style.display = 'block';

      // ВСЕГДА очищаем предыдущие кнопки в верхней панели, чтобы они не зависали от старой вкладки
      AppState.setTopBarActions('');

      const module = modulesMap[viewName];
      if (module) {
        // Если панель уже отрендерена (DOM и состояние сохранены):
        if (activePanel.dataset.rendered === 'true') {
          if (typeof module.onActivated === 'function') {
            module.onActivated(activePanel);
          } else if (typeof module.render === 'function') {
            module.render(activePanel);
          }
        } else {
          // Первый рендер панели
          if (typeof module.render === 'function') {
            module.render(activePanel);
            activePanel.dataset.rendered = 'true';
          }
        }
      }
    }
  }

  // MAIL BADGE & AUTONOMOUS BACKGROUND REFRESH
  async function updateMailBadge(performSync = false) {
    try {
      if (performSync) {
        try {
          await API.syncMail();
        } catch (syncErr) {
          // Silent catch for auto-sync background errors
        }
      }
      const data = await API.getMailUnreadCount();
      const badge = document.getElementById('mail-badge');
      if (badge) {
        if (data.unreadCount > 0) {
          badge.textContent = data.unreadCount;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }
      if (window.MailModule && typeof window.MailModule.refreshCurrentFolderSilent === 'function') {
        window.MailModule.refreshCurrentFolderSilent();
      }
    } catch (e) {}
  }

  function setupMailAutoRefresh() {
    if (window._mailAutoRefreshTimer) clearInterval(window._mailAutoRefreshTimer);
    window._mailAutoRefreshTimer = setInterval(() => {
      if (AppState.getCurrentUser()) {
        updateMailBadge(false);
      }
    }, 60000);
  }

  // Register AppState.switchView wrapper
  AppState.switchView = switchView;

})();
