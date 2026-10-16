-- A read-only verification with no explicitly linked broker trades has nothing to check. Record that as
-- its own status instead of NEEDS_RECONCILIATION, which wrongly told the investor something was wrong.
ALTER TABLE strategy_broker_connections DROP CONSTRAINT IF EXISTS strategy_broker_connections_last_sync_status_check;
ALTER TABLE strategy_broker_connections ADD CONSTRAINT strategy_broker_connections_last_sync_status_check
  CHECK (last_sync_status IN ('NOT_SYNCED','VERIFIED','NEEDS_RECONCILIATION','NO_LINKED_TRADES','ERROR'));
UPDATE strategy_broker_connections SET last_sync_status='NO_LINKED_TRADES'
  WHERE last_sync_status='NEEDS_RECONCILIATION' AND COALESCE((last_sync_summary->>'linkedTradeCount')::int,0)=0;
