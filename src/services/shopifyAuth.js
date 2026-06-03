const axios = require('axios');
const prisma = require('../db/prisma');
const logger = require('../utils/logger');
const { encrypt } = require('./tokenEncryption');
const auditLog = require('./auditLog');

// Build the Shopify OAuth authorization URL to redirect the merchant to.
function buildAuthorizeUrl(shop, state) {
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_CLIENT_ID || '',
    scope: process.env.SHOPIFY_SCOPES || '',
    redirect_uri: process.env.SHOPIFY_REDIRECT_URI || '',
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

// Exchange an authorization code for a permanent access token.
async function exchangeCodeForToken(shop, code) {
  const url = `https://${shop}/admin/oauth/access_token`;
  const { data } = await axios.post(
    url,
    {
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      code,
    },
    { timeout: 15000 }
  );
  // data: { access_token, scope }
  return data;
}

// Complete an install: exchange the code, encrypt + persist the token, upsert the Shop.
async function completeInstall({ shop, code, ip }) {
  const tokenResponse = await exchangeCodeForToken(shop, code);
  const accessToken = tokenResponse.access_token;
  const scopes = tokenResponse.scope || process.env.SHOPIFY_SCOPES || '';

  if (!accessToken) {
    throw new Error('Shopify did not return an access token');
  }

  const encryptedToken = encrypt(accessToken);

  await prisma.shop.upsert({
    where: { shopDomain: shop },
    create: {
      shopDomain: shop,
      accessToken: encryptedToken,
      scopes,
      installed: true,
      installedAt: new Date(),
      uninstalledAt: null,
    },
    update: {
      accessToken: encryptedToken,
      scopes,
      installed: true,
      installedAt: new Date(),
      uninstalledAt: null,
    },
  });

  logger.info('Shop installed', { shop });
  await auditLog.record({
    action: 'install',
    actor: shop,
    details: { scopes },
    ip,
  });

  return { shop, scopes };
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  completeInstall,
};
