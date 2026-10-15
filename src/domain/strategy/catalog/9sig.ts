import type {StrategyPlugin} from "./plugin";

export const CANONICAL_9SIG_CONFIG={
  targetExposure:"NASDAQ_100_3X_LONG",
  initialTargetRatio:"0.60",targetRate:"0.09",contributionTargetRatio:"0.50",
  maxCashUse:"0.90",tolerance:"0.01",reviewFrequency:"QUARTERLY",
  reviewCutoffLocal:"16:00",businessDayConvention:"PREVIOUS",marketHolidays:[]
} as const;

export const plugin:StrategyPlugin={
  key:"9sig",
  profile:null,
  codeRelease:{
    engine:"VALUE_TARGET",
    config:CANONICAL_9SIG_CONFIG,
    summary:"Research-only value-target model; original 9Sig protection/reset rules are not fully verified. Do not enable for customers."
  },
  seedDefinition:{
    name:"9Sig",family:"SIGNAL_VALUE_TARGET",description:"Rules-based value target strategy",
    engine:"VALUE_TARGET",proprietary:true,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"DRAFT",realignsResearchOnlyDefinition:false
  },
  specCard:null,
  goldenTests:"tests/value-target.test.ts",
  releaseStatus:"INCOMPLETE"
};
