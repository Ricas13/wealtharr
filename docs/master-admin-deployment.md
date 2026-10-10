# Master Admin: clone, deploy, configure

This product is designed to be configured from the browser after Docker is running.
The setup flow at `/setup` creates the first admin using a one-time code from the server log.
Then open `/admin/configuration` to complete setup from one place.

## What remains in Docker Compose or its private environment

- Database connectivity and password (the application cannot store the credentials needed to read its own configuration). Oracle Compose enforces non-owner `wealtharr_app` at runtime; a separate maintenance profile owns schema changes.
- `AUTH_SECRET` and `APP_ENCRYPTION_KEY` (session and encrypted-settings bootstrap keys).
- `CRON_SECRET` shared between **both** app and scheduler containers. Never rotate it only in the web UI.
- Reverse proxy and certificates, container ports/networks, persistent volumes, backup container/repository credentials and hosting.
- `AUTH_TRUST_HOST` when required by proxy deployment.

**Never** expose the database to the public network or put plaintext secrets in Git.

## Everything else is set up in Master Admin

| Configuration | Dashboard |
|---|---|
| Public HTTPS origin, brand, SEO and Search Console | Master setup → Settings / SEO |
| Plans, per-currency pricing, entitlements and billing products | Plans |
| Stripe credentials and webhooks | Settings → Billing; Integrations → Test |
| Transactional email and provider test | Settings → Email; Integrations |
| Current/historical licensed market data | Settings → Market data; Integrations |
| Telegram bot token, username and webhook secret | Settings → Messaging (Telegram); Integrations → Verify bot & register webhook |
| Customer Telegram enrolment | Customer Settings → Notifications → Telegram |
| Google / Apple sign-in | Settings → Sign-in providers |
| Curated strategy versions and release gate | Strategies |
| Verified country/wrapper/broker trading lines | Instruments |
| Worker budgets, monitoring, alerting | Settings / Integrations & jobs |
| Regulatory/backup-restore operator attestations | Launch readiness |

No customer-custom strategies are supported. Every published strategy version remains immutable.
Instrument mappings must be verified before enabling a strategy in a market, and market-data rights,
investment rules and launch sign-offs require evidence beyond clicking a checkbox.

Seeding is **first-install-only**: rerunning `npm run db:seed` inserts any missing catalogue
defaults but does not overwrite existing operator-edited plans, prices, definitions or versions.
A new version needs a reviewed migration or an explicit admin release, not a seed overwrite.

## Telegram initial configuration

1. Create a private Telegram bot with BotFather.
2. Save its token, username and a random webhook secret in Master Admin → Settings → Messaging (Telegram).
3. In Integrations & jobs, click **Verify bot & register webhook**. This securely registers
   `https://<public-origin>/api/integrations/telegram/webhook` with Telegram.
4. Enable Telegram in the relevant subscription plan's notification channels.
5. Each subscriber uses the one-time 15-minute connection link in Settings.
   Telegram messages are sent only after their private chat is verified.

Never enter a Telegram chat ID manually or expose bot tokens to the client.
