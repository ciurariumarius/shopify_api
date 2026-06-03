const crypto = require('crypto');
const prisma = require('../db/prisma');
const logger = require('../utils/logger');

// Hash an incoming raw API key the same way we store it.
function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// API-key auth for the public product API.
// Expects: Authorization: Bearer <key>
// Validates SHA-256 hash against the DB, checks active + expiry, bumps lastUsedAt.
async function apiKeyAuth(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const rawKey = match[1].trim();
    const hashed = hashKey(rawKey);

    const apiKey = await prisma.apiKey.findUnique({ where: { key: hashed } });

    if (!apiKey || !apiKey.active) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
      return res.status(401).json({ error: 'API key expired' });
    }

    // Best-effort lastUsedAt update; don't block the request on it.
    prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch((err) => logger.warn('Failed to update lastUsedAt', { error: err.message }));

    // Attach the key context (scope) for downstream handlers.
    req.apiKey = { id: apiKey.id, label: apiKey.label, shopDomain: apiKey.shopDomain };
    return next();
  } catch (err) {
    logger.error('API key auth error', { error: err.message, stack: err.stack });
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

module.exports = { apiKeyAuth, hashKey };
