-- Durable fairness for the hourly worker. updated_at only moves when a calculation succeeds, so a
-- strategy whose calculation keeps failing stayed at the head of the stalest-first queue forever and,
-- once there were as many of them as the per-run cap, starved every healthy strategy. The worker now
-- stamps every attempt, successful or not, and orders by it; unreached strategies keep their old stamp
-- and are served first on the next run.
ALTER TABLE strategy_instances ADD COLUMN IF NOT EXISTS last_calculation_attempt_at timestamptz;
CREATE INDEX IF NOT EXISTS strategy_instances_attempt_idx ON strategy_instances (last_calculation_attempt_at NULLS FIRST, updated_at, id) WHERE status='ACTIVE';
