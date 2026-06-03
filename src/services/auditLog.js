const prisma = require('../db/prisma');
const logger = require('../utils/logger');

// Write an audit log entry. Never throws — auditing must not break the request.
// action: install | uninstall | sync | key_create | key_revoke | admin_login | admin_logout
// actor:  shopDomain | admin | system
async function record({ action, actor, details, ip }) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        actor: actor || 'system',
        details:
          details == null
            ? null
            : typeof details === 'string'
              ? details
              : JSON.stringify(details),
        ip: ip || null,
      },
    });
  } catch (err) {
    logger.error('Failed to write audit log', {
      action,
      actor,
      error: err.message,
    });
  }
}

module.exports = { record };
