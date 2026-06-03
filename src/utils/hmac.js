const crypto = require('crypto');

const CLIENT_SECRET = () => process.env.SHOPIFY_CLIENT_SECRET || '';

// Constant-time comparison of two hex/base64 digest strings.
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Verify the HMAC on an OAuth callback query string.
// Per Shopify: remove the `hmac` (and `signature`) param, sort the rest,
// build a query string, and HMAC-SHA256 it with the client secret.
function verifyOAuthHmac(query) {
  if (!query || typeof query !== 'object') return false;
  const { hmac } = query;
  if (!hmac) return false;

  const message = Object.keys(query)
    .filter((key) => key !== 'hmac' && key !== 'signature')
    .sort()
    .map((key) => `${key}=${query[key]}`)
    .join('&');

  const digest = crypto
    .createHmac('sha256', CLIENT_SECRET())
    .update(message)
    .digest('hex');

  return safeCompare(digest, hmac);
}

// Verify a webhook HMAC. `rawBody` must be the exact raw request body (Buffer
// or string), and `headerHmac` is the X-Shopify-Hmac-Sha256 header (base64).
function verifyWebhookHmac(rawBody, headerHmac) {
  if (!rawBody || !headerHmac) return false;

  const digest = crypto
    .createHmac('sha256', CLIENT_SECRET())
    .update(rawBody, 'utf8')
    .digest('base64');

  return safeCompare(digest, headerHmac);
}

module.exports = { verifyOAuthHmac, verifyWebhookHmac, safeCompare };
