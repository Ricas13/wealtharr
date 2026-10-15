-- Group 3 Trinity hybrid's exact Tactfolio 2016 rules (new immutable version only).
-- Do not change old pinned instances/ledger/versions. Legacy research promotion
-- occurs only when global definition is disabled and no existing published version.
UPDATE strategy_definitions d
SET name='Trinity Portfolio — Faber 2016 Tactfolio proxy',
    description='50% Global Asset Allocation Plus / 50% Global Trend 10-asset ranked-monthly proxy',
    family='TACTICAL_MULTI_ASSET',engine='TRINITY_HYBRID'
WHERE d.key='trinity' AND d.enabled=false
 AND NOT EXISTS(SELECT 1 FROM strategy_versions v WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED');

INSERT INTO strategy_versions(strategy_definition_id,version,effective_from,engine_key,
 lifecycle_status,upgrade_policy,input_schema,config,disclosure,published_at)
SELECT d.id,'1.1','2026-10-14','TRINITY_HYBRID','PUBLISHED','OPTIONAL',
  '[]'::jsonb,'{"variant":"TACTFOLIO_2016_PROXY","reviewFrequency":"MONTHLY","reviewSchedule":"CALENDAR_MONTH_END","reviewTimezone":"America/New_York","reviewCutoffLocal":"16:00","businessDayConvention":"PREVIOUS","marketHolidays":[],"rebalanceThreshold":"0.00","staticWeight":"0.50","tacticalWeight":"0.50","staticAllocations":[{"exposure":"G3_TRINITY_US_LARGE_VALUE","weight":"0.045"},{"exposure":"G3_TRINITY_US_LARGE_MOMENTUM","weight":"0.045"},{"exposure":"G3_TRINITY_DEVELOPED_VALUE","weight":"0.0675"},{"exposure":"G3_TRINITY_EMERGING","weight":"0.0225"},{"exposure":"G3_TRINITY_US_CORPORATE_IG","weight":"0.099"},{"exposure":"G3_TRINITY_US_LONG_TREASURY","weight":"0.0675"},{"exposure":"G3_TRINITY_FOREIGN_GOVT_10Y","weight":"0.072"},{"exposure":"G3_TRINITY_US_TIPS","weight":"0.009"},{"exposure":"G3_TRINITY_BROAD_COMMODITIES","weight":"0.025"},{"exposure":"G3_TRINITY_GOLD","weight":"0.025"},{"exposure":"G3_TRINITY_US_REITS","weight":"0.0225"}],"signalUniverse":["G3_TRINITY_US_LARGE_SIGNAL","G3_TRINITY_DEVELOPED_VALUE","G3_TRINITY_EMERGING","G3_TRINITY_US_CORPORATE_IG","G3_TRINITY_US_LONG_TREASURY","G3_TRINITY_FOREIGN_GOVT_10Y","G3_TRINITY_US_TIPS","G3_TRINITY_BROAD_COMMODITIES","G3_TRINITY_GOLD","G3_TRINITY_US_REITS"],"defensiveAsset":"G3_TRINITY_US_TBILLS","momentumLookbacks":[1,3,6,12],"topCount":5,"trendMonths":10}'::jsonb,
  'Rules-based Trinity 2016 Tactfolio proxy; underlying fund-level value/momentum tilts are not proprietary Cambria replication. Markets and monthly licensed signals must be verified.',now()
FROM strategy_definitions d
WHERE d.key='trinity' AND d.enabled=false AND d.engine='TRINITY_HYBRID'
 AND NOT EXISTS(SELECT 1 FROM strategy_versions v WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED')
ON CONFLICT(strategy_definition_id,version) DO NOTHING;
