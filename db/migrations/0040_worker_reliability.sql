-- Worker reliability: fairness stamps and retention support indexes.
--
-- Same pattern as 0034 (last_calculation_attempt_at): every attempt is stamped, successful or not, and
-- the worker serves the least recently attempted first, so persistently failing rows rotate to the back
-- of the queue instead of starving healthy ones. Rows never attempted sort first.
--   users.deletion_attempted_at      - stalled account deletions (finishPendingAccountDeletions)
--   users.entitlement_checked_at     - per-owner entitlement enforcement in the hourly run
--   trading_lines.quote_attempted_at - market data refresh
--   notifications.delivery_attempted_at - delivery creation for notifications that keep failing
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_attempted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS entitlement_checked_at timestamptz;
ALTER TABLE trading_lines ADD COLUMN IF NOT EXISTS quote_attempted_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_attempted_at timestamptz;

CREATE INDEX IF NOT EXISTS users_deletion_pending_idx
  ON users (deletion_attempted_at NULLS FIRST, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_delivery_pending_idx
  ON notifications (delivery_attempted_at NULLS FIRST, created_at, id) WHERE deliveries_created_at IS NULL;

-- Retention support: each bounded cleanup selects by age, so the age columns need an index or every
-- run would scan the whole table to find nothing.
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start);
CREATE INDEX IF NOT EXISTS auth_tokens_expires_idx ON auth_tokens (expires_at);
CREATE INDEX IF NOT EXISTS telegram_link_tokens_expires_idx ON telegram_link_tokens (expires_at);
CREATE INDEX IF NOT EXISTS notification_deliveries_terminal_idx
  ON notification_deliveries (updated_at) WHERE status IN ('SENT','CANCELLED','DEAD_LETTER');
CREATE INDEX IF NOT EXISTS notifications_read_age_idx ON notifications (created_at) WHERE read_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS market_observation_age_idx ON market_data_observations (observed_at);
CREATE INDEX IF NOT EXISTS billing_webhook_events_age_idx ON billing_webhook_events (created_at);
CREATE INDEX IF NOT EXISTS store_webhook_events_age_idx ON store_webhook_events (created_at);
CREATE INDEX IF NOT EXISTS worker_runs_running_idx ON worker_runs (started_at) WHERE status='RUNNING';
CREATE INDEX IF NOT EXISTS worker_runs_age_idx ON worker_runs (started_at);
