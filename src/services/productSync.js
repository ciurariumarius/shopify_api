const prisma = require('../db/prisma');
const logger = require('../utils/logger');
const shopifyGraphql = require('./shopifyGraphql');
const auditLog = require('./auditLog');

// Orchestrates a product sync for a shop: delegates the GraphQL pagination to
// shopifyGraphql.syncAllProducts and wraps it with audit logging.
async function runSync(shop, { triggeredBy = 'manual', actor, ip } = {}) {
  const result = await shopifyGraphql.syncAllProducts(shop, { triggeredBy });

  await auditLog.record({
    action: 'sync',
    actor: actor || shop,
    details: {
      syncId: result.syncId,
      totalItems: result.totalItems,
      durationMs: result.durationMs,
      triggeredBy,
    },
    ip,
  });

  return result;
}

// Look up a single sync job's status.
async function getSyncStatus(id) {
  return prisma.productSync.findUnique({ where: { id: Number(id) } });
}

module.exports = { runSync, getSyncStatus };
