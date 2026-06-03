# App Store Listing — draft copy

Use this when filling in the Shopify Partner dashboard app listing. The listing
can be **unlisted** (not publicly searchable) if you only serve your own clients.

---

## App name
Limitless Connector

## Tagline (short description, ~62 chars)
Sync products, inventory & sales data for reporting and analytics.

## App icon
A simple square logo (1200×1200 px recommended). Use the Limitless Agency mark.

## Primary category
Store management → Analytics (or Reporting)

## Key benefits (3 bullets — title + 1–2 sentences each)

1. **Unified product & sales data**
   Pull your store's products, inventory levels, and order/sales figures into one
   place through a secure API — no manual exports.

2. **Privacy-first by design**
   The connector reads only what it needs. It never accesses customer names,
   emails, phone numbers, or addresses — only order totals and line items.

3. **Secure and auditable**
   Access tokens are encrypted with AES-256-GCM, every request is HMAC-verified,
   and all administrative actions are logged.

## Detailed description

Limitless Connector gives merchants and their agencies a reliable way to access
store data for reporting and analytics. After a one-click install, the app
securely connects to your store via the Shopify Admin API and exposes your
products, inventory, and sales data through an authenticated API.

Sales reporting is built on order totals, dates, financial and fulfillment
status, and line items — without touching any customer personal information.
The app is intended for back-office reporting use and has no storefront
component.

Security is a first-class concern: Shopify access tokens are encrypted at rest,
all webhooks and OAuth callbacks are verified with HMAC signatures, API access
is protected with revocable keys, and every action is recorded in an audit log.

## Demo / test instructions for the reviewer
- Install link: https://dev.populatia.ro/shopify/install?shop={store}.myshopify.com
- After install, the admin panel at https://dev.populatia.ro/admin shows the
  connected shop, sync history, and lets you create an API key.
- Product data: `GET /api/products?shop={store}.myshopify.com` with
  `Authorization: Bearer <key>`
- Sales data: `GET /api/orders?shop={store}.myshopify.com` with the same header.

## URLs
- App URL: https://dev.populatia.ro
- Privacy policy: https://dev.populatia.ro/privacy
- Terms of service: https://dev.populatia.ro/terms
- Support / contact email: gtm@limitless.ro

## Pricing
Free (or "Custom — contact us" if billed outside Shopify).

## Requested access scopes
- read_products
- read_inventory
- read_product_feeds
- read_orders   ← protected customer data (Level 1)
