# Licensed market-data provider contract

This is the **HTTP adapter contract** used by Wealtharr, not a claim that an arbitrary provider is licensed or suitable. Configure both base URL and Bearer token through **Master Admin → Settings → Market data**. The backend appends `/quote` and `/historical` to your base URL path.

## Current quote

`GET https://provider.example/v1/quote?symbol=TQQQ`

Response (illustrative, not real prices):

```json
{"price":"100.25","currency":"USD","observedAt":"2026-10-08T19:58:00-04:00",
 "granularity":"TRADE","priceKind":"LAST"}
```

The response must represent that security's actual price currency and timestamp. Current data is checked for plausible price jumps and freshness before being stored. Actual broker fills—not indicative quotes—determine the recorded cost and quantity.

## Historical adjusted closing price

`GET https://provider.example/v1/historical?symbol=TQQQ&at=2026-10-08T21%3A00%3A00.000Z`

Response (illustrative):

```json
{"price":"99.95","currency":"USD","observedAt":"2026-10-08T20:00:00Z",
 "granularity":"DAILY_BAR","priceKind":"CLOSE",
 "corporateActionsAdjusted":true}
```

The observation must have an exact UTC date matching the requested session, a positive price, correct currency, `granularity: "DAILY_BAR"`, `priceKind: "CLOSE"`, and `corporateActionsAdjusted: true`. The adjusted flag must be provided **for every response**; omitting it or returning `false` blocks history ingestion. Provider-side dividends/splits and benchmark total-return treatment must be separately validated; a flag does not prove the adjustments are correct.

The backend attaches provider identity from the selected adapter and only stores historical observations as licensed when the operator has separately confirmed storage and display rights via `MARKET_DATA_HISTORY_ADJUSTED_LICENSED` in Master Admin. A UI checkbox is *not* a substitute for a provider contract.

## Acceptance

In Master Admin → Integrations run both **Current market prices** and **Historical adjusted prices** tests on an actual instrument/supported session. The latter checks one exact day and will fail on holidays; run it with a trading date, instrument and expected currency you can verify. Tests never expose API tokens. Then test sustained lookbacks, FX, split/distribution samples, symbols/corporate actions, provider quota, delayed data, and error/recovery behaviour in staging.

Until the real feed, legal rights and exact strategy requirements are verified, historical momentum models and benchmark performance remain unavailable rather than manufactured.
