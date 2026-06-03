const express = require('express');
const router = express.Router();

const prisma = require('../db/prisma');
const logger = require('../utils/logger');
const { verifyWebhookHmac } = require('../utils/hmac');
const auditLog = require('../services/auditLog');

// Webhook routes rely on the raw body captured by the verify hook in server.js
// (req.rawBody). HMAC must be checked BEFORE trusting any payload content.
function verifyHmacMiddleware(req, res, next) {
  const headerHmac = req.get('x-shopify-hmac-sha256');
  if (!verifyWebhookHmac(req.rawBody, headerHmac)) {
    logger.warn('Webhook HMAC validation failed', {
      topic: req.get('x-shopify-topic'),
      shop: req.get('x-shopify-shop-domain'),
    });
    return res.status(401).send('HMAC validation failed');
  }
  return next();
}

router.use(verifyHmacMiddleware);

// POST /webhooks/app/uninstalled — mark shop uninstalled.
router.post('/app/uninstalled', async (req, res) => {
  const shop = req.get('x-shopify-shop-domain');
  try {
    if (shop) {
      await prisma.shop.updateMany({
        where: { shopDomain: shop },
        data: { installed: false, uninstalledAt: new Date() },
      });
      logger.info('App uninstalled', { shop });
      await auditLog.record({ action: 'uninstall', actor: shop, ip: req.ip });
    }
  } catch (err) {
    logger.error('Failed to process uninstall webhook', { shop, error: err.message });
  }
  // Always 200 so Shopify stops retrying.
  return res.status(200).send('ok');
});

// GDPR mandatory webhooks — log and acknowledge.
router.post('/customers/data_request', async (req, res) => {
  const shop = req.get('x-shopify-shop-domain');
  logger.info('GDPR customers/data_request', { shop });
  await auditLog.record({
    action: 'sync',
    actor: shop || 'system',
    details: { gdpr: 'customers/data_request' },
    ip: req.ip,
  });
  return res.status(200).send('ok');
});

router.post('/customers/redact', async (req, res) => {
  const shop = req.get('x-shopify-shop-domain');
  logger.info('GDPR customers/redact', { shop });
  await auditLog.record({
    action: 'sync',
    actor: shop || 'system',
    details: { gdpr: 'customers/redact' },
    ip: req.ip,
  });
  return res.status(200).send('ok');
});

router.post('/shop/redact', async (req, res) => {
  const shop = req.get('x-shopify-shop-domain');
  logger.info('GDPR shop/redact', { shop });
  await auditLog.record({
    action: 'sync',
    actor: shop || 'system',
    details: { gdpr: 'shop/redact' },
    ip: req.ip,
  });
  return res.status(200).send('ok');
});

module.exports = router;
