-- Add immutable 1.1 method versions on existing installs; never modify 1.0, customer instances, order/trade history or ledgers.
-- Operator activation and exact instrument eligibility remain separate; definitions are not auto-enabled.
-- three-fund: preserve historical 1.0 rules, even when DRAFT. New method gets immutable 1.1.
INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,upgrade_policy,input_schema,config,disclosure,published_at)
SELECT d.id,'1.1','2026-10-14','FIXED_ALLOCATION','PUBLISHED','OPTIONAL','[]'::jsonb,'{"allocations":[{"exposure":"G1_US_TOTAL_EQUITY","weight":"0.40"},{"exposure":"G1_EX_US_TOTAL_EQUITY","weight":"0.40"},{"exposure":"G1_US_AGGREGATE_BONDS","weight":"0.20"}],"reviewFrequency":"ANNUAL","rebalanceThreshold":"0.00"}'::jsonb,
  'Rule calculator for a user-selected strategy. Not a suitability recommendation.',now()
FROM strategy_definitions d WHERE d.key='three-fund' AND d.engine='FIXED_ALLOCATION'
AND EXISTS (SELECT 1 FROM strategy_versions old WHERE old.strategy_definition_id=d.id AND old.version='1.0')
ON CONFLICT (strategy_definition_id,version) DO NOTHING;

-- golden-butterfly: preserve historical 1.0 rules, even when DRAFT. New method gets immutable 1.1.
INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,upgrade_policy,input_schema,config,disclosure,published_at)
SELECT d.id,'1.1','2026-10-14','FIXED_ALLOCATION','PUBLISHED','OPTIONAL','[]'::jsonb,'{"allocations":[{"exposure":"G1_US_LARGE_BLEND","weight":"0.20"},{"exposure":"G1_US_SMALL_VALUE","weight":"0.20"},{"exposure":"G1_US_LONG_TREASURY","weight":"0.20"},{"exposure":"G1_US_SHORT_TREASURY","weight":"0.20"},{"exposure":"G1_PHYSICAL_GOLD","weight":"0.20"}],"reviewFrequency":"ANNUAL","rebalanceThreshold":"0.00"}'::jsonb,
  'Rule calculator for a user-selected strategy. Not a suitability recommendation.',now()
FROM strategy_definitions d WHERE d.key='golden-butterfly' AND d.engine='FIXED_ALLOCATION'
AND EXISTS (SELECT 1 FROM strategy_versions old WHERE old.strategy_definition_id=d.id AND old.version='1.0')
ON CONFLICT (strategy_definition_id,version) DO NOTHING;

-- permanent-portfolio: preserve historical 1.0 rules, even when DRAFT. New method gets immutable 1.1.
INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,upgrade_policy,input_schema,config,disclosure,published_at)
SELECT d.id,'1.1','2026-10-14','FIXED_ALLOCATION','PUBLISHED','OPTIONAL','[]'::jsonb,'{"allocations":[{"exposure":"G1_US_LARGE_BLEND","weight":"0.25"},{"exposure":"G1_US_LONG_TREASURY","weight":"0.25"},{"exposure":"G1_US_TREASURY_BILLS","weight":"0.25"},{"exposure":"G1_PHYSICAL_GOLD","weight":"0.25"}],"reviewFrequency":"ANNUAL","rebalanceThreshold":"0.00"}'::jsonb,
  'Rule calculator for a user-selected strategy. Not a suitability recommendation.',now()
FROM strategy_definitions d WHERE d.key='permanent-portfolio' AND d.engine='FIXED_ALLOCATION'
AND EXISTS (SELECT 1 FROM strategy_versions old WHERE old.strategy_definition_id=d.id AND old.version='1.0')
ON CONFLICT (strategy_definition_id,version) DO NOTHING;

-- buffett-90-10: preserve historical 1.0 rules, even when DRAFT. New method gets immutable 1.1.
INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,upgrade_policy,input_schema,config,disclosure,published_at)
SELECT d.id,'1.1','2026-10-14','FIXED_ALLOCATION','PUBLISHED','OPTIONAL','[]'::jsonb,'{"allocations":[{"exposure":"G1_SP500_INDEX","weight":"0.90"},{"exposure":"G1_US_SHORT_GOVERNMENT","weight":"0.10"}],"reviewFrequency":"ANNUAL","rebalanceThreshold":"0.00"}'::jsonb,
  'Rule calculator for a user-selected strategy. Not a suitability recommendation.',now()
FROM strategy_definitions d WHERE d.key='buffett-90-10' AND d.engine='FIXED_ALLOCATION'
AND EXISTS (SELECT 1 FROM strategy_versions old WHERE old.strategy_definition_id=d.id AND old.version='1.0')
ON CONFLICT (strategy_definition_id,version) DO NOTHING;

-- 80-20: preserve historical 1.0 rules, even when DRAFT. New method gets immutable 1.1.
INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,upgrade_policy,input_schema,config,disclosure,published_at)
SELECT d.id,'1.1','2026-10-14','FIXED_ALLOCATION','PUBLISHED','OPTIONAL','[]'::jsonb,'{"allocations":[{"exposure":"GLOBAL_EQUITY_ALL_CAP_UNHEDGED","weight":"0.80"},{"exposure":"GLOBAL_AGGREGATE_BONDS_GBP_HEDGED","weight":"0.20"}],"reviewFrequency":"ANNUAL","rebalanceThreshold":"0.00"}'::jsonb,
  'Rule calculator for a user-selected strategy. Not a suitability recommendation.',now()
FROM strategy_definitions d WHERE d.key='80-20' AND d.engine='FIXED_ALLOCATION'
AND EXISTS (SELECT 1 FROM strategy_versions old WHERE old.strategy_definition_id=d.id AND old.version='1.0')
ON CONFLICT (strategy_definition_id,version) DO NOTHING;
