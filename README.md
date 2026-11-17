# Duck Wars V88 Payments API

Secure backend for Duck Wars web purchases.

## Render
- Build: `npm install`
- Start: `npm start`
- Health: `/health`

## Required before real payments
Set these only in Render, never in GitHub:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PUBLIC_BASE_URL`

Optional:
- `DUCK_WARS_STORE_FILE` for persistent storage

Use Stripe test mode before switching to live payments.
