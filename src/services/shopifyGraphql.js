const axios = require('axios');
const prisma = require('../db/prisma');
const logger = require('../utils/logger');
const { decrypt } = require('./tokenEncryption');

const API_VERSION = '2026-04';
const PAGE_DELAY_MS = 500;

function endpoint(shop) {
  return `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Load a shop and return its decrypted access token. Decryption stays in-memory;
// the plaintext token is never logged or returned beyond this module's callers.
async function getAccessToken(shop) {
  const record = await prisma.shop.findUnique({
    where: { shopDomain: shop },
  });
  if (!record || !record.installed) {
    throw new Error(`Shop not installed: ${shop}`);
  }
  return decrypt(record.accessToken);
}

// Issue a single GraphQL request against a shop's Admin API.
async function graphqlRequest(shop, accessToken, query, variables = {}) {
  const { data } = await axios.post(
    endpoint(shop),
    { query, variables },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      timeout: 20000,
    }
  );

  if (data.errors) {
    throw new Error(
      `Shopify GraphQL error: ${JSON.stringify(data.errors)}`
    );
  }
  return data.data;
}

const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          status
          vendor
          productType
          createdAt
          updatedAt
          totalInventory
          variants(first: 50) {
            edges {
              node {
                id
                title
                sku
                price
                inventoryQuantity
              }
            }
          }
        }
      }
    }
  }
`;

// Fetch a single page of products for a shop (used by the public product API).
// Returns { products, pageInfo } where pageInfo = { hasNextPage, endCursor }.
async function fetchProductsPage(shop, cursor = null) {
  const accessToken = await getAccessToken(shop);
  const data = await graphqlRequest(shop, accessToken, PRODUCTS_QUERY, {
    cursor,
  });
  const connection = data.products;
  const products = connection.edges.map((edge) => edge.node);
  return { products, pageInfo: connection.pageInfo };
}

// Fetch ALL products for a shop, paginating cursor-by-cursor with a delay
// between pages. Records a ProductSync row (running -> success/error).
async function syncAllProducts(shop, { triggeredBy = 'manual' } = {}) {
  const start = Date.now();

  const syncRecord = await prisma.productSync.create({
    data: { shopDomain: shop, status: 'running', triggeredBy },
  });

  logger.info('Product sync started', { shop, syncId: syncRecord.id, triggeredBy });

  try {
    const accessToken = await getAccessToken(shop);
    let cursor = null;
    let hasNextPage = true;
    let total = 0;

    while (hasNextPage) {
      const data = await graphqlRequest(shop, accessToken, PRODUCTS_QUERY, {
        cursor,
      });
      const connection = data.products;
      total += connection.edges.length;
      hasNextPage = connection.pageInfo.hasNextPage;
      cursor = connection.pageInfo.endCursor;

      if (hasNextPage) await sleep(PAGE_DELAY_MS);
    }

    const durationMs = Date.now() - start;

    await prisma.productSync.update({
      where: { id: syncRecord.id },
      data: { status: 'success', totalItems: total, durationMs },
    });
    await prisma.shop.update({
      where: { shopDomain: shop },
      data: { lastSyncAt: new Date() },
    });

    logger.info('Product sync finished', {
      shop,
      syncId: syncRecord.id,
      totalItems: total,
      durationMs,
    });

    return { syncId: syncRecord.id, totalItems: total, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    await prisma.productSync.update({
      where: { id: syncRecord.id },
      data: {
        status: 'error',
        error: err.message,
        durationMs,
      },
    });
    logger.error('Product sync failed', {
      shop,
      syncId: syncRecord.id,
      error: err.message,
      stack: err.stack,
    });
    throw err;
  }
}

module.exports = {
  API_VERSION,
  fetchProductsPage,
  syncAllProducts,
};
