# Wealtharr Master Admin V2 — implementation fidelity specification

The approved concept is a premium Stripe-like SaaS control plane using Snowball-style financial information hierarchy. **It is not a Snowball asset/brand copy**, and it must never invent revenue, broker connections or strategy approvals.

## Typography and geometry

| Element | Approved CSS in `src/app/globals.css` |
| --- | --- |
| Font family | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| Rhythm | 4 px base; gaps generally 8/12/13/16/20/24/35 px |
| Sidebar desktop width | 236 px, 216 px below 1220 px; scrollable navigation on mobile |
| Main content | max 1400 px, 35 px top padding and responsive gutters |
| Sidebar brand mark | W on #344FAD, 34 × 34 px, 10 px corners |
| Brand text | 17 px, 850 weight, -.035em tracking |
| Section eyebrow | 10 px, uppercase, .12em tracking, 800 weight |
| H1 heading | 31–40 px, -.05em tracking |
| Card heading | 16 px, 800 weight |
| KPI amount | clamp(26 px, 2.5vw, 35 px) |
| KPI card | 14 px radius, 19 px desktop top padding, 13 px grid gap |
| Table header | 10 px, .08em tracking, 800 weight |
| Table row | 16 px vertical padding |
| Controls | 10 px radius, 11–12 px label size, visible focus ring |
| Horizontal breakpoints | 1220 / 980 / 700 px (plus 650 for tables) |
| Dark palette | #0B1525 canvas, #141F31 surfaces, #2D4058 borders, #F2F6FD text |
| Light palette | #F5F7FB canvas, #FFFFFF cards, #DAE2ED border, #1D2D45 text |
| Accent | #344FAD for buttons; light/dark contrast-aware text variants |

## Required experience and URL ownership

- `/admin`: four KPI tiles, revenue/growth SVG from actual dated registrations, attention queue, strategy library summary, workers, quick links and advanced flags.
- `/admin/users`: customers overview and searchable (latest 250) account metadata table.
- `/admin/strategies`: **Strategy Studio** searchable table, research/status distinctions, verified bulk enable, existing release editors and golden tests under advanced panels.
- `/admin/plans`: **Commerce** plan/pricing/entitlement table, unchanged plan editors and provider-specific Stripe price sync.
- `/admin/integrations`: five consistent provider rows (brokerage, market, payments, communications, automation) with a status, route and plain language description.
- `/admin/operations`: actual integration test results, retries, worker runs, queues.
- `/admin/security`: current admin MFA state, safe recent audit event overview, backup & recovery links.
- `/admin/settings`: encrypted settings editor, groups, provider secrets write-only, Docker bootstrap only.
- `/admin/configuration`: seven exact checklist items with progress, auditable component signals and launch-safe evidence wording.
- `/admin/launch`: untouched commercial launch controls and independent release gates.
- `/admin/seo`: site and brand settings under governance navigation.

## Reality gates

Financial facts require a verified source. Registered customer counts and new strategy instances come from actual database timestamps, **not mock numbers**. Until an independently reconciled payments ledger exists, Monthly revenue displays an em dash, not theoretical recurring revenue. Integration credentials indicate only configuration, not connectivity. Brokerage integration is visibly **Planned** and is specifically **strategy-scoped read-only** per issue #27; unrelated holdings remain outside Wealtharr.

Research strategies stay visible to administrators but not customer-enabled until the independent methodology, approved trading-line and golden-test gates pass. Master Admin changes are authenticated, MFA-gated, status-driven and must never bypass audit trails.

## Verification

The Admin CSS uses a root-scoped design layer. Customer-facing pages stay unchanged. Browser tests verify desktop/mobile widths, exact typography and geometry, navigation, seven-step progress, and accessibility for newly introduced routes. Unit tests verify the product copy, backend gating and the absence of fictitious financial data.
