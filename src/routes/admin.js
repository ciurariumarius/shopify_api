const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const tls = require('tls');
const { exec } = require('child_process');
const axios = require('axios');

const router = express.Router();

const prisma = require('../db/prisma');
const logger = require('../utils/logger');
const { normalizeShopDomain } = require('../utils/shop');
const { requireAdmin, constantTimeEqual } = require('../middleware/adminAuth');
const { loginLimiter } = require('../middleware/rateLimiter');
const { hashKey } = require('../middleware/shopAuth');
const auditLog = require('../services/auditLog');
const productSync = require('../services/productSync');
const { API_VERSION } = require('../services/shopifyGraphql');
const { renderPage, escapeHtml, badge, fmtDate } = require('../admin/render');

// ---------------------------------------------------------------------------
// Auth: login / logout (public-ish — login itself is rate-limited)
// ---------------------------------------------------------------------------

router.get('/login', (req, res) => {
  if (req.session && req.session.admin) return res.redirect('/admin');
  const error = req.query.error ? '<p class="error">Invalid credentials</p>' : '';
  res.send(renderLogin(error));
});

router.post('/login', loginLimiter, express.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = process.env.ADMIN_USERNAME || '';
  const hash = process.env.ADMIN_PASSWORD_HASH || '';

  try {
    const userOk = username && constantTimeEqual(username, expectedUser);
    const passOk = userOk && hash ? await bcrypt.compare(String(password || ''), hash) : false;

    if (userOk && passOk) {
      req.session.admin = true;
      req.session.username = expectedUser;
      logger.info('Admin login success', { ip: req.ip });
      await auditLog.record({ action: 'admin_login', actor: 'admin', ip: req.ip });
      return res.redirect('/admin');
    }

    logger.warn('Admin login failed', { ip: req.ip });
    await auditLog.record({
      action: 'admin_login',
      actor: 'admin',
      details: { result: 'failed', username },
      ip: req.ip,
    });
    return res.redirect('/admin/login?error=1');
  } catch (err) {
    logger.error('Admin login error', { error: err.message });
    return res.redirect('/admin/login?error=1');
  }
});

router.post('/logout', requireAdmin, async (req, res) => {
  await auditLog.record({ action: 'admin_logout', actor: 'admin', ip: req.ip });
  req.session.destroy(() => res.redirect('/admin/login'));
});

// Everything below requires an authenticated admin.
router.use(requireAdmin);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

