// public/js/modules/documents.js (Google Drive Style + Hybrid RAG Search + ONLYOFFICE Live)
window.DocumentsModule = (function() {
  let loadedDocEditor = null;
  let docSearchQuery = '';
  let activeSection = 'drive'; // 'drive' | 'my' | 'shared' | 'public' | 'recent'
  let currentFolderId = null;  // null = корень "Мой диск", число = ID папки
  let viewMode = localStorage.getItem('docflow_drive_view') === 'grid' ? 'grid' : 'list';
  let typeFilter = 'all';      // 'all' | 'word' | 'sheet' | 'slide' | 'pdf' | 'image'
  let sortBy = 'updated_desc'; // 'updated_desc' | 'name_asc' | 'size_desc'
  let docPage = 1;
  let docPageSize = 15;
  let searchPage = 1;
  let searchPageSize = 12;
  let currentEditorDocId = null;
  let currentEditorConfig = null;
  let isMobileEditorMode = false;
  let isFullscreenActive = false;
  let isDocModified = false;

  let cachedDocuments = [];
  let cachedFolders = [];
  let outsideClickBound = false;

  function formatBytes(bytes) {
    const b = Number(bytes) || 0;
    if (b === 0) return '—';
    if (b < 1024) return `${b} Б`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
    return `${(b / (1024 * 1024)).toFixed(2)} МБ`;
  }

  function getFileVisual(fileType) {
    const typeUpper = (fileType || '').toUpperCase();
    let icon = dfIcon('file-text', 16);
    let badgeClass = 'badge-primary';
    let group = 'other';

    if (typeUpper === 'PDF') {
      icon = '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-book"/></svg>'; badgeClass = 'badge-danger'; group = 'pdf';
    } else if (['DOCX', 'DOC', 'ODT', 'RTF', 'TXT', 'MD'].includes(typeUpper)) {
      icon = '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-file-edit"/></svg>'; badgeClass = 'badge-primary'; group = 'word';
    } else if (['XLSX', 'XLS', 'ODS', 'CSV', 'TSV'].includes(typeUpper)) {
      icon = '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-bar-chart"/></svg>'; badgeClass = 'badge-active'; group = 'sheet';
    } else if (['PPTX', 'PPT', 'ODP'].includes(typeUpper)) {
      icon = '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-video"/></svg>'; badgeClass = 'badge-warning'; group = 'slide';
    } else if (['PNG', 'JPG', 'JPEG', 'GIF', 'WEBP', 'SVG'].includes(typeUpper)) {
      icon = '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-image"/></svg>'; badgeClass = 'badge-primary'; group = 'image';
    } else if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(typeUpper)) {
      icon = '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-archive"/></svg>'; badgeClass = 'badge-warning'; group = 'archive';
    } else if (['JSON', 'XML', 'YAML', 'YML'].includes(typeUpper)) {
      icon = '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-settings"/></svg>'; badgeClass = 'badge-subtle'; group = 'other';
    }

    const isOnlyOfficeSupported = ['DOCX', 'DOC', 'ODT', 'RTF', 'TXT', 'MD', 'XLSX', 'XLS', 'ODS', 'CSV', 'TSV', 'PPTX', 'PPT', 'ODP', 'PDF'].includes(typeUpper);
    const isImage = group === 'image';
    const isArchive = group === 'archive';

    return { typeUpper, icon, badgeClass, group, isOnlyOfficeSupported, isImage, isArchive };
  }

  function getBreadcrumbs(folders, folderId) {
    const map = new Map(folders.map(f => [Number(f.id), f]));
    const chain = [];
    let cursor = folderId ? map.get(Number(folderId)) : null;
    const visited = new Set();
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      chain.unshift(cursor);
      cursor = cursor.parent_id ? map.get(Number(cursor.parent_id)) : null;
    }
    return chain;
  }

  function updateHeaderAndActions() {
    if (isEditorActive()) {
      restoreEditorHeaderAndActions();
      return;
    }

    AppState.setHeader('Хранилище документов', 'Корпоративный диск с вложенными папками, умным поиском и ONLYOFFICE Live');
    AppState.setTopBarActions('');
  }

  function closeAllMenus() {
    document.querySelectorAll('.drive-create-menu, .drive-kebab-menu').forEach(el => el.classList.add('hidden'));
  }

  function bindGlobalOutsideClick() {
    if (outsideClickBound) return;
    outsideClickBound = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.drive-create-wrapper') && !e.target.closest('.drive-kebab-wrapper')) {
        closeAllMenus();
      }
    });
  }

  function buildFolderPathLabel(folder, folderMap) {
    const parts = [];
    let cur = folder;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parent_id ? folderMap.get(Number(cur.parent_id)) : null;
    }
    return parts.join(' / ');
  }

  async function render(containerEl) {
    if (!containerEl) return;
    bindGlobalOutsideClick();
    updateHeaderAndActions();

    containerEl.innerHTML = `
      <div class="drive-layout">
        <div class="skeleton-card" style="width: 244px; flex-shrink: 0; height: 340px;"></div>
        <div style="flex: 1; min-width: 0;">
          <div class="skeleton" style="height: 82px; margin-bottom: 14px; border-radius: 14px;"></div>
          <div class="skeleton" style="height: 260px; border-radius: 14px;"></div>
        </div>
      </div>
    `;

    try {
      const [documents, foldersList] = await Promise.all([
        API.getDocuments(),
        API.getDocumentFolders().catch(() => [])
      ]);

      cachedDocuments = Array.isArray(documents) ? documents : [];
      cachedFolders = Array.isArray(foldersList) ? foldersList : [];

      renderDriveUI(containerEl);
    } catch (err) {
      containerEl.innerHTML = `<div class="form-error">Ошибка загрузки Диска: ${AppState.escapeHtml(err.message)}</div>`;
    }
  }

  function renderDriveUI(containerEl) {
    const currentUser = AppState.getCurrentUser();
    const currentUserId = currentUser ? parseInt(currentUser.id, 10) : 0;
    const folderMap = new Map(cachedFolders.map(f => [Number(f.id), f]));

    // Сбрасываем currentFolderId, если папку удалили
    if (currentFolderId !== null && !folderMap.has(Number(currentFolderId))) {
      currentFolderId = null;
    }

    // Счётчики для разделов слева
    let myCount = 0;
    let sharedCount = 0;
    let publicCount = 0;
    const folderFileCounts = new Map();

    cachedDocuments.forEach(d => {
      if (parseInt(d.created_by, 10) === currentUserId) myCount++;
      else sharedCount++;
      if (d.is_public) publicCount++;
      const fid = d.folder_id ? Number(d.folder_id) : null;
      if (fid) folderFileCounts.set(fid, (folderFileCounts.get(fid) || 0) + 1);
    });

    const rootFolders = cachedFolders.filter(f => !f.parent_id);

    // Дочерние папки для отображения в текущей директории (только в режиме 'drive')
    const childFolders = activeSection === 'drive'
      ? cachedFolders.filter(f => (currentFolderId === null ? !f.parent_id : Number(f.parent_id) === Number(currentFolderId)))
      : [];

    // Фильтрация документов
    let visibleDocs = cachedDocuments.filter(d => {
      if (activeSection === 'my') {
        if (parseInt(d.created_by, 10) !== currentUserId) return false;
      } else if (activeSection === 'shared') {
        if (parseInt(d.created_by, 10) === currentUserId) return false;
      } else if (activeSection === 'public') {
        if (!d.is_public) return false;
      } else if (activeSection === 'drive') {
        const docFolderId = d.folder_id ? Number(d.folder_id) : null;
        if (currentFolderId === null) {
          if (docFolderId !== null) return false;
        } else if (docFolderId !== Number(currentFolderId)) {
          return false;
        }
      }

      if (typeFilter !== 'all') {
        const vis = getFileVisual(d.file_type);
        if (vis.group !== typeFilter) return false;
      }

      if (docSearchQuery && docSearchQuery.trim().length === 1) {
        const q = docSearchQuery.trim().toLowerCase();
        const hay = `${d.title || ''} ${d.file_name || ''} ${d.author_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    // Сортировка
    visibleDocs = [...visibleDocs].sort((a, b) => {
      if (sortBy === 'name_asc') {
        return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
      }
      if (sortBy === 'size_desc') {
        return (Number(b.file_size) || 0) - (Number(a.file_size) || 0);
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    if (activeSection === 'recent') {
      visibleDocs = visibleDocs.slice(0, 25);
    }

    const breadcrumbs = activeSection === 'drive' ? getBreadcrumbs(cachedFolders, currentFolderId) : [];
    const sectionTitles = {
      drive: `${dfIcon('home', 15)} Мой диск`,
      my: `${dfIcon('star', 15)} Мои файлы`,
      shared: `${dfIcon('users', 15)} Доступные мне`,
      public: `${dfIcon('globe', 15)} Общедоступные`,
      recent: `${dfIcon('clock', 15)} Недавние`
    };

    containerEl.innerHTML = `
      <div class="drive-layout">
        <!-- ЛЕВАЯ ПАНЕЛЬ ДИСКА -->
        <aside class="drive-sidebar card">
          <div class="drive-create-wrapper">
            <button type="button" id="btn-drive-new-menu" class="btn btn-primary drive-create-btn">
              <span style="font-size: 16px;">＋</span>
              <span>Создать</span>
            </button>
            <div id="drive-create-menu" class="drive-create-menu hidden">
              <button type="button" class="drive-menu-item" data-create-action="folder"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-folder'/></svg> Новая папка</button>
              <button type="button" class="drive-menu-item" data-create-action="upload"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-upload'/></svg> Загрузить файл</button>
              <div class="drive-menu-divider"></div>
              <button type="button" class="drive-menu-item" data-create-action="docx"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-file-edit'/></svg> Документ Word (.docx)</button>
              <button type="button" class="drive-menu-item" data-create-action="xlsx"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-bar-chart'/></svg> Таблица Excel (.xlsx)</button>
              <button type="button" class="drive-menu-item" data-create-action="pptx"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-video'/></svg> Презентация (.pptx)</button>
            </div>
          </div>

          <div class="drive-nav-group">
            <div class="drive-nav-item ${activeSection === 'drive' && currentFolderId === null ? 'active' : ''}" data-section="drive">
              <span class="drive-nav-label"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-home'/></svg> Мой диск</span>
              <span class="badge badge-subtle" style="font-size: 10.5px;">${cachedDocuments.length}</span>
            </div>
            <div class="drive-nav-item ${activeSection === 'recent' ? 'active' : ''}" data-section="recent">
              <span class="drive-nav-label"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-clock'/></svg> Недавние</span>
            </div>
            <div class="drive-nav-item ${activeSection === 'my' ? 'active' : ''}" data-section="my">
              <span class="drive-nav-label"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-star'/></svg> Мои файлы</span>
              <span class="badge badge-subtle" style="font-size: 10.5px;">${myCount}</span>
            </div>
            <div class="drive-nav-item ${activeSection === 'shared' ? 'active' : ''}" data-section="shared">
              <span class="drive-nav-label"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-users'/></svg> Доступные мне</span>
              <span class="badge badge-subtle" style="font-size: 10.5px;">${sharedCount}</span>
            </div>
            <div class="drive-nav-item ${activeSection === 'public' ? 'active' : ''}" data-section="public">
              <span class="drive-nav-label"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-globe'/></svg> Общедоступные</span>
              <span class="badge badge-subtle" style="font-size: 10.5px;">${publicCount}</span>
            </div>
          </div>

          <div class="drive-sidebar-folders-tree">
            <div class="drive-section-heading">
              <span>Папки</span>
              <button type="button" id="btn-sidebar-new-folder" class="btn btn-secondary btn-sm" style="padding: 1px 7px; font-size: 11px;" title="Создать папку">＋</button>
            </div>
            <div style="display: flex; flex-direction: column; gap: 2px; max-height: 290px; overflow-y: auto; margin-top: 4px;">
              ${rootFolders.map(f => `
                <div class="drive-nav-item ${activeSection === 'drive' && Number(currentFolderId) === Number(f.id) ? 'active' : ''}" data-open-folder="${f.id}">
                  <span class="drive-nav-label"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-folder-open'/></svg> ${AppState.escapeHtml(f.name)}</span>
                  <span class="badge badge-subtle" style="font-size: 10px;">${folderFileCounts.get(Number(f.id)) || 0}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </aside>

        <!-- ОСНОВНАЯ ОБЛАСТЬ ДИСКА -->
        <div class="drive-main" id="drive-drop-zone">
          <div class="drive-drop-banner"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-inbox'/></svg> Отпустите файлы, чтобы загрузить их в текущую папку</div>

          <!-- ВЕРХНЯЯ ПАНЕЛЬ: УМНЫЙ ПОИСК + ХЛЕБНЫЕ КРОШКИ + ВИД -->
          <div class="drive-toolbar card">
            <div class="drive-search-bar">
              <span style="font-size: 15px; opacity: 0.85;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-sparkles'/></svg></span>
              <input type="text" id="doc-search-input" placeholder="Умный поиск на Диске (Ctrl+K)..." value="${AppState.escapeHtml(docSearchQuery)}" autocomplete="off">
              <button type="button" id="doc-search-clear-btn" class="btn btn-secondary btn-sm" style="${docSearchQuery ? '' : 'display: none;'} padding: 3px 9px; font-size: 11.5px;">✕</button>
              <span id="doc-search-count" style="font-size: 11.5px; color: var(--text-muted); white-space: nowrap;">
                ${docSearchQuery.trim().length >= 2 ? 'Поиск...' : `Файлов: ${visibleDocs.length}`}
              </span>
            </div>

            <div class="drive-controls-row">
              <div class="drive-breadcrumbs">
                ${activeSection === 'drive' ? `
                  <button type="button" class="drive-crumb-btn ${currentFolderId === null ? 'active' : ''}" data-crumb-id=""><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-home"/></svg> Мой диск</button>
                  ${breadcrumbs.map((b, idx) => `
                    <span class="drive-crumb-sep">›</span>
                    <button type="button" class="drive-crumb-btn ${idx === breadcrumbs.length - 1 ? 'active' : ''}" data-crumb-id="${b.id}">
                      <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder-open"/></svg> ${AppState.escapeHtml(b.name)}
                    </button>
                  `).join('')}
                ` : `
                  <span class="drive-crumb-btn active" style="cursor: default;">${sectionTitles[activeSection] || 'Документы'}</span>
                `}
              </div>

              <div class="drive-filter-group">
                <select id="drive-type-filter" class="drive-select" title="Фильтр по типу файла">
                  <option value="all" ${typeFilter === 'all' ? 'selected' : ''}>Все типы</option>
                  <option value="word" ${typeFilter === 'word' ? 'selected' : ''}>Документы</option>
                  <option value="sheet" ${typeFilter === 'sheet' ? 'selected' : ''}>Таблицы</option>
                  <option value="slide" ${typeFilter === 'slide' ? 'selected' : ''}>Презентации</option>
                  <option value="pdf" ${typeFilter === 'pdf' ? 'selected' : ''}>PDF</option>
                  <option value="image" ${typeFilter === 'image' ? 'selected' : ''}>Изображения</option>
                </select>

                <select id="drive-sort-select" class="drive-select" title="Сортировка">
                  <option value="updated_desc" ${sortBy === 'updated_desc' ? 'selected' : ''}>По дате</option>
                  <option value="name_asc" ${sortBy === 'name_asc' ? 'selected' : ''}>По имени</option>
                  <option value="size_desc" ${sortBy === 'size_desc' ? 'selected' : ''}>По размеру</option>
                </select>

                <div class="drive-view-toggle" role="group" aria-label="Переключатель вида">
                  <button type="button" class="drive-view-btn ${viewMode === 'list' ? 'active' : ''}" data-view-mode="list" title="Список">☰</button>
                  <button type="button" class="drive-view-btn ${viewMode === 'grid' ? 'active' : ''}" data-view-mode="grid" title="Сетка">⊞</button>
                </div>
              </div>
            </div>
          </div>

          <!-- КОНТЕНТ ДИСКА (ПАПКИ + ФАЙЛЫ ИЛИ РЕЗУЛЬТАТЫ УМНОГО ПОИСКА) -->
          <div id="drive-content-body">
            ${renderDriveItemsHtml(childFolders, visibleDocs, folderFileCounts, folderMap)}
          </div>

          <!-- ONLYOFFICE EMBEDDED VIEWER / EDITOR CONTAINER -->
          <div id="onlyoffice-editor-container" class="card hidden" style="margin-top: 12px; padding: 0; overflow: hidden; border: 1px solid var(--border-color); background: var(--bg-card); border-radius: var(--radius-md);">
            <div class="onlyoffice-header-bar">
              <div class="onlyoffice-header-left">
                <span style="font-size: 16px; flex-shrink: 0;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-file-text'/></svg></span>
                <span id="editing-doc-title" class="onlyoffice-doc-title" title="Документ">Документ</span>
                <span class="badge badge-active onlyoffice-live-badge">ONLYOFFICE Live</span>
              </div>
              <div class="onlyoffice-header-actions">
                <button class="btn btn-secondary btn-sm onlyoffice-action-btn" id="btn-save-editor" title="Принудительно сохранить документ на сервере">
                  <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-save"/></svg></span>
                  <span class="btn-label">Сохранить</span>
                </button>
                <button class="btn btn-secondary btn-sm onlyoffice-action-btn" id="btn-toggle-fullscreen" title="Полноэкранный режим">
                  <span>⛶</span>
                  <span class="btn-label">Во весь экран</span>
                </button>
                <button class="btn btn-secondary btn-sm onlyoffice-action-btn" id="btn-open-new-tab" title="Открыть в новой вкладке">
                  <span>↗</span>
                  <span class="btn-label">В новой вкладке</span>
                </button>
                <button class="btn btn-secondary btn-sm onlyoffice-action-btn btn-close-editor-style" id="btn-close-editor" title="Закрыть редактор">
                  <span>✕</span>
                  <span class="btn-label">Закрыть</span>
                </button>
              </div>
            </div>
            <div id="onlyoffice-wrapper" class="onlyoffice-wrapper" style="height: 720px; width: 100%; position: relative;">
              <div id="onlyoffice-placeholder"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    bindDriveEvents(containerEl);

    if (docSearchQuery && docSearchQuery.trim().length >= 2) {
      executeSmartSearch(containerEl);
    }
  }

  function renderDriveItemsHtml(childFolders, visibleDocs, folderFileCounts, folderMap) {
    let html = '';

    if (childFolders.length > 0) {
      html += `
        <div style="margin-bottom: 14px;">
          <div class="drive-block-title">Папки (${childFolders.length})</div>
          <div class="drive-folders-grid">
            ${childFolders.map(f => {
              const subCount = cachedFolders.filter(sf => Number(sf.parent_id) === Number(f.id)).length;
              const docsInFolder = folderFileCounts.get(Number(f.id)) || 0;
              return `
                <div class="card drive-folder-chip" data-folder-id="${f.id}">
                  <div class="drive-folder-chip-main">
                    <span style="font-size: 20px; flex-shrink: 0;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-folder'/></svg></span>
                    <div style="min-width: 0; flex: 1;">
                      <div class="drive-folder-name" title="${AppState.escapeHtml(f.name)}">${AppState.escapeHtml(f.name)}</div>
                      <div class="drive-folder-count">${docsInFolder} ф.${subCount > 0 ? ` • ${subCount} пап.` : ''}</div>
                    </div>
                  </div>
                  <div class="drive-kebab-wrapper">
                    <button type="button" class="btn btn-secondary btn-sm drive-kebab-trigger" data-kebab-folder="${f.id}" style="padding: 3px 7px; font-size: 13px;" title="Действия с папкой">⋮</button>
                    <div class="drive-kebab-menu hidden">
                      <button type="button" class="drive-menu-item folder-rename-btn" data-folder-id="${f.id}"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg> Переименовать</button>
                      <button type="button" class="drive-menu-item folder-delete-btn" data-folder-id="${f.id}" style="color: var(--danger);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-trash'/></svg> Удалить папку</button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    let isQuickRecentFallback = false;
    let displayDocs = visibleDocs;

    // В корне "Мой диск", если корневых файлов нет, показываем недавние файлы как в Google Диске
    if (displayDocs.length === 0 && activeSection === 'drive' && currentFolderId === null && !docSearchQuery && cachedDocuments.length > 0) {
      isQuickRecentFallback = true;
      displayDocs = [...cachedDocuments]
        .filter(d => typeFilter === 'all' || getFileVisual(d.file_type).group === typeFilter)
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 8);
    }

    if (displayDocs.length === 0) {
      if (childFolders.length === 0) {
        html += `
          <div class="card" style="text-align: center; padding: 42px 20px;">
            <div style="font-size: 40px; margin-bottom: 10px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-folder-open'/></svg></div>
            <h3 style="font-size: 16px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">Папка пуста</h3>
            <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 18px;">Создайте новый документ, добавьте подпапку или перетащите файлы мышкой прямо сюда.</p>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
              <button type="button" class="btn btn-primary" id="btn-empty-create-doc">+ Создать документ</button>
              <button type="button" class="btn btn-secondary" id="btn-empty-upload-doc"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-upload'/></svg> Загрузить файл</button>
              ${activeSection === 'drive' ? `<button type="button" class="btn btn-secondary" id="btn-empty-create-folder"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder"/></svg> Новая папка</button>` : ''}
            </div>
          </div>
        `;
      } else {
        html += `<div style="font-size: 12.5px; color: var(--text-muted); padding: 8px 4px;">В этой папке пока нет файлов.</div>`;
      }
      return html;
    }

    html += `<div class="drive-block-title">${isQuickRecentFallback ? `Быстрый доступ — недавние файлы (${displayDocs.length})` : `Файлы (${displayDocs.length})`}</div>`;

    const pg = AppState.paginate(displayDocs, docPage, docPageSize);
    docPage = pg.page;

    if (viewMode === 'list') {
      html += `
        <div class="card drive-table-card">
          <table class="drive-table">
            <thead>
              <tr>
                <th>Название</th>
                <th class="drive-col-hide-sm">Владелец</th>
                <th class="drive-col-hide-xs">Изменён</th>
                <th class="drive-col-hide-sm">Размер</th>
                <th style="text-align: right;">Действия</th>
              </tr>
            </thead>
            <tbody>
              ${pg.items.map(d => renderFileRowHtml(d, folderMap)).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else {
      html += `
        <div class="drive-grid">
          ${pg.items.map(d => renderFileCardHtml(d)).join('')}
        </div>
      `;
    }

    html += AppState.renderPaginationHtml(pg, { pageSizeOptions: [15, 30, 50] });

    return html;
  }

  function renderAccessTag(doc) {
    if (doc.is_public) return `<span class="badge badge-public" style="font-size: 10px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-globe"/></svg> Общий</span>`;
    if (doc.user_access_level === 'EDIT') return `<span class="badge badge-primary" style="font-size: 10px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-pencil"/></svg> Ред.</span>`;
    if (doc.user_access_level === 'VIEW') return `<span class="badge badge-subtle" style="font-size: 10px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-eye"/></svg> Чтение</span>`;
    return '';
  }

  function renderDocKebabMenuHtml(d, vis) {
    const newTabUrl = vis.isOnlyOfficeSupported ? `/editor.html?id=${d.id}` : API.downloadDocumentUrl(d.id);
    return `
      <div class="drive-kebab-menu hidden">
        <a href="${newTabUrl}" target="_blank" class="drive-menu-item" style="text-decoration: none;" onclick="event.stopPropagation();">↗ Открыть в новой вкладке</a>
        <a href="${API.downloadDocumentUrl(d.id)}" download class="drive-menu-item" style="text-decoration: none;" onclick="event.stopPropagation();"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-inbox'/></svg> Скачать файл</a>
        ${(d.can_manage_access || d.user_access_level === 'EDIT') ? `
          <div class="drive-menu-divider"></div>
          <button type="button" class="drive-menu-item edit-doc-btn" data-id="${d.id}"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg> Свойства / Переместить</button>
        ` : ''}
        ${d.can_manage_access ? `
          <button type="button" class="drive-menu-item manage-permissions-btn" data-id="${d.id}"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-lock'/></svg> Настроить доступ</button>
          <button type="button" class="drive-menu-item delete-doc-btn" data-id="${d.id}" style="color: var(--danger);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-trash'/></svg> Удалить</button>
        ` : ''}
      </div>
    `;
  }

  function renderFileRowHtml(d, folderMap) {
    const vis = getFileVisual(d.file_type);
    const folderLabel = d.folder_id && folderMap.get(Number(d.folder_id))
      ? folderMap.get(Number(d.folder_id)).name
      : (d.category || '');
    return `
      <tr class="drive-file-row" data-id="${d.id}" data-type="${vis.typeUpper}">
        <td>
          <div class="drive-file-name-cell">
            <span style="font-size: 18px; flex-shrink: 0;">${vis.icon}</span>
            <div style="min-width: 0;">
              <div class="drive-file-title-text" title="${AppState.escapeHtml(d.title)}">${AppState.escapeHtml(d.title)}</div>
              <div style="display: flex; gap: 5px; align-items: center; margin-top: 2px; flex-wrap: wrap;">
                <span class="badge ${vis.badgeClass}" style="font-size: 9.5px; padding: 1px 6px;">${vis.typeUpper}</span>
                ${renderAccessTag(d)}
                ${activeSection !== 'drive' && folderLabel ? `<span class="badge badge-subtle" style="font-size: 9.5px; padding: 1px 6px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder-open"/></svg> ${AppState.escapeHtml(folderLabel)}</span>` : ''}
              </div>
            </div>
          </div>
        </td>
        <td class="drive-col-hide-sm" style="color: var(--text-muted);">${AppState.escapeHtml(d.author_name || 'Не указан')}</td>
        <td class="drive-col-hide-xs" style="color: var(--text-muted); white-space: nowrap;">${new Date(d.updated_at).toLocaleDateString('ru-RU')}</td>
        <td class="drive-col-hide-sm" style="color: var(--text-muted); white-space: nowrap;">${formatBytes(d.file_size)}</td>
        <td style="text-align: right;" onclick="event.stopPropagation();">
          <div class="drive-row-actions">
            <button type="button" class="btn btn-secondary btn-sm open-onlyoffice-btn" data-id="${d.id}" data-type="${vis.typeUpper}" style="padding: 4px 10px; font-size: 12px;">
              ${vis.isArchive ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-inbox"/></svg>' : 'Открыть'}
            </button>
            <div class="drive-kebab-wrapper">
              <button type="button" class="btn btn-secondary btn-sm drive-kebab-trigger" style="padding: 4px 8px;">⋮</button>
              ${renderDocKebabMenuHtml(d, vis)}
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  function renderFileCardHtml(d) {
    const vis = getFileVisual(d.file_type);
    return `
      <div class="card drive-file-card" data-id="${d.id}" data-type="${vis.typeUpper}">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
          <div style="display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1;">
            <span style="font-size: 16px;">${vis.icon}</span>
            <span class="drive-folder-name" title="${AppState.escapeHtml(d.title)}">${AppState.escapeHtml(d.title)}</span>
          </div>
          <div class="drive-kebab-wrapper" onclick="event.stopPropagation();">
            <button type="button" class="btn btn-secondary btn-sm drive-kebab-trigger" style="padding: 2px 7px;">⋮</button>
            ${renderDocKebabMenuHtml(d, vis)}
          </div>
        </div>

        <div class="drive-file-preview">
          <span style="font-size: 28px;">${vis.icon}</span>
          <span class="drive-file-preview-ext">${vis.typeUpper}</span>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: var(--text-muted);">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${AppState.escapeHtml(d.author_name || 'Автор')}</span>
          <span>${new Date(d.updated_at).toLocaleDateString('ru-RU')}</span>
        </div>
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          ${renderAccessTag(d)}
          <span class="badge badge-subtle" style="font-size: 10px;">${formatBytes(d.file_size)}</span>
        </div>
      </div>
    `;
  }

  function openDocumentAction(docId, typeUpper) {
    const doc = cachedDocuments.find(d => d.id === docId);
    const t = (typeUpper || doc?.file_type || '').toUpperCase();
    if (['PNG', 'JPG', 'JPEG', 'GIF', 'WEBP', 'SVG'].includes(t)) {
      if (doc) openImagePreviewModal(doc);
    } else if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(t)) {
      window.location.href = API.downloadDocumentUrl(docId);
    } else {
      openOnlyofficeEditor(docId);
    }
  }

  async function executeSmartSearch(containerEl) {
    const q = (docSearchQuery || '').trim();
    const contentBody = containerEl.querySelector('#drive-content-body');
    const searchCountEl = containerEl.querySelector('#doc-search-count');
    if (!contentBody) return;

    if (searchCountEl) searchCountEl.textContent = 'Умный поиск...';

    try {
      const folderName = currentFolderId
        ? (cachedFolders.find(f => Number(f.id) === Number(currentFolderId))?.name || '')
        : '';
      const results = await API.searchDocuments(q, { category: activeSection === 'drive' ? folderName : '', limit: 20 });

      if (searchCountEl) searchCountEl.textContent = `Найдено: ${results.length}`;

      if (results.length === 0) {
        contentBody.innerHTML = `
          <div class="card" style="text-align: center; padding: 40px;">
            <div style="font-size: 36px; margin-bottom: 10px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-search'/></svg></div>
            <h3 style="font-size: 15px; font-weight: 600; margin-bottom: 6px;">Ничего не найдено</h3>
            <p style="color: var(--text-muted); font-size: 13px;">По запросу «${AppState.escapeHtml(q)}» совпадений по названию и содержимому не найдено.</p>
          </div>
        `;
        return;
      }

      const renderSearchResultsPage = () => {
        const pg = AppState.paginate(results, searchPage, searchPageSize);
        searchPage = pg.page;

        contentBody.innerHTML = `
          <div class="drive-block-title">Результаты умного поиска (${results.length})</div>
          <div class="grid-3">
            ${pg.items.map(d => {
              const vis = getFileVisual(d.file_type);
              let matchBadge = `<span class="badge badge-primary" style="font-size: 10px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-file-text"/></svg> В тексте</span>`;
              if (d.matchType === 'semantic') matchBadge = `<span class="badge badge-active" style="font-size: 10px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-bot"/></svg> По смыслу</span>`;
              else if (d.matchType === 'hybrid') matchBadge = `<span class="badge badge-active" style="font-size: 10px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-zap"/></svg> Гибридно</span>`;

              return `
                <div class="card doc-card" data-id="${d.id}">
                  <div class="doc-card-header">
                    <div class="doc-card-title-row">
                      <span class="doc-card-icon">${vis.icon}</span>
                      <span class="doc-card-title" title="${AppState.escapeHtml(d.title)}">${AppState.escapeHtml(d.title)}</span>
                    </div>
                    <span class="badge ${vis.badgeClass} doc-card-badge">${vis.typeUpper}</span>
                  </div>
                  <div class="doc-card-badges">
                    ${matchBadge}
                    <span class="badge badge-subtle" style="font-size: 10.5px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder-open"/></svg> ${AppState.escapeHtml(d.category || 'Общие')}</span>
                  </div>
                  ${d.snippet ? `<div class="search-result-snippet">${d.snippet}</div>` : ''}
                  <div class="doc-card-primary-actions" style="margin-top: auto;">
                    <button type="button" class="btn btn-primary open-onlyoffice-btn" data-id="${d.id}" data-type="${vis.typeUpper}">
                      <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-eye"/></svg> Открыть
                    </button>
                    <a href="${API.downloadDocumentUrl(d.id)}" download class="btn btn-secondary doc-card-btn-icon" title="Скачать"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-inbox'/></svg></a>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          ${AppState.renderPaginationHtml(pg, { pageSizeOptions: [12, 24, 48] })}
        `;

        AppState.bindPaginationEvents(contentBody, {
          onPageChange: (p) => { searchPage = p; renderSearchResultsPage(); },
          onPageSizeChange: (sz) => { searchPageSize = sz; searchPage = 1; renderSearchResultsPage(); }
        });
        bindItemActions(containerEl);
      };

      renderSearchResultsPage();
    } catch (err) {
      if (searchCountEl) searchCountEl.textContent = 'Ошибка поиска';
    }
  }

  function bindDriveEvents(containerEl) {
    // Кнопка "+ Создать" в сайдбаре Диска
    const newBtn = containerEl.querySelector('#btn-drive-new-menu');
    const newMenu = containerEl.querySelector('#drive-create-menu');
    newBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasHidden = newMenu?.classList.contains('hidden');
      closeAllMenus();
      if (wasHidden) newMenu?.classList.remove('hidden');
    });

    containerEl.querySelectorAll('[data-create-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeAllMenus();
        const act = btn.getAttribute('data-create-action');
        if (act === 'folder') openNewFolderModal(containerEl);
        else if (act === 'upload') openUploadDocModal();
        else openCreateDocModal(act);
      });
    });

    containerEl.querySelector('#btn-sidebar-new-folder')?.addEventListener('click', () => {
      openNewFolderModal(containerEl);
    });

    // Переключение разделов слева
    containerEl.querySelectorAll('.drive-nav-item[data-section]').forEach(item => {
      item.addEventListener('click', () => {
        activeSection = item.getAttribute('data-section');
        if (activeSection === 'drive') currentFolderId = null;
        docPage = 1;
        renderDriveUI(containerEl);
      });
    });

    // Открытие папки из левого дерева
    containerEl.querySelectorAll('.drive-nav-item[data-open-folder]').forEach(item => {
      item.addEventListener('click', () => {
        activeSection = 'drive';
        currentFolderId = parseInt(item.getAttribute('data-open-folder'), 10);
        docPage = 1;
        renderDriveUI(containerEl);
      });
    });

    // Хлебные крошки
    containerEl.querySelectorAll('.drive-crumb-btn[data-crumb-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const raw = btn.getAttribute('data-crumb-id');
        activeSection = 'drive';
        currentFolderId = raw ? parseInt(raw, 10) : null;
        docPage = 1;
        renderDriveUI(containerEl);
      });
    });

    // Фильтры, сортировка, вид
    containerEl.querySelector('#drive-type-filter')?.addEventListener('change', (e) => {
      typeFilter = e.target.value;
      docPage = 1;
      renderDriveUI(containerEl);
    });
    containerEl.querySelector('#drive-sort-select')?.addEventListener('change', (e) => {
      sortBy = e.target.value;
      docPage = 1;
      renderDriveUI(containerEl);
    });
    containerEl.querySelectorAll('.drive-view-btn[data-view-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        viewMode = btn.getAttribute('data-view-mode');
        localStorage.setItem('docflow_drive_view', viewMode);
        renderDriveUI(containerEl);
      });
    });

    AppState.bindPaginationEvents(containerEl.querySelector('#drive-content-body'), {
      onPageChange: (p) => { docPage = p; renderDriveUI(containerEl); },
      onPageSizeChange: (sz) => { docPageSize = sz; docPage = 1; renderDriveUI(containerEl); }
    });

    // Поиск (локальная фильтрация + гибридный RAG при 2+ символах)
    const searchInput = containerEl.querySelector('#doc-search-input');
    const clearSearchBtn = containerEl.querySelector('#doc-search-clear-btn');
    let searchTimer = null;

    searchInput?.addEventListener('input', (e) => {
      docSearchQuery = e.target.value;
      docPage = 1;
      searchPage = 1;
      if (clearSearchBtn) clearSearchBtn.style.display = docSearchQuery ? 'inline-flex' : 'none';
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const q = (docSearchQuery || '').trim();
        if (!q) {
          renderDriveUI(containerEl);
        } else if (q.length >= 2) {
          executeSmartSearch(containerEl);
        } else {
          renderDriveUI(containerEl);
        }
      }, 240);
    });

    clearSearchBtn?.addEventListener('click', () => {
      docSearchQuery = '';
      docPage = 1;
      searchPage = 1;
      renderDriveUI(containerEl);
    });

    // Drag & Drop загрузка файлов в текущую папку
    const dropZone = containerEl.querySelector('#drive-drop-zone');
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
      dropZone.addEventListener('dragleave', (e) => {
        if (!dropZone.contains(e.relatedTarget)) {
          dropZone.classList.remove('drag-over');
        }
      });
      dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;

        let uploaded = 0;
        for (const file of Array.from(files)) {
          const fd = new FormData();
          fd.append('file', file);
          fd.append('title', file.name);
          if (currentFolderId) {
            fd.append('folder_id', String(currentFolderId));
          } else {
            fd.append('folder_id', '');
          }
          try {
            await API.uploadDocument(fd);
            uploaded++;
          } catch (err) {
            AppState.showAlert(`Не удалось загрузить ${file.name}: ${err.message}`, 'error');
          }
        }
        if (uploaded > 0) {
          AppState.showAlert(`Загружено файлов: ${uploaded}`, 'success');
          render(containerEl);
        }
      });
    }

    // Пустое состояние
    containerEl.querySelector('#btn-empty-create-doc')?.addEventListener('click', () => openCreateDocModal());
    containerEl.querySelector('#btn-empty-upload-doc')?.addEventListener('click', () => openUploadDocModal());
    containerEl.querySelector('#btn-empty-create-folder')?.addEventListener('click', () => openNewFolderModal(containerEl));

    // Вход в папки
    containerEl.querySelectorAll('.drive-folder-chip').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.drive-kebab-wrapper')) return;
        activeSection = 'drive';
        currentFolderId = parseInt(card.getAttribute('data-folder-id'), 10);
        renderDriveUI(containerEl);
      });
    });

    // Переименование и удаление папок
    containerEl.querySelectorAll('.folder-rename-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllMenus();
        const fid = parseInt(btn.getAttribute('data-folder-id'), 10);
        const folder = cachedFolders.find(f => Number(f.id) === fid);
        if (folder) openRenameFolderModal(folder, containerEl);
      });
    });

    containerEl.querySelectorAll('.folder-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllMenus();
        const fid = parseInt(btn.getAttribute('data-folder-id'), 10);
        const folder = cachedFolders.find(f => Number(f.id) === fid);
        if (!folder) return;
        AppState.showConfirmModal({
          title: 'Удаление папки',
          message: `Удалить папку «${folder.name}»? Документы и подпапки внутри не потеряются и будут перенесены уровнем выше.`,
          confirmText: 'Удалить папку',
          cancelText: 'Отмена',
          onConfirm: async () => {
            try {
              const res = await API.deleteDocumentFolder(fid);
              AppState.showAlert(res.message || 'Папка удалена', 'success');
              render(containerEl);
            } catch (err) {
              alert('Ошибка удаления папки: ' + err.message);
            }
          }
        });
      });
    });

    // Выпадающие меню ⋮
    containerEl.querySelectorAll('.drive-kebab-trigger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = btn.parentElement?.querySelector('.drive-kebab-menu');
        const wasHidden = menu?.classList.contains('hidden');
        closeAllMenus();
        if (wasHidden) menu?.classList.remove('hidden');
      });
    });

    bindItemActions(containerEl);

    // Контролы редактора ONLYOFFICE
    containerEl.querySelector('#btn-close-editor')?.addEventListener('click', requestCloseEditor);
    containerEl.querySelector('#btn-save-editor')?.addEventListener('click', handleManualSave);
    containerEl.querySelector('#btn-open-new-tab')?.addEventListener('click', () => {
      if (currentEditorDocId) window.open(`/editor.html?id=${currentEditorDocId}`, '_blank');
    });
    containerEl.querySelector('#btn-toggle-fullscreen')?.addEventListener('click', () => {
      const container = document.getElementById('onlyoffice-editor-container');
      if (!container) return;
      isFullscreenActive = !isFullscreenActive;
      if (isFullscreenActive) {
        container.classList.add('onlyoffice-fullscreen-overlay');
        document.body.style.overflow = 'hidden';
      } else {
        container.classList.remove('onlyoffice-fullscreen-overlay', 'active-mobile-fullscreen');
        document.body.style.overflow = '';
      }
    });
  }

  function bindItemActions(containerEl) {
    containerEl.querySelectorAll('.drive-file-row, .drive-file-card').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.drive-kebab-wrapper') || e.target.closest('button') || e.target.closest('a')) return;
        const id = parseInt(el.getAttribute('data-id'), 10);
        const type = el.getAttribute('data-type');
        openDocumentAction(id, type);
      });
    });

    containerEl.querySelectorAll('.open-onlyoffice-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const type = btn.getAttribute('data-type');
        openDocumentAction(id, type);
      });
    });

    containerEl.querySelectorAll('.manage-permissions-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllMenus();
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const doc = cachedDocuments.find(d => d.id === id);
        if (doc) openPermissionsModal(doc, containerEl);
      });
    });

    containerEl.querySelectorAll('.edit-doc-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllMenus();
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const doc = cachedDocuments.find(d => d.id === id);
        if (doc) openEditDocModal(doc, containerEl);
      });
    });

    containerEl.querySelectorAll('.delete-doc-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllMenus();
        const id = parseInt(btn.getAttribute('data-id'), 10);
        AppState.showConfirmModal({
          title: 'Удаление документа',
          message: 'Вы уверены, что хотите безвозвратно удалить этот документ из хранилища и MinIO?',
          confirmText: 'Удалить документ',
          cancelText: 'Отмена',
          onConfirm: async () => {
            try {
              await API.deleteDocument(id);
              AppState.showAlert('Документ удален', 'success');
              render(containerEl);
            } catch (err) {
              alert('Ошибка при удалении: ' + err.message);
            }
          }
        });
      });
    });
  }

  function openNewFolderModal(containerEl) {
    const parentFolder = currentFolderId ? cachedFolders.find(f => Number(f.id) === Number(currentFolderId)) : null;
    AppState.setModalTitle('Новая папка');
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <form id="new-folder-form">
        <div class="form-group">
          <label>Расположение</label>
          <input type="text" disabled value="${parentFolder ? AppState.escapeHtml(parentFolder.name) : 'Мой диск (корень)'}">
        </div>
        <div class="form-group">
          <label>Название папки *</label>
          <input type="text" id="new-folder-name" required placeholder="Например: Счета 2026" autocomplete="off">
        </div>
        <button type="submit" class="btn btn-primary btn-block">+ Создать папку</button>
      </form>
    `;
    AppState.openModal(null, null, 'sm');
    setTimeout(() => document.getElementById('new-folder-name')?.focus(), 50);

    document.getElementById('new-folder-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('new-folder-name').value.trim();
      if (!name) return;
      try {
        await API.createDocumentFolder(name, currentFolderId);
        AppState.closeModal();
        AppState.showAlert(`Папка «${name}» создана`, 'success');
        render(containerEl);
      } catch (err) {
        alert('Ошибка создания папки: ' + err.message);
      }
    });
  }

  function openRenameFolderModal(folder, containerEl) {
    AppState.setModalTitle(`<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-pencil"/></svg> Переименовать папку`);
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <form id="rename-folder-form">
        <div class="form-group">
          <label>Новое название папки *</label>
          <input type="text" id="rename-folder-name" required value="${AppState.escapeHtml(folder.name)}" autocomplete="off">
        </div>
        <button type="submit" class="btn btn-primary btn-block"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-save'/></svg> Сохранить</button>
      </form>
    `;
    AppState.openModal(null, null, 'sm');
    setTimeout(() => document.getElementById('rename-folder-name')?.focus(), 50);

    document.getElementById('rename-folder-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('rename-folder-name').value.trim();
      if (!name) return;
      try {
        await API.updateDocumentFolder(folder.id, { name });
        AppState.closeModal();
        AppState.showAlert('Папка переименована', 'success');
        render(containerEl);
      } catch (err) {
        alert('Ошибка: ' + err.message);
      }
    });
  }

  function openImagePreviewModal(doc) {
    AppState.setModalTitle(AppState.escapeHtml(doc.title || 'Просмотр изображения'));
    const modalBody = document.getElementById('modal-body');
    const imgUrl = API.downloadDocumentUrl(doc.id);
    modalBody.innerHTML = `
      <div style="text-align: center; padding: 10px;">
        <div style="max-height: 70vh; overflow: auto; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.05); border-radius: 8px; padding: 10px; margin-bottom: 14px;">
          <img src="${imgUrl}" alt="${AppState.escapeHtml(doc.title)}" style="max-width: 100%; max-height: 65vh; object-fit: contain; border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.15);">
        </div>
        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <a href="${imgUrl}" download="${AppState.escapeHtml(doc.title)}" class="btn btn-primary"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-inbox'/></svg> Скачать оригинал</a>
          <a href="${imgUrl}" target="_blank" class="btn btn-secondary">↗ Открыть в новой вкладке</a>
        </div>
      </div>
    `;
    AppState.openModal(null, null, 'sm');
  }

  async function handleManualSave() {
    if (!currentEditorDocId) return;
    const saveBtn = document.getElementById('btn-save-editor');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clock"/></svg></span> <span class="btn-label">Сохранение...</span>';
    }
    try {
      await API.saveDocumentNow(currentEditorDocId);
      isDocModified = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.classList.remove('btn-primary');
        saveBtn.classList.add('btn-secondary');
        saveBtn.innerHTML = '<span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-check-circle"/></svg></span> <span class="btn-label">Сохранено</span>';
        setTimeout(() => {
          if (saveBtn && !isDocModified) saveBtn.innerHTML = '<span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-save"/></svg></span> <span class="btn-label">Сохранить</span>';
        }, 2500);
      }
      AppState.showAlert('Документ успешно сохранен на сервере!', 'success');
    } catch (err) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-alert-triangle"/></svg></span> <span class="btn-label">Ошибка</span>';
      }
      alert('Не удалось сохранить документ: ' + err.message);
    }
  }

  function requestCloseEditor() {
    if (!currentEditorDocId) {
      closeEditor();
      return;
    }

    if (isDocModified) {
      AppState.setModalTitle('Сохранение изменений');
      const modalBody = document.getElementById('modal-body');
      modalBody.innerHTML = `
        <div style="padding: 10px 0;">
          <p style="font-size: 14px; margin-bottom: 24px; line-height: 1.5; color: var(--text-main);">
            В документе есть несохранённые изменения.<br>
            Хотите сохранить внесённые правки перед закрытием редактора?
          </p>
          <div style="display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap;">
            <button type="button" id="btn-modal-cancel-close" class="btn btn-secondary">Отмена (остаться)</button>
            <button type="button" id="btn-modal-discard-close" class="btn btn-secondary" style="color: var(--danger);">Выйти без сохранения</button>
            <button type="button" id="btn-modal-save-and-close" class="btn btn-primary" style="font-weight: 600;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-save'/></svg> Сохранить и закрыть</button>
          </div>
        </div>
      `;
      AppState.openModal(null, null, 'sm');

      document.getElementById('btn-modal-cancel-close')?.addEventListener('click', () => AppState.closeModal());
      document.getElementById('btn-modal-discard-close')?.addEventListener('click', () => {
        isDocModified = false;
        AppState.closeModal();
        closeEditor();
      });
      document.getElementById('btn-modal-save-and-close')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-modal-save-and-close');
        if (btn) { btn.disabled = true; btn.textContent = 'Сохранение...'; }
        try {
          await API.saveDocumentNow(currentEditorDocId);
          isDocModified = false;
          AppState.closeModal();
          closeEditor();
          AppState.showAlert('Документ успешно сохранен!', 'success');
          const container = document.getElementById('view-panel-documents');
          if (container) render(container);
        } catch (err) {
          alert('Ошибка при сохранении документа: ' + err.message);
          if (btn) { btn.disabled = false; btn.textContent = 'Сохранить и закрыть'; }
        }
      });
      return;
    }

    closeEditor();
  }

  function closeEditor() {
    isDocModified = false;
    destroyActiveEditor();
    const container = document.getElementById('onlyoffice-editor-container');
    if (container) {
      container.classList.add('hidden');
      container.classList.remove('active-mobile-fullscreen', 'onlyoffice-fullscreen-overlay');
    }
    isFullscreenActive = false;
    currentEditorDocId = null;
    currentEditorConfig = null;
    document.body.style.overflow = '';
    updateHeaderAndActions();
  }

  function destroyActiveEditor() {
    if (loadedDocEditor) {
      try {
        const prevOnBeforeUnload = window.onbeforeunload;
        window.onbeforeunload = null;
        loadedDocEditor.destroyEditor();
        window.onbeforeunload = prevOnBeforeUnload;
      } catch (e) {
        console.warn('destroyActiveEditor warning:', e);
      }
      loadedDocEditor = null;
    }
  }

  function initDocsEditorInstance() {
    if (!currentEditorConfig) return;
    destroyActiveEditor();
    const wrapper = document.getElementById('onlyoffice-wrapper');
    if (wrapper) wrapper.innerHTML = '<div id="onlyoffice-placeholder"></div>';

    const editorType = isMobileEditorMode ? 'mobile' : 'desktop';
    try {
      loadedDocEditor = new DocsAPI.DocEditor('onlyoffice-placeholder', {
        type: editorType,
        documentType: currentEditorConfig.documentType,
        document: currentEditorConfig.document,
        editorConfig: {
          ...currentEditorConfig.editorConfig,
          customization: {
            ...(currentEditorConfig.editorConfig?.customization || {}),
            compactHeader: true,
            compactToolbar: isMobileEditorMode
          }
        },
        events: {
          onDocumentStateChange: function(event) {
            isDocModified = Boolean(event.data);
            const saveBtn = document.getElementById('btn-save-editor');
            if (saveBtn) {
              if (isDocModified) {
                saveBtn.classList.remove('btn-secondary');
                saveBtn.classList.add('btn-primary');
                saveBtn.innerHTML = '<span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-save"/></svg></span> <span class="btn-label">Сохранить *</span>';
              } else {
                saveBtn.classList.remove('btn-primary');
                saveBtn.classList.add('btn-secondary');
                saveBtn.innerHTML = '<span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-save"/></svg></span> <span class="btn-label">Сохранить</span>';
              }
            }
          },
          onRequestClose: () => requestCloseEditor(),
          onError: (event) => {
            console.warn('[DocsAPI Error]:', event);
            if (event?.data?.errorCode === -5 || event?.data === -5 || (event?.data?.errorDescription && /version/i.test(event.data.errorDescription))) {
              setTimeout(() => { if (currentEditorDocId) openOnlyofficeEditor(currentEditorDocId); }, 600);
            }
          }
        },
        height: '100%',
        width: '100%'
      });
    } catch (err) {
      console.error('Failed to initialize DocEditor:', err);
    }
  }

  async function openOnlyofficeEditor(docId) {
    const container = document.getElementById('onlyoffice-editor-container');
    if (!container) return;

    currentEditorDocId = docId;
    const isMobileScreen = window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

    if (isMobileScreen) {
      container.classList.add('active-mobile-fullscreen', 'onlyoffice-fullscreen-overlay');
      isFullscreenActive = true;
      isMobileEditorMode = true;
      document.body.style.overflow = 'hidden';
    } else {
      isMobileEditorMode = false;
      isFullscreenActive = false;
      container.classList.remove('active-mobile-fullscreen', 'onlyoffice-fullscreen-overlay');
      document.body.style.overflow = '';
    }

    container.classList.remove('hidden');
    if (!isMobileScreen) container.scrollIntoView({ behavior: 'smooth' });

    destroyActiveEditor();
    const wrapper = document.getElementById('onlyoffice-wrapper');
    if (wrapper) {
      wrapper.innerHTML = `<div id="onlyoffice-placeholder"><div style="padding: 40px; color: var(--text-muted); text-align: center;">Загрузка модуля ONLYOFFICE Docs...</div></div>`;
    }

    try {
      const config = await API.getOnlyofficeConfig(docId);
      currentEditorConfig = config;
      const titleEl = document.getElementById('editing-doc-title');
      if (titleEl) titleEl.textContent = config.document.title;
      if (!window.DocsAPI) await loadScriptWithRetry(config.onlyofficeApiUrl, config.onlyofficeDirectUrl);
      initDocsEditorInstance();
    } catch (err) {
      if (wrapper) {
        wrapper.innerHTML = `
          <div style="padding: 40px 20px; text-align: center; color: var(--text-main);">
            <div style="font-size: 40px; margin-bottom: 12px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-alert-triangle'/></svg></div>
            <h4 style="font-size: 16px; margin-bottom: 8px;">Не удалось запустить онлайн-редактор ONLYOFFICE</h4>
            <p style="color: var(--text-muted); font-size: 13px; max-width: 540px; margin: 0 auto 12px;">
              ${AppState.escapeHtml(err.message)}
            </p>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 16px;">
              <a href="/editor.html?id=${docId}" target="_blank" class="btn btn-primary"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-globe'/></svg> Открыть в отдельном окне</a>
              <a href="${API.downloadDocumentUrl(docId)}" class="btn btn-secondary" download><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-inbox'/></svg> Скачать файл на ПК</a>
              <button type="button" class="btn btn-secondary" onclick="window.DocumentsModule.openOnlyofficeEditor(${docId})"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-refresh'/></svg> Повторить</button>
            </div>
          </div>
        `;
      }
    }
  }

  async function loadScriptWithRetry(primaryUrl, fallbackUrl, retries = 3, delayMs = 1200) {
    if (window.DocsAPI) return Promise.resolve();
    const urlsToTry = [primaryUrl];
    if (fallbackUrl && fallbackUrl !== primaryUrl) urlsToTry.push(fallbackUrl);
    for (const url of urlsToTry) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          await loadScript(url);
          if (window.DocsAPI) return;
        } catch (err) {
          if (attempt === retries && url === urlsToTry[urlsToTry.length - 1]) throw err;
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
    }
  }

  function loadScript(url) {
    if (window.DocsAPI) return Promise.resolve();
    document.querySelectorAll('script[data-onlyoffice-api]').forEach(s => s.remove());
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.setAttribute('data-onlyoffice-api', 'true');
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Не удалось загрузить ONLYOFFICE API (' + url + ')'));
      document.head.appendChild(script);
    });
  }

  function renderFolderSelectOptions(folders, selectedFolderId) {
    const folderMap = new Map(folders.map(f => [Number(f.id), f]));
    return `
      <option value="" ${!selectedFolderId ? 'selected' : ''}>Мой диск (корень)</option>
      ${folders.map(f => `
        <option value="${f.id}" ${Number(selectedFolderId) === Number(f.id) ? 'selected' : ''}>${AppState.escapeHtml(buildFolderPathLabel(f, folderMap))}
 </option>
      `).join('')}
    `;
  }

  async function openCreateDocModal(defaultType = 'docx') {
    AppState.setModalTitle('+ Создать новый документ');
    const modalBody = document.getElementById('modal-body');
    const foldersList = cachedFolders.length ? cachedFolders : await API.getDocumentFolders().catch(() => []);

    modalBody.innerHTML = `
      <form id="create-doc-form">
        <div class="form-group">
          <label>Тип создаваемого документа *</label>
          <select id="create-doc-type" required style="padding: 10px; font-weight: 500;">
            <option value="docx" ${defaultType === 'docx' ? 'selected' : ''}>Текстовый документ Word (.docx)</option>
            <option value="xlsx" ${defaultType === 'xlsx' ? 'selected' : ''}>Электронная таблица Excel (.xlsx)</option>
            <option value="pptx" ${defaultType === 'pptx' ? 'selected' : ''}>Презентация PowerPoint (.pptx)</option>
            <option value="txt" ${defaultType === 'txt' ? 'selected' : ''}>Текстовый файл (.txt)</option>
            <option value="csv" ${defaultType === 'csv' ? 'selected' : ''}>Таблица данных CSV (.csv)</option>
            <option value="md" ${defaultType === 'md' ? 'selected' : ''}>Документ Markdown (.md)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Название документа *</label>
          <input type="text" id="create-doc-title" required placeholder="Например: Договор поставки оборудования">
        </div>
        <div class="form-group">
          <label>Папка на Диске</label>
          <select id="create-doc-folder">
            ${renderFolderSelectOptions(foldersList, currentFolderId)}
          </select>
        </div>
        <div class="form-group" style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; padding: 12px; margin-top: 10px;">
          <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; margin-bottom: 0;">
            <input type="checkbox" id="create-doc-public" style="margin-top: 3px; width: 17px; height: 17px; cursor: pointer;">
            <div>
              <span style="font-weight: 600; color: var(--text-main);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-globe'/></svg> Общедоступный документ</span>
              <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Виден всем сотрудникам компании на просмотр и скачивание</div>
            </div>
          </label>
        </div>
        <button type="submit" id="btn-submit-create-doc" class="btn btn-primary btn-block"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-rocket'/></svg> Создать и открыть в ONLYOFFICE</button>
      </form>
    `;
    AppState.openModal(null, null, 'sm');
    setTimeout(() => document.getElementById('create-doc-title')?.focus(), 50);

    let isSubmitting = false;
    document.getElementById('create-doc-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isSubmitting) return;
      isSubmitting = true;
      const submitBtn = document.getElementById('btn-submit-create-doc');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clock"/></svg> Создание документа...'; }

      const folderVal = document.getElementById('create-doc-folder')?.value || '';
      const selectedFolder = folderVal ? foldersList.find(f => Number(f.id) === Number(folderVal)) : null;

      try {
        const createdDoc = await API.createDocument({
          title: document.getElementById('create-doc-title').value,
          type: document.getElementById('create-doc-type').value,
          folder_id: folderVal ? parseInt(folderVal, 10) : null,
          category: selectedFolder ? selectedFolder.name : 'Мой диск',
          is_public: document.getElementById('create-doc-public')?.checked || false
        });
        AppState.closeModal();
        await render(document.getElementById('view-panel-documents'));
        setTimeout(() => openOnlyofficeEditor(createdDoc.id), 150);
      } catch (err) {
        isSubmitting = false;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-rocket"/></svg> Создать и открыть в ONLYOFFICE'; }
        alert('Ошибка при создании документа: ' + err.message);
      }
    });
  }

  async function openUploadDocModal() {
    AppState.setModalTitle('Загрузить файл на Диск');
    const modalBody = document.getElementById('modal-body');
    const foldersList = cachedFolders.length ? cachedFolders : await API.getDocumentFolders().catch(() => []);

    modalBody.innerHTML = `
      <form id="upload-doc-form">
        <div class="form-group">
          <label>Файл *</label>
          <input type="file" id="doc-file" required accept=".docx,.doc,.xlsx,.xls,.pptx,.ppt,.pdf,.txt,.rtf,.odt,.ods,.odp,.csv,.tsv,.md,.json,.xml,.png,.jpg,.jpeg,.gif,.webp,.svg,.zip,.rar,.7z">
        </div>
        <div class="form-group">
          <label>Название (необязательно)</label>
          <input type="text" id="doc-title" placeholder="По умолчанию — имя файла">
        </div>
        <div class="form-group">
          <label>Папка на Диске</label>
          <select id="doc-folder">
            ${renderFolderSelectOptions(foldersList, currentFolderId)}
          </select>
        </div>
        <div class="form-group" style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; padding: 12px; margin-top: 10px;">
          <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; margin-bottom: 0;">
            <input type="checkbox" id="upload-doc-public" style="margin-top: 3px; width: 17px; height: 17px; cursor: pointer;">
            <div>
              <span style="font-weight: 600; color: var(--text-main);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-globe'/></svg> Общедоступный документ</span>
              <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Виден всем сотрудникам компании</div>
            </div>
          </label>
        </div>
        <button type="submit" id="btn-submit-upload-doc" class="btn btn-primary btn-block">Загрузить на Диск</button>
      </form>
    `;
    AppState.openModal(null, null, 'sm');

    let isUploading = false;
    document.getElementById('upload-doc-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isUploading) return;
      isUploading = true;
      const submitBtn = document.getElementById('btn-submit-upload-doc');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-clock"/></svg> Загрузка файла...'; }

      const folderVal = document.getElementById('doc-folder')?.value || '';
      const selectedFolder = folderVal ? foldersList.find(f => Number(f.id) === Number(folderVal)) : null;

      const formData = new FormData();
      formData.append('file', document.getElementById('doc-file').files[0]);
      formData.append('title', document.getElementById('doc-title').value);
      formData.append('folder_id', folderVal);
      formData.append('category', selectedFolder ? selectedFolder.name : 'Мой диск');
      formData.append('is_public', document.getElementById('upload-doc-public')?.checked ? 'true' : 'false');

      try {
        await API.uploadDocument(formData);
        AppState.closeModal();
        AppState.showAlert('Файл загружен на Диск', 'success');
        render(document.getElementById('view-panel-documents'));
      } catch (err) {
        isUploading = false;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = 'Загрузить на Диск'; }
        alert('Ошибка при загрузке: ' + err.message);
      }
    });
  }

  function openEditDocModal(doc, containerEl) {
    AppState.setModalTitle(`Свойства и перемещение: ${doc.title}`);
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
      <form id="edit-doc-form">
        <div class="form-group">
          <label>Название документа *</label>
          <input type="text" id="edit-doc-title" required value="${AppState.escapeHtml(doc.title)}">
        </div>
        <div class="form-group">
          <label>Расположение (папка на Диске)</label>
          <select id="edit-doc-folder">
            ${renderFolderSelectOptions(cachedFolders, doc.folder_id)}
          </select>
        </div>
        <div class="form-group" style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; padding: 12px; margin-top: 10px;">
          <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; margin-bottom: 0;">
            <input type="checkbox" id="edit-doc-public" ${doc.is_public ? 'checked' : ''} style="margin-top: 3px; width: 17px; height: 17px; cursor: pointer;">
            <div>
              <span style="font-weight: 600; color: var(--text-main);"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-globe'/></svg> Общедоступный документ</span>
              <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Разрешить просмотр и скачивание всем сотрудникам</div>
            </div>
          </label>
        </div>
        <button type="submit" class="btn btn-primary btn-block"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-save'/></svg> Сохранить изменения</button>
      </form>
    `;
    AppState.openModal(null, null, 'sm');

    document.getElementById('edit-doc-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const folderVal = document.getElementById('edit-doc-folder')?.value || '';
      const selectedFolder = folderVal ? cachedFolders.find(f => Number(f.id) === Number(folderVal)) : null;
      try {
        await API.updateDocument(doc.id, {
          title: document.getElementById('edit-doc-title').value.trim(),
          folder_id: folderVal ? parseInt(folderVal, 10) : null,
          category: selectedFolder ? selectedFolder.name : 'Мой диск',
          is_public: document.getElementById('edit-doc-public')?.checked || false
        });
        AppState.closeModal();
        AppState.showAlert('Свойства документа обновлены', 'success');
        render(containerEl);
      } catch (err) {
        alert('Ошибка: ' + err.message);
      }
    });
  }

  async function openPermissionsModal(doc, containerEl) {
    AppState.setModalTitle(`<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-lock"/></svg> Права доступа: ${doc.title}`);
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `<div class="text-muted" style="text-align: center; padding: 24px;">Загрузка прав доступа...</div>`;
    AppState.openModal(null, null, 'sm');

    try {
      const data = await API.getDocumentPermissions(doc.id);
      renderPermissionsContent(data, doc, containerEl);
    } catch (err) {
      modalBody.innerHTML = `<div class="form-error">Ошибка загрузки прав: ${AppState.escapeHtml(err.message)}</div>`;
    }
  }

  function renderPermissionsContent(data, doc, containerEl) {
    const modalBody = document.getElementById('modal-body');
    const permissions = data.permissions || [];
    const availableUsers = data.availableUsers || [];
    const departments = Array.from(new Set(availableUsers.map(u => u.department).filter(Boolean)));
    const grantedUserIds = new Set(permissions.map(p => parseInt(p.user_id, 10)));
    const nonGrantedUsers = availableUsers.filter(u => !grantedUserIds.has(parseInt(u.id, 10)));

    modalBody.innerHTML = `
      <div style="margin-bottom: 14px; font-size: 13px; color: var(--text-muted);">
        Владелец документа: <strong style="color: var(--text-main);">${AppState.escapeHtml(doc.author_name || 'Администратор')}</strong>
      </div>

      <div style="background: ${doc.is_public ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-subtle)'}; padding: 14px; border-radius: 8px; border: 1px solid ${doc.is_public ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-color)'}; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
          <div>
            <div style="font-weight: 600; font-size: 13px; color: var(--text-main);">
              ${doc.is_public ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-globe"/></svg> Общедоступный документ' : '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-lock"/></svg> Приватный документ'}
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 3px;">
              ${doc.is_public ? 'Виден всей организации.' : 'Виден только автору, руководству и списку ниже.'}
            </div>
          </div>
          <button type="button" class="btn ${doc.is_public ? 'btn-secondary' : 'btn-primary'} btn-sm" id="btn-toggle-doc-public">
            ${doc.is_public ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-lock"/></svg> Сделать приватным' : '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-globe"/></svg> Сделать общедоступным'}
          </button>
        </div>
      </div>

      <div style="background: var(--bg-subtle); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 16px;">
        <div style="font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 8px; text-transform: uppercase;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-zap'/></svg> Быстрая выдача доступа</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px;">
          <button type="button" class="btn btn-secondary btn-sm" id="btn-bulk-all-view"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-users'/></svg> Всем (Просмотр)</button>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-bulk-all-edit"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-pencil'/></svg> Всем (Редактирование)</button>
        </div>
        ${departments.length > 0 ? `
          <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px; border-top: 1px solid var(--border-color); padding-top: 8px; flex-wrap: wrap;">
            <select id="bulk-dept-select" style="font-size: 12px; padding: 4px 8px; flex: 1; border-radius: 4px;">
              <option value="">Выберите отдел...</option>
              ${departments.map(d => `<option value="${AppState.escapeHtml(d)}">${AppState.escapeHtml(d)}</option>`).join('')}
            </select>
            <select id="bulk-dept-level" style="font-size: 12px; padding: 4px 8px; border-radius: 4px;">
              <option value="VIEW">Просмотр</option>
              <option value="EDIT">Редактор</option>
            </select>
            <button type="button" class="btn btn-primary btn-sm" id="btn-bulk-dept-apply" style="padding: 4px 10px; font-size: 12px;">Выдать отделу</button>
          </div>
        ` : ''}
      </div>

      <div style="margin-bottom: 18px;">
        <h4 style="font-size: 13px; font-weight: 700; color: var(--text-main); margin-bottom: 10px; display: flex; justify-content: space-between;">
          <span>Сотрудники с доступом</span>
          <span class="badge badge-subtle">${permissions.length}</span>
        </h4>
        ${permissions.length === 0 ? `
          <div style="padding: 14px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-color); border-radius: 6px; font-size: 12.5px;">
            Индивидуальный доступ пока никому не выдан.
          </div>
        ` : `
          <div style="display: flex; flex-direction: column; gap: 8px; max-height: 190px; overflow-y: auto;">
            ${permissions.map(p => `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 6px; gap: 8px;">
                <div style="min-width: 0; flex: 1;">
                  <div style="font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${AppState.escapeHtml(p.full_name)}</div>
                  <div style="font-size: 11px; color: var(--text-muted);">${AppState.escapeHtml(p.email)}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <select class="change-perm-select" data-user-id="${p.user_id}" style="padding: 4px 6px; font-size: 12px;">
                    <option value="VIEW" ${p.permission_level === 'VIEW' ? 'selected' : ''}>Просмотр</option>
                    <option value="EDIT" ${p.permission_level === 'EDIT' ? 'selected' : ''}>Редактор</option>
                  </select>
                  <button type="button" class="btn btn-secondary btn-sm revoke-perm-btn" data-user-id="${p.user_id}" style="color: var(--danger); padding: 4px 8px;">✕</button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      ${nonGrantedUsers.length > 0 ? `
        <form id="grant-perm-form" style="border-top: 1px solid var(--border-color); padding-top: 14px; display: flex; flex-direction: column; gap: 10px;">
          <label style="font-size: 12px; font-weight: 600;">+ Предоставить доступ сотруднику</label>
          <select id="grant-perm-user-id" required>
            <option value="">Выберите сотрудника...</option>
            ${nonGrantedUsers.map(u => `<option value="${u.id}">${AppState.escapeHtml(u.full_name)} (${AppState.escapeHtml(u.department || u.email)})</option>`).join('')}
          </select>
          <select id="grant-perm-level" required>
            <option value="VIEW">Только просмотр</option>
            <option value="EDIT">Редактирование</option>
          </select>
          <button type="submit" class="btn btn-primary btn-block">+ Предоставить доступ</button>
        </form>
      ` : ''}
    `;

    modalBody.querySelector('#btn-toggle-doc-public')?.addEventListener('click', async () => {
      try {
        const res = await API.toggleDocumentPublic(doc.id);
        doc.is_public = res.is_public;
        AppState.showAlert(res.message || 'Статус обновлён', 'success');
        const updated = await API.getDocumentPermissions(doc.id);
        renderPermissionsContent(updated, doc, containerEl);
        render(containerEl);
      } catch (err) {
        alert('Ошибка: ' + err.message);
      }
    });

    modalBody.querySelector('#btn-bulk-all-view')?.addEventListener('click', async () => {
      const res = await API.bulkGrantDocumentPermissions(doc.id, { targetType: 'all', permissionLevel: 'VIEW' });
      AppState.showAlert(res.message || 'Доступ выдан', 'success');
      renderPermissionsContent(await API.getDocumentPermissions(doc.id), doc, containerEl);
      render(containerEl);
    });

    modalBody.querySelector('#btn-bulk-all-edit')?.addEventListener('click', async () => {
      const res = await API.bulkGrantDocumentPermissions(doc.id, { targetType: 'all', permissionLevel: 'EDIT' });
      AppState.showAlert(res.message || 'Доступ выдан', 'success');
      renderPermissionsContent(await API.getDocumentPermissions(doc.id), doc, containerEl);
      render(containerEl);
    });

    modalBody.querySelector('#btn-bulk-dept-apply')?.addEventListener('click', async () => {
      const dept = modalBody.querySelector('#bulk-dept-select')?.value;
      const level = modalBody.querySelector('#bulk-dept-level')?.value || 'VIEW';
      if (!dept) return;
      const res = await API.bulkGrantDocumentPermissions(doc.id, { targetType: 'department', department: dept, permissionLevel: level });
      AppState.showAlert(res.message || 'Доступ выдан отделу', 'success');
      renderPermissionsContent(await API.getDocumentPermissions(doc.id), doc, containerEl);
      render(containerEl);
    });

    modalBody.querySelectorAll('.change-perm-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        await API.setDocumentPermission(doc.id, parseInt(sel.getAttribute('data-user-id'), 10), sel.value);
        AppState.showAlert('Права обновлены', 'success');
        renderPermissionsContent(await API.getDocumentPermissions(doc.id), doc, containerEl);
        render(containerEl);
      });
    });

    modalBody.querySelectorAll('.revoke-perm-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await API.removeDocumentPermission(doc.id, parseInt(btn.getAttribute('data-user-id'), 10));
        AppState.showAlert('Доступ отозван', 'success');
        renderPermissionsContent(await API.getDocumentPermissions(doc.id), doc, containerEl);
        render(containerEl);
      });
    });

    modalBody.querySelector('#grant-perm-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = parseInt(modalBody.querySelector('#grant-perm-user-id')?.value || '', 10);
      const level = modalBody.querySelector('#grant-perm-level')?.value || 'VIEW';
      if (!userId) return;
      await API.setDocumentPermission(doc.id, userId, level);
      AppState.showAlert('Доступ предоставлен', 'success');
      renderPermissionsContent(await API.getDocumentPermissions(doc.id), doc, containerEl);
      render(containerEl);
    });
  }

  function focusSearch() {
    const inp = document.getElementById('doc-search-input');
    if (inp) {
      inp.focus();
      inp.select();
    }
  }

  function isEditorActive() {
    const container = document.getElementById('onlyoffice-editor-container');
    return container && !container.classList.contains('hidden') && currentEditorDocId !== null;
  }

  function restoreEditorHeaderAndActions() {
    AppState.setHeader('Редактор ONLYOFFICE', 'Совместное редактирование документа');
    AppState.setTopBarActions(`<button class="btn btn-secondary" id="btn-topbar-close-editor">‹ Назад на Диск</button>`);
    document.getElementById('btn-topbar-close-editor')?.addEventListener('click', closeEditor);
  }

  return {
    render,
    onActivated: () => updateHeaderAndActions(),
    openCreateDocModal,
    openUploadDocModal,
    openPermissionsModal,
    openOnlyofficeEditor,
    focusSearch,
    isEditorActive,
    restoreEditorHeaderAndActions
  };
})();
