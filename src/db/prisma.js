const { PrismaClient } = require('@prisma/client');

// Single shared PrismaClient instance for the whole process.
const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'production'
      ? ['warn', 'error']
      : ['query', 'warn', 'error'],
});

module.exports = prisma;
