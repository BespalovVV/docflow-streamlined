/**
 * DocFlow Monochrome SVG Icon Sprite & Helper
 * Единая система одноцветных векторных иконок (currentColor).
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SPRITE_ID = 'df-svg-sprite';

  const SYMBOLS = {
    'home': '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
    'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h6"/>',
    'file-edit': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
    'files': '<path d="M15 2H9a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6z"/><path d="M15 2v4h4"/><path d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h9"/>',
    'folder': '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    'folder-open': '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v2"/><path d="M3 18l2.5-8h15l-2.5 8a1.5 1.5 0 0 1-1.4 1H4.4A1.4 1.4 0 0 1 3 18z"/>',
    'folders': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M9 4v16"/>',
    'book': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    'clipboard': '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h6"/>',
    'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3.5"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a3.5 3.5 0 0 1 0 6.74"/>',
    'user': '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'building': '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M16 9h2a2 2 0 0 1 2 2v10"/><path d="M2 21h20"/><path d="M8 7h4"/><path d="M8 11h4"/><path d="M8 15h4"/>',
    'pencil': '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    'search': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
    'save': '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    'compass': '<circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 13.8 13.8 8.5 15.5 10.2 10.2 15.5 8.5"/>',
    'bar-chart': '<path d="M3 20h18"/><rect x="5" y="12" width="3" height="8" rx="0.5"/><rect x="10.5" y="7" width="3" height="13" rx="0.5"/><rect x="16" y="4" width="3" height="16" rx="0.5"/>',
    'trash': '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    'inbox': '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    'clock': '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
    'video': '<rect x="2" y="6" width="14" height="12" rx="2"/><polygon points="16 10 22 7 22 17 16 14"/>',
    'globe': '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
    'alert-triangle': '<path d="m10.29 3.86-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.71-3l-8-14a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    'eye': '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    'paperclip': '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/>',
    'calendar': '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    'message-circle': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    'lock': '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    'refresh': '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
    'moon': '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    'image': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    'rocket': '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    'mail': '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    'mail-open': '<path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"/><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>',
    'bot': '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4H8"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
    'sparkles': '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/><path d="M5 3v4"/><path d="M3 5h4"/>',
    'pin': '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    'map-pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    'archive': '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>',
    'settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    'zap': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    'tag': '<path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l8.59-8.59a1 1 0 0 0 0-1.41z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    'briefcase': '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    'sitemap': '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5"/><path d="M5 17v-3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/>',
    'smartphone': '<rect x="6" y="2" width="12" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    'flask': '<path d="M9 3h6"/><path d="M10 3v5l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7 14h10"/>',
    'lightbulb': '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',
    'star': '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    'monitor': '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    'target': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    'type': '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
    'scale': '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
    'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'infinity': '<path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z"/>',
    'award': '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
    'menu': '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    'x': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'maximize': '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    'check': '<polyline points="20 6 9 17 4 12"/>',
    'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    'reply': '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>'
  };

  // Карта сопоставления цветных эмодзи (с variation selector и без него) и SVG-иконок
  const EMOJI_MAP = {
    '🏠': 'home',
    '📄': 'file-text',
    '📝': 'file-edit',
    '✍': 'file-edit',
    '✍️': 'file-edit',
    '📑': 'files',
    '📁': 'folder',
    '📂': 'folder-open',
    '🗂': 'folders',
    '🗂️': 'folders',
    '📕': 'book',
    '📘': 'book',
    '📗': 'book',
    '📋': 'clipboard',
    '👥': 'users',
    '👤': 'user',
    '🏢': 'building',
    '✏': 'pencil',
    '✏️': 'pencil',
    '🔍': 'search',
    '🔎': 'search',
    '💾': 'save',
    '🧭': 'compass',
    '📊': 'bar-chart',
    '📈': 'bar-chart',
    '🗑': 'trash',
    '🗑️': 'trash',
    '📥': 'inbox',
    '📤': 'upload',
    '⬇': 'download',
    '⬇️': 'download',
    '⏳': 'clock',
    '⌛': 'clock',
    '🕒': 'clock',
    '📹': 'video',
    '📽': 'video',
    '📽️': 'video',
    '🌐': 'globe',
    '⚠': 'alert-triangle',
    '⚠️': 'alert-triangle',
    '👁': 'eye',
    '👁️': 'eye',
    '📎': 'paperclip',
    '✅': 'check-circle',
    '📅': 'calendar',
    '🗓': 'calendar',
    '🗓️': 'calendar',
    '💬': 'message-circle',
    '🔒': 'lock',
    '🔐': 'lock',
    '🛡': 'shield',
    '🛡️': 'shield',
    '🔄': 'refresh',
    '🔁': 'refresh',
    '🌙': 'moon',
    '☀': 'sun',
    '☀️': 'sun',
    '🖼': 'image',
    '🖼️': 'image',
    '🚀': 'rocket',
    '📧': 'mail',
    '✉': 'mail',
    '✉️': 'mail',
    '📭': 'mail-open',
    '🤖': 'bot',
    '🧠': 'bot',
    '✨': 'sparkles',
    '📌': 'pin',
    '📍': 'map-pin',
    '📦': 'archive',
    '⚙': 'settings',
    '⚙️': 'settings',
    '⚡': 'zap',
    '🏷': 'tag',
    '🏷️': 'tag',
    '👔': 'briefcase',
    '🌳': 'sitemap',
    '📲': 'smartphone',
    '🔬': 'flask',
    '💡': 'lightbulb',
    '⭐': 'star',
    '💻': 'monitor',
    '🎯': 'target',
    '🔤': 'type',
    '⚖': 'scale',
    '⚖️': 'scale',
    '🎉': 'award',
    '🔗': 'link',
    '♾': 'infinity',
    '♾️': 'infinity'
  };

  function injectSprite() {
    if (!document.body && !document.documentElement) return;
    if (document.getElementById(SPRITE_ID)) return;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.id = SPRITE_ID;
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';

    let defs = '<defs>';
    for (const [name, body] of Object.entries(SYMBOLS)) {
      defs += `<symbol id="df-ico-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`;
    }
    defs += '</defs>';
    svg.innerHTML = defs;

    const target = document.body || document.documentElement;
    target.insertBefore(svg, target.firstChild);
  }

  function dfIcon(name, size = 16, extraClass = '') {
    const resolved = EMOJI_MAP[name] || (SYMBOLS[name] ? name : 'file-text');
    const cls = extraClass ? `df-ico ${extraClass}` : 'df-ico';
    return `<svg class="${cls}" width="${size}" height="${size}" aria-hidden="true"><use href="#df-ico-${resolved}"/></svg>`;
  }

  const EMOJI_KEYS = Object.keys(EMOJI_MAP).sort((a, b) => b.length - a.length);
  const EMOJI_REGEX = new RegExp(
    EMOJI_KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g'
  );
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'OPTION', 'TITLE', 'CODE', 'PRE', 'SVG', 'USE']);

  function replaceEmojisInNode(root) {
    if (!root) return;
    injectSprite();

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !EMOJI_REGEX.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        EMOJI_REGEX.lastIndex = 0;
        let p = node.parentNode;
        while (p && p.nodeType === 1) {
          if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    let current;
    while ((current = walker.nextNode())) nodes.push(current);

    for (const textNode of nodes) {
      const text = textNode.nodeValue;
      EMOJI_REGEX.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      let match;

      while ((match = EMOJI_REGEX.exec(text)) !== null) {
        if (match.index > lastIdx) {
          frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
        }
        const iconName = EMOJI_MAP[match[0]];
        if (iconName) {
          const svg = document.createElementNS(SVG_NS, 'svg');
          svg.setAttribute('class', 'df-ico df-ico-inline');
          svg.setAttribute('width', '15');
          svg.setAttribute('height', '15');
          svg.setAttribute('aria-hidden', 'true');
          const use = document.createElementNS(SVG_NS, 'use');
          use.setAttribute('href', `#df-ico-${iconName}`);
          svg.appendChild(use);
          frag.appendChild(svg);
        }
        lastIdx = EMOJI_REGEX.lastIndex;
      }

      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      }
      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(frag, textNode);
      }
    }
  }

  function startObserver() {
    injectSprite();
    replaceEmojisInNode(document.body);
    if (!window.MutationObserver || !document.body) return;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const added of m.addedNodes) {
          if (added.nodeType === 1 && !SKIP_TAGS.has(added.tagName)) {
            replaceEmojisInNode(added);
          } else if (added.nodeType === 3) {
            replaceEmojisInNode(added.parentNode);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.DF_SVG_SYMBOLS = SYMBOLS;
  window.DF_EMOJI_MAP = EMOJI_MAP;
  window.dfIcon = dfIcon;
  window.injectDfSprite = injectSprite;
  window.replaceEmojisInNode = replaceEmojisInNode;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
