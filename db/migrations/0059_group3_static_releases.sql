-- Group 3 static release promotion: preserves immutable old versions, instances and ledgers.
-- Only a disabled legacy definition with no published release can be realigned.
-- New install has no matching legacy row: scripts/seed.ts seeds code version 1.0 instead.
-- A legacy 1.0 DRAFT stays untouched; a separate 1.1 PUBLISHED becomes the latest.
-- Nothing is enabled; country/wrapper/broker/plan/user market gates still apply.
WITH releases(strategy_key,release_name,release_config) AS (
  VALUES ('bernstein-no-brainer','Bernstein No-Brainer — US reference','{"allocations":[{"exposure":"G3_US_LARGE_CAP_BLEND","weight":"0.25"},{"exposure":"G3_US_SMALL_CAP_BLEND","weight":"0.25"},{"exposure":"G3_DEV_EX_US_SMALL_CAP_BLEND","weight":"0.25"},{"exposure":"G3_US_SHORT_TREASURY","weight":"0.25"}],"reviewFrequency":"ANNUAL","rebalanceThreshold":"0.00"}'::jsonb),
    ('larry-portfolio','Larry Portfolio — 2014 28/72 example','{"allocations":[{"exposure":"G3_US_SMALL_CAP_VALUE","weight":"0.14"},{"exposure":"G3_DEV_EX_US_SMALL_CAP_VALUE","weight":"0.105"},{"exposure":"G3_EM_VALUE","weight":"0.035"},{"exposure":"G3_US_FIVE_YEAR_TREASURY","weight":"0.72"}],"reviewFrequency":"ANNUAL","rebalanceThreshold":"0.00"}'::jsonb),
    ('pinwheel','Pinwheel — Portfolio Charts US reference','{"allocations":[{"exposure":"G3_US_LARGE_CAP_BLEND","weight":"0.15"},{"exposure":"G3_US_SMALL_CAP_VALUE","weight":"0.10"},{"exposure":"G3_DEV_EX_US_LARGE_CAP_BLEND","weight":"0.15"},{"exposure":"G3_EM_LARGE_CAP_BLEND","weight":"0.10"},{"exposure":"G3_US_INTERMEDIATE_TREASURY","weight":"0.15"},{"exposure":"G3_US_TREASURY_BILLS","weight":"0.10"},{"exposure":"G3_US_REITS","weight":"0.15"},{"exposure":"G3_PHYSICAL_GOLD","weight":"0.10"}],"reviewFrequency":"ANNUAL","rebalanceThreshold":"0.00"}'::jsonb)
)
UPDATE strategy_definitions d SET
  name=r.release_name,description='Source-locked Group 3 fixed allocation reference',
  family='FIXED_ALLOCATION',engine='FIXED_ALLOCATION'
FROM releases r
WHERE d.key=r.strategy_key AND d.enabled=false
  AND NOT EXISTS (
    SELECT 1 FROM strategy_versions v WHERE v.strategy_definition_id=d.id
       AND v.lifecycle_status='PUBLISHED'
  );

WITH releases(strategy_key,release_name,release_config) AS (
  VALUES ('bernstein-no-brainer','Bernstein No-Brainer — US reference','{"allocations":[{"exposure":"G3_US_LARGE_CAP_BLEND","weight":"0.25"},{"exposure":"G3_US_SMALL_CAP_BLEND","weight":"0.25"},{"exposure":"G3_DEV_EX_US_SMALL_CAP_BLEND","weight":"0.25"},{"exposure":"G3_US_SHORT_TREASURY","weight":"0.25"}],"reviewFrequency":"ANNUAL","rebalanceThreshold":"0.00"}'::jsonb),
    ('larry-portfolio','Larry Portfolio — 2014 28/72 example','{"allocations":[{"exposure":"G3_US_SMALL_CAP_VALUE","weight":"0.14"},{"exposure":"G3_DEV_EX_US_SMALL_CAP_VALUE","weight":"0.105"},{"exposure":"G3_EM_VALUE","weight":"0.035"},{"exposure":"G3_US_FIVE_YEAR_TREASURY","weight":"0.72"}],"reviewFrequency":"ANNUAL","rebalanceThreshold":"0.00"}'::jsonb),
    ('pinwheel','Pinwheel — Portfolio Charts US reference','{"allocations":[{"exposure":"G3_US_LARGE_CAP_BLEND","weight":"0.15"},{"exposure":"G3_US_SMALL_CAP_VALUE","weight":"0.10"},{"exposure":"G3_DEV_EX_US_LARGE_CAP_BLEND","weight":"0.15"},{"exposure":"G3_EM_LARGE_CAP_BLEND","weight":"0.10"},{"exposure":"G3_US_INTERMEDIATE_TREASURY","weight":"0.15"},{"exposure":"G3_US_TREASURY_BILLS","weight":"0.10"},{"exposure":"G3_US_REITS","weight":"0.15"},{"exposure":"G3_PHYSICAL_GOLD","weight":"0.10"}],"reviewFrequency":"ANNUAL","rebalanceThreshold":"0.00"}'::jsonb)
)
INSERT INTO strategy_versions(
  strategy_definition_id,version,effective_from,engine_key,lifecycle_status,
  upgrade_policy,input_schema,config,disclosure,published_at
)
SELECT d.id,'1.1','2026-10-14','FIXED_ALLOCATION','PUBLISHED','OPTIONAL',
       '[]'::jsonb,r.release_config,
       'Rule calculator using strict economic exposure mappings. No personal investment advice.',now()
FROM releases r
JOIN strategy_definitions d ON d.key=r.strategy_key
WHERE d.enabled=false AND d.engine='FIXED_ALLOCATION'
  AND NOT EXISTS (
    SELECT 1 FROM strategy_versions v WHERE v.strategy_definition_id=d.id
      AND v.lifecycle_status='PUBLISHED'
  )
ON CONFLICT (strategy_definition_id,version) DO NOTHING;
