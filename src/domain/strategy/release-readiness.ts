import {RESEARCH_STRATEGIES,type StrategyProfile} from "./research-catalog";
import {assertCuratedRules} from "./curated-release";
import {assessStrategyMarket,type VerifiedCandidate} from "./market-eligibility";

export type StrategyReleaseEvidence={
  key:string;enabled:boolean;version:string|null;engineKey:string|null;
  lifecycleStatus:string|null;config:Record<string,unknown>|null;inputSchema:unknown;
  specCard:string|null;goldenTests:string|null;attestedAt:string|null;
};
export type ResearchGate={
  key:string;name:string;state:string;marketNames:string[];missing:string[];
  rulesMatch:boolean;published:boolean;attested:boolean;operatorEnabled:boolean;
};
/**
 * This is an *evidence inventory*, not independent author approval or trading
 * eligibility certification. 'EXACT' mappings are operator assertions; no
 * exchange/broker licence or actual purchase is inferred from a database row.
 */
export function researchGate(
  profile:StrategyProfile,evidence:StrategyReleaseEvidence|undefined,
  candidates:VerifiedCandidate[],asOf:string
):ResearchGate{
  let rulesMatch=false;
  if(profile.config&&evidence?.config&&evidence.engineKey){
    try{
      assertCuratedRules(profile.key,evidence.engineKey,evidence.config,evidence.inputSchema);
      rulesMatch=true;
    }catch{rulesMatch=false;}
  }
  const published=evidence?.lifecycleStatus==="PUBLISHED";
  const attested=Boolean(evidence?.attestedAt&&evidence.specCard&&evidence.goldenTests);
  const check=profile.config?assessStrategyMarket(profile.engine,profile.config,candidates,
    {country:"GB",wrapper:"ISA",currency:"GBP"},asOf):null;
  const marketNames=check?.supportedMarkets??[];
  const missing=check?.missingExposures??[];
  const operatorEnabled=Boolean(evidence?.enabled);
  let state:string;
  if(!profile.config||profile.engine==="RESEARCH_PENDING")state="Research method incomplete";
  else if(!evidence?.version)state="Release not installed";
  else if(!rulesMatch)state="Stored rules need code review";
  else if(!published)state="Draft: source approval required";
  else if(!attested)state="Published: independent evidence missing";
  else if(!marketNames.length)state="No complete configured market";
  else state=operatorEnabled?"Enabled in catalogue: verify live evidence":"Eligible for operator review only";
  return {key:profile.key,name:profile.name,state,marketNames,missing,
    rulesMatch,published,attested,operatorEnabled};
}
export function strategyReadiness(
  releases:StrategyReleaseEvidence[],candidates:VerifiedCandidate[],asOf:string
):ResearchGate[]{
  const installed=new Map(releases.map(release=>[release.key,release]));
  return RESEARCH_STRATEGIES.map(profile=>researchGate(profile,installed.get(profile.key),candidates,asOf));
}
