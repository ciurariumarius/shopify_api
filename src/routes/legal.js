const express = require('express');
const router = express.Router();

// Public legal pages required for Shopify app review / App Store listing:
//   /privacy  — Privacy Policy (required for protected customer data access)
//   /terms    — Terms of Service
// These are intentionally unauthenticated so Shopify reviewers and merchants
// can read them. Content is written to match the app's actual behaviour.

const COMPANY = 'Limitless Agency';
const APP_NAME = 'Limitless Connector';
const CONTACT_EMAIL = 'gtm@limitless.ro';
const LAST_UPDATED = 'June 3, 2026';

function page(title, bodyHtml) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${APP_NAME}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #202223; max-width: 820px; margin: 0 auto; padding: 48px 24px; }
  h1 { font-size: 28px; }
  h2 { font-size: 19px; margin-top: 32px; }
  h3 { font-size: 16px; margin-top: 22px; }
  .muted { color: #6d7175; font-size: 14px; }
  ul { padding-left: 20px; }
  code { background: #f1f1f1; padding: 1px 5px; border-radius: 4px; }
  a { color: #2c6ecb; }
  footer { margin-top: 48px; border-top: 1px solid #eee; padding-top: 16px; font-size: 13px; color: #6d7175; }
</style></head>
<body>
${bodyHtml}
<footer>
  ${APP_NAME} is operated by ${COMPANY}. Contact: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.<br>
  Last updated ${LAST_UPDATED}.
</footer>
</body></html>`;
}

// GET /privacy
router.get('/privacy', (_req, res) => {
  res.set('Content-Type', 'text/html');
  res.send(
    page(
      'Privacy Policy',
      `<h1>Privacy Policy</h1>
<p class="muted">Last updated ${LAST_UPDATED}</p>

<p>This Privacy Policy explains how <strong>${COMPANY}</strong> ("we", "us")
collects, uses, and protects data through the <strong>${APP_NAME}</strong>
application ("the App") when a Shopify merchant ("Merchant") installs it on
their store.</p>

<h2>1. Who this policy is for</h2>
<p>The App is a back-office data connector used by Merchants to retrieve their
own store data (products, inventory, and order/sales information) for reporting
and analytics. It has no storefront component and does not interact with a
Merchant's shoppers directly.</p>

<h2>2. Data we access</h2>
<p>When a Merchant authorizes the App via Shopify OAuth, we are granted access,
through the Shopify Admin API, to the following store data:</p>
<ul>
  <li><strong>Products &amp; inventory</strong>: product titles, handles, SKUs,
      variants, prices, and inventory quantities.</li>
  <li><strong>Order / sales data</strong>: order numbers, dates, financial and
      fulfillment status, order totals, taxes, discounts, and line items
      (product title, SKU, quantity, price).</li>
</ul>

<h3>Data we do NOT access</h3>
<p>The App is designed to operate without customer personal information. We do
<strong>not</strong> request, retrieve, display, or store customer
<strong>names, email addresses, phone numbers, or physical/billing/shipping
addresses</strong>. Our order queries deliberately exclude these fields. We
operate at Shopify's "protected customer data — Level 1" tier only.</p>

<h2>3. How we use data</h2>
<p>Accessed store data is used solely to provide the Merchant with sales,
product, and inventory reporting and to expose that data back to the Merchant
(or systems the Merchant authorizes) through an authenticated API. We do not
use the data for advertising, profiling, or any purpose unrelated to the
service the Merchant installed the App to perform.</p>

<h2>4. How data is stored and secured</h2>
<ul>
  <li><strong>Access tokens</strong> issued by Shopify are encrypted at rest
      using <code>AES-256-GCM</code> with a unique initialization vector per
      token. Decrypted tokens exist only in memory for the duration of an API
      call and are never logged.</li>
  <li><strong>Order and product data</strong> is retrieved from Shopify
      <em>on demand</em> and returned to the Merchant; it is not persisted in
      our database. We retain only operational metadata about synchronization
      jobs (e.g. item counts, durations, timestamps) and audit records of
      administrative actions.</li>
  <li>All traffic is served over <strong>HTTPS/TLS</strong>.</li>
  <li>Administrative access to the App is protected by authentication, rate
      limiting, and audit logging.</li>
  <li>Webhook and OAuth requests are verified with HMAC signatures before
      processing.</li>
</ul>

<h2>5. Data sharing</h2>
<p>We do not sell Merchant or customer data. Data is not shared with third
parties except infrastructure providers strictly necessary to operate the
service (hosting and database), who process data on our behalf under
confidentiality obligations.</p>

<h2>6. Data retention and deletion</h2>
<ul>
  <li>When a Merchant uninstalls the App, the associated Shopify access token is
      invalidated and the store is marked uninstalled. We honour Shopify's
      mandatory compliance webhooks
      (<code>shop/redact</code>, <code>customers/redact</code>,
      <code>customers/data_request</code>).</li>
  <li>Because customer personal data is never stored, there is no customer
      personal data for us to erase on a redaction request; we log and
      acknowledge such requests as required.</li>
  <li>Operational metadata and audit logs are retained only as long as needed
      for security and troubleshooting, then deleted.</li>
</ul>

<h2>7. Merchant and data-subject rights</h2>
<p>Merchants may request access to, or deletion of, the data we hold about their
store at any time by contacting us. Where applicable under the GDPR, CCPA, or
similar laws, data subjects may exercise their rights through the Merchant, who
acts as the data controller for their store's data.</p>

<h2>8. International transfers</h2>
<p>Data may be processed on servers located in the European Union. Any transfer
is carried out in accordance with applicable data-protection law.</p>

<h2>9. Changes to this policy</h2>
<p>We may update this policy from time to time. Material changes will be
reflected by updating the "Last updated" date above.</p>

<h2>10. Contact</h2>
<p>For privacy questions or data requests, contact
<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`
    )
  );
});

// GET /terms
router.get('/terms', (_req, res) => {
  res.set('Content-Type', 'text/html');
  res.send(
    page(
      'Terms of Service',
      `<h1>Terms of Service</h1>
<p class="muted">Last updated ${LAST_UPDATED}</p>

<p>These Terms of Service ("Terms") govern use of the <strong>${APP_NAME}</strong>
application ("the App") provided by <strong>${COMPANY}</strong> ("we", "us").
By installing or using the App, the Shopify merchant ("you") agrees to these
Terms.</p>

<h2>1. Service</h2>
<p>The App connects to your Shopify store via the Shopify Admin API to retrieve
your product, inventory, and order/sales data and make it available to you for
reporting and analytics.</p>

<h2>2. Authorization</h2>
<p>You authorize the App to access the data described in our
<a href="/privacy">Privacy Policy</a> using the scopes granted during
installation. You may revoke access at any time by uninstalling the App from
your Shopify admin.</p>

<h2>3. Acceptable use</h2>
<ul>
  <li>You will use the App only with stores you own or are authorized to manage.</li>
  <li>You will not attempt to access data belonging to stores you are not
      authorized for, reverse-engineer the App, or use it to violate Shopify's
      terms or applicable law.</li>
</ul>

<h2>4. Data</h2>
<p>You remain the controller of your store's data. We process it solely to
provide the service, as described in our <a href="/privacy">Privacy Policy</a>.</p>

<h2>5. Availability and warranty</h2>
<p>The App is provided "as is" without warranties of any kind. We do not
guarantee uninterrupted or error-free operation and are not responsible for data
made available by the Shopify API.</p>

<h2>6. Limitation of liability</h2>
<p>To the maximum extent permitted by law, ${COMPANY} shall not be liable for any
indirect, incidental, or consequential damages arising from use of the App.</p>

<h2>7. Termination</h2>
<p>You may stop using the App at any time by uninstalling it. We may suspend
access in case of misuse or to comply with legal obligations.</p>

<h2>8. Changes</h2>
<p>We may update these Terms; continued use after changes constitutes acceptance.</p>

<h2>9. Contact</h2>
<p>Questions about these Terms: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`
    )
  );
});

module.exports = router;
