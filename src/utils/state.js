const crypto = require('crypto');

// In-memory, single-use OAuth state store with a 10-minute TTL.
// Single instance only (matches the MVP's instances: 1 PM2 config).
const TTL_MS = 10 * 60 * 1000;
const store = new Map(); // state -> { shop, expiresAt }

// Generate and persist a new state value bound to a shop domain.
function createState(shop) {
  const state = crypto.randomBytes(16).toString('hex');
  store.set(state, { shop, expiresAt: Date.now() + TTL_MS });
  return state;
}

// Consume a state value: returns the bound shop if valid + unexpired, else null.
// The state is always deleted (one-time use).
function consumeState(state) {
  if (!state) return null;
  const entry = store.get(state);
  store.delete(state);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.shop;
}

// Periodically evict expired entries so the Map doesn't grow unbounded.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(state);
  }
}, 60 * 1000);
sweep.unref();

module.exports = { createState, consumeState };
