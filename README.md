# Wealtharr — rules-based portfolio tracking

This repository is a modular-monolith SaaS for operating user-selected, rules-based investment strategies. The source repository is `Ricas13/wealtharr` and **Wealtharr** is the customer-facing product brand; **9Sig** remains one supported strategy family.

The product is built around three questions:

1. Where am I?
2. Do I need to do anything?
3. Exactly what do I need to do next?

It separates strategy definitions from versioned strategy rules, user strategy instances, source ledger events, derived calculations, reversible overrides, actions and notification delivery.

## Current launch scope

Only curated fixed-rule strategies may be activated. Regional account eligibility is proven from the entire strategy’s set of approved exact-leverage instruments; no matching or partial implementation returns an explicit unsupported-market error rather than guessing.

Implemented foundations include authentication, Free / Investor / Pro entitlements, versioned strategies, multiple strategy instances per user, append-only ledger events, cash as a first-class position, quick resume, reconciliation adjustments, regional instrument mapping, action lifecycle and explanations, notification dedupe, Stripe subscription state, public aggregate plumbing, demo mode, customer dashboards and admin views.

The active seed enables the 9Sig-family value-target engine. Fixed-allocation engines exist and are tested, but HFEA / Golden Butterfly definitions are deliberately disabled until faithful regional instruments and full multi-leg execution workflows are configured. Momentum strategies are research-only until verified. Customer custom-strategy authoring is intentionally excluded. Strategy releases use a draft/publish/retire lifecycle; published versions snapshot their engine and configuration, while existing user instances remain pinned until an explicit audited migration.

Production market data uses the configured HTTPS provider adapter. If no licensed provider is configured, the application deliberately fails closed instead of fabricating prices. The development mock provider is unavailable in production.

## Stack

- Next.js and React with TypeScript
- PostgreSQL
- Drizzle schema definitions plus reviewed SQL migrations
- Auth.js
- Decimal.js for accounting calculations
- Recharts and Framer Motion-ready UI foundation
- Stripe
- Docker
- GitHub Actions

## Local development

Requirements: Node 22+, PostgreSQL 16+.

    cp .env.example .env.local
    npm install
    npm run db:migrate
    npm run db:seed
    npm run dev

Generate an Auth.js secret using a cryptographically secure random value. APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key. CRON_SECRET protects the action and notification worker.

## Verification

    npm run lint
    npm run typecheck
    npm test
    npm run build

CI applies migrations twice to prove idempotency, seeds a fresh PostgreSQL database, runs lint/typecheck/unit and database tests, builds production, renders public pages in mobile and desktop Chromium, and runs a high-severity production dependency audit.

## Stripe test setup

Create monthly and annual Stripe Prices for each supported billing currency. Put those Price IDs into plan price records through the admin panel/API. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, then point Stripe to POST /api/stripe/webhook.

The webhook is the authority for paid subscription status. Feature access comes from the canonical entitlement service, not scattered Stripe checks.

## Notifications

In-app notifications exist on every plan. Investor and Pro may use Email and Discord according to their plan entitlements. Discord webhook destinations are encrypted at rest. notification_deliveries has a unique dedupe key, so worker restarts cannot resend the same delivery record.

### Advance review reminders

On by default with a 2-day lead time; set 0 to turn it off. Admin > Settings > Notifications > "Review reminder lead time (days)" (`REVIEW_REMINDER_LEAD_DAYS`, 0-14; blank uses the default of 2; 0 is off) makes the hourly worker create one "<Strategy> review due <date>" notification per strategy review, that many days before it is due. It is created only for an active strategy whose newest calculation says nothing is due yet, after the day's calculations and before deliveries are created, so it goes out in the same run on the channels the user's plan allows and has a connected destination for (in-app only on Free). It is held back until 08:00 in the user's own timezone, states the date only (never an amount or an instruction; amounts are calculated on the day from current data), is cancelled at send time if the strategy was paused or closed or the review date moved, and is hidden from the Activity page once it is no longer current (strategy not active, review date moved, or the date has arrived). It is only created when the review is on a later local calendar date than today. The on-the-day alert is unchanged. Implementation: `src/domain/review-reminder.ts`, `src/lib/review-reminder.ts`, migration 0036.

