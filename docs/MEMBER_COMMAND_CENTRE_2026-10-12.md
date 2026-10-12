# Wealtharr member command centre — October 12, 2026

This PR translates the approved standalone member-dashboard concept into the **authenticated, real-data-backed** `/app` route. It supersedes the visual direction of `CUSTOMER_DASHBOARD_PREVIEW_SPEC.md` for the user overview, while leaving the older spec as historical context. No stand-alone HTML mockup or illustrative user data is embedded in the app.

## Design decisions

- **Quieter colour:** charcoal `#080d11` page, `#10191e` cards, restrained mint `#b7f5cc` reserved for the primary call to action, selected navigation, success indicators and subtle chart accents. Blue remains for secondary chart comparisons.
- **Priority:** one full-width "action due / no action due" hero first. This is deliberately stronger than the old split balance/action panel. Never hide an action inside a decorative performance chart.
- **Four honest metrics:** latest verified combined value if fully valued in one currency; active strategy health; active strategy count; next planned contribution. Never manufacture an allocation-alignment score. Mixed/incomplete valuations show a dash or currency context.
- **Portfolio journey:** existing cash-flow-adjusted indexed chart, still with all period and benchmark controls. It is explicitly labelled as an index, **not** a cash-value chart.
- **Coming up:** only recorded contribution plans and future scheduled reviews; no invented calendar items.
- **Progressive disclosure:** details such as estimated return, observed maximum drawdown and ranked comparisons are still available behind a native disclosure, rather than competing with the next action.
- **Strategies:** existing tracked strategies, including paused states and individually versioned method names, remain clickable. Adding a strategy still uses the existing user-access/plan enforcement route.
- **Membership:** a visually integrated link to the existing account/plan screen, without claiming an entitlement, slot count or subscription price not verified by the server.
- **Accessibility:** semantic headings, visible focus states, colour not used as the sole status indicator, motion reduction, account for fixed mobile navigation, and an alternative light theme.

## Data and safety constraints

1. All content comes from existing authenticated queries for the user's strategies, actions, performance series, activity and contribution plans.
2. `isStoredActionCurrent` still guards stale actions; the action button goes to the correct strategy detail. The UI **never places a trade**.
3. Existing independently verified benchmark safeguards and shared-date comparability stay in place.
4. Empty accounts keep the first-strategy onboarding CTA; missing or mixed-currency valuations stay missing, and incomplete chart histories show a reasoned empty state.
5. Existing financial calculation functions, SQL filtering, ledger semantics, entitlements, backend routes, payments and the admin UI are not changed.
6. Styles are confined to `.customer-workspace-shell` and loaded after the previous member CSS for this iteration. Public and `/admin` are not restyled.

## Validation

- Added `tests/member-command-centre.test.ts` for data-backed integrity, links, content, accessibility basics and responsive styling.
- Run `npm run verify` and `npm run test:e2e` in CI with the configured database and browser.
- Visually confirm signed-in sessions at 1440px, 768px, and 390px, in dark and light themes. Review no-strategy, no-action, due-action, long-name, mixed-currency, unavailable-benchmark, missing-price and partial-valuation states.
- This change is not intended to introduce new strategy implementations or trading functionality.
