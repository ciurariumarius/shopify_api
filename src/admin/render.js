const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, 'views');

// Simple file cache so we read each template from disk only once in production.
const cache = new Map();

function readView(name) {
  if (process.env.NODE_ENV === 'production' && cache.has(name)) {
    return cache.get(name);
  }
  const content = fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');
  cache.set(name, content);
  return content;
}

// Replace {{key}} tokens in a template with the supplied values.
function fill(template, vars = {}) {
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => {
    const val = vars[key];
    return val == null ? '' : String(val);
  });
}

// Build the sidebar nav, marking the active item.
function buildNav(active) {
  const items = [
    ['dashboard', '/admin', 'Dashboard'],
    ['shops', '/admin/shops', 'Shops'],
    ['keys', '/admin/keys', 'API Keys'],
    ['logs', '/admin/logs', 'Logs'],
    ['config', '/admin/config', 'Config'],
    ['health', '/admin/health', 'Health'],
  ];
  return items
    .map(
      ([id, href, label]) =>
        `<a href="${href}" class="nav-item${id === active ? ' active' : ''}">${label}</a>`
    )
    .join('\n');
}

// Render a page: wrap the named view's filled content in the layout.
function renderPage({ view, active, title, vars = {} }) {
  const layout = readView('layout.html');
  const pageTemplate = readView(view);
  const content = fill(pageTemplate, vars);
  return fill(layout, {
    title: title || 'Admin',
    nav: buildNav(active),
    content,
  });
}

// HTML-escape a value for safe interpolation into templates.
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Render a colored status badge.
function badge(status) {
  const s = String(status || '').toLowerCase();
  let cls = 'badge-gray';
  if (['installed', 'active', 'success', 'ok', 'true'].includes(s)) cls = 'badge-green';
  else if (['uninstalled', 'revoked', 'error', 'down', 'false', 'expired'].includes(s)) cls = 'badge-red';
  else if (['running', 'pending', 'warn', 'warning'].includes(s)) cls = 'badge-yellow';
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

module.exports = { renderPage, fill, escapeHtml, badge, fmtDate, buildNav };