router.get('/', async (req, res, next) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [shopCount, installedCount, activeKeys, syncs, lastSync] = await Promise.all([
      prisma.shop.count(),
      prisma.shop.count({ where: { installed: true } }),
      prisma.apiKey.count({ where: { active: true } }),
      prisma.productSync.groupBy({
        by: ['status'],
        where: { createdAt: { gte: sevenDaysAgo } },
        _count: { _all: true },
      }),
      prisma.productSync.findFirst({ orderBy: { createdAt: 'desc' } }),
    ]);

    const syncStats = { success: 0, error: 0, running: 0 };
    for (const row of syncs) {
      syncStats[row.status] = row._count._all;
    }

    res.send(
      renderPage({
        view: 'dashboard.html',
        active: 'dashboard',
        title: 'Dashboard',
        vars: {
          shopCount,
          installedCount,
          activeKeys,
          syncSuccess: syncStats.success,
          syncError: syncStats.error,
          syncRunning: syncStats.running,
          lastSync: lastSync ? `${fmtDate(lastSync.createdAt)} (${escapeHtml(lastSync.shopDomain)})` : '—',
        },
      })
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------

router.get('/shops', async (req, res, next) => {
  try {
    const shops = await prisma.shop.findMany({ orderBy: { installedAt: 'desc' } });
    const rows = shops
      .map(
        (s) => `<tr>
          <td>${escapeHtml(s.shopDomain)}</td>
          <td>${badge(s.installed ? 'installed' : 'uninstalled')}</td>
          <td>${fmtDate(s.installedAt)}</td>
          <td>${fmtDate(s.lastSyncAt)}</td>
          <td class="actions">
            <a class="btn btn-sm" href="/admin/shops/${encodeURIComponent(s.shopDomain)}">View</a>
            <form method="post" action="/admin/shops/${encodeURIComponent(s.shopDomain)}/sync" style="display:inline">
              <button class="btn btn-sm" type="submit">Sync</button>
            </form>
          </td>
        </tr>`
      )
      .join('\n');

    res.send(
      renderPage({
        view: 'shops.html',
        active: 'shops',
        title: 'Shops',
        vars: { rows: rows || '<tr><td colspan="5">No shops yet.</td></tr>' },
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/shops/:domain', async (req, res, next) => {
  try {
    const domain = normalizeShopDomain(req.params.domain) || req.params.domain;
    const shop = await prisma.shop.findUnique({ where: { shopDomain: domain } });
    if (!shop) return res.status(404).send(renderError('Shop not found'));

    const syncs = await prisma.productSync.findMany({
      where: { shopDomain: domain },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const syncRows = syncs
      .map(
        (s) => `<tr>
          <td>${s.id}</td>
          <td>${badge(s.status)}</td>
          <td>${s.totalItems ?? '—'}</td>
          <td>${s.durationMs != null ? s.durationMs + ' ms' : '—'}</td>
          <td>${escapeHtml(s.triggeredBy)}</td>
          <td>${fmtDate(s.createdAt)}</td>
          <td>${escapeHtml(s.error || '')}</td>
        </tr>`
      )
      .join('\n');

    res.send(
      renderPage({
        view: 'shop-detail.html',
        active: 'shops',
        title: `Shop · ${domain}`,
        vars: {
          domain: escapeHtml(domain),
          status: badge(shop.installed ? 'installed' : 'uninstalled'),
          scopes: escapeHtml(shop.scopes),
          installedAt: fmtDate(shop.installedAt),
          uninstalledAt: fmtDate(shop.uninstalledAt),
          lastSyncAt: fmtDate(shop.lastSyncAt),
          domainEnc: encodeURIComponent(domain),
          syncRows: syncRows || '<tr><td colspan="7">No syncs yet.</td></tr>',
        },
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/shops/:domain/sync', async (req, res) => {
  const domain = normalizeShopDomain(req.params.domain) || req.params.domain;
  // Fire the sync in the background; redirect immediately.
  productSync
    .runSync(domain, { triggeredBy: 'manual', actor: 'admin', ip: req.ip })
    .catch((err) => logger.error('Manual sync failed', { shop: domain, error: err.message }));
  res.redirect(`/admin/shops/${encodeURIComponent(domain)}`);
});

router.delete('/shops/:domain', async (req, res, next) => {
  try {
    const domain = normalizeShopDomain(req.params.domain) || req.params.domain;
    const shop = await prisma.shop.findUnique({ where: { shopDomain: domain } });
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    // Revoke dependent keys + sync history, then remove the shop (and its token).
    await prisma.apiKey.updateMany({ where: { shopDomain: domain }, data: { active: false } });
    await prisma.productSync.deleteMany({ where: { shopDomain: domain } });
    await prisma.apiKey.deleteMany({ where: { shopDomain: domain } });
    await prisma.shop.delete({ where: { shopDomain: domain } });

    logger.info('Shop removed by admin', { shop: domain });
    await auditLog.record({
      action: 'uninstall',
      actor: 'admin',
      details: { shop: domain, reason: 'admin_delete' },
      ip: req.ip,
    });

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

router.get('/keys', async (req, res, next) => {
  try {
    const keys = await prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
    const created = req.query.created; // raw key shown once via query (server-rendered modal)

    const rows = keys
      .map(
        (k) => `<tr>
          <td>${escapeHtml(k.label)}</td>
          <td>${k.shopDomain ? escapeHtml(k.shopDomain) : '<em>global</em>'}</td>
          <td>${fmtDate(k.lastUsedAt)}</td>
          <td>${fmtDate(k.expiresAt)}</td>
          <td>${badge(k.active ? 'active' : 'revoked')}</td>
          <td class="actions">
            ${
              k.active
                ? `<button class="btn btn-sm btn-danger" onclick="revokeKey(${k.id})">Revoke</button>`
                : '—'
            }
          </td>
        </tr>`
      )
      .join('\n');

    const modal = created
      ? `<script>window.__newKey=${JSON.stringify(String(created))};</script>`
      : '';

    res.send(
      renderPage({
        view: 'keys.html',
        active: 'keys',
        title: 'API Keys',
        vars: {
          rows: rows || '<tr><td colspan="6">No API keys yet.</td></tr>',
          modal,
        },
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/keys', express.urlencoded({ extended: false }), async (req, res, next) => {
  try {
    const { label, shopDomain, expiresAt } = req.body || {};
    if (!label || !String(label).trim()) {
      return res.status(400).send(renderError('Label is required'));
    }

    const rawKey = crypto.randomBytes(32).toString('hex');
    const hashed = hashKey(rawKey);

    let scopeDomain = null;
    if (shopDomain && String(shopDomain).trim()) {
      scopeDomain = normalizeShopDomain(shopDomain);
      if (!scopeDomain) return res.status(400).send(renderError('Invalid shop domain for key scope'));
    }

    await prisma.apiKey.create({
      data: {
        key: hashed,
        label: String(label).trim(),
        shopDomain: scopeDomain,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    logger.info('API key created', { label, scope: scopeDomain || 'global' });
    await auditLog.record({
      action: 'key_create',
      actor: 'admin',
      details: { label, scope: scopeDomain || 'global' },
      ip: req.ip,
    });

    // Show the raw key exactly once (passed back through the redirect).
    return res.redirect(`/admin/keys?created=${encodeURIComponent(rawKey)}`);
  } catch (err) {
    next(err);
  }
});

router.delete('/keys/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid key id' });

    const key = await prisma.apiKey.findUnique({ where: { id } });
    if (!key) return res.status(404).json({ error: 'Key not found' });

    await prisma.apiKey.update({ where: { id }, data: { active: false } });

    logger.info('API key revoked', { id, label: key.label });
    await auditLog.record({
      action: 'key_revoke',
      actor: 'admin',
      details: { id, label: key.label },
      ip: req.ip,
    });

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Logs (AuditLog + ProductSync) with filters + CSV export
// ---------------------------------------------------------------------------

router.get('/logs', async (req, res, next) => {
  try {
    const { shop, status, from, to, format } = req.query;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = 50;

    const syncWhere = {};
    if (shop) syncWhere.shopDomain = normalizeShopDomain(shop) || shop;
    if (status) syncWhere.status = status;
    if (from || to) {
      syncWhere.createdAt = {};
      if (from) syncWhere.createdAt.gte = new Date(from);
      if (to) syncWhere.createdAt.lte = new Date(to);
    }

    const auditWhere = {};
    if (shop) auditWhere.actor = normalizeShopDomain(shop) || shop;
    if (from || to) {
      auditWhere.createdAt = {};
      if (from) auditWhere.createdAt.gte = new Date(from);
      if (to) auditWhere.createdAt.lte = new Date(to);
    }

    // CSV export of the combined audit log.
    if (format === 'csv') {
      const logs = await prisma.auditLog.findMany({
        where: auditWhere,
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });
      const header = 'id,action,actor,ip,createdAt,details\n';
      const body = logs
        .map((l) =>
          [
            l.id,
            l.action,
            l.actor,
            l.ip || '',
            new Date(l.createdAt).toISOString(),
            csvEscape(l.details || ''),
          ].join(',')
        )
        .join('\n');
      res.set('Content-Type', 'text/csv');
      res.set('Content-Disposition', 'attachment; filename="audit-logs.csv"');
      return res.send(header + body);
    }

    const [audit, syncs, auditTotal] = await Promise.all([
      prisma.auditLog.findMany({
        where: auditWhere,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.productSync.findMany({
        where: syncWhere,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
      }),
      prisma.auditLog.count({ where: auditWhere }),
    ]);

    const auditRows = audit
      .map(
        (l) => `<tr>
          <td>${l.id}</td>
          <td>${escapeHtml(l.action)}</td>
          <td>${escapeHtml(l.actor)}</td>
          <td>${escapeHtml(l.ip || '')}</td>
          <td>${fmtDate(l.createdAt)}</td>
          <td><code>${escapeHtml(l.details || '')}</code></td>
        </tr>`
      )
      .join('\n');

    const syncRows = syncs
      .map(
        (s) => `<tr>
          <td>${s.id}</td>
          <td>${escapeHtml(s.shopDomain)}</td>
          <td>${badge(s.status)}</td>
          <td>${s.totalItems ?? '—'}</td>
          <td>${s.durationMs != null ? s.durationMs + ' ms' : '—'}</td>
          <td>${escapeHtml(s.triggeredBy)}</td>
          <td>${fmtDate(s.createdAt)}</td>
        </tr>`
      )
      .join('\n');

    const totalPages = Math.max(1, Math.ceil(auditTotal / pageSize));
    const qs = (p) => {
      const params = new URLSearchParams();
      if (shop) params.set('shop', shop);
      if (status) params.set('status', status);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('page', p);
      return `/admin/logs?${params.toString()}`;
    };

    const pager = `
      <div class="pager">
        ${page > 1 ? `<a class="btn btn-sm" href="${qs(page - 1)}">&larr; Prev</a>` : ''}
        <span>Page ${page} / ${totalPages}</span>
        ${page < totalPages ? `<a class="btn btn-sm" href="${qs(page + 1)}">Next &rarr;</a>` : ''}
      </div>`;

    res.send(
      renderPage({
        view: 'logs.html',
        active: 'logs',
        title: 'Logs',
        vars: {
          auditRows: auditRows || '<tr><td colspan="6">No audit entries.</td></tr>',
          syncRows: syncRows || '<tr><td colspan="7">No sync records.</td></tr>',
          pager,
          shop: escapeHtml(shop || ''),
          status: escapeHtml(status || ''),
          from: escapeHtml(from || ''),
          to: escapeHtml(to || ''),
          csvLink: qs(1).replace('/admin/logs?', '/admin/logs?format=csv&'),
        },
      })
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Config (read-only, masked)
// ---------------------------------------------------------------------------

router.get('/config', (req, res) => {
  // Fully hidden secrets.
  const hidden = new Set(['TOKEN_ENCRYPTION_KEY', 'ADMIN_PASSWORD_HASH']);
  // Masked (show last 4).
  const masked = new Set([
    'SHOPIFY_CLIENT_SECRET',
    'ADMIN_SESSION_SECRET',
    'ADMIN_API_KEY',
    'DATABASE_URL',
  ]);

  const display = [
    'SHOPIFY_CLIENT_ID',
    'SHOPIFY_CLIENT_SECRET',
    'SHOPIFY_SCOPES',
    'SHOPIFY_REDIRECT_URI',
    'APP_URL',
    'DATABASE_URL',
    'PORT',
    'TOKEN_ENCRYPTION_KEY',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD_HASH',
    'ADMIN_SESSION_SECRET',
    'ADMIN_API_KEY',
    'RATE_LIMIT_MAX',
    'LOG_LEVEL',
    'NODE_ENV',
  ];

  const rows = display
    .map((key) => {
      const raw = process.env[key];
      let shown;
      if (raw == null || raw === '') shown = '<em>(not set)</em>';
      else if (hidden.has(key)) shown = '<em>(hidden)</em>';
      else if (masked.has(key)) shown = '******* ' + escapeHtml(raw.slice(-4));
      else shown = escapeHtml(raw);
      return `<tr><td><code>${key}</code></td><td>${shown}</td></tr>`;
    })
    .join('\n');

  res.send(
    renderPage({
      view: 'config.html',
      active: 'config',
      title: 'Config',
      vars: { rows },
    })
  );
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

router.get('/health', async (req, res) => {
  const checks = {};

  // DB
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok' };
  } catch (err) {
    checks.database = { status: 'error', detail: err.message };
  }

  // Shopify API reachability (admin API version endpoint, unauthenticated ping).
  try {
    const r = await axios.get(`https://shopify.dev/`, { timeout: 5000, validateStatus: () => true });
    checks.shopify = { status: r.status < 500 ? 'ok' : 'error', detail: `HTTP ${r.status}`, apiVersion: API_VERSION };
  } catch (err) {
    checks.shopify = { status: 'error', detail: err.message, apiVersion: API_VERSION };
  }

  // SSL expiry of APP_URL host.
  checks.ssl = await checkSslExpiry(process.env.APP_URL);

  // PM2 status.
  checks.pm2 = await checkPm2();

  const rows = Object.entries(checks)
    .map(([name, c]) => {
      const detail = Object.entries(c)
        .filter(([k]) => k !== 'status')
        .map(([k, v]) => `${k}: ${escapeHtml(String(v))}`)
        .join(', ');
      return `<tr><td>${escapeHtml(name)}</td><td>${badge(c.status)}</td><td>${escapeHtml(detail)}</td></tr>`;
    })
    .join('\n');

  if (req.query.format === 'json') {
    return res.json(checks);
  }

  res.send(
    renderPage({
      view: 'health.html',
      active: 'health',
      title: 'Health',
      vars: { rows },
    })
  );
});

// --- health helpers ---

function checkSslExpiry(appUrl) {
  return new Promise((resolve) => {
    if (!appUrl) return resolve({ status: 'warn', detail: 'APP_URL not set' });
    let host;
    try {
      host = new URL(appUrl).hostname;
    } catch {
      return resolve({ status: 'warn', detail: 'Invalid APP_URL' });
    }

    const socket = tls.connect(
      { host, port: 443, servername: host, timeout: 5000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          return resolve({ status: 'warn', detail: 'No certificate info' });
        }
        const expires = new Date(cert.valid_to);
        const daysLeft = Math.floor((expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        resolve({
          status: daysLeft > 14 ? 'ok' : daysLeft > 0 ? 'warn' : 'error',
          detail: `expires ${expires.toISOString().slice(0, 10)} (${daysLeft}d)`,
        });
      }
    );
    socket.on('error', (err) => resolve({ status: 'error', detail: err.message }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ status: 'error', detail: 'TLS timeout' });
    });
  });
}

function checkPm2() {
  return new Promise((resolve) => {
    exec('pm2 jlist', { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve({ status: 'warn', detail: 'pm2 not available' });
      try {
        const list = JSON.parse(stdout);
        const app = list.find((p) => p.name === 'shopify-connector') || list[0];
        if (!app) return resolve({ status: 'warn', detail: 'no pm2 process' });
        const s = app.pm2_env && app.pm2_env.status;
        return resolve({
          status: s === 'online' ? 'ok' : 'error',
          detail: `${app.name}: ${s}, restarts: ${app.pm2_env ? app.pm2_env.restart_time : '?'}`,
        });
      } catch (e) {
        return resolve({ status: 'warn', detail: 'could not parse pm2 output' });
      }
    });
  });
}

// --- misc helpers ---

function csvEscape(value) {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function renderError(msg) {
  return `<!doctype html><html><body style="font-family:sans-serif;padding:40px">
    <h2>Error</h2><p>${escapeHtml(msg)}</p><a href="/admin">Back to dashboard</a></body></html>`;
}

function renderLogin(errorHtml) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Admin Login</title>
<style>
  body { font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:#f6f6f7; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  .card { background:#fff; padding:40px; border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,.1); width:320px; }
  h1 { font-size:20px; margin:0 0 20px; }
  label { display:block; font-size:13px; margin:12px 0 4px; color:#555; }
  input { width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; box-sizing:border-box; }
  button { margin-top:20px; width:100%; padding:10px; background:#008060; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:14px; }
  button:hover { background:#006e52; }
  .error { color:#bf0711; font-size:13px; }
</style></head>
<body><form class="card" method="post" action="/admin/login">
  <h1>Admin Login</h1>
  ${errorHtml}
  <label>Username</label>
  <input name="username" autocomplete="username" required>
  <label>Password</label>
  <input name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
</form></body></html>`;
}

module.exports = router;
