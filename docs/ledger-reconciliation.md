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

A split you record is a SPLIT ledger event (`to:from`) that restates the units of your strategy only. It never changes which provider quotes are accepted: otherwise any user could make a wrong price acceptable for everyone. A split-sized quote (for example the halved price after a 2:1 split) is accepted only when an administrator has confirmed the corporate action for that instrument, with a source and note, in Admin > Instruments (see PR #75 for the rejected user-split design).

Until you record the split for your strategy (or enter a verified post-split price), a strategy that held the instrument before a confirmed split takes effect gets `DATA_REQUIRED` for valuation and trade sizing, on every trading line of that instrument. A position first opened on or after the effective date is not affected. Reversing a recorded split with a ledger correction restores the pre-split units; revoking an administrator's confirmed action stops it explaining future quotes but does not delete quotes already accepted.
