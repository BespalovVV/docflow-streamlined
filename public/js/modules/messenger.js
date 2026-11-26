// public/js/modules/messenger.js
window.MessengerModule = (function () {
  let activeChatType = 'channel'; // 'channel' or 'direct'
  let activeChannel = 'general';
  let activeRecipientId = null;
  let activeRecipient = null;
  let chatPollTimer = null;
  let colleagueSearchQuery = '';
  let sidebarLimit = 25;
  let allColleagues = [];
  let cachedConversations = [];
  let selectedChatFiles = [];

  async function render(containerEl) {
    AppState.setHeader('Корпоративный мессенджер', 'Быстрые сообщения между сотрудниками и рабочими группами');
    AppState.setTopBarActions('');

    containerEl.innerHTML = `<div class="text-muted" style="padding: 20px;">Загрузка мессенджера и диалогов...</div>`;

    try {
      const [users, conversations] = await Promise.all([
        API.getUsers().catch(() => []),
        API.getMessengerConversations().catch(() => [])
      ]);

      const currentUser = AppState.getCurrentUser();
      const currentUserId = currentUser ? parseInt(currentUser.id, 10) : 0;

      // Exclude self from colleagues list
      allColleagues = users.filter(u => u.id !== currentUserId);
      cachedConversations = conversations || [];

      // If a recipient was already chosen, restore their object
      if (activeChatType === 'direct' && activeRecipientId) {
        activeRecipient = allColleagues.find(u => u.id === activeRecipientId) ||
          cachedConversations.find(c => c.id === activeRecipientId) ||
          activeRecipient;
      }

      containerEl.innerHTML = `
        <div class="messenger-layout card" style="display: flex; gap: 0; height: calc(100dvh - 190px); min-height: 440px; padding: 0; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden;">
          
          <!-- LEFT CONTACTS & ACTIVE CHATS SIDEBAR -->
          <div class="messenger-sidebar" style="width: 320px; flex-shrink: 0; border-right: 1px solid var(--border-color); display: flex; flex-direction: column; background: var(--bg-card);">
            
            <!-- ACTION BUTTONS: WRITE TO USER / CREATE GROUP (DEF-15) -->
            <div style="display: flex; gap: 6px; padding: 10px 14px 4px 14px; border-bottom: 1px solid var(--border-color);">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-messenger-new-direct" style="flex: 1; font-size: 11.5px; padding: 6px 8px; border-radius: 6px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 4px;">
                <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-message-circle"/></svg></span> <span>Написать</span>
              </button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-messenger-create-group" style="flex: 1; font-size: 11.5px; padding: 6px 8px; border-radius: 6px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 4px;">
                <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-users"/></svg></span> <span>Группа</span>
              </button>
            </div>

            <!-- SEARCH BAR -->
            <div style="padding: 10px 14px; border-bottom: 1px solid var(--border-color); background: var(--bg-card);">
              <div style="position: relative; display: flex; align-items: center;">
                <input type="text" id="messenger-colleague-search" class="user-search-input" 
                       placeholder="Найти по имени или email..." 
                       value="${AppState.escapeHtml(colleagueSearchQuery)}" 
                       autocomplete="off" 
                       style="font-size: 13px; padding: 8px 30px 8px 12px; width: 100%; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-subtle); color: var(--text-main);">
                <button id="btn-clear-messenger-search" class="btn-icon ${colleagueSearchQuery ? '' : 'hidden'}" 
                        title="Очистить поиск" 
                        style="position: absolute; right: 6px; font-size: 14px; padding: 2px 6px; color: var(--text-muted); cursor: pointer;">✕</button>
              </div>
            </div>

            <!-- CHAT LIST AREA -->
            <div id="messenger-sidebar-scroll" style="flex: 1; overflow-y: auto; padding: 8px;">
              
              <!-- FIXED: GENERAL COMPANY CHANNEL -->
              <div class="chat-tab-item ${activeChatType === 'channel' && activeChannel === 'general' ? 'active' : ''}" 
                   data-type="channel" data-channel="general" 
                   style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; cursor: pointer; margin-bottom: 8px; transition: background 0.15s ease;">
                <div style="width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: bold; flex-shrink: 0;">#</div>
                <div style="flex: 1; min-width: 0;">
                  <div style="font-weight: 700; font-size: 13px; color: var(--text-main);"># Общий канал</div>
                  <div style="font-size: 11px; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">Общение всей команды &bull; объявления</div>
                </div>
              </div>

              <!-- DYNAMIC LIST: CONVERSATIONS OR SEARCH RESULTS -->
              <div id="messenger-chats-list">
                ${renderSidebarListHtml(currentUserId)}
              </div>

            </div>
          </div>

          <!-- RIGHT CHAT VIEW -->
          <div class="messenger-chat-pane" id="messenger-chat-pane" style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg-subtle);">
            
            <!-- CHAT HEADER -->
            <div id="chat-header" style="padding: 12px 18px; border-bottom: 1px solid var(--border-color); background: var(--bg-card); display: flex; justify-content: space-between; align-items: center; min-height: 58px; box-sizing: border-box;">
              <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                <!-- MOBILE BACK BUTTON (TELEGRAM PATTERN) -->
                <button type="button" id="btn-chat-back" class="mobile-chat-back-btn" title="Назад к списку чатов" aria-label="Назад к чатам">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                  </svg>
                </button>

                <div id="chat-header-avatar" style="width: 38px; height: 38px; border-radius: 50%; background: var(--primary); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 15px; flex-shrink: 0;">
                  #
                </div>
                <div style="min-width: 0; flex: 1;">
                  <div id="chat-header-title" style="font-size: 14px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"># Общий канал компании</div>
                  <div id="chat-header-subtitle" style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Общий корпоративный чат для всех сотрудников</div>
                </div>
              </div>
            </div>

            <!-- MESSAGES CONTAINER -->
            <div id="chat-messages-container" style="flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; -webkit-overflow-scrolling: touch;">
              <div class="text-muted" style="text-align: center; margin-top: 40px;">Загрузка сообщений...</div>
            </div>

            <!-- CHAT INPUT BAR WITH MULTI-ATTACHMENT TRAY -->
            <div style="padding: 10px 14px; background: var(--bg-card); border-top: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 8px;">
              
              <!-- ATTACHMENT PREVIEW TRAY (Supports multiple photos & docs simultaneously) -->
              <div id="chat-attachment-preview" class="hidden" style="padding: 8px 12px; background: var(--bg-subtle); border: 1px dashed var(--primary); border-radius: 8px; display: flex; flex-direction: column; gap: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.5px;">
                  <span id="chat-attachments-counter">Прикрепленные файлы (0)</span>
                  <button type="button" id="btn-clear-all-attachments" class="btn-icon" title="Очистить все вложения" style="font-size: 11px; color: var(--danger); cursor: pointer; padding: 2px 6px;">✕ Очистить всё</button>
                </div>
                <div id="chat-attachments-list" style="display: flex; flex-wrap: wrap; gap: 6px; max-height: 120px; overflow-y: auto;"></div>
              </div>

              <!-- CONTROLS ROW -->
              <div class="messenger-input-row" style="position: relative;">
                <!-- UNIFIED ATTACHMENT MENU BUTTON (DEF-13, DEF-14) -->
                <div style="position: relative;">
                  <button type="button" id="btn-attach-chat-menu" class="chat-attach-btn" title="Прикрепить файл, фото или документ DocFlow">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                  </button>
                  
                  <div id="chat-attach-dropdown" class="hidden" style="position: absolute; bottom: 44px; left: 0; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.25); z-index: 100; min-width: 230px; padding: 5px; display: flex; flex-direction: column; gap: 2px;">
                    <button type="button" id="btn-menu-attach-device" style="display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; background: transparent; border: none; border-radius: 6px; color: var(--text-main); font-size: 12.5px; cursor: pointer; text-align: left;">
                      <span style="font-size: 15px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-monitor'/></svg></span> <span>Файл с устройства</span>
                    </button>
                    <button type="button" id="btn-menu-attach-image" style="display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; background: transparent; border: none; border-radius: 6px; color: var(--text-main); font-size: 12.5px; cursor: pointer; text-align: left;">
                      <span style="font-size: 15px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-image'/></svg></span> <span>Фото или картинку</span>
                    </button>
                    <div style="height: 1px; background: var(--border-color); margin: 2px 0;"></div>
                    <button type="button" id="btn-menu-attach-docflow" style="display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; background: transparent; border: none; border-radius: 6px; color: var(--primary); font-size: 12.5px; cursor: pointer; text-align: left; font-weight: 600;">
                      <span style="font-size: 15px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-file-text'/></svg></span> <span>Из «Моих документов» DocFlow</span>
                    </button>
                  </div>
                </div>

                <input type="file" id="chat-file-input" multiple style="display: none;">
                <input type="file" id="chat-image-input" accept="image/*" multiple style="display: none;">

                <textarea id="chat-message-input" class="chat-input-textarea" rows="1" placeholder="Сообщение..."></textarea>
                
                <button id="btn-send-chat-message" class="chat-send-btn" title="Отправить сообщение" aria-label="Отправить">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: translateX(1px) translateY(-1px);">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
              </div>

            </div>

          </div>
        </div>
      `;

      bindMessengerEvents(containerEl, currentUserId);
      updateHeaderUI();
      await loadMessages();
      startPolling();

    } catch (err) {
      containerEl.innerHTML = `<div class="form-error">Ошибка загрузки мессенджера: ${AppState.escapeHtml(err.message)}</div>`;
    }
  }

  // Render Sidebar List: Shows Active (non-empty) Conversations by default, or Search Results when searching
  function renderSidebarListHtml(currentUserId) {
    const q = (colleagueSearchQuery || '').toLowerCase().trim();

    // 1. IF SEARCH IS ACTIVE: Search across all users by name, email, or department
    if (q) {
      const searchMatches = allColleagues.filter(u => {
        const name = (u.full_name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        const dept = (u.department || '').toLowerCase();
        return name.includes(q) || email.includes(q) || dept.includes(q);
      });

      const visibleMatches = searchMatches.slice(0, sidebarLimit);
      const hasMoreSearch = searchMatches.length > visibleMatches.length;

      return `
        <div style="font-size: 11px; font-weight: 700; color: var(--primary); text-transform: uppercase; margin: 12px 0 6px 6px; letter-spacing: 0.5px; display: flex; justify-content: space-between; align-items: center;">
          <span>Результаты поиска</span>
          <span class="badge badge-subtle" style="font-size: 10px;">${searchMatches.length}</span>
        </div>
        ${searchMatches.length === 0 ? `
          <div style="padding: 24px 12px; text-align: center; color: var(--text-muted); font-size: 12px;">
            Сотрудников с именем или email «${AppState.escapeHtml(colleagueSearchQuery)}» не найдено
          </div>
        ` : visibleMatches.map(u => {
        const isSelected = activeChatType === 'direct' && activeRecipientId === u.id;
        const firstLetter = (u.full_name || 'U').trim().charAt(0).toUpperCase();

        return `
            <div class="chat-tab-item colleague-tab ${isSelected ? 'active' : ''}" data-type="direct" data-id="${u.id}" 
                 style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; cursor: pointer; margin-bottom: 4px; transition: background 0.15s ease;">
              <div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(59, 130, 246, 0.2); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; flex-shrink: 0;">
                ${firstLetter}
              </div>
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 6px;">
                  <span style="font-weight: 600; font-size: 13px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${AppState.escapeHtml(u.full_name)}
                  </span>
                  <span style="font-size: 10px; color: var(--primary); font-weight: 600; white-space: nowrap;">Написать &rarr;</span>
                </div>
                <div style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${AppState.escapeHtml(u.email)} &bull; ${AppState.escapeHtml(u.department || 'Сотрудник')}
                </div>
              </div>
            </div>
          `;
      }).join('')}
        ${hasMoreSearch ? `
          <button type="button" class="btn btn-secondary btn-sm btn-messenger-show-more" style="width: 100%; margin-top: 6px;">Показать ещё (${searchMatches.length - visibleMatches.length})</button>
        ` : ''}
      `;
    }

    const visibleConversations = cachedConversations.slice(0, sidebarLimit);
    const hasMoreConvs = cachedConversations.length > visibleConversations.length;

    // 2. IF SEARCH IS EMPTY: Show only active (non-empty) conversations
    return `
      <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin: 12px 0 6px 6px; letter-spacing: 0.5px; display: flex; justify-content: space-between; align-items: center;">
        <span>Активные диалоги</span>
        <span class="badge badge-subtle" style="font-size: 10px;">${cachedConversations.length}</span>
      </div>

      ${cachedConversations.length === 0 ? `
        <div style="padding: 32px 14px; text-align: center; color: var(--text-muted); line-height: 1.45;">
          <div style="font-size: 28px; margin-bottom: 8px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-message-circle'/></svg></div>
          <div style="font-size: 13px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">Нет активных диалогов</div>
          <div style="font-size: 11px;">Используйте поиск выше по имени или email, чтобы найти коллегу и начать диалог.</div>
        </div>
      ` : visibleConversations.map(conv => {
      const isSelected = activeChatType === 'direct' && activeRecipientId === conv.id;
      const firstLetter = (conv.full_name || 'U').trim().charAt(0).toUpperCase();
      const isMeLastSender = parseInt(conv.last_sender_id, 10) === currentUserId;
      const lastMsgPrefix = isMeLastSender ? 'Вы: ' : '';
      const timeStr = formatMessageTime(conv.last_message_at);

      let previewText = conv.last_message || '';
      if (conv.last_attachment_url && !previewText) {
        previewText = conv.last_attachment_name ? `<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-paperclip"/></svg> [Файл: ${conv.last_attachment_name}]` : '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-paperclip"/></svg> [Вложение]';
      }

      return `
          <div class="chat-tab-item colleague-tab ${isSelected ? 'active' : ''}" data-type="direct" data-id="${conv.id}" 
               style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; cursor: pointer; margin-bottom: 4px; transition: background 0.15s ease;">
            <div style="width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg, rgba(59,130,246,0.25), rgba(37,99,235,0.4)); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; flex-shrink: 0;">
              ${firstLetter}
            </div>
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 6px;">
                <span style="font-weight: 600; font-size: 13px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${AppState.escapeHtml(conv.full_name)}
                </span>
                <span style="font-size: 10px; color: var(--text-muted); white-space: nowrap;">${timeStr}</span>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;">
                <span style="color: ${isMeLastSender ? 'var(--primary)' : 'var(--text-muted)'};">${lastMsgPrefix}</span>${AppState.escapeHtml(previewText)}
              </div>
            </div>
          </div>
        `;
    }).join('')}
      ${hasMoreConvs ? `
        <button type="button" class="btn btn-secondary btn-sm btn-messenger-show-more" style="width: 100%; margin-top: 6px;">Показать ещё (${cachedConversations.length - visibleConversations.length})</button>
      ` : ''}
    `;
  }

  function formatMessageTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function bindMessengerEvents(containerEl, currentUserId) {
    const searchInput = containerEl.querySelector('#messenger-colleague-search');
    const clearBtn = containerEl.querySelector('#btn-clear-messenger-search');

    // Search input handler
    searchInput?.addEventListener('input', (e) => {
      colleagueSearchQuery = e.target.value;
      sidebarLimit = 25;
      if (clearBtn) {
        clearBtn.classList.toggle('hidden', !colleagueSearchQuery);
      }
      refreshSidebarList(containerEl, currentUserId);
    });

    // Clear search handler
    clearBtn?.addEventListener('click', () => {
      colleagueSearchQuery = '';
      sidebarLimit = 25;
      if (searchInput) searchInput.value = '';
      clearBtn.classList.add('hidden');
      refreshSidebarList(containerEl, currentUserId);
    });

    // Mobile back button handler
    const btnBack = containerEl.querySelector('#btn-chat-back');
    btnBack?.addEventListener('click', () => {
      const layout = containerEl.querySelector('.messenger-layout');
      if (layout) layout.classList.remove('mobile-chat-open');
    });

    // General channel tab click
    containerEl.querySelector('.chat-tab-item[data-channel="general"]')?.addEventListener('click', () => {
      activeChatType = 'channel';
      activeChannel = 'general';
      activeRecipientId = null;
      activeRecipient = null;
      updateHeaderUI();
      updateTabsActive(containerEl);
      loadMessages();
      updateGeneralChannelInputState(currentUserId);
      const layout = containerEl.querySelector('.messenger-layout');
      if (layout) layout.classList.add('mobile-chat-open');
    });

    attachColleaguesClick(containerEl, currentUserId);

    // Initial general channel input state check
    updateGeneralChannelInputState(currentUserId);

    // New Direct message & Create Group buttons (DEF-15)
    containerEl.querySelector('#btn-messenger-new-direct')?.addEventListener('click', () => {
      openNewDirectModal(containerEl, currentUserId);
    });

    containerEl.querySelector('#btn-messenger-create-group')?.addEventListener('click', () => {
      openCreateGroupModal(containerEl, currentUserId);
    });

    // Attachment menu & inputs (DEF-12, DEF-13, DEF-14)
    const fileInput = containerEl.querySelector('#chat-file-input');
    const imageInput = containerEl.querySelector('#chat-image-input');
    const btnAttachMenu = containerEl.querySelector('#btn-attach-chat-menu');
    const attachDropdown = containerEl.querySelector('#chat-attach-dropdown');
    const btnClearAll = containerEl.querySelector('#btn-clear-all-attachments');

    btnAttachMenu?.addEventListener('click', (e) => {
      e.stopPropagation();
      attachDropdown?.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (attachDropdown && !attachDropdown.contains(e.target) && e.target !== btnAttachMenu) {
        attachDropdown.classList.add('hidden');
      }
    });

    containerEl.querySelector('#btn-menu-attach-device')?.addEventListener('click', () => {
      attachDropdown?.classList.add('hidden');
      fileInput?.click();
    });

    containerEl.querySelector('#btn-menu-attach-image')?.addEventListener('click', () => {
      attachDropdown?.classList.add('hidden');
      imageInput?.click();
    });

    containerEl.querySelector('#btn-menu-attach-docflow')?.addEventListener('click', () => {
      attachDropdown?.classList.add('hidden');
      openDocFlowAttachModal();
    });

    fileInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        addChatFiles(e.target.files);
        fileInput.value = '';
      }
      btnAttachMenu?.blur();
      const msgInput = containerEl.querySelector('#chat-message-input');
      if (msgInput) setTimeout(() => msgInput.focus(), 60);
    });

    imageInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        addChatFiles(e.target.files);
        imageInput.value = '';
      }
      btnAttachMenu?.blur();
      const msgInput = containerEl.querySelector('#chat-message-input');
      if (msgInput) setTimeout(() => msgInput.focus(), 60);
    });

    btnClearAll?.addEventListener('click', () => {
      clearChatAttachments();
    });

    // Send button & enter key & auto-resize
    const msgInput = containerEl.querySelector('#chat-message-input');
    const sendBtn = containerEl.querySelector('#btn-send-chat-message');

    msgInput?.addEventListener('input', () => {
      msgInput.style.height = 'auto';
      const newHeight = Math.min(msgInput.scrollHeight, 120);
      msgInput.style.height = newHeight + 'px';
      msgInput.style.overflowY = msgInput.scrollHeight > 120 ? 'auto' : 'hidden';
    });

    sendBtn?.addEventListener('click', () => sendMessage(containerEl, currentUserId));

    msgInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(containerEl, currentUserId);
      }
    });

    // Paste handler for Ctrl+V insertion (images and files)
    msgInput?.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const filesToAdd = [];
      for (const item of items) {
        if (item.kind === 'file') {
          const blob = item.getAsFile();
          if (blob) filesToAdd.push(blob);
        }
      }
      if (filesToAdd.length > 0) {
        addChatFiles(filesToAdd);
      }
    });

    // Drag and Drop files onto chat
    const chatPane = containerEl.querySelector('#messenger-chat-pane');
    if (chatPane) {
      chatPane.addEventListener('dragover', (e) => {
        e.preventDefault();
        chatPane.style.outline = '2px dashed var(--primary)';
      });
      chatPane.addEventListener('dragleave', (e) => {
        e.preventDefault();
        chatPane.style.outline = 'none';
      });
      chatPane.addEventListener('drop', (e) => {
        e.preventDefault();
        chatPane.style.outline = 'none';
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          addChatFiles(e.dataTransfer.files);
        }
      });
    }

    // Auto-scroll on drag selection for both messages list and text input
    const messagesBox = containerEl.querySelector('#chat-messages-container');
    if (messagesBox) setupSelectionAutoScroll(messagesBox);
    if (msgInput) setupTextareaSelectionAutoScroll(msgInput);
  }

  // Автопрокрутка контейнера при выделении текста мышью (перетаскивании к верхнему/нижнему краю)
  function setupSelectionAutoScroll(scrollContainer) {
    if (!scrollContainer) return;

    let isSelecting = false;
    let scrollSpeed = 0;
    let animFrameId = null;
    let lastX = 0;
    let lastY = 0;

    function step() {
      if (scrollSpeed !== 0 && isSelecting) {
        scrollContainer.scrollTop += scrollSpeed;

        // Расширение диапазона выделения к текущей позиции мыши
        try {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0 && sel.extend) {
            const rect = scrollContainer.getBoundingClientRect();
            const clampX = Math.max(rect.left + 5, Math.min(rect.right - 5, lastX));
            const clampY = Math.max(rect.top + 5, Math.min(rect.bottom - 5, lastY));

            if (document.caretRangeFromPoint) {
              const r = document.caretRangeFromPoint(clampX, clampY);
              if (r) sel.extend(r.startContainer, r.startOffset);
            } else if (document.caretPositionFromPoint) {
              const p = document.caretPositionFromPoint(clampX, clampY);
              if (p) sel.extend(p.offsetNode, p.offset);
            }
          }
        } catch (e) { }

        animFrameId = requestAnimationFrame(step);
      } else {
        animFrameId = null;
      }
    }

    scrollContainer.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isSelecting = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isSelecting) return;
      if (e.buttons !== 1) {
        isSelecting = false;
        scrollSpeed = 0;
        if (animFrameId) cancelAnimationFrame(animFrameId);
        return;
      }

      lastX = e.clientX;
      lastY = e.clientY;

      const rect = scrollContainer.getBoundingClientRect();
      const topThreshold = rect.top + 50;
      const bottomThreshold = rect.bottom - 50;

      if (e.clientY < topThreshold) {
        // Мышь у верхнего края или выше — прокрутка вверх
        const dist = topThreshold - e.clientY;
        scrollSpeed = -Math.min(30, Math.max(4, dist * 0.4));
        if (!animFrameId) animFrameId = requestAnimationFrame(step);
      } else if (e.clientY > bottomThreshold) {
        // Мышь у нижнего края или ниже — прокрутка вниз
        const dist = e.clientY - bottomThreshold;
        scrollSpeed = Math.min(30, Math.max(4, dist * 0.4));
        if (!animFrameId) animFrameId = requestAnimationFrame(step);
      } else {
        scrollSpeed = 0;
      }
    });

    window.addEventListener('mouseup', () => {
      isSelecting = false;
      scrollSpeed = 0;
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
    });
  }

  // Автопрокрутка textarea при выделении текста
  function setupTextareaSelectionAutoScroll(textarea) {
    if (!textarea) return;

    let isSelecting = false;
    let scrollSpeed = 0;
    let animId = null;

    function step() {
      if (scrollSpeed !== 0 && isSelecting) {
        textarea.scrollTop += scrollSpeed;
        animId = requestAnimationFrame(step);
      } else {
        animId = null;
      }
    }

    textarea.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isSelecting = true;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isSelecting) return;
      if (e.buttons !== 1) {
        isSelecting = false;
        scrollSpeed = 0;
        if (animId) cancelAnimationFrame(animId);
        return;
      }

      const rect = textarea.getBoundingClientRect();
      const topThreshold = rect.top + 15;
      const bottomThreshold = rect.bottom - 15;

      if (e.clientY < topThreshold) {
        const dist = topThreshold - e.clientY;
        scrollSpeed = -Math.min(20, Math.max(3, dist * 0.35));
        if (!animId) animId = requestAnimationFrame(step);
      } else if (e.clientY > bottomThreshold) {
        const dist = e.clientY - bottomThreshold;
        scrollSpeed = Math.min(20, Math.max(3, dist * 0.35));
        if (!animId) animId = requestAnimationFrame(step);
      } else {
        scrollSpeed = 0;
      }
    });

    window.addEventListener('mouseup', () => {
      isSelecting = false;
      scrollSpeed = 0;
      if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    });
  }

  // Ограничение записи в общий канал: только для ADMIN
  function updateGeneralChannelInputState(currentUserId) {
    if (activeChatType !== 'channel' || activeChannel !== 'general') {
      // Не общий канал — разблокировать ввод
      const msgInput = document.getElementById('chat-message-input');
      const sendBtn = document.getElementById('btn-send-chat-message');
      const inputBar = msgInput?.closest('[style*="padding: 10px"]');
      if (msgInput) {
        msgInput.disabled = false;
        msgInput.placeholder = 'Сообщение...';
        msgInput.style.opacity = '';
      }
      if (sendBtn) sendBtn.disabled = false;
      const notice = document.getElementById('general-channel-notice');
      if (notice) notice.remove();
      return;
    }

    const currentUser = AppState.getCurrentUser();
    const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role_code === 'admin';

    const msgInput = document.getElementById('chat-message-input');
    const sendBtn = document.getElementById('btn-send-chat-message');

    // Убираем старое уведомление
    const oldNotice = document.getElementById('general-channel-notice');
    if (oldNotice) oldNotice.remove();

    if (!isAdmin) {
      if (msgInput) {
        msgInput.disabled = true;
        msgInput.placeholder = 'Только администратор может писать в общий канал';
        msgInput.style.opacity = '0.5';
      }
      if (sendBtn) sendBtn.disabled = true;

      // Показываем уведомление
      const inputBar = msgInput?.parentElement;
      if (inputBar) {
        const notice = document.createElement('div');
        notice.id = 'general-channel-notice';
        notice.style.cssText = 'font-size: 12px; color: var(--text-muted); text-align: center; padding: 6px 0;';
        notice.textContent = 'Общий канал — только объявления от администратора';
        inputBar.before(notice);
      }
    } else {
      if (msgInput) {
        msgInput.disabled = false;
        msgInput.placeholder = 'Сообщение для всей команды...';
        msgInput.style.opacity = '';
      }
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function addChatFiles(files) {
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const exists = selectedChatFiles.some(existing =>
        existing.name === f.name && existing.size === f.size && existing.lastModified === f.lastModified
      );
      if (!exists) {
        selectedChatFiles.push(f);
      }
    }
    updateChatAttachmentPreview();
  }

  function removeChatFile(index) {
    if (index >= 0 && index < selectedChatFiles.length) {
      selectedChatFiles.splice(index, 1);
      updateChatAttachmentPreview();
    }
  }

  function clearChatAttachments() {
    selectedChatFiles = [];
    const fileInput = document.getElementById('chat-file-input');
    const imageInput = document.getElementById('chat-image-input');
    if (fileInput) fileInput.value = '';
    if (imageInput) imageInput.value = '';
    updateChatAttachmentPreview();
  }

  function updateChatAttachmentPreview() {
    const previewContainer = document.getElementById('chat-attachment-preview');
    const counterEl = document.getElementById('chat-attachments-counter');
    const listEl = document.getElementById('chat-attachments-list');
    if (!previewContainer || !counterEl || !listEl) return;

    if (selectedChatFiles.length === 0) {
      previewContainer.classList.add('hidden');
      listEl.innerHTML = '';
      return;
    }

    previewContainer.classList.remove('hidden');
    counterEl.textContent = `Прикрепленные файлы (${selectedChatFiles.length})`;

    listEl.innerHTML = selectedChatFiles.map((file, idx) => {
      const isImg = file.type && file.type.startsWith('image/');
      const sizeStr = formatFileSize(file.size);
      const safeName = AppState.escapeHtml(file.name || 'Файл');

      if (isImg) {
        const objUrl = URL.createObjectURL(file);
        return `
          <div style="display: flex; align-items: center; gap: 8px; background: var(--bg-card); border: 1px solid var(--border-color); padding: 4px 8px; border-radius: 6px; font-size: 11px;">
            <img src="${objUrl}" style="width: 28px; height: 28px; object-fit: cover; border-radius: 4px;">
            <div style="max-width: 140px; min-width: 0;">
              <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-main);">${safeName}</div>
              <div style="font-size: 9px; color: var(--text-muted);">${sizeStr}</div>
            </div>
            <button type="button" class="btn-remove-file-chip" data-idx="${idx}" title="Удалить" style="background: none; border: none; color: var(--danger); font-size: 13px; font-weight: bold; cursor: pointer; padding: 2px 4px; margin-left: 4px;">✕</button>
          </div>
        `;
      } else {
        const isPdf = /\.pdf$/i.test(file.name);
        const isWord = /\.(docx?|rtf|odt)$/i.test(file.name);
        const isExcel = /\.(xlsx?|csv|ods)$/i.test(file.name);
        const icon = isPdf ? dfIcon('book', 16) : (isWord ? dfIcon('book', 16) : (isExcel ? dfIcon('book', 16) : dfIcon('file-text', 16)));
        return `
          <div style="display: flex; align-items: center; gap: 8px; background: var(--bg-card); border: 1px solid var(--border-color); padding: 4px 8px; border-radius: 6px; font-size: 11px;">
            <span style="font-size: 18px;">${icon}</span>
            <div style="max-width: 140px; min-width: 0;">
              <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-main);">${safeName}</div>
              <div style="font-size: 9px; color: var(--text-muted);">${sizeStr}</div>
            </div>
            <button type="button" class="btn-remove-file-chip" data-idx="${idx}" title="Удалить" style="background: none; border: none; color: var(--danger); font-size: 13px; font-weight: bold; cursor: pointer; padding: 2px 4px; margin-left: 4px;">✕</button>
          </div>
        `;
      }
    }).join('');

    listEl.querySelectorAll('.btn-remove-file-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        removeChatFile(idx);
      });
    });
  }

  function refreshSidebarList(containerEl, currentUserId) {
    const listEl = containerEl.querySelector('#messenger-chats-list');
    if (listEl) {
      listEl.innerHTML = renderSidebarListHtml(currentUserId);
      attachColleaguesClick(containerEl, currentUserId);
      listEl.querySelector('.btn-messenger-show-more')?.addEventListener('click', () => {
        sidebarLimit += 25;
        refreshSidebarList(containerEl, currentUserId);
      });
    }
  }

  function attachColleaguesClick(containerEl, currentUserId) {
    containerEl.querySelectorAll('.colleague-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const id = parseInt(tab.getAttribute('data-id'), 10);
        const user = allColleagues.find(u => u.id === id) || cachedConversations.find(c => c.id === id);
        if (user) {
          activeChatType = 'direct';
          activeRecipientId = id;
          activeRecipient = user;

          // If this user was selected from search, clear search to show active chats
          if (colleagueSearchQuery) {
            colleagueSearchQuery = '';
            const searchInput = containerEl.querySelector('#messenger-colleague-search');
            const clearBtn = containerEl.querySelector('#btn-clear-messenger-search');
            if (searchInput) searchInput.value = '';
            if (clearBtn) clearBtn.classList.add('hidden');
            refreshSidebarList(containerEl, currentUserId);
          }

          updateHeaderUI();
          updateTabsActive(containerEl);
          loadMessages();
          // Разблокировать ввод (выход из общего канала)
          updateGeneralChannelInputState(currentUserId);
          const layout = containerEl.querySelector('.messenger-layout');
          if (layout) layout.classList.add('mobile-chat-open');
        }
      });
    });
  }

  function updateTabsActive(containerEl) {
    containerEl.querySelectorAll('.chat-tab-item').forEach(tab => {
      tab.classList.remove('active');
      const type = tab.getAttribute('data-type');
      if (type === 'channel' && activeChatType === 'channel') {
        tab.classList.add('active');
      } else if (type === 'direct' && activeChatType === 'direct') {
        const id = parseInt(tab.getAttribute('data-id'), 10);
        if (id === activeRecipientId) tab.classList.add('active');
      }
    });
  }

  function updateHeaderUI() {
    const avatar = document.getElementById('chat-header-avatar');
    const title = document.getElementById('chat-header-title');
    const subtitle = document.getElementById('chat-header-subtitle');

    if (!title || !subtitle || !avatar) return;

    if (activeChatType === 'channel') {
      avatar.innerHTML = '#';
      avatar.style.background = 'var(--primary)';
      title.textContent = '# Общий канал компании';
      subtitle.textContent = 'Общий корпоративный чат для всех сотрудников';
    } else if (activeRecipient) {
      avatar.innerHTML = (activeRecipient.full_name || 'U').charAt(0).toUpperCase();
      avatar.style.background = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
      title.textContent = activeRecipient.full_name;
      subtitle.textContent = `${activeRecipient.department || 'Сотрудник'} • ${activeRecipient.email}`;
    }
  }

  function getAuthFileUrl(rawUrl) {
    if (!rawUrl) return '';
    if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) return rawUrl;
    const token = (typeof API !== 'undefined' && API.getToken) ? API.getToken() : null;
    if (!token) return rawUrl;
    const sep = rawUrl.includes('?') ? '&' : '?';
    return `${rawUrl}${sep}token=${encodeURIComponent(token)}`;
  }

  async function loadMessages() {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;

    try {
      const query = activeChatType === 'direct'
        ? { recipient_id: activeRecipientId }
        : { channel: activeChannel };

      const messages = await API.getMessengerMessages(query);
      const currentUser = AppState.getCurrentUser();
      const currentUserId = currentUser ? parseInt(currentUser.id, 10) : 0;

      if (messages.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; color: var(--text-muted); margin-top: 60px;">
            <div style="font-size: 36px; margin-bottom: 10px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-message-circle'/></svg></div>
            <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">История сообщений пуста</div>
            <div style="font-size: 12px;">Отправьте первое сообщение, файл или фото, чтобы начать диалог.</div>
          </div>
        `;
        return;
      }

      container.innerHTML = messages.map(m => {
        const isMine = m.sender_id === currentUserId;
        const timeStr = new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const senderName = m.sender_name || 'Сотрудник';
        const initial = senderName.charAt(0).toUpperCase();

        // Normalize attachments (support both array and legacy single fields)
        let attList = [];
        if (Array.isArray(m.attachments) && m.attachments.length > 0) {
          attList = m.attachments;
        } else if (m.attachment_url) {
          attList = [{
            url: m.attachment_url,
            name: m.attachment_name,
            size: m.attachment_size,
            type: m.attachment_type
          }];
        }

        // Deduplicate attachments to prevent showing duplicate items
        const seenAtts = new Set();
        attList = attList.filter(att => {
          if (!att) return false;
          const key = (att.name || '') + '_' + (att.size || '') + '_' + (att.url || '');
          if (seenAtts.has(key)) return false;
          seenAtts.add(key);
          return true;
        });

        let attachmentHtml = '';
        if (attList.length > 0) {
          const images = [];
          const docs = [];
          attList.forEach(att => {
            const isImg = (att.type && att.type.startsWith('image/')) ||
              /\.(jpe?g|png|gif|webp|svg)$/i.test(att.url || att.name || '');
            if (isImg) {
              images.push(att);
            } else {
              docs.push(att);
            }
          });

          let imagesHtml = '';
          if (images.length === 1) {
            const img = images[0];
            const safeName = AppState.escapeHtml(img.name || 'Изображение');
            const sizeStr = formatFileSize(img.size);
            const authUrl = getAuthFileUrl(img.url);
            imagesHtml = `
              <div style="margin-top: 8px; max-width: 320px; width: 100%; overflow: hidden;">
                <a href="${authUrl}" target="_blank" rel="noopener noreferrer" style="display: block; border-radius: 8px; overflow: hidden; max-width: 320px; width: 100%; box-shadow: 0 4px 12px rgba(0,0,0,0.25);">
                  <img src="${authUrl}" alt="${safeName}" style="width: 100%; max-height: 240px; object-fit: cover; display: block;" loading="lazy">
                </a>
                <div style="font-size: 10px; opacity: 0.8; margin-top: 4px; display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; max-width: 100%; min-width: 0;">
                  <span title="${safeName}" style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${safeName}</span>
                  <span style="flex-shrink: 0; white-space: nowrap;">${sizeStr}</span>
                </div>
              </div>
            `;
          } else if (images.length > 1) {
            imagesHtml = `
              <div style="margin-top: 8px; display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px; max-width: 360px;">
                ${images.map(img => {
              const safeName = AppState.escapeHtml(img.name || 'Изображение');
              const authUrl = getAuthFileUrl(img.url);
              return `
                    <a href="${authUrl}" target="_blank" rel="noopener noreferrer" title="${safeName}" style="display: block; aspect-ratio: 1; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.15);">
                      <img src="${authUrl}" alt="${safeName}" style="width: 100%; height: 100%; object-fit: cover; display: block;" loading="lazy">
                    </a>
                  `;
            }).join('')}
              </div>
            `;
          }

          let docsHtml = '';
          if (docs.length > 0) {
            docsHtml = `
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
              ${docs.map(doc => {
              let safeName = doc.name || 'Документ';
              if (!/\.[a-zA-Z0-9]{1,8}$/.test(safeName)) {
                const extMatch = (doc.url || '').match(/\.([a-zA-Z0-9]+)$/);
                if (extMatch) {
                  safeName += '.' + extMatch[1];
                } else if (doc.type) {
                  if (doc.type.includes('pdf')) safeName += '.pdf';
                  else if (doc.type.includes('word') || doc.type.includes('officedocument.word')) safeName += '.docx';
                  else if (doc.type.includes('sheet') || doc.type.includes('excel')) safeName += '.xlsx';
                  else if (doc.type.includes('presentation') || doc.type.includes('powerpoint')) safeName += '.pptx';
                  else if (doc.type.includes('zip')) safeName += '.zip';
                  else safeName += '.bin';
                }
              }
              const sizeStr = formatFileSize(doc.size);
              const isPdf = /\.pdf$/i.test(safeName || doc.url || '');
              const isWord = /\.(docx?|rtf|odt)$/i.test(safeName || doc.url || '');
              const isExcel = /\.(xlsx?|csv|ods|tsv)$/i.test(safeName || doc.url || '');
              const isPpt = /\.(pptx?|odp)$/i.test(safeName || doc.url || '');
              const isArchive = /\.(zip|rar|7z|tar|gz)$/i.test(safeName || doc.url || '');
              const icon = isPdf ? dfIcon('book', 16) : (isWord ? dfIcon('book', 16) : (isExcel ? dfIcon('book', 16) : (isPpt ? dfIcon('bar-chart', 16) : (isArchive ? dfIcon('archive', 16) : dfIcon('file-text', 16)))));
              const cardBg = isMine ? 'rgba(0,0,0,0.2)' : 'var(--bg-subtle)';
              const cardBorder = isMine ? 'rgba(255,255,255,0.12)' : 'var(--border-color)';
              const btnClass = isMine ? 'btn btn-sm' : 'btn btn-secondary btn-sm';
              const btnStyle = isMine
                ? 'padding: 4px 10px; font-size: 11px; text-decoration: none; flex-shrink: 0; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: #fff;'
                : 'padding: 4px 10px; font-size: 11px; text-decoration: none; flex-shrink: 0;';

              const token = API.getToken();
              const isDocFlowDoc = Boolean(doc.docId || doc.type === 'docflow_document');
              const downloadUrl = isDocFlowDoc ? `/api/documents/${doc.docId}/download` : `/api/messenger/download?url=${encodeURIComponent(doc.url)}&name=${encodeURIComponent(safeName)}${token ? '&token=' + token : ''}`;

              return `
                  <div class="chat-doc-card" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: ${cardBg}; padding: 7px 10px; border-radius: 8px; border: 1px solid ${cardBorder}; max-width: 100%; box-sizing: border-box;">
                    <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                      <span style="font-size: 18px; flex-shrink: 0;">${isDocFlowDoc ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-file-text"/></svg>' : icon}</span>
                      <div style="min-width: 0; flex: 1;">
                        <div style="font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
                          ${AppState.escapeHtml(safeName)}
                        </div>
                        <div style="font-size: 10px; opacity: 0.75;">${isDocFlowDoc ? 'Документ DocFlow' : sizeStr}</div>
                      </div>
                    </div>
                    <div style="display: flex; gap: 4px; align-items: center;">
                      ${isDocFlowDoc ? `
                        <a href="/editor.html?id=${doc.docId}" target="_blank" class="btn btn-primary btn-sm" style="padding: 3px 8px; font-size: 10.5px; text-decoration: none; border-radius: 4px; white-space: nowrap;">
                          <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-file-edit"/></svg> Открыть
                        </a>
                      ` : ''}
                      <a href="${downloadUrl}" download="${AppState.escapeHtml(safeName)}" class="${btnClass}" style="${btnStyle}; display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        <span>Скачать</span>
                      </a>
                    </div>
                  </div>
                `;
            }).join('')}
            </div>
          `;
          }

          attachmentHtml = imagesHtml + docsHtml;
        }

        const msgText = m.message && !m.message.startsWith('\uD83D\uDCCE ') ? m.message : '';

        if (isMine) {
          return `
            <div style="display: flex; justify-content: flex-end; margin-bottom: 4px;">
              <div class="chat-bubble-mine" style="max-width: 82%; min-width: 0; overflow: hidden; box-sizing: border-box; background: #2563eb; color: #ffffff; padding: 10px 14px; border-radius: 14px 14px 2px 14px; box-shadow: 0 2px 8px rgba(37,99,235,0.25);">
                ${msgText ? `<div style="font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-word;">${AppState.escapeHtml(msgText)}</div>` : ''}
                ${attachmentHtml}
                <div style="text-align: right; font-size: 10px; opacity: 0.8; margin-top: 4px;">${timeStr}</div>
              </div>
            </div>
          `;
        } else {
          return `
            <div style="display: flex; gap: 8px; align-items: flex-start; margin-bottom: 4px;">
              <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-main); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0;">
                ${initial}
              </div>
              <div class="chat-bubble-theirs" style="max-width: 82%; min-width: 0; overflow: hidden; box-sizing: border-box; background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-main); padding: 10px 14px; border-radius: 14px 14px 14px 2px; box-shadow: var(--shadow-card);">
                <div style="font-size: 11px; font-weight: 700; color: var(--primary); margin-bottom: 3px;">
                  ${AppState.escapeHtml(senderName)} <span style="font-weight: normal; color: var(--text-muted); font-size: 10px;">(${AppState.escapeHtml(m.sender_department || '')})</span>
                </div>
                ${msgText ? `<div style="font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-word;">${AppState.escapeHtml(msgText)}</div>` : ''}
                ${attachmentHtml}
                <div style="text-align: right; font-size: 10px; color: var(--text-muted); margin-top: 4px;">${timeStr}</div>
              </div>
            </div>
          `;
        }
      }).join('');

      // Auto scroll to bottom
      container.scrollTop = container.scrollHeight;

    } catch (e) {
      console.error('Error polling messenger messages:', e);
    }
  }

  async function sendMessage(containerEl, currentUserId) {
    const input = document.getElementById('chat-message-input');
    const sendBtn = document.getElementById('btn-send-chat-message');
    if (!input) return;
    const text = input.value.trim();

    if (!text && selectedChatFiles.length === 0) return;

    if (sendBtn) sendBtn.disabled = true;

    try {
      if (selectedChatFiles.length > 0) {
        const formData = new FormData();
        if (text) formData.append('message', text);
        if (activeChatType === 'channel') formData.append('channel', activeChannel);
        if (activeChatType === 'direct') formData.append('recipient_id', activeRecipientId);

        const docFlowAtts = selectedChatFiles.filter(f => f.isDocFlowDoc).map(f => ({
          name: f.name,
          size: f.size,
          type: 'docflow_document',
          docId: f.docId,
          url: f.url
        }));
        const binaryFiles = selectedChatFiles.filter(f => !f.isDocFlowDoc);

        if (docFlowAtts.length > 0) {
          formData.append('attachments_json', JSON.stringify(docFlowAtts));
        }
        binaryFiles.forEach(f => {
          formData.append('files', f);
        });

        await API.sendMessengerMessage(formData);
      } else {
        const payload = {
          message: text,
          channel: activeChatType === 'channel' ? activeChannel : null,
          recipient_id: activeChatType === 'direct' ? activeRecipientId : null
        };
        await API.sendMessengerMessage(payload);
      }

      input.value = '';
      input.style.height = 'auto';
      clearChatAttachments();
      await loadMessages();

      // Refresh conversations list so newly active chat appears at the top
      const conversations = await API.getMessengerConversations().catch(() => []);
      cachedConversations = conversations || [];
      refreshSidebarList(containerEl, currentUserId);
      updateTabsActive(containerEl);

    } catch (err) {
      alert('Ошибка отправки: ' + err.message);
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  let chatEventSource = null;

  function initSSE() {
    if (chatEventSource) return;
    try {
      const token = AppState.getToken ? AppState.getToken() : localStorage.getItem('token');
      const streamUrl = token ? `/api/messenger/stream?token=${encodeURIComponent(token)}` : '/api/messenger/stream';
      chatEventSource = new EventSource(streamUrl);

      chatEventSource.onmessage = async (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'new_message') {
            const m = data.message;
            const currentUser = AppState.getCurrentUser();
            const currentUserId = currentUser ? parseInt(currentUser.id, 10) : 0;

            if (AppState.getCurrentView() === 'messenger') {
              const isCurrentChannel = activeChatType === 'channel' && !m.recipient_id && (m.channel === activeChannel || (!m.channel && activeChannel === 'general'));
              const isCurrentDirect = activeChatType === 'direct' && activeRecipientId && (
                (m.sender_id === activeRecipientId && m.recipient_id === currentUserId) ||
                (m.sender_id === currentUserId && m.recipient_id === activeRecipientId)
              );

              if (isCurrentChannel || isCurrentDirect) {
                await loadMessages();
              }

              if (!colleagueSearchQuery) {
                const conversations = await API.getMessengerConversations().catch(() => []);
                cachedConversations = conversations || [];
                const containerEl = document.getElementById('view-panel-messenger');
                if (containerEl) {
                  refreshSidebarList(containerEl, currentUserId);
                  updateTabsActive(containerEl);
                }
              }
            }
          }
        } catch (err) {
          // Ignore parse errors on keepalive comments
        }
      };

      chatEventSource.onerror = () => {
        // SSE disconnected or error; background fallback timer will maintain sync
      };
    } catch (e) {
      console.warn('SSE initialization notice:', e);
    }
  }

  function closeSSE() {
    if (chatEventSource) {
      try {
        chatEventSource.close();
      } catch (e) { }
      chatEventSource = null;
    }
  }

  function startPolling() {
    initSSE();
    stopPollingTimer();
    // Optimized fallback polling: 30 seconds instead of aggressive 3s polling
    chatPollTimer = setInterval(async () => {
      if (AppState.getCurrentView() === 'messenger') {
        await loadMessages();
        if (!colleagueSearchQuery) {
          const conversations = await API.getMessengerConversations().catch(() => []);
          cachedConversations = conversations || [];
          const containerEl = document.getElementById('view-panel-messenger');
          if (containerEl) {
            const currentUser = AppState.getCurrentUser();
            const currentUserId = currentUser ? parseInt(currentUser.id, 10) : 0;
            refreshSidebarList(containerEl, currentUserId);
            updateTabsActive(containerEl);
          }
        }
      }
    }, 30000);
  }

  // ATTACH DOCUMENT FROM DOCFLOW REPOSITORY (DEF-13)
  async function openDocFlowAttachModal() {
    AppState.setModalTitle('Выбрать из «Моих документов» DocFlow');
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted);">Загрузка документов...</div>`;
    AppState.openModal(null, null, 'md');

    try {
      const docs = await API.getDocuments();
      if (!docs || docs.length === 0) {
        modalBody.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-muted);">В вашем хранилище пока нет документов.</div>`;
        return;
      }

      modalBody.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <input type="text" id="attach-doc-search" placeholder="Поиск документа по названию или папке..." 
                 style="width: 100%; padding: 8px 12px; font-size: 13px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-main);">
          <div id="attach-docs-list" style="max-height: 340px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 2px;">
            ${docs.map(d => `
              <div class="docflow-attach-item" data-id="${d.id}" data-title="${AppState.escapeHtml(d.title)}" data-type="${d.file_type || 'docx'}" data-size="${d.file_size || 0}"
                   style="display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-radius: 8px; background: var(--bg-subtle); border: 1px solid var(--border-color); cursor: pointer; transition: background 0.15s ease;">
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                  <span style="font-size: 22px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-file-text'/></svg></span>
                  <div style="min-width: 0; flex: 1;">
                    <div style="font-weight: 600; font-size: 13px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${AppState.escapeHtml(d.title)}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">Папка: ${AppState.escapeHtml(d.category || 'Общие')} &bull; ${(d.file_type || '').toUpperCase()}</div>
                  </div>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" style="flex-shrink: 0; font-size: 11.5px; padding: 4px 10px; font-weight: 600;">+ Прикрепить</button>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      const searchInput = document.getElementById('attach-doc-search');
      searchInput?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        modalBody.querySelectorAll('.docflow-attach-item').forEach(el => {
          const text = el.textContent.toLowerCase();
          el.style.display = text.includes(q) ? 'flex' : 'none';
        });
      });

      modalBody.querySelectorAll('.docflow-attach-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = parseInt(item.getAttribute('data-id'), 10);
          const title = item.getAttribute('data-title');
          const type = item.getAttribute('data-type');
          const size = parseInt(item.getAttribute('data-size'), 10) || 0;

          selectedChatFiles.push({
            isDocFlowDoc: true,
            docId: id,
            name: title,
            size: size,
            type: 'docflow_document',
            url: `/api/documents/download/${id}`
          });

          updateChatAttachmentPreview();
          AppState.closeModal();
          const msgInput = document.getElementById('chat-message-input');
          if (msgInput) setTimeout(() => msgInput.focus(), 60);
        });
      });

    } catch (err) {
      modalBody.innerHTML = `<div class="form-error">Ошибка: ${AppState.escapeHtml(err.message)}</div>`;
    }
  }

  // WRITE TO ANY EMPLOYEE MODAL (DEF-15)
  function openNewDirectModal(containerEl, currentUserId) {
    AppState.setModalTitle('Написать сотруднику');
    const modalBody = document.getElementById('modal-body');

    modalBody.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <input type="text" id="direct-user-search" placeholder="Поиск по ФИО, должности или отделу..." 
               style="width: 100%; padding: 8px 12px; font-size: 13px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-main);">
        <div id="direct-users-list" style="max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">
          ${allColleagues.map(u => {
      const initial = (u.full_name || 'U').trim().charAt(0).toUpperCase();
      return `
              <div class="direct-user-item" data-id="${u.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 8px; background: var(--bg-subtle); border: 1px solid var(--border-color); cursor: pointer; transition: background 0.15s ease;">
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                  <div style="width: 34px; height: 34px; border-radius: 50%; background: rgba(59,130,246,0.2); color: var(--primary); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0;">
                    ${initial}
                  </div>
                  <div style="min-width: 0; flex: 1;">
                    <div style="font-weight: 600; font-size: 13px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${AppState.escapeHtml(u.full_name)}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${AppState.escapeHtml(u.position || 'Сотрудник')} &bull; ${AppState.escapeHtml(u.department || 'Общий отдел')}</div>
                  </div>
                </div>
                <button type="button" class="btn btn-primary btn-sm" style="font-size: 11px; padding: 4px 10px;">Написать <svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-message-circle'/></svg></button>
              </div>
            `;
    }).join('')}
        </div>
      </div>
    `;
    AppState.openModal(null, null, 'md');

    const search = document.getElementById('direct-user-search');
    search?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      modalBody.querySelectorAll('.direct-user-item').forEach(el => {
        const text = el.textContent.toLowerCase();
        el.style.display = text.includes(q) ? 'flex' : 'none';
      });
    });

    modalBody.querySelectorAll('.direct-user-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = parseInt(item.getAttribute('data-id'), 10);
        const user = allColleagues.find(u => u.id === id);
        if (user) {
          activeChatType = 'direct';
          activeRecipientId = id;
          activeRecipient = user;
          AppState.closeModal();
          updateHeaderUI();
          updateTabsActive(containerEl);
          loadMessages();
          updateGeneralChannelInputState(currentUserId);
          const layout = containerEl.querySelector('.messenger-layout');
          if (layout) layout.classList.add('mobile-chat-open');
          const msgInput = document.getElementById('chat-message-input');
          if (msgInput) setTimeout(() => msgInput.focus(), 60);
        }
      });
    });
  }

  // CREATE GROUP / CHANNEL MODAL (DEF-15)
  function openCreateGroupModal(containerEl, currentUserId) {
    AppState.setModalTitle('Создать рабочую группу / канал');
    const modalBody = document.getElementById('modal-body');

    modalBody.innerHTML = `
      <form id="create-group-form">
        <div class="form-group">
          <label>Название группы или канала *</label>
          <input type="text" id="group-name" required placeholder="Например: Проект Альфа или Отдел логистики">
        </div>
        <div class="form-group">
          <label>Описание назначения группы</label>
          <input type="text" id="group-desc" placeholder="Краткое описание целей чата...">
        </div>
        <div class="form-group">
          <label>Участники группы</label>
          <div style="max-height: 180px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 4px; background: var(--bg-card);">
            ${allColleagues.map(u => `
              <label style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; cursor: pointer; padding: 2px 4px;">
                <input type="checkbox" class="group-member-checkbox" value="${u.id}" checked style="accent-color: var(--primary);">
                <span>${AppState.escapeHtml(u.full_name)} <small class="text-muted">(${AppState.escapeHtml(u.department || 'Сотрудник')})</small></span>
              </label>
            `).join('')}
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-block"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-rocket'/></svg> Создать группу</button>
      </form>
    `;
    AppState.openModal(null, null, 'sm');

    document.getElementById('create-group-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('group-name').value.trim();
      if (!name) return;
      const channelKey = 'grp_' + name.toLowerCase().replace(/[^a-zа-я0-9]/gi, '_').slice(0, 24);

      activeChatType = 'channel';
      activeChannel = channelKey;
      activeRecipientId = null;
      activeRecipient = null;

      AppState.closeModal();
      AppState.showAlert(`Группа "${name}" успешно создана`, 'success');

      const formData = new FormData();
      formData.append('message', `<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-award"/></svg> Группа "${name}" создана. Приветствуем всех участников!`);
      formData.append('channel', channelKey);
      try {
        await API.sendMessengerMessage(formData);
      } catch (e) { }

      updateHeaderUI();
      const headerTitle = document.getElementById('chat-header-title');
      const headerSub = document.getElementById('chat-header-subtitle');
      if (headerTitle) headerTitle.textContent = `${name}`;
      if (headerSub) headerSub.textContent = 'Рабочая группа';

      loadMessages();
    });
  }

  function stopPollingTimer() {
    if (chatPollTimer) {
      clearInterval(chatPollTimer);
      chatPollTimer = null;
    }
  }

  function stopPolling() {
    stopPollingTimer();
    closeSSE();
  }

  return {
    render: render,
    stopPolling: stopPolling,
    startPolling: startPolling,
    onActivated: (containerEl) => {
      AppState.setHeader('Корпоративный мессенджер', 'Быстрые сообщения между сотрудниками и рабочими группами');
      AppState.setTopBarActions('');
      startPolling();
    }
  };
})();
