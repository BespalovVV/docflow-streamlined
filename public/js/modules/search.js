// public/js/modules/search.js
// Интеллектуальный гибридный поиск (pgvector ONNX + FTS + pg_trgm) + Extractive QA по единой базе знаний
// (Документы + Материалы проектов + Вложения почты)

window.SearchModule = (function() {
  const state = {
    query: '',
    results: [],
    qa: null,
    isFallbackNearest: false,
    confidence: 'none',
    hasSearched: false,
    selectedCategory: 'ALL',
    selectedSourceType: 'ALL',
    selectedFileType: 'ALL',
    isSearching: false
  };

  let searchDebounceTimer = null;

  async function render(containerEl) {
    updateHeaderAndActions();

    if (containerEl.dataset.rendered === 'true' && containerEl.querySelector('#search-input-field')) {
      restoreUIState(containerEl);
      return;
    }

    containerEl.innerHTML = `
      <div class="search-view-layout" style="display: flex; flex-direction: column; gap: 18px; width: 100%; max-width: 1200px; margin: 0 auto;">
        
        <!-- SEARCH HERO BOX -->
        <div class="card" style="padding: 24px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
          <div style="margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 22px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-sparkles'/></svg></span>
              <h2 style="font-size: 18px; font-weight: 700; color: var(--text-main); margin: 0;">Интеллектуальный поиск и ответы по базе знаний</h2>
            </div>
            <p style="font-size: 13px; color: var(--text-muted); margin: 0;">
              Задайте вопрос или введите ключевые слова — система найдёт точные цитаты по <strong>документам</strong>, <strong>материалам проектов</strong> и <strong>вложениям почты</strong> (pgvector + ONNX). Если точных совпадений нет — покажет ближайший по смыслу вариант.
            </p>
          </div>

          <!-- SEARCH INPUT BAR -->
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="position: relative; display: flex; align-items: center; background: var(--bg-subtle); border: 2px solid var(--primary); border-radius: 10px; padding: 4px 8px; transition: box-shadow 0.2s ease;">
              <span style="font-size: 18px; padding: 0 8px; opacity: 0.8;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-search'/></svg></span>
              <input type="text" id="search-input-field" 
                     placeholder="Например: какой штраф за просрочку поставки или размер суточных..." 
                     value="${AppState.escapeHtml(state.query)}"
                     autocomplete="off"
                     style="flex: 1; min-width: 0; border: none; background: transparent; font-size: 15px; padding: 10px 6px; outline: none; color: var(--text-main);">
              <button type="button" id="search-clear-btn" class="btn-icon" title="Очистить поиск" 
                      style="display: ${state.query ? 'inline-flex' : 'none'}; padding: 6px; margin-right: 4px; color: var(--text-muted); cursor: pointer;">
                ✕
              </button>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              <button type="button" id="search-submit-btn" class="btn btn-primary" style="padding: 8px 20px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
                <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-search"/></svg> Найти ответ</span>
                <kbd style="background: rgba(255,255,255,0.2); padding: 1px 5px; border-radius: 4px; font-size: 10px; font-family: monospace;">Enter</kbd>
              </button>

              <!-- Source Type Filter (Unified Knowledge Base) -->
              <select id="search-source-select" style="padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-main); font-size: 12px; flex: 1; min-width: 150px; max-width: 240px;">
                <option value="ALL">Вся база знаний</option>
                <option value="document">Документы</option>
                <option value="project_material">Материалы проектов</option>
                <option value="mail_attachment">Вложения почты</option>
              </select>

              <!-- File Type Filter -->
              <select id="search-filetype-select" style="padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-main); font-size: 12px; flex: 1; min-width: 120px; max-width: 220px;">
                <option value="ALL">Все форматы</option>
                <option value="DOCX">Word (DOCX)</option>
                <option value="XLSX">Excel (XLSX)</option>
                <option value="PDF">PDF</option>
                <option value="TXT">Текст (TXT, MD)</option>
                <option value="PPTX">Презентации PPTX</option>
              </select>
            </div>
          </div>
        </div>

        <!-- SEARCH RESULTS & EXTRACTIVE QA CONTAINER -->
        <div id="search-results-section" style="display: flex; flex-direction: column; gap: 12px;"></div>

      </div>
    `;

    containerEl.dataset.rendered = 'true';
    bindSearchEvents(containerEl);
    renderResults(containerEl);
  }

  function updateHeaderAndActions() {
    AppState.setHeader('Умный поиск и RAG', 'Ответы по смыслу и содержимому документов, материалов проектов и почтовых вложений');

    const isAdmin = AppState.isAdmin();
    AppState.setTopBarActions(`
      ${isAdmin ? `
        <button class="btn btn-secondary btn-sm" id="btn-search-reindex" title="Переиндексировать все документы, материалы и вложения почты">
          <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-refresh"/></svg> Переиндексировать
        </button>
      ` : ''}
      <button class="btn btn-primary btn-sm" id="btn-search-open-docs">
        <svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-file-text"/></svg> В хранилище
      </button>
    `);

    document.getElementById('btn-search-open-docs')?.addEventListener('click', () => {
      window.location.hash = 'documents';
    });

    document.getElementById('btn-search-reindex')?.addEventListener('click', async () => {
      try {
        const res = await API.reindexDocuments();
        AppState.showAlert(res.message || 'Переиндексация запущена в фоне', 'success');
      } catch (err) {
        AppState.showAlert('Ошибка переиндексации: ' + err.message, 'error');
      }
    });
  }

  function restoreUIState(containerEl) {
    updateHeaderAndActions();
    const input = containerEl.querySelector('#search-input-field');
    const clearBtn = containerEl.querySelector('#search-clear-btn');
    const sourceSelect = containerEl.querySelector('#search-source-select');
    const filetypeSelect = containerEl.querySelector('#search-filetype-select');

    if (input) input.value = state.query;
    if (clearBtn) clearBtn.style.display = state.query ? 'inline-flex' : 'none';
    if (sourceSelect && state.selectedSourceType) sourceSelect.value = state.selectedSourceType;
    if (filetypeSelect && state.selectedFileType) filetypeSelect.value = state.selectedFileType;

    renderResults(containerEl);
  }

  function bindSearchEvents(containerEl) {
    const input = containerEl.querySelector('#search-input-field');
    const clearBtn = containerEl.querySelector('#search-clear-btn');
    const submitBtn = containerEl.querySelector('#search-submit-btn');
    const sourceSelect = containerEl.querySelector('#search-source-select');
    const filetypeSelect = containerEl.querySelector('#search-filetype-select');

    input?.addEventListener('input', (e) => {
      state.query = e.target.value;
      if (clearBtn) clearBtn.style.display = state.query.trim() ? 'inline-flex' : 'none';

      clearTimeout(searchDebounceTimer);
      if (!state.query.trim()) {
        state.hasSearched = false;
        state.results = [];
        state.qa = null;
        state.isFallbackNearest = false;
        renderResults(containerEl);
        return;
      }

      searchDebounceTimer = setTimeout(() => {
        executeSearch(containerEl);
      }, 320);
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(searchDebounceTimer);
        executeSearch(containerEl);
      }
    });

    clearBtn?.addEventListener('click', () => {
      state.query = '';
      state.hasSearched = false;
      state.results = [];
      state.qa = null;
      state.isFallbackNearest = false;
      if (input) {
        input.value = '';
        input.focus();
      }
      if (clearBtn) clearBtn.style.display = 'none';
      renderResults(containerEl);
    });

    submitBtn?.addEventListener('click', () => {
      clearTimeout(searchDebounceTimer);
      executeSearch(containerEl);
    });

    sourceSelect?.addEventListener('change', (e) => {
      state.selectedSourceType = e.target.value;
      if (state.query.trim()) {
        executeSearch(containerEl);
      }
    });

    filetypeSelect?.addEventListener('change', (e) => {
      state.selectedFileType = e.target.value;
      renderResults(containerEl);
    });
  }

  async function executeSearch(containerEl) {
    const q = (state.query || '').trim();
    if (!q) {
      state.hasSearched = false;
      state.results = [];
      state.qa = null;
      renderResults(containerEl);
      return;
    }

    state.isSearching = true;
    state.hasSearched = true;
    renderSearchingState(containerEl);

    try {
      const categoryParam = (state.selectedCategory !== 'ALL') ? state.selectedCategory : '';
      const data = await API.searchDocuments(q, {
        category: categoryParam,
        sourceType: state.selectedSourceType,
        limit: 30,
        includeQa: true
      });

      if (Array.isArray(data)) {
        state.results = data;
        state.qa = null;
        state.isFallbackNearest = data.some(d => d.isNearestFallback);
        state.confidence = state.isFallbackNearest ? 'fallback_nearest' : 'high';
      } else {
        state.results = Array.isArray(data.results) ? data.results : [];
        state.qa = data.qa || null;
        state.isFallbackNearest = Boolean(data.isFallbackNearest);
        state.confidence = data.confidence || 'none';
      }
    } catch (err) {
      console.error('[SearchModule] Search error:', err);
      state.results = [];
      state.qa = null;
    } finally {
      state.isSearching = false;
      renderResults(containerEl);
    }
  }

  function renderSearchingState(containerEl) {
    const resultsContainer = containerEl.querySelector('#search-results-section');
    if (!resultsContainer) return;

    resultsContainer.innerHTML = `
      <div class="card" style="padding: 30px; text-align: center; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
        <div style="font-size: 28px; margin-bottom: 8px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-clock'/></svg></div>
        <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">Семантический поиск и анализ фрагментов...</div>
        <div style="font-size: 12px; color: var(--text-muted);">Поиск по векторам ONNX (pgvector HNSW), FTS и триграммам по документам, материалам и вложениям</div>
      </div>
    `;
  }

  // Безопасная санитизация HTML-сниппета (устраняет Stored XSS, сохраняя только подсветку <mark>)
  function sanitizeSnippetHtml(raw) {
    if (!raw) return '';
    const placeholders = [];
    let safe = String(raw).replace(/<mark>([\s\S]*?)<\/mark>/gi, (_, inner) => {
      const idx = placeholders.length;
      placeholders.push(`<mark>${AppState.escapeHtml(inner)}</mark>`);
      return `__MARK_PLACEHOLDER_${idx}__`;
    });
    safe = safe.replace(/<span style="opacity: 0\.65; font-size: 11px;">\([^<]+\)<\/span>/gi, (m) => {
      const idx = placeholders.length;
      placeholders.push(m);
      return `__MARK_PLACEHOLDER_${idx}__`;
    });
    safe = AppState.escapeHtml(safe);
    placeholders.forEach((html, idx) => {
      safe = safe.replace(`__MARK_PLACEHOLDER_${idx}__`, html);
    });
    return safe;
  }

  function formatMarkdownBasic(raw) {
    return AppState.escapeHtml(raw || '')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/•/g, '&bull;');
  }

  function renderResults(containerEl) {
    const resultsContainer = containerEl.querySelector('#search-results-section');
    if (!resultsContainer) return;

    if (!state.hasSearched || !state.query.trim()) {
      resultsContainer.innerHTML = `
        <div class="card" style="padding: 40px; text-align: center; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
          <div style="font-size: 44px; margin-bottom: 12px; opacity: 0.9;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-search'/></svg></div>
          <h3 style="font-size: 16px; font-weight: 700; color: var(--text-main); margin-bottom: 8px;">Готов к поиску по базе знаний</h3>
          <p style="font-size: 13px; color: var(--text-muted); max-width: 560px; margin: 0 auto 16px; line-height: 1.5;">
            Введите естественный вопрос или ключевые слова. Движок проанализирует тексты <strong>документов</strong> (Word, Excel, PDF, PPTX, TXT), <strong>материалов проектов</strong> и <strong>ваших почтовых вложений</strong>, выделит точные цитаты-ответы и при отсутствии точных совпадений предложит ближайший вариант.
          </p>
        </div>
      `;
      return;
    }

    let filtered = state.results;
    if (state.selectedFileType !== 'ALL') {
      filtered = filtered.filter(d => {
        const typeUpper = (d.file_type || '').toUpperCase();
        if (state.selectedFileType === 'DOCX') return ['DOCX', 'DOC', 'ODT', 'RTF'].includes(typeUpper);
        if (state.selectedFileType === 'XLSX') return ['XLSX', 'XLS', 'ODS', 'CSV'].includes(typeUpper);
        if (state.selectedFileType === 'PDF') return typeUpper === 'PDF';
        if (state.selectedFileType === 'TXT') return ['TXT', 'MD', 'JSON', 'XML'].includes(typeUpper);
        if (state.selectedFileType === 'PPTX') return ['PPTX', 'PPT', 'ODP'].includes(typeUpper);
        return true;
      });
    }

    if (filtered.length === 0) {
      resultsContainer.innerHTML = `
        <div class="card" style="padding: 40px; text-align: center; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
          <div style="font-size: 40px; margin-bottom: 12px;"><svg class='df-ico' width='15' height='15' aria-hidden='true'><use href='#df-ico-folder'/></svg></div>
          <h3 style="font-size: 16px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">В выбранном фильтре файлов пока нет</h3>
          <p style="font-size: 13px; color: var(--text-muted); max-width: 480px; margin: 0 auto; line-height: 1.5;">
            По запросу «<strong style="color: var(--text-main);">${AppState.escapeHtml(state.query)}</strong>» среди доступных файлов выбранного формата совпадений не обнаружено. Попробуйте сбросить фильтр формата или источника.
          </p>
        </div>
      `;
      return;
    }

    let html = '';

    // 1. БЛОК EXTRACTIVE QA ОТВЕТА ПО СОДЕРЖИМОМУ (ИЛИ БЛИЖАЙШИЙ ВАРИАНТ)
    if (state.qa && state.qa.answer) {
      const isNearest = Boolean(state.qa.isFallbackNearest || state.isFallbackNearest);
      const borderColor = isNearest ? 'rgba(245, 158, 11, 0.45)' : 'rgba(59, 130, 246, 0.4)';
      const bgGrad = isNearest
        ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.09), rgba(245, 158, 11, 0.03))'
        : 'linear-gradient(135deg, rgba(59, 130, 246, 0.10), rgba(139, 92, 246, 0.05))';
      const titleColor = isNearest ? '#f59e0b' : 'var(--primary)';
      const headerLabel = isNearest
        ? '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-search"/></svg> Точных совпадений не найдено — наиболее близкий вариант по смыслу'
        : '<svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-bot"/></svg> Извлечённый ответ по содержимому базы знаний (Extractive QA)';

      html += `
        <div class="card" style="padding: 18px 20px; background: ${bgGrad}; border: 1px solid ${borderColor}; border-radius: var(--radius-md);">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
            <span style="font-size: 13px; font-weight: 700; color: ${titleColor};">${headerLabel}</span>
            <span style="font-size: 11px; color: var(--text-muted);">Локальный ONNX (multilingual-e5-small) + pgvector</span>
          </div>
          <div style="font-size: 13.5px; color: var(--text-main); line-height: 1.55; white-space: pre-wrap;">${formatMarkdownBasic(state.qa.answer)}</div>
        </div>
      `;
    }

    // 2. ЗАГОЛОВОК СПИСКА ИСТОЧНИКОВ
    html += `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding: 0 4px;">
        <span style="font-size: 13px; font-weight: 600; color: var(--text-muted);">
          ${state.isFallbackNearest ? 'Ближайшие варианты по смыслу' : 'Найдено источников'}: <strong style="color: var(--text-main);">${filtered.length}</strong>
        </span>
        <span style="font-size: 12px; color: var(--text-muted);">
          Ранжирование: <span style="color: var(--primary); font-weight: 600;">pgvector HNSW + FTS + RRF</span>
        </span>
      </div>
      <div class="search-cards-grid" style="display: flex; flex-direction: column; gap: 12px;">
    `;

    filtered.forEach(d => {
      const typeUpper = (d.file_type || '').toUpperCase();
      let icon = d.source_icon || dfIcon('file-text', 16);
      if (d.source_type === 'document') {
        if (typeUpper === 'PDF') icon = dfIcon('book', 16);
        else if (['DOCX', 'DOC', 'ODT', 'RTF'].includes(typeUpper)) icon = dfIcon('file-edit', 16);
        else if (['XLSX', 'XLS', 'ODS', 'CSV'].includes(typeUpper)) icon = dfIcon('bar-chart', 16);
        else if (['PPTX', 'PPT', 'ODP'].includes(typeUpper)) icon = dfIcon('video', 16);
      }

      // Source type badge
      let sourceBadge = `<span class="badge" style="background: rgba(59, 130, 246, 0.12); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.25); font-size: 11px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-file-text"/></svg> Документ</span>`;
      if (d.source_type === 'project_material') {
        sourceBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.28); font-size: 11px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-compass"/></svg> Материал${d.project_title ? `: ${AppState.escapeHtml(d.project_title)}` : ''}</span>`;
      } else if (d.source_type === 'mail_attachment') {
        sourceBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.28); font-size: 11px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-mail"/></svg> Вложение почты</span>`;
      }

      // Match type badge
      let matchBadge = '';
      const simPct = typeof d.similarity === 'number' ? ` (${Math.round(d.similarity * 100)}%)` : '';
      if (d.matchType === 'nearest' || d.isNearestFallback) {
        matchBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 11px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-search"/></svg> Ближайший вариант${simPct}</span>`;
      } else if (d.matchType === 'semantic') {
        matchBadge = `<span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #8b5cf6; border: 1px solid rgba(139, 92, 246, 0.3); font-size: 11px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-sparkles"/></svg> Смысловое (ONNX)${simPct}</span>`;
      } else if (d.matchType === 'hybrid') {
        matchBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 11px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-zap"/></svg> Гибридное (FTS+ONNX)${simPct}</span>`;
      } else {
        matchBadge = `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 11px;"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-search"/></svg> По тексту</span>`;
      }

      // Действия в зависимости от типа источника
      let actionsHtml = '';
      if (d.source_type === 'project_material') {
        actionsHtml = `
          <button class="btn btn-primary btn-download-material" data-id="${d.id}" data-title="${AppState.escapeHtml(d.file_name || d.title)}">
            <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-download"/></svg> Скачать материал</span>
          </button>
          <button class="btn btn-secondary btn-open-materials">
            <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-compass"/></svg> В направления</span>
          </button>
        `;
      } else if (d.source_type === 'mail_attachment') {
        actionsHtml = `
          <a href="${API.downloadAttachmentUrl(d.id)}" class="btn btn-primary" download>
            <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-download"/></svg> Скачать вложение</span>
          </a>
          <button class="btn btn-secondary btn-open-mail">
            <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-mail"/></svg> В почту</span>
          </button>
        `;
      } else {
        actionsHtml = `
          <button class="btn btn-primary btn-open-editor" data-id="${d.id}" data-type="${typeUpper}">
            <span><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-eye"/></svg> Открыть</span>
          </button>
          <a href="/editor.html?id=${d.id}" target="_blank" class="btn btn-secondary btn-icon-action" title="Открыть в новой вкладке">
            ↗
          </a>
          <a href="${API.downloadDocumentUrl(d.id)}" class="btn btn-secondary btn-icon-action" download title="Скачать файл">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </a>
        `;
      }

      html += `
        <div class="card search-result-card" data-id="${d.id}" data-source-type="${d.source_type || 'document'}">
          <div class="search-result-header">
            <span class="search-result-icon">${icon}</span>
            <h4 class="search-result-title" title="${AppState.escapeHtml(d.title)}">
              ${AppState.escapeHtml(d.title)}
            </h4>
          </div>

          <div class="search-result-badges">
            ${sourceBadge}
            ${matchBadge}
            ${d.section ? `<span class="badge badge-subtle"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-files"/></svg> ${AppState.escapeHtml(d.section)}</span>` : ''}
            ${d.is_public ? `<span class="badge badge-public"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-globe"/></svg> Общедоступный</span>` : ''}
            <span class="badge badge-subtle"><svg class="df-ico" width="15" height="15" aria-hidden="true"><use href="#df-ico-folder-open"/></svg> ${AppState.escapeHtml(d.category || 'Общие')}</span>
            <span class="search-result-filesize">${AppState.escapeHtml(typeUpper)} • ${typeof AppState.formatFileSize === 'function' ? AppState.formatFileSize(d.file_size || 0) : ((d.file_size || 0) + ' Б')}</span>
          </div>

          <div class="search-result-snippet">
            ${sanitizeSnippetHtml(d.snippet)}
          </div>

          <div class="search-result-meta">
            <span>Автор / Отправитель: <strong style="color: var(--text-main);">${AppState.escapeHtml(d.author_name || 'Не указан')}</strong></span>
            <span>Обновлён: ${d.updated_at ? new Date(d.updated_at).toLocaleDateString('ru-RU') : '—'}</span>
          </div>

          <div class="search-result-actions">
            ${actionsHtml}
          </div>
        </div>
      `;
    });

    html += `</div>`;
    resultsContainer.innerHTML = html;

    resultsContainer.querySelectorAll('.btn-open-editor').forEach(btn => {
      btn.addEventListener('click', () => {
        const docId = parseInt(btn.getAttribute('data-id'), 10);
        window.location.hash = 'documents';
        setTimeout(() => {
          if (window.DocumentsModule && typeof window.DocumentsModule.openEditorForId === 'function') {
            window.DocumentsModule.openEditorForId(docId);
          }
        }, 120);
      });
    });

    resultsContainer.querySelectorAll('.btn-download-material').forEach(btn => {
      btn.addEventListener('click', () => {
        const matId = parseInt(btn.getAttribute('data-id'), 10);
        const fname = btn.getAttribute('data-title') || 'material.docx';
        API.downloadProjectMaterial(matId, fname).catch(err => AppState.showAlert(err.message, 'error'));
      });
    });

    resultsContainer.querySelectorAll('.btn-open-materials').forEach(btn => {
      btn.addEventListener('click', () => { AppState.switchView('materials'); });
    });

    resultsContainer.querySelectorAll('.btn-open-mail').forEach(btn => {
      btn.addEventListener('click', () => { AppState.switchView('mail'); });
    });
  }

  return {
    render,
    onActivated: (containerEl) => {
      updateHeaderAndActions();
      restoreUIState(containerEl);
    },
    getState: () => ({ ...state }),
    focusSearch: (query) => {
      if (query !== undefined) state.query = query;
      const input = document.getElementById('search-input-field');
      if (input) {
        if (query !== undefined) input.value = query;
        input.focus();
        input.select();
      }
    }
  };
})();
