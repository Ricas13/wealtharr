-- Financial mutations take the strategy lock before inserting ledger rows.
-- now() is transaction start time: a transaction that waits for that lock can
-- otherwise appear older than the action calculated before it acquired the lock.
-- Preserve existing audit timestamps; timestamp future inserts at insertion.
ALTER TABLE ledger_events ALTER COLUMN created_at SET DEFAULT clock_timestamp();
