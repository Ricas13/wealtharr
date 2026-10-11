import Decimal from "decimal.js";

// A quantity can have 30 significant digits and a price 24. Keep their
// exact product (up to 54 digits) before checking the ledger's storage scale.
// Do not mutate decimal.js global configuration or round a broker fill first.
export const LedgerDecimal=Decimal.clone({precision:80});
