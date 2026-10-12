import type {StrategyEngineKey,StrategyPlugin,StrategyProfile} from "./plugin";
// Explicit imports (no filesystem globbing) so the registry is bundler safe. To add a strategy,
// create `<key>.ts` in this folder and add it to STRATEGY_PLUGINS below (see docs/strategy-engines.md).
import {plugin as nineSig} from "./9sig";
import {plugin as hfea} from "./hfea";
import {plugin as goldenButterfly} from "./golden-butterfly";
import {plugin as permanentPortfolio} from "./permanent-portfolio";
import {plugin as allWeather} from "./all-weather";
import {plugin as threeFund} from "./three-fund";
import {plugin as sixtyForty} from "./60-40";
import {plugin as eightyTwenty} from "./80-20";
import {plugin as buffett9010} from "./buffett-90-10";
import {plugin as coffeehouse} from "./coffeehouse";
import {plugin as coreFour} from "./core-four";
import {plugin as swensen} from "./swensen";
import {plugin as merrimanUltimate} from "./merriman-ultimate";
import {plugin as incomeSig} from "./income-sig";
import {plugin as twoFundsForLife} from "./two-funds-for-life";
import {plugin as bernsteinNoBrainer} from "./bernstein-no-brainer";
import {plugin as larryPortfolio} from "./larry-portfolio";
import {plugin as pinwheel} from "./pinwheel";
import {plugin as trinity} from "./trinity";
import {plugin as trend200d} from "./trend-200d";
import {plugin as riskParity} from "./risk-parity";
import {plugin as dualMomentum} from "./dual-momentum";
import {plugin as gtaaIvy} from "./gtaa-ivy";
import {plugin as paa} from "./paa";
import {plugin as vaa} from "./vaa";
import {plugin as threeSig} from "./3sig";
import {plugin as sixSig} from "./6sig";

export type {StrategyEngineKey,StrategyPlugin,StrategyProfile,SeedDefinition,CodeRelease} from "./plugin";
export {LEVERAGE_DISCLOSURE} from "./plugin";
export {CANONICAL_9SIG_CONFIG} from "./9sig";

/**
 * Every strategy the portal knows about, in display/seed order. The profiles of the plugins that
 * have one, in this order, are `RESEARCH_STRATEGIES`.
 */
export const STRATEGY_PLUGINS:readonly StrategyPlugin[]=[
  nineSig,
  hfea,goldenButterfly,permanentPortfolio,allWeather,threeFund,sixtyForty,eightyTwenty,buffett9010,
  coffeehouse,coreFour,swensen,
  merrimanUltimate,incomeSig,twoFundsForLife,bernsteinNoBrainer,larryPortfolio,pinwheel,trinity,
  trend200d,riskParity,
  dualMomentum,gtaaIvy,paa,vaa,
  threeSig,sixSig
];

const BY_KEY=new Map<string,StrategyPlugin>();
for(const plugin of STRATEGY_PLUGINS){
  if(BY_KEY.has(plugin.key))throw new Error("DUPLICATE_STRATEGY_PLUGIN:"+plugin.key);
  if(plugin.profile&&plugin.profile.key!==plugin.key)throw new Error("STRATEGY_PLUGIN_KEY_MISMATCH:"+plugin.key);
  BY_KEY.set(plugin.key,plugin);
}

export function getStrategyPlugin(key:string):StrategyPlugin|undefined{return BY_KEY.get(key);}
/** True for every strategy that is built in and code-reviewed (reference catalogue and 9Sig). */
export function isBuiltInStrategy(key:string):boolean{return BY_KEY.has(key);}

/** The engine and immutable rules a stored version is compared against (`assertCuratedRules`). */
export type CuratedRelease={
  engine:StrategyEngineKey;
  config:Readonly<Record<string,unknown>>|undefined;
  inputSchema:StrategyProfile["inputSchema"];
  disclosure:string|undefined;
  summary:string|undefined;
};
export function curatedRelease(plugin:StrategyPlugin):CuratedRelease|null{
  if(plugin.profile){
    return {engine:plugin.profile.engine,config:plugin.profile.config,inputSchema:plugin.profile.inputSchema,
      disclosure:plugin.profile.disclosure,summary:undefined};
  }
  if(plugin.codeRelease){
    return {engine:plugin.codeRelease.engine,config:plugin.codeRelease.config,inputSchema:undefined,
      disclosure:undefined,summary:plugin.codeRelease.summary};
  }
  return null;
}
