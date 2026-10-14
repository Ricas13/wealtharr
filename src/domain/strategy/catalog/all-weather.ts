import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

export const plugin:StrategyPlugin={
  key:"all-weather",
  profile:{
    key:"all-weather",name:"All Weather (unlevered reference)",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["BROAD_EQUITY","0.30"],["LONG_TREASURY","0.40"],["INTERMEDIATE_TREASURY","0.15"],["GOLD","0.075"],["BROAD_COMMODITIES","0.075"]],"ANNUAL"),
    rules:"Commonly circulated unlevered 30/40/15/7.5/7.5 All Weather approximation; NOT an official, single canonical Ray Dalio product or risk-parity implementation.",
    research:["https://portfoliocharts.com/portfolios/all-seasons-portfolio/"],
    risks:["Commodities and tax-wrapper availability","Allocation differs from true risk parity"]
  },
  seedDefinition:{
    name:"All Weather (reference)",family:"FIXED_ALLOCATION",description:"Published unlevered reference approximation",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"DRAFT",realignsResearchOnlyDefinition:false
  },
  specCard:"docs/strategy-specs/group-2-all-weather.md",
  goldenTests:"tests/strategy-group-2-golden.test.ts"
};
