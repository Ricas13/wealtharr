# Wealtharr: PR completion and launch-evidence audit — 13 October 2026

## Scope and standard of proof

Reviewed **all 55 PRs known as of PR #59** (46 merged into `main`, eight intentionally closed unmerged, one new draft). Cross-checked important claims against the current repository: `src/app/page.tsx`, `src/app/app/explore/page.tsx`, `src/app/api/admin/plans/route.ts`, `scripts/seed.ts`, `src/lib/strategy-service.ts`, `src/lib/user-strategy-access.ts`, `src/domain/explore-catalogue.ts`, `src/domain/strategy/fixed-allocation.ts`, `src/domain/ledger.ts`, `src/domain/quote-plausibility.ts`, `src/domain/commercial-launch.ts`, `src/app/api/billing/checkout/route.ts`, `docs/STATUS.md`, `docs/9SIG_IMPLEMENTATION_GAP.md`, and the named tests/migrations below.

**Interpretation:** `MERGED` means source committed, **not** that every feature promised in a broad PR is launched or independently verified. `CODE` means an implementation is present or covered by tests. `OPEN` means unimplemented/unverified or dependent on external evidence. This was a current-head static/source and CI-evidence audit, **not** an independent penetration test, production server login, real broker test, licensed-data audit, live payment exercise or strategy performance certification. The CI of PR #58 succeeded including PostgreSQL, lint, typecheck, unit, build, Docker, Playwright and audit; these checks prove only their tested environment.

## PR-by-PR dispositions

