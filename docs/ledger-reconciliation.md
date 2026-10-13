# Ledger and reconciliation

ledger_events is the financial source history.

Cash amounts and quantities are signed. Contributions add cash. Buys reduce cash and add quantity. Sales add cash and reduce quantity. Fees reduce cash.

Events are not edited to force today's numbers to match. A broker discrepancy creates a reconciliation record and, when accepted, a BROKER_ADJUSTMENT ledger event. The original history remains available.

Overrides store automatic_value and manual_value separately and can be restored by deactivating the override. Current engine integration supports reversible strategy target overrides and instrument-price overrides.


## Everyday cash events

Customers can record withdrawals, dividends, distributions, interest, fees and tax as ordinary ledger events. These events are distinct from contributions and reconciliation differences.

The ledger tracks cash by currency. The calculation layer uses only the account's base-currency cash and fails closed if non-zero foreign-currency cash exists without an explicit FX conversion path. This prevents future broker imports from ever treating GBP 100 plus USD 100 as a numeric cash balance of 200.

Future FX/broker adapters should create explicit FX events/conversions rather than collapsing currencies during import.

## Stock splits and provider quotes

A split is recorded per strategy as a SPLIT ledger event (`to:from`). The market worker uses unreversed SPLIT events for the instrument, ratio and effective time only, to recognise the post-split quote as explained: it must follow the reference quote, be observed within 14 days of the split and be within 5% of reference x from/to. Only then is the quote accepted, the rejection cleared and the line marked (`trading_lines.corporate_action_split_at`). A strategy that holds units acquired before the marked split but has not recorded it is `DATA_REQUIRED` until it records the split or enters a manual price. Reversing the split with a ledger correction removes its power to explain later quotes.
