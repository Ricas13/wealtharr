import {describe,expect,it} from "vitest";
import {existsSync,readFileSync} from "node:fs";
import {STRATEGY_PLUGINS,getStrategyPlugin} from "@/domain/strategy/catalog";
import type {StrategyPlugin} from "@/domain/strategy/catalog/plugin";
import {evaluateMethodCompleteness,isMethodComplete,type MethodFileEvidence} from "@/domain/strategy/method-complete";

const realFiles:MethodFileEvidence={
  exists:(path)=>existsSync(path),
  read:(path)=>existsSync(path)?readFileSync(path,"utf8"):null
};
/** In-memory evidence: a map of path -> content. */
const memory=(files:Record<string,string>):MethodFileEvidence=>({
  exists:(path)=>Object.hasOwn(files,path),
  read:(path)=>Object.hasOwn(files,path)?files[path]:null
});

const base=getStrategyPlugin("60-40")!;
const CARD=base.specCard!;
const GOLDEN=base.goldenTests!;
const goodCard=[
  "# Card","## Definition","x","## Rebalancing rule (exact)","x","## Instrument requirements","x",
  "## Owner-decision list","x","## Golden tests","x"
].join("\n");
const goodGolden='import {expect,it} from "vitest";\nit("x",()=>{expect(getStrategyPlugin("60-40")).toBeTruthy();});\n';
const goodFiles=()=>memory({[CARD]:goodCard,[GOLDEN]:goodGolden});

const variant=(over:Partial<StrategyPlugin>):StrategyPlugin=>({...base,...over});
const withConfig=(config:Record<string,unknown>,extra:Partial<NonNullable<StrategyPlugin["profile"]>>={}):StrategyPlugin=>
  variant({profile:{...base.profile!,config,...extra}});
const alloc=(a:string,b:string)=>({allocations:[{exposure:a,weight:"0.60"},{exposure:b,weight:"0.40"}],
  reviewFrequency:"ANNUAL",rebalanceThreshold:"0.00"});
const failed=(plugin:StrategyPlugin,files?:MethodFileEvidence)=>
  evaluateMethodCompleteness(plugin,files).checks.filter(c=>!c.ok).map(c=>c.id);

describe("isMethodComplete: the real catalogue",()=>{
  it("marks the released 60/40 and 80/20 GBP models complete, with and without file evidence",()=>{
    const complete=(files?:MethodFileEvidence)=>STRATEGY_PLUGINS.filter(p=>isMethodComplete(p,files)).map(p=>p.key);
    expect(complete()).toEqual(["60-40","80-20"]);
    expect(complete(realFiles)).toEqual(["60-40"]);
  });
  it("every plugin declared COMPLETE satisfies every checklist item against the real files",()=>{
    for(const plugin of STRATEGY_PLUGINS.filter(p=>p.releaseStatus==="COMPLETE")){
      const result=evaluateMethodCompleteness(plugin,realFiles);
      expect(result.failures,plugin.key).toEqual([]);
      expect(result.checks.map(c=>c.id),plugin.key).toEqual(expect.arrayContaining(["spec-card-file","golden-file"]));
    }
  });
  it("no plugin without an explicit COMPLETE declaration is ever complete",()=>{
    for(const plugin of STRATEGY_PLUGINS.filter(p=>p.releaseStatus!=="COMPLETE")){
      expect(isMethodComplete(plugin),plugin.key).toBe(false);
      expect(isMethodComplete(plugin,realFiles),plugin.key).toBe(false);
    }
  });
  it("keeps 9Sig, HFEA and the other fixed allocations incomplete",()=>{
    for(const key of ["9sig","hfea","three-fund","all-weather","dual-momentum"])
      expect(isMethodComplete(getStrategyPlugin(key)),key).toBe(false);
    expect(isMethodComplete(undefined)).toBe(false);
  });
  it("the 60/40 golden file is a dedicated engine-level file, not the shared reference file",()=>{
    expect(GOLDEN).toBe("tests/strategy-golden-60-40.test.ts");
    expect(readFileSync(GOLDEN,"utf8")).toContain("fixedAllocationEngine");
  });
});

