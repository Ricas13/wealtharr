# Wealtharr customer dashboard — approved visual preview contract

Reference: the approved customer dashboard displayed in the project conversation on 11 October 2026. This implementation is the **real data-backed `/app` customer experience**, not a static mockup. It deliberately preserves the existing financial logic, price/FX verification, action state, ledger integrity, chart filters, and benchmark-availability warnings.

## Desktop visual measurements

| Element | Contract |
| --- | --- |
| Sidebar | 195px wide; 25px top and 13px horizontal padding |
| Brand | 20px / weight 850; 27px mint-to-blue mark; 9px gap |
| Sidebar navigation | 13px / weight 650; 44px minimum tap target; selected state in mint |
| Topbar | 61px high; 22px horizontal gutters |
| Strategy tabs | 11px type; 7px × 13px padding; 20px radius |
| Content | Max width 1200px; 22px page gutters; 25px top padding |
| Dashboard title | Clamp 28–44px; -2px tracking |
| Hero | 0.92:1.08 columns; 12px gap/padding; 232px minimum height |
| Portfolio value | Clamp 34–60px; weight 850; -3px tracking |
| Action panel | 16px radius; 24px × 20px padding; blue/mint gradient |
| Analytics panel | 21px padding; 21px radius; 16px top gap |
| KPI strip | 4 equal columns; 8px gaps; 13px × 11px card padding |
| Chart | 237px; dark navy plot; mint actual, blue/orange comparisons |
| Quick summary strip | Three columns; 14px × 16px padding |
| Strategy cards | Two columns; 12px gap; 154px minimum height; 19px radius; 21px title |
| Surface / brand colours | #07111f base, #78f3c6 mint, #79a8ff blue, #8ea3bd muted, #ff9a9a loss |

The homepage layout wraps live server-derived sections in `.home-dashboard`. All styles are under `.customer-workspace-shell`: the public website and `/admin` must remain unaffected.

## Preserve app integrity

- Never hardcode the illustrative £31,420, profit or returns shown in the approved preview. Show a dash if a real valuation is unavailable.
- Existing actions continue to open the correct strategy detail. No trade is placed automatically.
- The leaderboard and combined chart keep their shared-date, independently verified benchmark and cash-flow safeguards.
- The chart retains the full existing time-range and comparison controls, even where the preview displays fewer.
- Active navigation and strategy tabs follow the current URL and expose `aria-current="page"`.
- Signed-in users with zero strategies continue to see the guided first-strategy screen.
- Existing theme toggle stays available. Light mode uses equivalent readable colours rather than forcing dark mode.
- At tablet sizes the sidebar becomes a top navigation; at phone sizes it stays an accessible fixed bottom navigation with 44px targets.
- No external CSS, copied branding, or external fonts are needed.

## Verification

- `npm run verify` (lint, TypeScript, unit tests, production build).
- `npm run test:e2e` with configured test database and Chromium.
- In a running seeded demo account, visually review the dashboard at 1440px desktop, 768px tablet, and 390px phone, in dark and light modes. Check long names, mixed currencies, missing valuation/benchmark data, pending action, no-action and empty-state cases.
- Do not merge with conflicting customer redesign PRs (notably #26) without resolving the intended layout. PR #26 is a separate Snowball-inspired proposal and is not part of this approved preview parity change.
