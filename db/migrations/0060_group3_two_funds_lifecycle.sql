-- Idempotent version-safe conversion of the legacy research stub to Merriman
-- Moderate 2050. Pinned strategy instances and their financial ledgers are untouched.
-- Unlike a broad mutation, only disabled research rows with no PUBLISHED
-- version are eligible. An existing 1.0 DRAFT is preserved, with 1.1 inserted.
UPDATE strategy_definitions d
SET name='Two Funds for Life — Moderate (2050 retirement)',
    description='Merriman Moderate 2050 target-date plus annual decreasing US small-cap value allocation',
    family='DYNAMIC_ALLOCATION',engine='TWO_FUNDS_MODERATE'
WHERE d.key='two-funds-for-life' AND d.enabled=false
  AND NOT EXISTS(SELECT 1 FROM strategy_versions v
    WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED');

INSERT INTO strategy_versions(
 strategy_definition_id,version,effective_from,engine_key,lifecycle_status,
 upgrade_policy,input_schema,config,disclosure,published_at
)
SELECT d.id,'1.1','2026-10-14','TWO_FUNDS_MODERATE','PUBLISHED',
       'OPTIONAL','[]'::jsonb,
       '{"retirementYear":2050,"targetDateExposure":"G3_TDF_2050","smallCapValueExposure":"G3_US_SMALL_CAP_VALUE","variant":"MERRIMAN_MODERATE_2050","reviewFrequency":"ANNUAL","rebalanceThreshold":"0.00"}'::jsonb,
       'Merriman Moderate 2050 target-date retirement method with annual dynamic weight calculation. Not personalised investment advice.',now()
FROM strategy_definitions d
WHERE d.key='two-funds-for-life' AND d.engine='TWO_FUNDS_MODERATE'
 AND d.enabled=false
 AND NOT EXISTS(SELECT 1 FROM strategy_versions v
   WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED')
ON CONFLICT (strategy_definition_id,version) DO NOTHING;