## Market data

src/lib/market-data.ts defines the provider interface. The built-in production adapter accepts a configured HTTPS quote service via MARKET_DATA_PROVIDER=http, MARKET_DATA_HTTP_BASE_URL and MARKET_DATA_HTTP_TOKEN. It expects GET /quote?symbol=... and GET /historical?symbol=...&at=... responses containing price, three-letter currency and an offset-aware observedAt timestamp. The hourly worker refreshes active holdings/mappings before action calculation. If no licensed provider is configured, financial actions fail closed on missing or stale critical data.

### Yahoo Finance provider (unofficial, unlicensed)

`MARKET_DATA_PROVIDER=yahoo` (Admin > Settings > Market data) uses Yahoo Finance's public chart endpoints (`query1.finance.yahoo.com/v8/finance/chart/<symbol>`) and needs no token. **These endpoints are unofficial and undocumented, are not licensed for commercial redistribution, and can break or be rate-limited without notice.** It is available because the owner chose it; it is not a licensed data source and must be replaced before charging customers. Admin > Launch shows a warning whenever it is selected and the market data launch gate cannot pass while it is.

- Provider symbols are stored in `trading_lines.provider_symbol`. London lines use the `.L` suffix (for example `<TICKER>.L`). Yahoo does not list every leveraged ETP, so the owner must spot-check each symbol before relying on it.
- Current quotes use `regularMarketPrice`/`regularMarketTime`; historical lookups use the last daily bar CLOSE at or before the requested time. Yahoo never sets `corporateActionsAdjusted`, so it can not satisfy `MARKET_DATA_HISTORY_ADJUSTED_LICENSED` and momentum history stays off.
- LSE prices quoted in pence (`GBp`/`GBX`) are converted to pounds with exact decimal division and reported as GBP. Any other subunit (for example `ZAc`, `ILA`) or malformed currency returns no quote; FX is never guessed. Missing, non-positive, future-dated or errored responses return no quote, and staleness is classified downstream as for every provider. A current quote is also cross-checked against Yahoo's own previous/closing prices in the same response (it must be within 0.5x to 2x of each, converted with the same pence rule); with no reference present the quote is rejected. A historical bar is used only once its day has completed (bar open time + 24 hours at or before the requested time). Setup pages that only recognise licensed providers will still show market data as "not configured" while Yahoo is selected; that is intentional, because Yahoo is unofficial and unlicensed.

## Deployment

Build the Docker image after migrations have been applied. Run db:migrate and db:seed as controlled release steps before switching application traffic. Configure the hourly /api/cron/actions worker with Authorization: Bearer CRON_SECRET.

The container health check calls `/api/health`. Core readiness requires a reachable database plus a valid application URL, Auth.js secret, cron secret and 32-byte encryption key. Billing, email and licensed market data are reported separately as capabilities so infrastructure can distinguish “the app is unhealthy” from “an optional/commercial integration is not configured.” The cron endpoint returns HTTP 503 when any strategy calculation unexpectedly fails, allowing monitoring to distinguish a degraded worker run from a successful pass.

## Security and regulatory posture

Financial information is treated as sensitive. The application uses server-side validation, fail-closed production origin checks, signed and idempotently claimed Stripe webhooks, secure response headers, database-backed rate limiting for account flows, encrypted notification secrets, retry-safe financial mutation keys and audit events.

The application does not select a strategy based on suitability. Customer-facing wording describes the output as a calculation under rules the user selected. Jurisdiction-specific legal and regulatory review remains required before launch.

See docs/ for the detailed architecture and methodology notes.
