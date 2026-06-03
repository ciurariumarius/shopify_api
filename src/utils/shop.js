// Helpers for validating and normalizing Shopify shop domains.

// Valid myshopify domain: lowercase alphanumeric + hyphens, ending in .myshopify.com
const SHOP_REGEX = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

// Normalize user input into a canonical shop domain, or return null if invalid.
// Accepts "my-shop", "my-shop.myshopify.com", or a full URL.
function normalizeShopDomain(input) {
  if (!input || typeof input !== 'string') return null;

  let shop = input.trim().toLowerCase();

  // Strip protocol and any path/query.
  shop = shop.replace(/^https?:\/\//, '').split('/')[0].split('?')[0];

  // Bare handle -> append the myshopify suffix.
  if (!shop.includes('.')) {
    shop = `${shop}.myshopify.com`;
  }

  return isValidShopDomain(shop) ? shop : null;
}

function isValidShopDomain(shop) {
  if (!shop || typeof shop !== 'string') return false;
  if (shop.length > 255) return false;
  return SHOP_REGEX.test(shop);
}

module.exports = { normalizeShopDomain, isValidShopDomain };
