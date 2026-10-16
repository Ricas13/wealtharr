# Wealtharr · public marketing art direction (2026-10-16)

## Source of direction
Original implementation inspired by the discipline of editorial grid design, experimental quantitative-finance microsites, and accessible interactive data stories; not a copy of any live website.

## Three radically different concepts

### 01 / SIGNAL LOOM — time woven into rules
- First screen: a wide typographic statement intersects a delicate ribbon diagram of dated reviews; colored lines pass through an information loom.
- Interaction: scrub across upcoming review intervals and see the changing explanation of *when* rules are evaluated.
- Engineering: custom accessible SVG paths and section-chapter intersection cues. Strength: narrative; limitation: requires meaningful authentic schedules and risks implying nonexistent certainty.

### 02 / ALLOCATION OBSERVATORY — a playable measuring instrument **selected**
- First screen: editorial ink-and-mint typography with a luminous, concentric, precision-labelled radial instrument. The interface resembles an actual analytical device rather than a dashboard screenshot.
- Interaction: move the target allocation marker **directly on the orbit**, use a fully accessible percentage slider or change a contribution. Both radial rings and exact value deltas respond immediately. Switch between illustrative review intervals.
- Engineering: hand-authored SVG, CSS transitions gated by reduced-motion, pure integer-minor-unit maths, screen-reader-readable numeric breakdown. No remote market price data, fabricated returns or orders.
- Selection rationale: independently engaging, especially on mobile and with a pointer; accurately communicates what the app actually does; fast, robust and inspectable.

### 03 / DECISION ATLAS — cartography of independent choices
- First screen: a typographic map of branching decisions, rendered like a large celestial star chart with connection paths.
- Interaction: hover/focus nodes to see how hypothetical choices alter the route to the next review.
- Engineering: SVG pan/zoom, keyboard roving focus, graph layout. Limitation: complex graph does not map precisely to actual Wealtharr strategy methods without introducing a fictitious shared rules system.

## Non-negotiables
- Illustrative inputs: 6,400 equity and 3,600 bonds, no inferred returns or prices. Cash contribution 0–2,000 whole units, target equity 30–80% in 5% increments. The bond target is the complement.
- Actual holdings stay fixed while cash is added to the account total. Target value equals total times chosen percentage. Two gap values add to the contribution, exactly.
- Review intervals are *illustrative reminders from 16 Oct 2026*, not original published review calendars or a prediction of Wealtharr strategy schedules.
- Keep SEO content, footer, pricing functionality and auth/register links; do not alter financial engines, customer ledger, billing or admin.
- Reduced-motion mode must display a completed, usable graph with no visual animation. Sliders fully operable by keyboard, direct drag supplemental only.
- Visual signoff requires real desktop and mobile screenshots and intact existing visual-regression baselines.
