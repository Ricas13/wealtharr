-- An administrator may start a strategy whose definition is still disabled for customers (to test it).
-- Such an instance is marked so that, if its owner later loses the admin role, the entitlement
-- enforcement pass can pause exactly these instances while the definition is still disabled.
-- Customers who legitimately run a strategy that was disabled later are NOT marked and are untouched.
-- Additive, defaults to false: every existing instance keeps its current behaviour.
ALTER TABLE strategy_instances ADD COLUMN IF NOT EXISTS admin_disabled_preview boolean NOT NULL DEFAULT false;
