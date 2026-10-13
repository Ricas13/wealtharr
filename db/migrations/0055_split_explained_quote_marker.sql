-- A provider quote accepted because a recorded SPLIT explains it. Strategies that hold the instrument
-- without having recorded that split still count pre-split units, so their valuation fails closed
-- (DATA_REQUIRED) until they record it or enter a manual price. Only timestamps are stored.
ALTER TABLE trading_lines ADD COLUMN IF NOT EXISTS corporate_action_suspected_at timestamptz;
ALTER TABLE trading_lines ADD COLUMN IF NOT EXISTS corporate_action_split_at timestamptz;
