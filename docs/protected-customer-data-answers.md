# Protected Customer Data Access — recommended answers

Guidance for the Partner dashboard → App → API access →
**Protected customer data access** request. These answers reflect the app's
actual behaviour, which is what Shopify checks against.

## Step 1 — Data use and reasons

- **Protected customer data**: **Selected** (required because `read_orders`
  returns order data, which is classed as protected customer data).
  - **Reason**: *Analytics* — the app provides the merchant with sales and
    order reporting.
- **Protected customer fields (name, email, phone, address)**: **NOT selected.**
  The app does not access these. Leaving them unselected keeps you at **Level 1**
  and significantly simplifies approval.

> The app's GraphQL order query intentionally omits the `customer` object,
> `email`, `phone`, `billingAddress`, and `shippingAddress`. Do not request
> Level 2 fields.

## Step 2 — Data protection details (the 9 questions)

Answer based on the app's real implementation:

1. **Do you encrypt data in transit?** — Yes. All traffic is over HTTPS/TLS.
2. **Do you encrypt data at rest?** — Yes. Shopify access tokens are encrypted
   with AES-256-GCM (unique IV per token). Order/product data is fetched on
   demand and not persisted.
3. **Do you have access controls / least privilege?** — Yes. Admin panel is
   authentication-protected; API access uses revocable, hashed API keys; only
   the minimum scopes are requested.
4. **Do you keep audit logs / can you detect a breach?** — Yes. All install,
   uninstall, sync, key, and admin actions are recorded in an audit log.
5. **Do you have a data retention / minimization policy?** — Yes. Customer
   personal data is never stored; order/product data is transient; only sync
   metadata and audit logs are retained, and only as long as needed.
6. **Can you delete data on request (GDPR/CCPA)?** — Yes. The mandatory
   compliance webhooks (`shop/redact`, `customers/redact`,
   `customers/data_request`) are implemented; uninstall invalidates the token.
7. **Do you have a written privacy policy?** — Yes:
   https://dev.populatia.ro/privacy
8. **Do you train staff / restrict who can access data?** — Yes. Access is
   limited to authorized personnel; admin access is credential-protected and
   logged.
9. **Do you have an incident response process?** — Yes. We monitor logs, can
   revoke tokens and API keys immediately, and notify affected merchants as
   required by law.

## Notes

- There is **no separate "Submit" button** — Shopify reviews protected-data
  access when you **submit the App Store listing** (public distribution).
- You can **access the selected data on development stores without submitting**,
  so testing can proceed immediately.
- Do **not** request the "Read all orders" scope (`read_all_orders`) unless you
  need order history older than 60 days — it triggers a stricter review.
