const express = require('express');
const router = express.Router();

const logger = require('../utils/logger');
const { normalizeShopDomain } = require('../utils/shop');
const { apiKeyAuth } = require('../middleware/shopAuth');
const shopifyGraphql = require('../services/shopifyGraphql');
const { getSyncStatus } = require('../services/productSync');

// All product API routes require a valid API key.
router.use(apiKeyAuth);

// GET /api/products?shop=&cursor= — fetch a paginated page of products.
router.get('/products', async (req, res) => {
  const shop = normalizeShopDomain(req.query.shop);
  if (!shop) {
    return res.status(400).json({ error: 'Invalid or missing shop parameter' });
  }

  // Shop-scoped keys may only access their own shop.
  if (req.apiKey.shopDomain && req.apiKey.shopDomain !== shop) {
    return res.status(403).json({ error: 'API key not authorized for this shop' });
  }

  try {
    const cursor = req.query.cursor || null;
    const { products, pageInfo } = await shopifyGraphql.fetchProductsPage(shop, cursor);
    return res.json({
      shop,
      count: products.length,
      products,
      pageInfo,
    });
  } catch (err) {
    logger.error('Product fetch failed', { shop, error: err.message });
    if (/not installed/i.test(err.message)) {
      return res.status(404).json({ error: 'Shop not installed' });
    }
    return res.status(502).json({ error: 'Failed to fetch products from Shopify' });
  }
});

// GET /api/sync/:id — status of a sync job.
router.get('/sync/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid sync id' });
  }

  const sync = await getSyncStatus(id);
  if (!sync) {
    return res.status(404).json({ error: 'Sync not found' });
  }

  if (req.apiKey.shopDomain && req.apiKey.shopDomain !== sync.shopDomain) {
    return res.status(403).json({ error: 'API key not authorized for this shop' });
  }

  return res.json({
    id: sync.id,
    shop: sync.shopDomain,
    status: sync.status,
    totalItems: sync.totalItems,
    error: sync.error,
    durationMs: sync.durationMs,
    triggeredBy: sync.triggeredBy,
    createdAt: sync.createdAt,
  });
});

module.exports = router;
