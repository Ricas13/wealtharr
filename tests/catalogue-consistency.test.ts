import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {RESEARCH_STRATEGIES,LEVERAGE_DISCLOSURE} from "@/domain/strategy/research-catalog";
import {STRATEGY_PLUGINS,curatedRelease} from "@/domain/strategy/catalog";
import {supportedEngineKeys,validateEngineConfig} from "@/domain/strategy/registry";

// The seed, the reference catalogue and the engine registry must agree on engine names and on the
// preset configurations, or a strategy can be created that no engine will calculate.
describe("strategy catalogue consistency",()=>{
 const engines=new Set(supportedEngineKeys());

 it("every catalogue entry names a registered engine (or is explicitly pending)",()=>{
  const unknown=RESEARCH_STRATEGIES.filter((s)=>s.engine!=="RESEARCH_PENDING"&&!engines.has(s.engine)).map((s)=>s.key+":"+s.engine);
  expect(unknown).toEqual([]);
 });

 it("every engine the seed will insert (from the plugin registry) is registered",()=>{
  const seeded=STRATEGY_PLUGINS.flatMap((p)=>p.seedDefinition?[p.seedDefinition]:[]);
  expect(seeded.length).toBeGreaterThanOrEqual(4);
  expect(seeded.map((d)=>d.engine).filter((e)=>!engines.has(e))).toEqual([]);
 });

 it("each seeded definition names the same engine as its plugin's release, and only unpublishable engines get no version",()=>{
  for(const plugin of STRATEGY_PLUGINS){
   const def=plugin.seedDefinition;
   if(!def)continue;
   const release=curatedRelease(plugin);
   expect(release,plugin.key).not.toBeNull();
   expect(def.engine,plugin.key).toBe(release!.engine);
   expect(def.initialVersion===null,plugin.key).toBe(def.engine==="MOMENTUM_ROTATION");
   if(def.initialVersion!==null)expect(release!.config,plugin.key).toBeTruthy();
  }
 });

 it("seeds definitions and presets from the plugin registry instead of a second inline copy",()=>{
  const seed=readFileSync("scripts/seed.ts","utf8");
  expect(seed).toContain("STRATEGY_PLUGINS");
  expect(seed).toContain("curatedRelease");
  expect(seed).not.toContain("const definitions=[");
  expect(seed).not.toContain('"9sig"');
  expect(seed).not.toMatch(/exposure:"US_EQUITY_3X_LONG"/);
  expect(seed).not.toMatch(/exposure:"US_SMALL_CAP_VALUE"/);
 });

 it("every fixed-allocation catalogue config passes its engine's own validation and sums to 100%",()=>{
  for(const s of RESEARCH_STRATEGIES.filter((x)=>x.engine==="FIXED_ALLOCATION"&&x.config)){
   expect(()=>validateEngineConfig("FIXED_ALLOCATION",s.config!),s.key).not.toThrow();
  }
 });
});

describe("fixed strategy catalogue",()=>{
 it("no listed fixed strategy exposes arbitrary customer allocation weights",()=>{
  for(const item of RESEARCH_STRATEGIES) {
   expect((item.config as {userWeights?:boolean}|undefined)?.userWeights,item.key).not.toBe(true);
   expect(item.inputSchema?.some(field=>String(field.key).startsWith("weight_")),item.key).not.toBe(true);
  }
 });
 it("classic HFEA remains 55%/45% with no customer weights",()=>{
  const hfea=RESEARCH_STRATEGIES.find(item=>item.key==="hfea")!;
  expect((hfea.config as {allocations:Array<{weight:string}>}).allocations.map(x=>x.weight)).toEqual(["0.55","0.45"]);
  expect(hfea.inputSchema).toBeUndefined();
 });
});

import {getExposure} from "@/domain/strategy/exposures";
describe("leveraged strategies carry a leverage disclosure",()=>{
 it("any catalogue strategy holding a leveraged exposure explains daily reset and volatility decay",()=>{
  for(const s of RESEARCH_STRATEGIES){
   const allocations=(s.config as {allocations?:Array<{exposure:string}>}|undefined)?.allocations??[];
   if(!allocations.some((a)=>(getExposure(a.exposure)?.leverage??1)>1))continue;
   expect(s.disclosure,s.key).toBeTruthy();
   expect(s.disclosure,s.key).toMatch(/reset/i);
   expect(s.disclosure,s.key).toMatch(/volatility decay/i);
  }
 });
 it("the seed stores the catalogue disclosure rather than the generic one for those strategies",()=>{
  const seed=readFileSync("scripts/seed.ts","utf8");
  expect(seed).toContain("release.disclosure");
  const hfea=STRATEGY_PLUGINS.find((p)=>p.key==="hfea")!;
  expect(curatedRelease(hfea)?.disclosure).toBe(LEVERAGE_DISCLOSURE);
 });
});
