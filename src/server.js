require('dotenv').config();

const express = require('express');
const session = require('express-session');

const logger = require('./utils/logger');
const prisma = require('./db/prisma');
const { apiLimiter } = require('./middleware/rateLimiter');

const shopifyRoutes = require('./routes/shopify');
const productRoutes = require('./routes/products');
const webhookRoutes = require('./routes/webhooks');
const adminRoutes = require('./routes/admin');
const legalRoutes = require('./routes/legal');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Nginx — trust the proxy so req.ip and secure cookies work.
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Body parsing
//   Webhooks need the RAW body for HMAC verification, so capture it via the
//   `verify` hook before JSON parsing. Everything else uses normal JSON.
// ---------------------------------------------------------------------------
app.use(
  '/webhooks',
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Standard JSON parsing for the rest of the app (admin routes that need form
// bodies attach express.urlencoded locally).
app.use(express.json());

// ---------------------------------------------------------------------------
// Sessions (admin panel)
// ---------------------------------------------------------------------------
app.use(
  session({
    secret: process.env.ADMIN_SESSION_SECRET || 'change-me-in-env',
    name: 'connector.sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  })
);

// Lightweight request logging.
app.use((req, _res, next) => {
  logger.debug('request', { method: req.method, path: req.path, ip: req.ip });
  next();
});

// ---------------------------------------------------------------------------
// Public health probe (for load balancers / uptime checks)
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/', (_req, res) => res.json({ app: 'shopify-product-connector', status: 'ok' }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/shopify', shopifyRoutes);
app.use('/api', apiLimiter, productRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/admin', adminRoutes);
app.use('/', legalRoutes); // /privacy, /terms

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Centralized error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Startup / graceful shutdown
// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  logger.info(`Shopify connector listening on port ${PORT}`, {
    env: process.env.NODE_ENV,
  });
});

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Force-exit if shutdown hangs.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
