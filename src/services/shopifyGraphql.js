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

// Orders query — deliberately selects ONLY financial + line-item data.
// No customer block, email, phone, or addresses are requested, which keeps
// this within Protected Customer Data "Level 1" (no Level 2 fields).
const ORDERS_QUERY = `
  query Orders($cursor: String) {
    orders(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          createdAt
          processedAt
          displayFinancialStatus
          displayFulfillmentStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount currencyCode } }
          totalTaxSet { shopMoney { amount currencyCode } }
          totalDiscountsSet { shopMoney { amount currencyCode } }
          lineItems(first: 100) {
            edges {
              node {
                title
                sku
                quantity
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                discountedUnitPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
      }
    }
  }
`;

// Flatten an order node into a compact, customer-data-free shape.
function mapOrder(node) {
  const money = (set) => (set && set.shopMoney ? set.shopMoney.amount : null);
  const currency = (set) => (set && set.shopMoney ? set.shopMoney.currencyCode : null);
  return {
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    processedAt: node.processedAt,
    financialStatus: node.displayFinancialStatus,
    fulfillmentStatus: node.displayFulfillmentStatus,
    currency: currency(node.currentTotalPriceSet),
    total: money(node.currentTotalPriceSet),
    subtotal: money(node.subtotalPriceSet),
    tax: money(node.totalTaxSet),
    discounts: money(node.totalDiscountsSet),
    lineItems: node.lineItems.edges.map((e) => ({
      title: e.node.title,
      sku: e.node.sku,
      quantity: e.node.quantity,
      unitPrice: money(e.node.originalUnitPriceSet),
      discountedUnitPrice: money(e.node.discountedUnitPriceSet),
    })),
  };
}

// Fetch a single page of orders for a shop (cursor-based).
// Returns { orders, pageInfo }. Contains no customer PII.
async function fetchOrdersPage(shop, cursor = null) {
  const accessToken = await getAccessToken(shop);
  const data = await graphqlRequest(shop, accessToken, ORDERS_QUERY, { cursor });
  const connection = data.orders;
  const orders = connection.edges.map((edge) => mapOrder(edge.node));
  return { orders, pageInfo: connection.pageInfo };
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

const REGISTER_WEBHOOK_MUTATION = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;

// Subscribe a shop to a webhook topic (e.g. APP_UNINSTALLED) pointing at our URL.
// Idempotent: "already exists / address taken" errors are swallowed so re-installs
// don't fail. Returns the subscription id, or null if it already existed.
async function registerWebhook(shop, topic, callbackUrl) {
  const accessToken = await getAccessToken(shop);
  const data = await graphqlRequest(shop, accessToken, REGISTER_WEBHOOK_MUTATION, {
    topic,
    webhookSubscription: { callbackUrl, format: 'JSON' },
  });

  const result = data.webhookSubscriptionCreate || {};
  const errors = (result.userErrors || []).filter(
    (e) => !/already|taken|exists/i.test(e.message || '')
  );
  if (errors.length) {
    throw new Error(`webhookSubscriptionCreate failed: ${JSON.stringify(errors)}`);
  }
  return result.webhookSubscription ? result.webhookSubscription.id : null;
}

module.exports = {
  API_VERSION,
  fetchProductsPage,
  fetchOrdersPage,
  syncAllProducts,
  registerWebhook,
};
