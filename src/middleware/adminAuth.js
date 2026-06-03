const crypto = require('crypto');
const logger = require('../utils/logger');

// Session-based admin guard. Also accepts a programmatic admin API key via
// the X-Admin-Api-Key header (constant-time compared against ADMIN_API_KEY).
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) {
    return next();
  }

  // Programmatic access path.
  const provided = req.get('x-admin-api-key');
  const expected = process.env.ADMIN_API_KEY;
  if (provided && expected && constantTimeEqual(provided, expected)) {
    req.adminApiAccess = true;
    return next();
  }

  // Browser requests get redirected to the login page; API clients get 401.
  if (req.accepts(['html', 'json']) === 'json' || req.xhr) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/admin/login');
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

module.exports = { requireAdmin, constantTimeEqual };
