-- Advance review reminders (type REVIEW_UPCOMING). A reminder has no action row (action_id is NULL),
-- so it carries the strategy and the review date it announces. The delivery worker uses these two
-- columns to cancel a reminder that has become stale (strategy no longer active, or the review date
-- has moved) before anything is sent. Nullable and additive: existing notifications are untouched.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS strategy_instance_id uuid REFERENCES strategy_instances(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reminder_due_at timestamptz;
