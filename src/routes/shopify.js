const express = require('express');
const router = express.Router();

const logger = require('../utils/logger');
const { normalizeShopDomain } = require('../utils/shop');
const { createState, consumeState } = require('../utils/state');
const { verifyOAuthHmac } = require('../utils/hmac');
const shopifyAuth = require('../services/shopifyAuth');
const { installLimiter } = require('../middleware/rateLimiter');

// GET /shopify/install — validate shop, generate state, redirect to Shopify OAuth.
router.get('/install', installLimiter, (req, res) => {
  const shop = normalizeShopDomain(req.query.shop);
  if (!shop) {
    return res.status(400).send('Invalid or missing shop parameter.');
  }

  const state = createState(shop);
  const authorizeUrl = shopifyAuth.buildAuthorizeUrl(shop, state);

  logger.info('OAuth install initiated', { shop });
  return res.redirect(authorizeUrl);
});

// GET /shopify/callback — verify state + HMAC, exchange code, encrypt + save.
router.get('/callback', async (req, res) => {
  try {
    const { shop: rawShop, code, state } = req.query;

    const shop = normalizeShopDomain(rawShop);
    if (!shop) {
      return res.status(400).send('Invalid shop parameter.');
    }

    // One-time state check (also binds the original shop).
    const expectedShop = consumeState(state);
    if (!expectedShop || expectedShop !== shop) {
      logger.warn('OAuth state validation failed', { shop });
      return res.status(403).send('Invalid or expired OAuth state.');
    }

    // HMAC verification of the full query string.
    if (!verifyOAuthHmac(req.query)) {
      logger.warn('OAuth HMAC validation failed', { shop });
      return res.status(403).send('HMAC validation failed.');
    }

    if (!code) {
      return res.status(400).send('Missing authorization code.');
    }

    await shopifyAuth.completeInstall({ shop, code, ip: req.ip });

    return res.redirect(`/shopify/status?shop=${encodeURIComponent(shop)}`);
  } catch (err) {
    logger.error('OAuth callback error', { error: err.message, stack: err.stack });
    return res.status(500).send('Installation failed. Please try again.');
  }
});

// GET /shopify/status — post-install success page.
router.get('/status', (req, res) => {
  const shop = normalizeShopDomain(req.query.shop) || '';
  res.set('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Installed</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#f6f6f7; color:#202223; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  .card { background:#fff; padding:48px; border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,.1); text-align:center; max-width:480px; }
  .check { font-size:48px; color:#108043; }
  code { background:#f1f1f1; padding:2px 6px; border-radius:4px; }
</style></head>
<body><div class="card">
  <div class="check">&#10003;</div>
  <h1>App installed successfully</h1>
  <p>The connector is now linked to <code>${escapeHtml(shop)}</code>.</p>
  <p>You can close this window.</p>
</div></body></html>`);
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

module.exports = router;
