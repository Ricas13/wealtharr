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

Once a split is confirmed (PR #94), each account of your strategy that held the instrument at the start of the effective date (UTC) must have recorded a split of the same ratio, dated from the day before the effective date until the next confirmed action, or valuation and trade sizing return `DATA_REQUIRED` on every trading line of that instrument. This is per account: recording the split in your ISA does not clear your GIA, a different ratio does not clear it, and a split recorded for a later action does not clear an earlier one. An account that held none of the instrument at that moment (sold out before, or bought after) is not affected. A manual price does not clear it, because it would pair a post-split price with units that are still pre-split; reconciliations are cash-only and an opening snapshot adds units, so they do not re-base a count either. After you record the split, a price observed before the effective date is not used with your units: the strategy waits for a post-split price.

Reversing a recorded split with a ledger correction restores the pre-split units. Revoking an administrator's confirmed action deletes the quotes it explained, and the later quotes judged against them, so the price reverts to the last pre-split accepted price. A rejection (`CORPORATE_ACTION_REVOKED`) is restored for each affected line, which keeps that price as the reference however old it is: the next provider quote is accepted only if it is plausible against it (or a new action is confirmed), and your strategies are `DATA_REQUIRED` until then.

If trades were entered after the split took effect, record the split with the effective date and time of the confirmed action (the day's 00:00 UTC) and its exact ratio: it restates only the units held at that instant, so post-split purchases are not multiplied again. A split dated before a later pre-effective entry is refused.

Effective dates are UTC dates. A market whose session crosses UTC midnight is not supported until exchange-timezone handling exists. Ratios that move the price by a factor of 5 or more (either direction, so 2:21 as well as 1:10) or that have a term above 50 need a second admin to approve them before any quote is explained.

A split can only be recorded once per account and instrument for a given confirmed action: recording it again (the same ratio at or after the same instant, or any second split inside that action's window) is refused until the first is reversed with a correction. If two splits are somehow present for one action on one account, your strategy is `DATA_REQUIRED` until the duplicate is reversed, because the units were restated more than once.