describe("isMethodComplete: checklist matrix",()=>{
  it("passes the unmodified plugin with good in-memory files",()=>{
    expect(failed(base,goodFiles())).toEqual([]);
  });
  it("requires the explicit declaration",()=>{
    expect(failed(variant({releaseStatus:undefined}))).toEqual(["declared"]);
    expect(failed(variant({releaseStatus:"INCOMPLETE"}))).toEqual(["declared"]);
  });
  it("requires the seed to insert a PUBLISHED version",()=>{
    expect(failed(variant({seedDefinition:{...base.seedDefinition!,initialVersion:"DRAFT"}}))).toContain("seed-published");
    expect(failed(variant({seedDefinition:{...base.seedDefinition!,initialVersion:null}}))).toContain("seed-published");
    expect(failed(variant({seedDefinition:null}))).toEqual(expect.arrayContaining(["seed-published","release-rules"]));
  });
  it("requires executable rules whose engine matches the seed definition",()=>{
    expect(failed(variant({profile:{...base.profile!,engine:"RESEARCH_PENDING",config:undefined}})))
      .toEqual(expect.arrayContaining(["release-rules","engine"]));
    expect(failed(variant({seedDefinition:{...base.seedDefinition!,engine:"VALUE_TARGET"}}))).toContain("release-rules");
  });
  it("requires a customer-publishable engine",()=>{
    expect(failed(variant({profile:{...base.profile!,engine:"MOMENTUM_ROTATION"},
      seedDefinition:{...base.seedDefinition!,engine:"MOMENTUM_ROTATION"}}))).toContain("engine");
  });
  it("requires every referenced exposure to be registered with a full descriptor",()=>{
    const e="GLOBAL_EQUITY_ALL_CAP_UNHEDGED";
    expect(failed(withConfig(alloc("NOT_A_REGISTERED_EXPOSURE","GLOBAL_AGGREGATE_BONDS_GBP_HEDGED")))).toContain("exposures");
    expect(failed(withConfig(alloc(e,"AGGREGATE_BONDS")))).toContain("exposures");
    expect(failed(withConfig(alloc("BROAD_EQUITY","AGGREGATE_BONDS")))).toContain("exposures");
    expect(failed(withConfig({allocations:[],reviewFrequency:"ANNUAL"}))).toContain("exposures");
    expect(failed(withConfig({allocations:[{weight:"1"}]}))).toContain("exposures");
  });
  it("requires a disclosure for a leveraged exposure",()=>{
    const leveraged=withConfig(alloc("US_EQUITY_3X_LONG","LONG_TREASURY_3X_LONG"));
    expect(failed(leveraged)).toEqual(expect.arrayContaining(["exposures","leverage"]));
    const hfea=getStrategyPlugin("hfea")!;
    expect(failed(hfea)).toContain("declared");
  });
  it("requires well-formed spec card and golden test paths",()=>{
    expect(failed(variant({specCard:null}))).toContain("spec-card");
    expect(failed(variant({specCard:"docs/../secret.md"}))).toContain("spec-card");
    expect(failed(variant({goldenTests:null}))).toContain("golden-tests");
    expect(failed(variant({goldenTests:"../outside.test.ts"}))).toContain("golden-tests");
  });
});

describe("isMethodComplete: file evidence",()=>{
  it("fails when the spec card file is missing",()=>{
    expect(failed(base,memory({[GOLDEN]:goodGolden}))).toEqual(["spec-card-file"]);
  });
  it("fails when the spec card lacks a model-definition section",()=>{
    for(const heading of ["## Definition","## Rebalancing rule (exact)","## Instrument requirements","## Owner-decision list","## Golden tests"]){
      const card=goodCard.replace(heading,"## Something else");
      expect(failed(base,memory({[CARD]:card,[GOLDEN]:goodGolden})),heading).toEqual(["spec-card-file"]);
    }
  });
  it("fails when the card still carries VERIFY, DRAFT or NOT SIGNED OFF markers",()=>{
    for(const marker of ["VERIFY the weights","Status: DRAFT","NOT SIGNED OFF"])
      expect(failed(base,memory({[CARD]:goodCard+"\n"+marker,[GOLDEN]:goodGolden})),marker).toEqual(["spec-card-file"]);
  });
  it("fails when the golden file is missing, a placeholder, or does not reference the key",()=>{
    expect(failed(base,memory({[CARD]:goodCard}))).toEqual(["golden-file"]);
    expect(failed(base,memory({[CARD]:goodCard,[GOLDEN]:"// TODO golden cases\n"}))).toEqual(["golden-file"]);
    expect(failed(base,memory({[CARD]:goodCard,[GOLDEN]:'it("x",()=>{expect(1).toBe(1);});'}))).toEqual(["golden-file"]);
    expect(failed(base,memory({[CARD]:goodCard,[GOLDEN]:'const key="60-40";'}))).toEqual(["golden-file"]);
  });
  it("the golden check is per key: a file that names another strategy does not count",()=>{
    const other='it("x",()=>{expect(getStrategyPlugin("hfea")).toBeTruthy();});';
    expect(failed(base,memory({[CARD]:goodCard,[GOLDEN]:other}))).toEqual(["golden-file"]);
  });
});
