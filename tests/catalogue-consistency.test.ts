import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {RESEARCH_STRATEGIES} from "@/domain/strategy/research-catalog";
import {supportedEngineKeys,validateEngineConfig} from "@/domain/strategy/registry";

// The seed, the reference catalogue and the engine registry must agree on engine names and on the
// preset configurations, or a strategy can be created that no engine will calculate.
describe("strategy catalogue consistency",()=>{
 const engines=new Set(supportedEngineKeys());

 it("every catalogue entry names a registered engine (or is explicitly pending)",()=>{
  const unknown=RESEARCH_STRATEGIES.filter((s)=>s.engine!=="RESEARCH_PENDING"&&!engines.has(s.engine)).map((s)=>s.key+":"+s.engine);
  expect(unknown).toEqual([]);
 });

 it("every engine named in the seed is registered",()=>{
  const seed=readFileSync("scripts/seed.ts","utf8");
  const block=seed.slice(seed.indexOf("const definitions=["),seed.indexOf("] as const;"));
  const named=[...block.matchAll(/,"([A-Z_]+)",(?:true|false),(?:true|false)\]/g)].map((m)=>m[1]);
  expect(named.length).toBeGreaterThanOrEqual(4);
  expect(named.filter((e)=>!engines.has(e))).toEqual([]);
 });

 it("seeds the fixed-allocation presets from the catalogue instead of a second inline copy",()=>{
  const seed=readFileSync("scripts/seed.ts","utf8");
  expect(seed).toContain("RESEARCH_STRATEGIES");
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
  expect(seed).toContain("preset.disclosure");
 });
});