| PR | GitHub disposition | What is actually delivered / limitation |
|---|---|---|
| [#1](https://github.com/Ricas13/wealtharr/pull/1) | Closed unmerged | Earlier standalone 9Sig journey concept; superseded by #2 and the multi-strategy product. Do not treat its three-way live results as built. |
| [#2](https://github.com/Ricas13/wealtharr/pull/2) | Merged | Multi-strategy app, ledgers, plans, jobs and route foundation. **Not proof of commercial readiness or correct complete 9Sig.** |
| [#3](https://github.com/Ricas13/wealtharr/pull/3) | Merged | Simplified premium UI first pass; later superseded by #26/#29/#57. |
| [#4](https://github.com/Ricas13/wealtharr/pull/4) | Merged | Research catalogue and launch-gate plan. Independent strategy/mapping/legal gates remain. |
| [#5](https://github.com/Ricas13/wealtharr/pull/5) | Merged | Historical payment/session/ledger fixes with tests. External Stripe operations remain unexercised. |
| [#6](https://github.com/Ricas13/wealtharr/pull/6) | Merged | Security-event emails in code; live provider delivery not verified. |
| [#7](https://github.com/Ricas13/wealtharr/pull/7) | Merged | Encrypted admin settings and setup workflow; production secrets/configuration not attested. |
| [#8](https://github.com/Ricas13/wealtharr/pull/8) | Merged | Mobile/PWA and native shells; published store builds/device acceptance not established. |
| [#9](https://github.com/Ricas13/wealtharr/pull/9) | Merged | Device-change alert logic, quote-notification test; real external delivery remains. |
| [#10](https://github.com/Ricas13/wealtharr/pull/10) | Merged | Wealtharr rebrand; trademark/domain clearance remains. |
| [#11](https://github.com/Ricas13/wealtharr/pull/11) | Merged | Traefik staging Compose/runbook; this is **not evidence** that HTTPS host and offsite restore were verified on server. |
| [#12](https://github.com/Ricas13/wealtharr/pull/12) | Merged | App-store/Google Play billing integration scaffolding with server verification; live stores/RevenueCat not tested. |
| [#13](https://github.com/Ricas13/wealtharr/pull/13) | Merged | Alerting, key rotation and accessibility tests; external security and operational drills open. |
| [#14](https://github.com/Ricas13/wealtharr/pull/14) | Merged | Historical audit snapshot, preset fixes; status document has historical claims and is not a launch certificate. |
| [#15](https://github.com/Ricas13/wealtharr/pull/15) | Merged | Draft strategy spec cards, explicitly **not** independently verified. |
| [#16](https://github.com/Ricas13/wealtharr/pull/16) | Merged | Semiannual/threshold schedules and corresponding unit cases. |
| [#17](https://github.com/Ricas13/wealtharr/pull/17) | Merged | Exposure registry and rebalance planner. Investor-custom weights later intentionally **removed** by #25. |
| [#18](https://github.com/Ricas13/wealtharr/pull/18) | Merged | UK instrument CSV importer produces **candidates**, not verified/purchasable account mappings. |
| [#19](https://github.com/Ricas13/wealtharr/pull/19) | Merged | Trusted adjusted-history ingest/storage gates. Data contract, provider provenance and real backtests open. |
| [#20](https://github.com/Ricas13/wealtharr/pull/20) | Merged | Manual release attestation gate, later intentionally made optional by #52. Do **not** restore obsolete manual blocker. |
| [#21](https://github.com/Ricas13/wealtharr/pull/21) | Merged | Multi-leg rebalance explanation; user-custom weight inputs subsequently removed under curated-only policy. |
| [#22](https://github.com/Ricas13/wealtharr/pull/22) | Merged | Opt-in adjusted history worker. Licensed real provider and exchange/calendar validation missing. |
| [#23](https://github.com/Ricas13/wealtharr/pull/23) | Merged | Leverage disclosure and rollout runbook; neither legal sign-off nor real rollback drill. |
| [#24](https://github.com/Ricas13/wealtharr/pull/24) | Closed unmerged | Superseded by curated components in #25. Do not merge. |
| [#25](https://github.com/Ricas13/wealtharr/pull/25) | Merged | Broad guided strategies/Admin/analytics/checkout plumbing. Its own `docs/PR25_COMPLETION_CHECKLIST.md` explicitly marks external/provider/legal gates incomplete. The old PR body incorrectly says draft/unmerged; GitHub merge status is authoritative. |
| [#26](https://github.com/Ricas13/wealtharr/pull/26) | Merged | Snowball-inspired customer UI; superseded visual direction by #57. **Not** a real brokerage API connection. |
| [#28](https://github.com/Ricas13/wealtharr/pull/28) | Merged | Functional Admin Control Centre design; live admin visual acceptance and external service configuration still require review. |
| [#29](https://github.com/Ricas13/wealtharr/pull/29) | Merged | Pixel-contracted earlier customer page; later intentionally superseded by #57. |
| [#30](https://github.com/Ricas13/wealtharr/pull/30) | Closed unmerged | Stale conflicted homepage/plan branch, replaced by #58. Do not merge. |
| [#31](https://github.com/Ricas13/wealtharr/pull/31) | Closed unmerged | Conflicting global theme. Scoped UI revisions (#47/#57/#58) take precedence. |
| [#32](https://github.com/Ricas13/wealtharr/pull/32) | Merged | User notification read-state and sign-out route/UI. External notification delivery open. |
| [#33](https://github.com/Ricas13/wealtharr/pull/33) | Merged | Admin entitlement bypass while retaining admin-only role gates. Not public release permission. |
| [#34](https://github.com/Ricas13/wealtharr/pull/34) | Merged | Plugin-based strategy registry (27 entries). **Source and seed still contain unfinished methods.** |
| [#35](https://github.com/Ricas13/wealtharr/pull/35) | Merged | Administrator disabled-but-published preview gates, with guardrails. |
| [#36](https://github.com/Ricas13/wealtharr/pull/36) | Merged | Explore catalogue originally included Research/Coming Soon labels; customer visibility later corrected by #49. |
| [#37](https://github.com/Ricas13/wealtharr/pull/37) | Merged | Advance review reminders in code; scheduled execution and live channel delivery still require smoke tests. |
| [#38](https://github.com/Ricas13/wealtharr/pull/38) | Merged | Candidate-to-EXACT admin workflow; self-checked boxes do **not** establish independently verified actual UK trading eligibility. |
| [#39](https://github.com/Ricas13/wealtharr/pull/39) | Merged | All Weather *hand-computed* expected values and checklist, not independent primary-source fidelity for every strategy. |
| [#40](https://github.com/Ricas13/wealtharr/pull/40) | Merged | Yahoo quote adapter, explicitly **unofficial and commercially unlicensed**; `commercial-launch.ts` fails paid-launch checks for it. |
| [#41](https://github.com/Ricas13/wealtharr/pull/41) | Merged | DB pool deadlock guard/timeouts and export hardening, tested in CI. |
| [#42](https://github.com/Ricas13/wealtharr/pull/42) | Merged | Admin auth/MFA/session protections; CSP, security assessment, server-side configuration remain. |
| [#43](https://github.com/Ricas13/wealtharr/pull/43) | Merged | Schema integrity constraints and migration guardrails; newer split workflow must preserve the vocabulary. |
| [#44](https://github.com/Ricas13/wealtharr/pull/44) | Merged | **Draft** 9Sig spec and gap analysis only; this is not a working faithful release. |
| [#45](https://github.com/Ricas13/wealtharr/pull/45) | Merged | Worker fairness/backlog isolation in code; sustained real traffic and live alert latency untested. |
| [#46](https://github.com/Ricas13/wealtharr/pull/46) | Closed unmerged | High-risk domain fixes **not integrated as a whole**. #54 tracks missing work; #59 separately restores split subset. |
| [#47](https://github.com/Ricas13/wealtharr/pull/47) | Merged | Accessibility/forms/error-state foundation; keyboard/contrast on final live design should still be tested. |
| [#48](https://github.com/Ricas13/wealtharr/pull/48) | Closed unmerged | 9Sig partial v1.1 intentionally rejected under complete-or-absent policy. |
| [#49](https://github.com/Ricas13/wealtharr/pull/49) | Merged | Customer Explore hides incomplete releases; **research-only source plugins and fresh seed rows still exist**, in conflict with `CLAUDE.md` cleanup requirement. |
| [#50](https://github.com/Ricas13/wealtharr/pull/50) | Merged | New-start/switch backend gates (no direct-API bypass). Manual attestation requirement superseded by #52. |
| [#51](https://github.com/Ricas13/wealtharr/pull/51) | Closed unmerged | Proposed zero/partial seeding policy was superseded. However removing unfinished plugins and research seed rows still remains an explicit repository rule, not a completed feature. |
| [#52](https://github.com/Ricas13/wealtharr/pull/52) | Merged | Global enable/disable, plan restrictions and per-user access without mandatory sign-off; still conditioned on real technical rules and instrument eligibility. Code: `src/lib/user-strategy-access.ts`, `src/app/api/admin/user-strategy-access/route.ts`, `tests/db/user-strategy-access.test.ts`. |
| [#55](https://github.com/Ricas13/wealtharr/pull/55) | Closed unmerged | Depended on conflicted #30; visual intent rebuilt independently as #58. |
| [#57](https://github.com/Ricas13/wealtharr/pull/57) | Merged | Real authenticated member command centre, scoped charcoal theme and responsive tests. Not broker auto-sync. |
| [#58](https://github.com/Ricas13/wealtharr/pull/58) | Merged in this audit session | Approved homepage, no public 9Sig promotion, published/market-gated strategy rail, 0–5 real configured plan cards, admin marketing highlights; full GitHub CI passed. **No production deploy or real checkout tested.** |
| [#59](https://github.com/Ricas13/wealtharr/pull/59) | Draft at audit creation | Isolated stock-split portion from #46; no merge until current-head CI/DB/E2E passes. |

## Priority defects and gaps, linked to required evidence

| ID | Priority | Where observed | Acceptance criterion |
|---|---|---|---|
| FIN-SPLIT | P0 | No `/splits` endpoint on prior main; abandoned PR #46, now draft #59 | Quantity-only event/correction, exact ratios, backdating guard, account isolation and PostgreSQL tests; CI green before merge |
| FIN-CASH | P0 | `fixed-allocation.ts` proposes a cash-funded buy before assessing its whole-share/minimum practical executability; PR #46's `cash-buy-fallback` remains absent | Detect refused cash buy, try next underweight sleeve or a valid funding sale, never loop; deterministic unit+full action-service tests |
| FIN-FILLS | P0 | Superseded #46's broker-consideration/price-band changes not integrated | Independently verify quantities, price deviations, fees and cash before committing a confirmed fill; bypass/refusal tests |
| FIN-QUOTE | P0 | Current `quote-plausibility.ts` uses a simple 50% recent-move heuristic | Reject units/currency changes, stale/out-of-order timestamps and implausible split-like quotes without suppressing legitimate moves; preserve verified external provenance |
| STRAT-RELEASE | P0 | 27-entry `STRATEGY_PLUGINS` and `scripts/seed.ts` still include research definitions | Only fully implemented methods seeded/shipped for new installs; migrate safely without deleting any historic user instance/version/ledger |
| STRAT-9SIG | P1 | `docs/9SIG_IMPLEMENTATION_GAP.md`, issue #56 | Full rule fidelity including bond sleeve, 90%-per-quarter cap, quarter timetable, dividends, reset/down rules, independently sourced cases; do not activate partial version |
| STRAT-MARKET | P0 | `VERIFIED_MARKET_MAPPINGS_SQL` requires EXACT mapping; no real UK issued holdings validation in repository | Broker- and ISA-compatible issuer-verified ISIN/trading lines, currency/leverage, active dates and precise units; no guessed substitutes |
| BROKER | P2 | Issue #27, only form/import placeholders | User-approved lot/transaction matching for *one strategy only*, read-only permissions, no silent ledger events, no unrelated positions in UI |
| BILL-LIVE | P0 before charging | `src/app/api/billing/checkout/route.ts`, `src/domain/commercial-launch.ts` | Stripe test-mode and live-mode lifecycle drills, webhook signature, renewal, failed collection, rollback/refunds, no duplicate subscriptions |
| OPS | P0 before public | `docs/STATUS.md`, launch preflight | Verified HTTPS host, real restore from offsite backup, production alert flow, actual email delivery and scheduler load/restart/rollback tests |
| LEGAL | P0 before charging | `src/domain/commercial-launch.ts` and `docs/COMMERCIAL_SEO_LAUNCH.md` | Independent UK regulatory and consumer/privacy review, brand and data licence approvals, service/terms/support |
| UI | P1 | #58 merged, #57 merged | Real account mobile/desktop UAT, admin 0–5 plans, staging screenshot, onboarding and navigation; no false pricing/market claims |

## Implementation sequence

1. **Now**: PR #58 merged after full CI; handle #59 separately. Treat existing strategy history as immutable.
2. **Financial safety**: finish #54 in independent PRs (splits, residual cash, fills, quotes/account folding), each on current `main` and with DB/E2E proofs.
3. **Catalogue cleanliness**: finish release cleanup (the mere presence of a research plugin or draft is not a commercial feature); golden-test, source-check and enable only complete marketed methods. Preserve plan/global/user controls from #52.
4. **Onboarding/billing**: validate plan-card descriptions against actual entitlements, Stripe checkout and renewals; no invented PayPal implementation.
5. **Optional scope**: Trading 212 reconciliation and broader strategy coverage are phased after trusted manual MVP.
6. **Production**: execute `npm run launch:preflight` with genuine configuration and independently confirm each external item. CI green is necessary, not sufficient.

**Do not close issues #54, #56, #27 or the remaining real-world portion of #53 until their stated acceptance checks can be demonstrated.**
