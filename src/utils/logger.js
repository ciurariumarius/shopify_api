const winston = require('winston');

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Fields whose values must never reach the logs in plaintext.
const REDACTED_KEYS = new Set([
  'accessToken',
  'access_token',
  'token',
  'SHOPIFY_CLIENT_SECRET',
  'clientSecret',
  'client_secret',
  'TOKEN_ENCRYPTION_KEY',
  'apiKey',
  'api_key',
  'authorization',
  'password',
  'ADMIN_PASSWORD_HASH',
  'ADMIN_SESSION_SECRET',
]);

// Recursively scrub sensitive keys from any logged metadata object.
const redact = winston.format((info) => {
  const scrub = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 6) return obj;
    for (const key of Object.keys(obj)) {
      if (REDACTED_KEYS.has(key)) {
        obj[key] = '[REDACTED]';
      } else if (obj[key] && typeof obj[key] === 'object') {
        scrub(obj[key], depth + 1);
      }
    }
    return obj;
  };
  return scrub(info);
});

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    redact(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'shopify-connector' },
  transports: [
    new winston.transports.Console({
      format:
        process.env.NODE_ENV === 'production'
          ? winston.format.json()
          : winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            ),
    }),
  ],
});

module.exports = logger;
