-- Public pricing copy is independent of permissions and actual payment authorization.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS marketing jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS payment_methods jsonb NOT NULL DEFAULT '["STRIPE"]'::jsonb;
ALTER TABLE plan_prices ADD COLUMN IF NOT EXISTS paypal_plan_id text;
CREATE UNIQUE INDEX IF NOT EXISTS plan_prices_paypal_plan_unique ON plan_prices(paypal_plan_id) WHERE paypal_plan_id IS NOT NULL;
