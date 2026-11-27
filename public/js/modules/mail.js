// public/js/modules/mail.js
window.MailModule = (function() {
  let activeMailFolder = 'inbox';
  let mailSearchQuery = '';
  let mailPage = 1;
  let mailPageSize = 20;
  let cachedMailList = [];

  function cleanPreviewText(rawText) {
    if (!rawText) return '';
    return rawText
      .replace(/<!DOCTYPE[^>]*>/gi, '')
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/@media[^{]*\{[\s\S]*?\}\s*\}/gi, ' ')
      .replace(/[a-z0-9_.*#,:>\s-]+\{[^{}]{0,400}\}/gi, ' ')
      .replace(/\b(?:html|body|table|td|th|div|span)\s*\{[^}]*$/gi, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isHtmlBody(str) {
    if (!str) return false;
    return /<[a-z][\s\S]*>/i.test(str.trim());
  }

  function updateHeaderAndActions(containerEl) {
    AppState.setHeader('Корпоративная почта', 'Синхронизация IMAP/SMTP в реальном времени');
    AppState.setTopBarActions(`
      <button class="btn btn-secondary" id="btn-topbar-settings"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-settings'/></svg> Настройки почты</button>
      <button class="btn btn-secondary" id="btn-topbar-sync"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-refresh'/></svg> Синхронизировать</button>
      <button class="btn btn-primary" id="btn-topbar-compose"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg> Написать письмо</button>
    `);

    document.getElementById('btn-topbar-settings')?.addEventListener('click', openMailSettingsModal);
    document.getElementById('btn-topbar-compose')?.addEventListener('click', openComposeModal);
    document.getElementById('btn-topbar-sync')?.addEventListener('click', async () => {
      const syncBtn = document.getElementById('btn-topbar-sync');
      if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.textContent = 'Синхронизация...';
      }
      try {
        const syncRes = await API.syncMail();
        AppState.showAlert(syncRes.message || 'Синхронизация успешно завершена!', 'success');
        await loadMailList(containerEl || document.getElementById('view-panel-mail'), activeMailFolder);
      } catch (err) {
        AppState.showAlert('Ошибка синхронизации: ' + err.message, 'danger');
      } finally {
        if (syncBtn) {
          syncBtn.disabled = false;
          syncBtn.textContent = 'Синхронизировать';
        }
      }
    });
  }

  async function render(containerEl) {
    updateHeaderAndActions(containerEl);

    containerEl.innerHTML = `
      <div class="mail-layout-full">
        <!-- SIDEBAR -->
        <div class="mail-sidebar card" style="width: 230px; flex-shrink: 0; padding: 16px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: 8px;">
          <button class="btn btn-primary btn-block" id="btn-compose-mail" style="margin-bottom: 8px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg> Написать письмо</button>
          
          <div class="mail-folder ${activeMailFolder === 'inbox' ? 'active' : ''}" data-folder="inbox" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: 6px; cursor: pointer;">
            <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-inbox"/></svg> Входящие</span>
            <span id="mail-sidebar-unread" class="badge badge-pill hidden">0</span>
          </div>
          <div class="mail-folder ${activeMailFolder === 'sent' ? 'active' : ''}" data-folder="sent" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: 6px; cursor: pointer;">
            <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-upload"/></svg> Отправленные</span>
          </div>

          <div style="margin-top: auto; border-top: 1px solid var(--border-color); padding-top: 14px;">
            <button class="btn btn-secondary btn-block btn-sm" id="btn-mail-settings"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-settings'/></svg> Настройки IMAP/SMTP</button>
          </div>
        </div>

        <!-- FULL-WIDTH MAIL LIST -->
        <div class="mail-list-full card">
          <!-- MOBILE TABS BAR (MAIL.RU / GMAIL PATTERN) -->
          <div class="mail-mobile-tabs-bar">
            <div class="mail-tab-pill ${activeMailFolder === 'inbox' ? 'active' : ''}" data-mobile-folder="inbox">
              <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-inbox"/></svg> Входящие</span>
              <span id="mail-mobile-unread-badge" class="badge badge-pill hidden" style="font-size: 10px; padding: 1px 6px;">0</span>
            </div>
            <div class="mail-tab-pill ${activeMailFolder === 'sent' ? 'active' : ''}" data-mobile-folder="sent">
              <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-upload"/></svg> Отправленные</span>
            </div>
          </div>

          <div style="padding: 12px 18px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; background: var(--bg-card);">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
              <span style="font-size: 15px; font-weight: 700; color: var(--text-main); white-space: nowrap;" id="mail-folder-title">
                ${activeMailFolder === 'inbox' ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-inbox"/></svg> Входящие письма' : '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-upload"/></svg> Отправленные письма'}
              </span>
              <span class="badge badge-subtle" id="mail-count-text">0 писем</span>
            </div>
            <div style="flex: 1; min-width: 160px; max-width: 320px;">
              <input type="text" id="mail-search-input" class="user-search-input" placeholder="Поиск писем..." value="${AppState.escapeHtml(mailSearchQuery)}" autocomplete="off" style="font-size: 12px; padding: 7px 12px; border-radius: 6px; width: 100%; box-sizing: border-box;">
            </div>
          </div>

          <div id="mail-items-list" style="flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;">
            <div style="padding: 16px; display: flex; flex-direction: column; gap: 8px;">
              <div class="skeleton" style="height: 52px; border-radius: 6px;"></div>
              <div class="skeleton" style="height: 52px; border-radius: 6px;"></div>
              <div class="skeleton" style="height: 52px; border-radius: 6px;"></div>
              <div class="skeleton" style="height: 52px; border-radius: 6px;"></div>
              <div class="skeleton" style="height: 52px; border-radius: 6px;"></div>
            </div>
          </div>

        </div>
      </div>

      <!-- FLOATING COMPOSE BUTTON ON MOBILE -->
      <button type="button" id="btn-mobile-compose-mail" class="mail-fab-compose" title="Написать письмо">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
        <span>Написать</span>
      </button>

      <!-- FULLSCREEN OVERLAY MAIL READER (MAIL.RU / GMAIL STYLE) -->
      <div id="mail-reader-overlay" class="mail-reader-overlay modal-overlay hidden">
        <div class="mail-reader-card card">
          <div id="mail-reader-content" style="flex: 1; min-height: 0; display: flex; flex-direction: column;">
            <!-- Mail reader content injected dynamically -->
          </div>
        </div>
      </div>
    `;

    bindMailEvents(containerEl);
    await loadMailList(containerEl, activeMailFolder);
  }

  function bindMailEvents(containerEl) {
    containerEl.querySelector('#btn-compose-mail')?.addEventListener('click', openComposeModal);
    containerEl.querySelector('#btn-mail-settings')?.addEventListener('click', openMailSettingsModal);
    containerEl.querySelector('#btn-mobile-compose-mail')?.addEventListener('click', openComposeModal);

    // Mobile Folder Tabs
    containerEl.querySelectorAll('.mail-tab-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const folder = pill.getAttribute('data-mobile-folder');
        containerEl.querySelectorAll('.mail-tab-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        containerEl.querySelectorAll('.mail-folder').forEach(f => {
          f.classList.toggle('active', f.getAttribute('data-folder') === folder);
        });
        activeMailFolder = folder;
        mailPage = 1;
        const titleEl = containerEl.querySelector('#mail-folder-title');
        if (titleEl) {
          titleEl.textContent = activeMailFolder === 'inbox'? 'Входящие письма': 'Отправленные письма';
        }
        loadMailList(containerEl, activeMailFolder);
      });
    });

    containerEl.querySelectorAll('.mail-folder').forEach(folderEl => {
      folderEl.addEventListener('click', () => {
        containerEl.querySelectorAll('.mail-folder').forEach(f => f.classList.remove('active'));
        folderEl.classList.add('active');
        activeMailFolder = folderEl.getAttribute('data-folder');
        mailPage = 1;
        containerEl.querySelectorAll('.mail-tab-pill').forEach(p => {
          p.classList.toggle('active', p.getAttribute('data-mobile-folder') === activeMailFolder);
        });
        const titleEl = containerEl.querySelector('#mail-folder-title');
        if (titleEl) {
          titleEl.textContent = activeMailFolder === 'inbox'? 'Входящие письма': 'Отправленные письма';
        }
        loadMailList(containerEl, activeMailFolder);
      });
    });

    const searchInput = containerEl.querySelector('#mail-search-input');
    searchInput?.addEventListener('input', (e) => {
      mailSearchQuery = e.target.value.toLowerCase().trim();
      mailPage = 1;
      renderMailItems(containerEl, cachedMailList);
    });

    // Close mail reader on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeMailReader();
      }
    });

    // Close mail reader on backdrop click
    const mailReaderOverlay = containerEl.querySelector('#mail-reader-overlay');
    mailReaderOverlay?.addEventListener('click', (e) => {
      if (e.target === mailReaderOverlay) {
        closeMailReader();
      }
    });
  }

  async function loadMailList(containerEl, folder) {
    const listEl = containerEl.querySelector('#mail-items-list');
    if (!listEl) return;

    listEl.innerHTML = `<div class="text-muted" style="padding: 40px; text-align: center;">Синхронизация и загрузка писем...</div>`;

    try {
      const res = await API.getMail(folder);
      const list = Array.isArray(res) ? res : (res?.messages || []);
      cachedMailList = list;
      renderMailItems(containerEl, cachedMailList);
    } catch (err) {
      listEl.innerHTML = `<div class="form-error" style="margin: 20px;">Ошибка загрузки почты: ${AppState.escapeHtml(err.message)}</div>`;
    }
  }

  function renderMailItems(containerEl, messages) {
    const listEl = containerEl.querySelector('#mail-items-list');
    const countText = containerEl.querySelector('#mail-count-text');
    const sidebarBadge = containerEl.querySelector('#mail-sidebar-unread');
    if (!listEl) return;

    const mailList = Array.isArray(messages) ? messages : (messages?.messages || []);

    const filtered = mailList.filter(m => {
      if (!mailSearchQuery) return true;
      const terms = [
        m.subject || '',
        m.sender_name || '',
        m.sender_email || '',
        m.recipient_email || '',
        m.preview || '',
        m.body || ''
      ].join(' ').toLowerCase();
      return terms.includes(mailSearchQuery);
    });

    const unreadCount = (activeMailFolder === 'inbox') ? mailList.filter(m => !m.is_read).length : 0;
    if (countText) countText.textContent = `${filtered.length} писем`;

    if (sidebarBadge) {
      if (unreadCount > 0 && activeMailFolder === 'inbox') {
        sidebarBadge.textContent = unreadCount;
        sidebarBadge.classList.remove('hidden');
      } else {
        sidebarBadge.classList.add('hidden');
      }
    }

    const mobileBadge = containerEl.querySelector('#mail-mobile-unread-badge');
    if (mobileBadge) {
      if (unreadCount > 0 && activeMailFolder === 'inbox') {
        mobileBadge.textContent = unreadCount;
        mobileBadge.classList.remove('hidden');
      } else {
        mobileBadge.classList.add('hidden');
      }
    }

    const mainMailBadge = document.getElementById('mail-badge');
    if (mainMailBadge && activeMailFolder === 'inbox') {
      if (unreadCount > 0) {
        mainMailBadge.textContent = unreadCount;
        mainMailBadge.classList.remove('hidden');
      } else {
        mainMailBadge.classList.add('hidden');
      }
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 60px 20px;">
          <div style="font-size: 40px; margin-bottom: 12px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-mail-open'/></svg></div>
          <div style="font-size: 15px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">В этой папке нет писем</div>
          <div style="font-size: 13px;">Все входящие сообщения будут отображаться здесь автоматически.</div>
        </div>
      `;
      return;
    }

    const pg = AppState.paginate(filtered, mailPage, mailPageSize);
    mailPage = pg.page;

    listEl.innerHTML = `
      <div class="mail-table" style="display: flex; flex-direction: column;">
        ${pg.items.map(m => {
          const isUnread = (activeMailFolder === 'inbox') ? !m.is_read : false;
          const isSentFolder = (activeMailFolder === 'sent');
          const senderDisplay = isSentFolder 
            ? (m.recipient_email ? `Кому: ${m.recipient_email}` : 'Кому: (получатель не указан)')
            : (m.sender_name || m.sender_email || 'Неизвестный отправитель');
          const firstLetter = isSentFolder ? '↗' : ((senderDisplay || 'U').trim().charAt(0).toUpperCase());
          const dateStr = new Date(m.created_at || m.received_at || Date.now()).toLocaleDateString('ru-RU', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
          });

          const previewText = cleanPreviewText(m.preview || m.text_body || m.body || '');
          const hasAttachment = m.attachments && m.attachments.length > 0;

          return `
            <div class="mail-row-item ${isUnread ? 'unread' : ''}" data-id="${m.id}" style="display: flex; align-items: center; padding: 12px 18px; border-bottom: 1px solid var(--border-color); cursor: pointer; transition: background 0.15s ease; gap: 12px; background: ${isUnread ? 'rgba(59, 130, 246, 0.05)' : 'transparent'};">
              <!-- Unread status dot -->
              <div style="width: 8px; height: 8px; border-radius: 50%; background: ${isUnread ? 'var(--primary)' : 'transparent'}; flex-shrink: 0;"></div>
              
              <!-- Sender Avatar -->
              <div class="user-avatar" style="width: 34px; height: 34px; font-size: 13px; flex-shrink: 0; background: var(--bg-card-hover); border: 1px solid var(--border-color); color: var(--primary); font-weight: bold;">
                ${firstLetter}
              </div>

              <!-- Main Content Column -->
              <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;">
                <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px;">
                  <span class="mail-sender-cell" style="font-weight: ${isUnread ? '700' : '600'}; color: ${isUnread ? 'var(--text-main)' : 'var(--text-muted)'}; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${AppState.escapeHtml(senderDisplay)}
                  </span>
                  <span class="mail-date-cell" style="font-size: 11px; color: var(--text-muted); white-space: nowrap; flex-shrink: 0;">
                    ${dateStr}
                  </span>
                </div>

                <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; min-width: 0;">
                  <span style="font-weight: ${isUnread ? '700' : '500'}; color: var(--text-main); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; max-width: 58%;">
                    ${AppState.escapeHtml(m.subject || '(Без темы)')}
                  </span>
                  <span class="mail-snippet-col" style="color: var(--text-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0;">
                    ${previewText ? `— ${AppState.escapeHtml(previewText)}` : ''}
                  </span>
                  ${hasAttachment ? `<span title="Есть вложения" style="font-size: 13px; opacity: 0.8; flex-shrink: 0;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-paperclip"/></svg></span>` : ''}
                </div>
              </div>

              <!-- Delete action button -->
              <button type="button" class="btn-icon delete-mail-quick-btn" data-id="${m.id}" title="Удалить письмо" style="padding: 6px; opacity: 0.6; font-size: 13px; flex-shrink: 0;" onclick="event.stopPropagation();">
                <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-trash"/></svg>
              </button>
            </div>
          `;
        }).join('')}
      </div>
      <div style="padding: 0 14px 14px;">
        ${AppState.renderPaginationHtml(pg, { pageSizeOptions: [15, 20, 50] })}
      </div>
    `;

    AppState.bindPaginationEvents(listEl, {
      onPageChange: (p) => { mailPage = p; renderMailItems(containerEl, cachedMailList); listEl.scrollTop = 0; },
      onPageSizeChange: (sz) => { mailPageSize = sz; mailPage = 1; renderMailItems(containerEl, cachedMailList); listEl.scrollTop = 0; }
    });

    // Row click: open reader overlay
    listEl.querySelectorAll('.mail-row-item').forEach(row => {
      row.addEventListener('click', () => {
        const id = parseInt(row.getAttribute('data-id'), 10);
        openMailReader(id, containerEl);
      });
      row.addEventListener('mouseenter', () => {
        row.style.background = 'var(--bg-card-hover)';
      });
      row.addEventListener('mouseleave', () => {
        const isUnread = row.classList.contains('unread');
        row.style.background = isUnread ? 'rgba(59, 130, 246, 0.06)' : 'transparent';
      });
    });

    // Quick delete buttons
    listEl.querySelectorAll('.delete-mail-quick-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.getAttribute('data-id'), 10);
        try {
          await API.deleteMail(id);
          cachedMailList = cachedMailList.filter(m => m.id !== id);
          renderMailItems(containerEl, cachedMailList);
        } catch (err) {
          alert('Ошибка удаления: ' + err.message);
        }
      });
    });
  }

  function getSenderAvatarHtml(senderName, senderEmail) {
    const name = senderName || senderEmail || 'N';
    const firstLetter = name.trim().charAt(0).toUpperCase();
    let bgBg = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
    let textColor = '#ffffff';

    const lower = name.toLowerCase();
    if (lower.includes('т-банк') || lower.includes('тинькофф') || lower.includes('t-bank') || lower.includes('tinkoff')) {
      bgBg = 'linear-gradient(135deg, #ffdd2d, #f59e0b)';
      textColor = '#1e293b';
    } else if (lower.includes('госуслуги')) {
      bgBg = 'linear-gradient(135deg, #005bff, #003db3)';
    } else if (lower.includes('сбер') || lower.includes('sber')) {
      bgBg = 'linear-gradient(135deg, #21a038, #15803d)';
    } else if (lower.includes('альфа') || lower.includes('alfa')) {
      bgBg = 'linear-gradient(135deg, #ef4444, #b91c1c)';
    }

    return `<div style="width: 46px; height: 46px; border-radius: 50%; background: ${bgBg}; color: ${textColor}; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 20px; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-family: system-ui;">${firstLetter}</div>`;
  }

  async function openMailReader(mailId, containerEl) {
    const overlay = document.getElementById('mail-reader-overlay');
    const content = document.getElementById('mail-reader-content');
    if (!overlay || !content) return;

    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    content.innerHTML = `<div class="text-muted" style="padding: 60px; text-align: center;">Загрузка содержимого письма...</div>`;

    try {
      const mail = await API.getMailById(mailId);
      // Mark as read in local cache
      const cached = cachedMailList.find(m => m.id === mailId);
      if (cached) cached.is_read = true;
      renderMailItems(containerEl, cachedMailList);

      const dateStr = new Date(mail.created_at || mail.received_at || Date.now()).toLocaleString('ru-RU', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      const avatarHtml = getSenderAvatarHtml(mail.sender_name, mail.sender_email);

      let attachmentsHtml = '';
      if (mail.attachments && mail.attachments.length > 0) {
        attachmentsHtml = `
          <div style="margin-top: 16px; padding: 14px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px;">
            <div style="font-size: 13px; font-weight: 600; color: var(--text-main); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
              <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-paperclip"/></svg> Вложения к письму (${mail.attachments.length}):</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${mail.attachments.map(att => {
                const sizeKb = Math.round((att.file_size || 0) / 1024);
                return `
                  <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg-subtle); border-radius: 6px; border: 1px solid var(--border-color);">
                    <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; margin-right: 12px;">
                      <span style="font-size: 20px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-file-text'/></svg></span>
                      <div style="overflow: hidden;">
                        <div style="font-size: 13px; font-weight: 600; color: var(--text-main); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${AppState.escapeHtml(att.file_name)}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${sizeKb} KB</div>
                      </div>
                    </div>
                    <div style="display: flex; gap: 8px; flex-shrink: 0;">
                      <a href="${API.downloadAttachmentUrl(att.id)}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration: none;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-inbox'/></svg> Скачать</a>
                      <button class="btn btn-primary btn-sm import-att-btn" data-id="${att.id}"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-folder'/></svg> Сохранить в Документы</button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      const rawBody = mail.body || mail.html_body || mail.text_body || mail.preview || 'Письмо без содержимого';
      const hasHtml = isHtmlBody(rawBody);

      content.innerHTML = `
        <!-- TOP ACTIONS BAR (FIXED) -->
        <div class="mail-reader-topbar">
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <button class="btn btn-secondary btn-sm" id="btn-close-mail-reader" style="font-weight: 600; padding: 6px 12px;">
              ← Назад
            </button>
            <button class="btn btn-primary btn-sm" id="btn-reader-reply" style="font-weight: 600; padding: 6px 12px;">
              <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-reply"/></svg> Ответить
            </button>
            ${mail.folder !== 'sent' ? `
            <button class="btn btn-secondary btn-sm" id="btn-reader-toggle-read" style="padding: 6px 10px;">
              ${mail.is_read ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-mail"/></svg> Не прочитано' : '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-eye"/></svg> Прочитано'}
            </button>` : ''}
            <button class="btn btn-secondary btn-sm" id="btn-reader-delete" style="color: var(--danger); padding: 6px 10px;">
              <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-trash"/></svg> Удалить
            </button>
          </div>
          <button class="btn-icon" id="btn-close-reader-x" title="Закрыть окно (Esc)" style="font-size: 18px; padding: 4px 8px; cursor: pointer;">✕</button>
        </div>

        <!-- MAIN SCROLLABLE CONTAINER (HEADER + BODY + ATTACHMENTS) -->
        <div class="mail-reader-scrollable" id="mail-reader-scrollable">
          <!-- EMAIL HEADER -->
          <div class="mail-reader-header">
            <h2 style="font-size: 22px; font-weight: 700; color: var(--text-main); margin: 0 0 16px 0; line-height: 1.35; word-break: break-word;">
              ${AppState.escapeHtml(mail.subject || '(Без темы)')}
            </h2>

            <div style="display: flex; align-items: center; gap: 16px;">
              ${avatarHtml}
              <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px;">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                  <strong style="color: var(--text-main); font-size: 15px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                    ${AppState.escapeHtml(mail.sender_name || mail.sender_email || 'Отправитель')}
                  </strong>
                  <span style="font-size: 13px; color: var(--text-muted); white-space: nowrap;">${dateStr}</span>
                </div>
                <div style="font-size: 12px; color: var(--text-muted);">
                  От: <span style="color: var(--text-main);">${AppState.escapeHtml(mail.sender_email || '')}</span> &bull; 
                  Кому: <span style="color: var(--text-main);">${AppState.escapeHtml(mail.recipient_email || '')}</span>
                </div>
              </div>
            </div>

            ${attachmentsHtml}
          </div>

          <!-- EMAIL BODY CONTENT -->
          <div class="mail-reader-body">
            ${hasHtml ? `
              <div class="mail-iframe-wrapper" id="mail-iframe-wrapper">
                <iframe id="mail-html-frame" sandbox="allow-same-origin allow-popups"></iframe>
              </div>
            ` : `
              <div class="mail-plain-body" style="white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; max-width: 100%; box-sizing: border-box; font-family: monospace; font-size: 14px; color: var(--text-main); background: var(--bg-subtle); padding: 24px; border-radius: 10px; line-height: 1.6; border: 1px solid var(--border-color);">
                ${AppState.escapeHtml(rawBody)}
              </div>
            `}
          </div>
        </div>
      `;

      // Frame HTML rendering, auto-scale-to-fit on mobile and seamless scroll handling
      if (hasHtml) {
        const wrapper = content.querySelector('#mail-iframe-wrapper');
        const frame = content.querySelector('#mail-html-frame');
        const scrollContainer = content.querySelector('#mail-reader-scrollable');
        if (frame && wrapper) {
          try {
            const doc = frame.contentDocument || frame.contentWindow.document;
            doc.open();

            const isMobileViewport = window.innerWidth <= 768;
            const gmailNormalizeCss = `
              <style>
                html {
                  margin: 0 !important;
                  padding: 0 !important;
                  height: auto !important;
                  min-height: 0 !important;
                  overflow: hidden !important;
                }
                body {
                  margin: 0 !important;
                  padding: ${isMobileViewport ? '12px' : '24px'} !important;
                  height: auto !important;
                  min-height: 0 !important;
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
                  background-color: #ffffff !important;
                  color: #202124 !important;
                  font-size: 14px;
                  line-height: 1.5;
                  word-wrap: break-word;
                  overflow-wrap: break-word;
                  -webkit-text-size-adjust: 100%;
                  overflow: hidden !important;
                  box-sizing: border-box;
                }
                img {
                  max-width: 100%;
                  height: auto;
                }
                a {
                  color: #1a73e8 !important;
                }
              </style>
            `;

            const sanitizeEmailHtml = (dirtyHtml) => {
              try {
                const parser = new DOMParser();
                const parsedDoc = parser.parseFromString(String(dirtyHtml || ''), 'text/html');
                const forbiddenTags = 'script, iframe, object, embed, applet, form, base, meta, link, svg, math, audio, video, source, track';
                parsedDoc.querySelectorAll(forbiddenTags).forEach(el => el.remove());

                const isSafeHref = (val, allowDataImg = false) => {
                  const clean = String(val || '').replace(/[\u0000-\u0020]+/g, '').toLowerCase();
                  if (!clean) return true;
                  if (clean.startsWith('#')) return true;
                  if (clean.startsWith('http://') || clean.startsWith('https://')) return true;
                  if (!allowDataImg && (clean.startsWith('mailto:') || clean.startsWith('tel:'))) return true;
                  if (allowDataImg && /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(clean)) return true;
                  return false;
                };

                parsedDoc.querySelectorAll('*').forEach(el => {
                  for (const attr of Array.from(el.attributes)) {
                    const name = attr.name.toLowerCase();
                    if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction' || name === 'xlink:href') {
                      el.removeAttribute(attr.name);
                      continue;
                    }
                    if (name === 'href' || name === 'action') {
                      if (!isSafeHref(attr.value, false)) el.removeAttribute(attr.name);
                    } else if (name === 'src' || name === 'poster' || name === 'background') {
                      if (!isSafeHref(attr.value, true)) el.removeAttribute(attr.name);
                    } else if (name === 'style') {
                      if (/expression\s*\(|javascript\s*:|url\s*\(\s*['"]?\s*(?:javascript|data:(?!image\/(?:png|jpeg|jpg|gif|webp)))/i.test(attr.value)) {
                        el.removeAttribute(attr.name);
                      }
                    }
                  }
                });
                return parsedDoc.body ? parsedDoc.body.innerHTML : '';
              } catch (e) {
                return AppState.escapeHtml(String(dirtyHtml || ''));
              }
            };

            const cleanedBody = sanitizeEmailHtml(rawBody);
            const safeHtml = '<html><head>' + gmailNormalizeCss + '</head><body>' + cleanedBody + '</body></html>';

            doc.write(safeHtml);
            doc.close();

            if (window._mailFrameRO) {
              try { window._mailFrameRO.disconnect(); } catch (e) {}
              window._mailFrameRO = null;
            }

            let isAdjusting = false;
            let lastWrapperW = 0;
            let lastAppliedH = 0;
            let lastAppliedScale = 1;
            const adjustFrameLayout = () => {
              if (isAdjusting || !wrapper.isConnected || !frame.isConnected) return;
              isAdjusting = true;
              try {
                const wrapperW = wrapper.clientWidth;
                if (wrapperW <= 0) return;

                const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

                // Сбрасываем масштаб и высоту для точного замера натуральных размеров письма
                // (frame имеет position: absolute, поэтому изменение его height не сдвигает поток и не дёргает скролл)
                frame.style.transformOrigin = 'top left';
                frame.style.transform = '';
                frame.style.width = `${wrapperW}px`;
                frame.style.height = '1px';

                const contentW = Math.max(
                  doc.documentElement ? doc.documentElement.scrollWidth : 0,
                  doc.body ? doc.body.scrollWidth : 0
                );

                const scale = contentW > wrapperW + 2 ? (wrapperW / contentW) : 1;
                if (scale < 1) {
                  frame.style.width = `${contentW}px`;
                  frame.style.transform = `scale(${scale})`;
                }

                const contentH = Math.max(
                  doc.body ? doc.body.scrollHeight : 0,
                  doc.body ? doc.body.offsetHeight : 0,
                  doc.documentElement ? doc.documentElement.offsetHeight : 0,
                  doc.documentElement ? doc.documentElement.scrollHeight : 0
                );

                const targetFrameH = Math.max(120, Math.ceil(contentH) + 8);
                const targetWrapperH = Math.max(120, Math.ceil(targetFrameH * scale));

                frame.style.height = `${targetFrameH}px`;
                if (Math.abs(targetWrapperH - lastAppliedH) > 1 || Math.abs(scale - lastAppliedScale) > 0.002) {
                  wrapper.style.height = `${targetWrapperH}px`;
                  lastAppliedH = targetWrapperH;
                  lastAppliedScale = scale;
                }
                lastWrapperW = wrapperW;

                if (scrollContainer && Math.abs(scrollContainer.scrollTop - prevScrollTop) > 2) {
                  const maxScroll = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
                  scrollContainer.scrollTop = Math.min(prevScrollTop, maxScroll);
                }
              } catch (e) {
              } finally {
                isAdjusting = false;
              }
            };

            adjustFrameLayout();
            setTimeout(adjustFrameLayout, 80);
            setTimeout(adjustFrameLayout, 350);

            if (window.ResizeObserver) {
              let rafId = null;
              window._mailFrameRO = new ResizeObserver(() => {
                if (wrapper.clientWidth > 0 && Math.abs(wrapper.clientWidth - lastWrapperW) > 1) {
                  if (rafId) cancelAnimationFrame(rafId);
                  rafId = requestAnimationFrame(adjustFrameLayout);
                }
              });
              window._mailFrameRO.observe(wrapper);
            }

            if (window._mailFrameResizeHandler) {
              window.removeEventListener('resize', window._mailFrameResizeHandler);
            }
            window._mailFrameResizeHandler = () => {
              if (!overlay || overlay.classList.contains('hidden')) {
                window.removeEventListener('resize', window._mailFrameResizeHandler);
                window._mailFrameResizeHandler = null;
                return;
              }
              adjustFrameLayout();
            };
            window.addEventListener('resize', window._mailFrameResizeHandler);

            doc.querySelectorAll('img').forEach(img => {
              img.addEventListener('load', adjustFrameLayout, { once: true });
              img.addEventListener('error', adjustFrameLayout, { once: true });
            });

            // Forward wheel events from inside the iframe to parent scroll container
            doc.addEventListener('wheel', (e) => {
              if (scrollContainer) {
                scrollContainer.scrollTop += e.deltaY;
                if (e.deltaX) scrollContainer.scrollLeft += e.deltaX;
              }
            }, { passive: true });

            // Forward keyboard navigation from inside the iframe
            doc.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                closeMailReader();
              } else if (e.key === 'ArrowDown') {
                if (scrollContainer) scrollContainer.scrollTop += 60;
              } else if (e.key === 'ArrowUp') {
                if (scrollContainer) scrollContainer.scrollTop -= 60;
              } else if (e.key === 'PageDown' || (e.key === ' ' && !e.target.matches('input, textarea'))) {
                if (scrollContainer) scrollContainer.scrollTop += scrollContainer.clientHeight * 0.8;
              } else if (e.key === 'PageUp') {
                if (scrollContainer) scrollContainer.scrollTop -= scrollContainer.clientHeight * 0.8;
              } else if (e.key === 'Home') {
                if (scrollContainer) scrollContainer.scrollTop = 0;
              } else if (e.key === 'End') {
                if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
              }
            });

          } catch (e) {
            console.error('Error rendering HTML iframe:', e);
          }
        }
      }

      // Close reader buttons
      content.querySelector('#btn-close-mail-reader')?.addEventListener('click', closeMailReader);
      content.querySelector('#btn-close-reader-x')?.addEventListener('click', closeMailReader);

      // Reply
      content.querySelector('#btn-reader-reply')?.addEventListener('click', () => {
        const replyEmail = mail.folder === 'sent' ? (mail.recipient_email || '') : (mail.sender_email || '');
        const replyName = mail.folder === 'sent' ? '' : (mail.sender_name || '');
        const rawSubj = String(mail.subject || '(Без темы)').trim();
        const replySubject = /^re:\s*/i.test(rawSubj) ? rawSubj : `Re: ${rawSubj}`;
        let plainQuote = rawBody || '';
        if (hasHtml) {
          const cleaned = rawBody
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');
          const parsedQuote = new DOMParser().parseFromString(cleaned, 'text/html');
          plainQuote = (parsedQuote.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
        }
        if (plainQuote.length > 1200) {
          plainQuote = plainQuote.slice(0, 1200).trim() + '\n...';
        }
        const fromLabel = mail.sender_name
          ? `${mail.sender_name} <${mail.sender_email || ''}>`
          : (mail.sender_email || '');
        const replyBody = `\n\n--- Исходное сообщение ---\nОт: ${fromLabel}\nДата: ${dateStr}\nТема: ${rawSubj}\n\n${plainQuote}`;

        closeMailReader();
        openComposeModal({
          modalTitle: 'Ответить на письмо',
          to: replyEmail ? [{ email: replyEmail, name: replyName }] : [],
          subject: replySubject,
          body: replyBody
        });
      });

      // Toggle read
      content.querySelector('#btn-reader-toggle-read')?.addEventListener('click', async () => {
        try {
          const newStatus = !mail.is_read;
          await API.toggleMailRead(mail.id, newStatus);
          mail.is_read = newStatus;
          if (cached) cached.is_read = newStatus;
          AppState.showAlert(newStatus ? 'Письмо помечено как прочитанное' : 'Письмо помечено как непрочитанное', 'success');
          renderMailItems(containerEl, cachedMailList);
          closeMailReader();
        } catch (err) {
          alert('Ошибка смены статуса: ' + err.message);
        }
      });

      // Delete
      content.querySelector('#btn-reader-delete')?.addEventListener('click', async () => {
        try {
          await API.deleteMail(mail.id);
          cachedMailList = cachedMailList.filter(m => m.id !== mail.id);
          renderMailItems(containerEl, cachedMailList);
          closeMailReader();
          AppState.showAlert('Письмо удалено', 'success');
        } catch (err) {
          alert('Ошибка удаления: ' + err.message);
        }
      });

      // Import attachments
      content.querySelectorAll('.import-att-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const attId = parseInt(btn.getAttribute('data-id'), 10);
          btn.disabled = true;
          btn.textContent = 'Сохранение...';
          try {
            await API.importAttachmentToDocuments(attId);
            AppState.showAlert('Вложение успешно скопировано в Хранилище Документов!', 'success');
            btn.textContent = 'В Документах';
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Сохранить в Документы';
            alert('Ошибка импорта: ' + err.message);
          }
        });
      });

    } catch (err) {
      content.innerHTML = `<div class="form-error" style="margin: 40px;">Ошибка загрузки письма: ${AppState.escapeHtml(err.message)}</div>`;
    }
  }

  function closeMailReader() {
    if (window._mailFrameRO) {
      try { window._mailFrameRO.disconnect(); } catch (e) {}
      window._mailFrameRO = null;
    }
    if (window._mailFrameResizeHandler) {
      window.removeEventListener('resize', window._mailFrameResizeHandler);
      window._mailFrameResizeHandler = null;
    }
    const overlay = document.getElementById('mail-reader-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
    document.body.style.overflow = '';
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getFileIcon(name, mime = '') {
    if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return dfIcon('image', 16);
    if (/\.(pdf)$/i.test(name)) return dfIcon('files', 16);
    if (/\.(docx?|odt|rtf|txt)$/i.test(name)) return dfIcon('file-text', 16);
    if (/\.(xlsx?|ods|csv)$/i.test(name)) return dfIcon('bar-chart', 16);
    if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return dfIcon('archive', 16);
    return dfIcon('paperclip', 16);
  }

  function openComposeModal(prefill = null) {
    const modalWindow = document.querySelector('.modal-window');
    if (modalWindow) modalWindow.classList.add('modal-lg');

    const cleanUpModalLg = () => {
      if (modalWindow) modalWindow.classList.remove('modal-lg');
    };

    // Hook cleanup to close button and modal overlay
    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', cleanUpModalLg, { once: true });
    const modalContainer = document.getElementById('modal-container');
    if (modalContainer) {
      const overlayCloser = (e) => {
        if (e.target === modalContainer) {
          cleanUpModalLg();
          modalContainer.removeEventListener('click', overlayCloser);
        }
      };
      modalContainer.addEventListener('click', overlayCloser);
    }

    AppState.setModalTitle((prefill && prefill.modalTitle) || 'Написать новое письмо');
    const modalBody = document.getElementById('modal-body');

    modalBody.innerHTML = `
      <form id="compose-mail-form" class="mail-compose-form">
        <!-- Поле "Кому" с автодополнением и чипсами -->
        <div class="mail-field-row">
          <div class="mail-field-label">Кому:</div>
          <div class="mail-field-control">
            <div class="mail-recipients-input-box" id="recipients-box" title="Нажмите, чтобы ввести email или выбрать из списка">
              <div id="recipients-chips-container" style="display: contents;"></div>
              <input type="text" id="compose-to-input" class="mail-recipient-input" placeholder="Введите имя или email получателя (например, admi...)" autocomplete="off">
            </div>
            <div id="recipients-suggest-dropdown" class="mail-suggest-dropdown hidden"></div>
          </div>
        </div>

        <!-- Поле "Тема" -->
        <div class="mail-field-row">
          <div class="mail-field-label">Тема:</div>
          <div class="mail-field-control">
            <input type="text" id="compose-subject" required placeholder="Тема сообщения" style="width: 100%; padding: 8px 12px;">
          </div>
        </div>

        <!-- Зона прикрепленных файлов (вложения) -->
        <div id="mail-attachments-zone" class="mail-attachments-preview-zone" title="Перетащите файлы сюда или прикрепите через кнопки ниже">
          <span class="text-muted" id="mail-attachments-empty-hint" style="font-size: 12px; display: flex; align-items: center; gap: 6px;">
            <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-paperclip"/></svg></span> Перетащите файлы или изображения сюда, или вставьте из буфера (Ctrl+V)
          </span>
          <div id="mail-attachments-list" style="display: contents;"></div>
        </div>

        <!-- Поле ввода текста сообщения -->
        <div class="mail-field-row" style="flex-direction: column; gap: 6px;">
          <textarea id="compose-body" rows="9" placeholder="Здравствуйте! Пишу по поводу..." style="width: 100%; resize: vertical; line-height: 1.5; font-size: 13px; padding: 12px; min-height: 160px;"></textarea>
        </div>

        <!-- Нижняя панель действий (Mail.ru / Gmail style) -->
        <div class="mail-compose-toolbar">
          <div class="mail-compose-actions">
            <button type="submit" id="btn-submit-send-mail" class="btn btn-primary" style="padding: 9px 22px; font-weight: 600; font-size: 14px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);">
              <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-rocket"/></svg> Отправить
            </button>

            <!-- Кнопки добавления вложений -->
            <label class="mail-attach-btn" title="Прикрепить любые файлы (документы, архивы, таблицы)">
              <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-paperclip"/></svg> Прикрепить файл
              <input type="file" id="mail-file-input" multiple style="display: none;">
            </label>
            <label class="mail-attach-btn" title="Прикрепить фото или изображение">
              <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-image"/></svg> Фото
              <input type="file" id="mail-image-input" accept="image/*" multiple style="display: none;">
            </label>
          </div>

          <div id="mail-attachments-summary" class="text-muted" style="font-size: 12px;">
            Вложений: 0
          </div>
        </div>
      </form>
    `;
    AppState.openModal();

    // State for compose modal
    const recipients = [];
    const attachedFiles = [];

    const recipientsBox = document.getElementById('recipients-box');
    const recipientsContainer = document.getElementById('recipients-chips-container');
    const toInput = document.getElementById('compose-to-input');
    const suggestDropdown = document.getElementById('recipients-suggest-dropdown');
    const attachmentsZone = document.getElementById('mail-attachments-zone');
    const attachmentsList = document.getElementById('mail-attachments-list');
    const emptyAttachmentsHint = document.getElementById('mail-attachments-empty-hint');
    const attachmentsSummary = document.getElementById('mail-attachments-summary');
    const fileInput = document.getElementById('mail-file-input');
    const imageInput = document.getElementById('mail-image-input');
    const composeBody = document.getElementById('compose-body');
    const composeForm = document.getElementById('compose-mail-form');

    // Focus input when clicking anywhere on the box
    recipientsBox.addEventListener('click', () => {
      toInput.focus();
    });

    // Render recipient chips
    function renderRecipients() {
      recipientsContainer.innerHTML = '';
      recipients.forEach((rec, idx) => {
        const chip = document.createElement('div');
        chip.className = 'mail-recipient-chip';
        chip.title = rec.email;
        chip.innerHTML = `
          <span class="chip-name">${AppState.escapeHtml(rec.name ? `${rec.name} <${rec.email}>` : rec.email)}</span>
          <button type="button" class="chip-remove" data-idx="${idx}" title="Удалить">&times;</button>
        `;
        chip.querySelector('.chip-remove').addEventListener('click', (e) => {
          e.stopPropagation();
          recipients.splice(idx, 1);
          renderRecipients();
          toInput.focus();
        });
        recipientsContainer.appendChild(chip);
      });

      if (recipients.length > 0) {
        toInput.placeholder = 'Добавить еще получателя...';
      } else {
        toInput.placeholder = 'Введите имя или email получателя (например, admi...)';
      }
    }

    function addRecipient(email, name = '') {
      email = (email || '').trim().toLowerCase();
      if (!email) return;
      if (!recipients.some(r => r.email === email)) {
        recipients.push({ email, name });
        renderRecipients();
      }
      toInput.value = '';
      hideSuggestDropdown();
    }

    function hideSuggestDropdown() {
      suggestDropdown.classList.add('hidden');
      suggestDropdown.innerHTML = '';
    }

    if (prefill) {
      if (Array.isArray(prefill.to)) {
        prefill.to.forEach(item => {
          if (typeof item === 'string') {
            addRecipient(item, '');
          } else if (item && item.email) {
            addRecipient(item.email, item.name || '');
          }
        });
      }
      const subjectInput = document.getElementById('compose-subject');
      if (subjectInput && prefill.subject) {
        subjectInput.value = prefill.subject;
      }
      if (composeBody && prefill.body) {
        composeBody.value = prefill.body;
        setTimeout(() => {
          composeBody.focus();
          try { composeBody.setSelectionRange(0, 0); } catch (e) {}
          composeBody.scrollTop = 0;
        }, 60);
      }
    }

    // Autocomplete Suggestions with Debounce
    let suggestTimer = null;
    let currentSuggestions = [];
    let selectedSuggestIndex = -1;

    toInput.addEventListener('input', () => {
      clearTimeout(suggestTimer);
      const query = toInput.value.trim();
      if (query.length === 0) {
        hideSuggestDropdown();
        return;
      }

      suggestTimer = setTimeout(async () => {
        try {
          const suggestions = await API.suggestMailRecipients(query);
          currentSuggestions = Array.isArray(suggestions) ? suggestions : [];
          selectedSuggestIndex = -1;

          if (currentSuggestions.length === 0) {
            hideSuggestDropdown();
            return;
          }

          suggestDropdown.innerHTML = currentSuggestions.map((item, idx) => {
            const initial = (item.full_name || item.email || '?')[0].toUpperCase();
            // Highlight matching letters
            const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            const highlightedName = (item.full_name || '').replace(regex, '<span style="color: var(--primary); font-weight: 700;">$1</span>');
            const highlightedEmail = (item.email || '').replace(regex, '<span style="color: var(--primary); font-weight: 700;">$1</span>');

            return `
              <div class="mail-suggest-item" data-idx="${idx}">
                <div class="mail-suggest-avatar">${AppState.escapeHtml(initial)}</div>
                <div class="mail-suggest-info">
                  <div class="mail-suggest-primary">
                    <span>${highlightedName || AppState.escapeHtml(item.email)}</span>
                    ${item.department ? `<span class="mail-suggest-dept">${AppState.escapeHtml(item.department)}</span>` : ''}
                  </div>
                  <div class="mail-suggest-email">${highlightedEmail}</div>
                </div>
              </div>
            `;
          }).join('');

          suggestDropdown.classList.remove('hidden');

          suggestDropdown.querySelectorAll('.mail-suggest-item').forEach(itemEl => {
            itemEl.addEventListener('click', (e) => {
              e.stopPropagation();
              const idx = parseInt(itemEl.dataset.idx, 10);
              const chosen = currentSuggestions[idx];
              if (chosen) {
                addRecipient(chosen.email, chosen.full_name);
              }
            });
          });
        } catch (err) {
          console.warn('Autocomplete suggest error:', err);
        }
      }, 120);
    });

    toInput.addEventListener('keydown', (e) => {
      const items = suggestDropdown.querySelectorAll('.mail-suggest-item');
      if (!suggestDropdown.classList.contains('hidden') && items.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          selectedSuggestIndex = (selectedSuggestIndex + 1) % items.length;
          items.forEach((it, i) => it.classList.toggle('active', i === selectedSuggestIndex));
          items[selectedSuggestIndex]?.scrollIntoView({ block: 'nearest' });
          return;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectedSuggestIndex = (selectedSuggestIndex - 1 + items.length) % items.length;
          items.forEach((it, i) => it.classList.toggle('active', i === selectedSuggestIndex));
          items[selectedSuggestIndex]?.scrollIntoView({ block: 'nearest' });
          return;
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (selectedSuggestIndex >= 0 && currentSuggestions[selectedSuggestIndex]) {
            const chosen = currentSuggestions[selectedSuggestIndex];
            addRecipient(chosen.email, chosen.full_name);
            return;
          }
        } else if (e.key === 'Escape') {
          hideSuggestDropdown();
          return;
        }
      }

      // If user presses Enter or comma or Tab on raw email
      if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
        const val = toInput.value.replace(/,/g, '').trim();
        if (val) {
          e.preventDefault();
          addRecipient(val);
        }
      } else if (e.key === 'Backspace' && !toInput.value && recipients.length > 0) {
        recipients.pop();
        renderRecipients();
      }
    });

    // Close suggest dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!recipientsBox.contains(e.target) && !suggestDropdown.contains(e.target)) {
        hideSuggestDropdown();
      }
    });

    // ==========================================
    // ATTACHMENTS HANDLING (FILES & IMAGES)
    // ==========================================
    function updateAttachmentsUI() {
      attachmentsList.innerHTML = '';
      if (attachedFiles.length === 0) {
        emptyAttachmentsHint.classList.remove('hidden');
        attachmentsSummary.textContent = 'Вложений: 0';
      } else {
        emptyAttachmentsHint.classList.add('hidden');
        let totalBytes = 0;

        attachedFiles.forEach((file, idx) => {
          totalBytes += file.size || 0;
          const tag = document.createElement('div');
          tag.className = 'mail-attach-tag';
          const icon = getFileIcon(file.name, file.type);

          let thumbHtml = `<span>${icon}</span>`;
          if (file.type.startsWith('image/')) {
            const blobUrl = URL.createObjectURL(file);
            thumbHtml = `<img src="${blobUrl}" class="mail-attach-tag-thumb" alt="Превью">`;
          }

          tag.innerHTML = `
            ${thumbHtml}
            <span class="mail-attach-tag-name" title="${AppState.escapeHtml(file.name)}">${AppState.escapeHtml(file.name)}</span>
            <span class="mail-attach-tag-size">(${formatFileSize(file.size)})</span>
            <button type="button" class="mail-attach-tag-remove" data-idx="${idx}" title="Удалить файл">&times;</button>
          `;

          tag.querySelector('.mail-attach-tag-remove').addEventListener('click', () => {
            attachedFiles.splice(idx, 1);
            updateAttachmentsUI();
          });

          attachmentsList.appendChild(tag);
        });

        attachmentsSummary.textContent = `Вложений: ${attachedFiles.length} (${formatFileSize(totalBytes)})`;
      }
    }

    function addFiles(files) {
      if (!files || !files.length) return;
      const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB
      let currentTotal = attachedFiles.reduce((acc, f) => acc + (f.size || 0), 0);

      Array.from(files).forEach(file => {
        if (attachedFiles.length >= 10) {
          alert('Максимум 10 прикрепленных файлов в одном письме');
          return;
        }
        if (currentTotal + file.size > MAX_TOTAL_SIZE) {
          alert(`Файл "${file.name}" превышает общий лимит вложений (50 МБ)`);
          return;
        }
        // Avoid duplicate files with same name and size
        if (!attachedFiles.some(f => f.name === file.name && f.size === file.size)) {
          attachedFiles.push(file);
          currentTotal += file.size;
        }
      });

      updateAttachmentsUI();
    }

    fileInput.addEventListener('change', () => {
      addFiles(fileInput.files);
      fileInput.value = '';
    });

    imageInput.addEventListener('change', () => {
      addFiles(imageInput.files);
      imageInput.value = '';
    });

    // Drag & Drop on attachments zone and entire modal form
    ['dragenter', 'dragover'].forEach(evtName => {
      attachmentsZone.addEventListener(evtName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        attachmentsZone.classList.add('dragover');
      });
      composeForm.addEventListener(evtName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    ['dragleave', 'drop'].forEach(evtName => {
      attachmentsZone.addEventListener(evtName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        attachmentsZone.classList.remove('dragover');
      });
      composeForm.addEventListener(evtName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    attachmentsZone.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files) {
        addFiles(e.dataTransfer.files);
      }
    });

    // Paste images/files from clipboard (Ctrl+V)
    composeForm.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const filesToAttach = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const file = items[i].getAsFile();
          if (file) filesToAttach.push(file);
        }
      }
      if (filesToAttach.length > 0) {
        addFiles(filesToAttach);
      }
    });

    // ==========================================
    // SEND FORM SUBMISSION
    // ==========================================
    composeForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Collect recipients
      const pendingRaw = toInput.value.replace(/,/g, '').trim();
      if (pendingRaw) {
        addRecipient(pendingRaw);
      }

      if (recipients.length === 0) {
        alert('Пожалуйста, укажите хотя бы одного получателя (email) в поле "Кому"');
        toInput.focus();
        return;
      }

      const subject = document.getElementById('compose-subject').value.trim();
      const body = composeBody.value.trim();

      if (!body && attachedFiles.length === 0) {
        alert('Пожалуйста, введите текст сообщения или прикрепите файлы');
        composeBody.focus();
        return;
      }

      const sendBtn = document.getElementById('btn-submit-send-mail');
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = 'Отправка письма...';
      }

      try {
        const formData = new FormData();
        formData.append('to', recipients.map(r => r.email).join(', '));
        formData.append('subject', subject);
        formData.append('body', body);

        attachedFiles.forEach(file => {
          formData.append('attachments', file);
        });

        const res = await API.sendMail(formData);
        cleanUpModalLg();
        AppState.closeModal();
        AppState.showAlert(res.message || 'Письмо успешно отправлено!', 'success');

        if (activeMailFolder === 'sent') {
          const container = document.getElementById('view-panel-mail');
          if (container) loadMailList(container, 'sent');
        }
      } catch (err) {
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Отправить';
        }
        alert('Ошибка при отправке письма: ' + err.message);
      }
    });
  }

  async function openMailSettingsModal() {
    AppState.setModalTitle('Настройки почты (IMAP & SMTP)');
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `<div class="text-muted" style="padding: 20px;">Загрузка настроек...</div>`;
    AppState.openModal();

    try {
      const s = await API.getMailSettings().catch(() => ({}));
      modalBody.innerHTML = `
        <form id="mail-settings-form">
          <div class="form-group">
            <label>Ваш корпоративный Email *</label>
            <input type="email" id="mail-email" required value="${AppState.escapeHtml(s.email || '')}" placeholder="user@company.ru">
          </div>
          <div class="form-group">
            <label>Пароль почты / Пароль приложения *</label>
            <input type="password" id="mail-password" value="${AppState.escapeHtml(s.password || '')}" placeholder="••••••••••••">
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label>IMAP Сервер (входящие)</label>
              <input type="text" id="mail-imap-host" value="${AppState.escapeHtml(s.imap_host || 'imap.gmail.com')}" placeholder="imap.mail.ru">
            </div>
            <div class="form-group">
              <label>IMAP Порт</label>
              <input type="number" id="mail-imap-port" value="${s.imap_port || 993}">
            </div>
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label>SMTP Сервер (исходящие)</label>
              <input type="text" id="mail-smtp-host" value="${AppState.escapeHtml(s.smtp_host || 'smtp.gmail.com')}" placeholder="smtp.mail.ru">
            </div>
            <div class="form-group">
              <label>SMTP Порт</label>
              <input type="number" id="mail-smtp-port" value="${s.smtp_port || 465}">
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-block"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-save'/></svg> Сохранить параметры</button>
        </form>
      `;

      document.getElementById('mail-settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          email: document.getElementById('mail-email').value.trim(),
          password: document.getElementById('mail-password').value,
          imap_host: document.getElementById('mail-imap-host').value.trim(),
          imap_port: parseInt(document.getElementById('mail-imap-port').value, 10),
          smtp_host: document.getElementById('mail-smtp-host').value.trim(),
          smtp_port: parseInt(document.getElementById('mail-smtp-port').value, 10)
        };
        try {
          await API.saveMailSettings(payload);
          AppState.closeModal();
          AppState.showAlert('Параметры почтового ящика сохранены', 'success');
        } catch (err) {
          alert('Ошибка сохранения: ' + err.message);
        }
      });
    } catch (err) {
      modalBody.innerHTML = `<div class="form-error">Ошибка: ${AppState.escapeHtml(err.message)}</div>`;
    }
  }

  return {
    render: render,
    onActivated: (containerEl) => {
      updateHeaderAndActions(containerEl);
    },
    openMailReader: openMailReader,
    closeMailReader: closeMailReader,
    openComposeModal: openComposeModal,
    openMailSettingsModal: openMailSettingsModal
  };
})();
