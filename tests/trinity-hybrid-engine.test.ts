import Decimal from "decimal.js";
import {describe,expect,it} from "vitest";
import {getStrategyPlugin} from "../src/domain/strategy/catalog";
import {TRINITY_CONFIG,TRINITY_SIGNALS,TRINITY_BILLS,TRINITY_VALUE,TRINITY_MOMENTUM} from "../src/domain/strategy/trinity-model";
import {trinityEngine,trinityWeights} from "../src/domain/strategy/trinity-engine";
import type {EngineContext,TrustedHistoricalSeries} from "../src/domain/strategy/types";

const NOW=new Date("2026-12-31T22:00:00Z");
const series=(exposure:string,growth:number):TrustedHistoricalSeries=>({
  exposure,currency:"GBP",source:"verified-adjusted-close-trinity-fixture",
  points:Array.from({length:13},(_,i)=>({
    at:new Date(Date.UTC(2025+Math.floor((11+i)/12),(11+i)%12+1,0,21)),
    adjustedClose:new Decimal(100).mul(new Decimal(growth).pow(i))
  }))
});
const history=(falling=false)=>TRINITY_SIGNALS.map((exposure,i)=>
  series(exposure,falling?0.99-i*0.005:1.10-i*0.01));
const ctx=(historical:TrustedHistoricalSeries[]=history()):EngineContext=>({
 strategyInstanceId:"trinity-test",strategyVersionId:"v1",now:NOW,baseCurrency:"GBP",
 cash:new Decimal("10000"),exposures:[],contributionsSinceReview:new Decimal(0),state:{},
 config:{...TRINITY_CONFIG},settings:{},reviewDue:true,dataHealth:{status:"CURRENT"},
 trustedHistory:historical
});
describe("trinity documented Tactfolio 50/50 hybrid mathematical engine",()=>{
  it("has source-locked, never-administrator-editable immutable rules",()=>{
    const plugin=getStrategyPlugin("trinity");
    expect(plugin?.profile?.engine).toBe("TRINITY_HYBRID");
    expect(plugin?.seedDefinition?.enabled).toBe(false);
    expect(plugin?.releaseStatus).toBe("COMPLETE");
    trinityEngine.validateConfig({...TRINITY_CONFIG});
    expect(()=>trinityEngine.validateConfig({...TRINITY_CONFIG,topCount:4})).toThrow("TRINITY_CONFIG_NOT_CANONICAL");
  });
  it("50% static half + five top trend slots = 100%; selected US stock split into value and momentum",()=>{
    const weights=trinityWeights(ctx());
    const sum=weights.reduce((total,row)=>total.plus(row.weight),new Decimal(0));
    expect(sum.toFixed(2)).toBe("1.00");
    const by=new Map(weights.map(w=>[w.exposure,w.weight]));
    // 4.5% static US large value, +5% tactical for broad US signal's half slot.
    expect(by.get(TRINITY_VALUE)).toBe("0.095000");
    expect(by.get(TRINITY_MOMENTUM)).toBe("0.095000");
    expect(by.get(TRINITY_BILLS)).toBe("0.000000");
  });
  it("all ten declining signals route 50% tactical half to Treasury bills, 50% static persists",()=>{
    const weights=trinityWeights(ctx(history(true)));
    const defensive=weights.find(x=>x.exposure===TRINITY_BILLS);
    expect(defensive?.weight).toBe("0.500000");
    expect(weights.reduce((sum,w)=>sum+Number(w.weight),0)).toBeCloseTo(1,10);
  });
  it("actual calculation proposes a cash-funded first buy, rather than a fixed-weight no-op",()=>{
    const out=trinityEngine.calculate(ctx());
    expect(out.actionType).toBe("BUY");
    expect(out.amount?.gt(0)).toBe(true);
    expect(out.explanation[0].value).toContain("Tactfolio");
  });
  it("rejects missing, cross-currency, stale and ambiguous monthly history",()=>{
    const base=ctx();
    expect(trinityEngine.calculate({...base,trustedHistory:[]}).actionType).toBe("DATA_REQUIRED");
    const wrong=history();wrong[0]={...wrong[0],currency:"USD"};
    expect(trinityEngine.calculate(ctx(wrong)).actionType).toBe("DATA_REQUIRED");
    expect(trinityEngine.calculate({...base,dataHealth:{status:"STALE"}}).actionType).toBe("DATA_REQUIRED");
    const old=history().map(s=>({...s,points:s.points.map(p=>({
      ...p,at:new Date(Date.UTC(p.at.getUTCFullYear()-1,p.at.getUTCMonth(),p.at.getUTCDate(),21))
    }))}));
    expect(trinityEngine.calculate(ctx(old)).actionType).toBe("DATA_REQUIRED");
  });
});
