import { describe,expect,it } from "vitest";
import { readFileSync } from "node:fs";
import {
  exploreCardState,preselectedStrategyKey,summariseRules,
  type ExploreCardInput
} from "../src/domain/explore-catalogue";
import { STRATEGY_PLUGINS,getStrategyPlugin } from "../src/domain/strategy/catalog";

const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

const released:ExploreCardInput={
  engine:"FIXED_ALLOCATION",hasRules:true,definitionEnabled:true,publishedInWindow:true,
  rulesVerified:true,marketVerified:true
};

describe("exploreCardState",()=>{
  it("is AVAILABLE only when enabled, published in window, rules verified and a market exists",()=>{
    const result=exploreCardState(released);
    expect(result).toEqual({state:"AVAILABLE",reason:null,startAction:"START"});
    expect(exploreCardState({...released,engine:"VALUE_TARGET"}).state).toBe("AVAILABLE");
  });

  it("never reports a disabled definition as AVAILABLE",()=>{
    const result=exploreCardState({...released,definitionEnabled:false});
    expect(result.state).toBe("COMING_SOON");
    expect(result.startAction).toBe("NONE");
    expect(result.reason).toBeTruthy();
  });

  it("never reports a draft-only strategy (no published version in window) as AVAILABLE",()=>{
    const result=exploreCardState({...released,publishedInWindow:false});
    expect(result.state).toBe("COMING_SOON");
    expect(result.startAction).toBe("NONE");
  });

  it("is COMING_SOON while stored rules are unreviewed or no verified market exists",()=>{
    expect(exploreCardState({...released,rulesVerified:false}).state).toBe("COMING_SOON");
    const noMarket=exploreCardState({...released,marketVerified:false});
    expect(noMarket.state).toBe("COMING_SOON");
    expect(noMarket.reason).toBe("Awaiting verified instruments for your region.");
    expect(noMarket.startAction).toBe("NONE");
  });

  it("is RESEARCH for research-pending, rule-less or non-customer-publishable engines, even if enabled",()=>{
    for(const input of [
      {...released,engine:"RESEARCH_PENDING"},
      {...released,hasRules:false},
      {...released,engine:null},
      {...released,engine:"MOMENTUM_ROTATION"},
      {...released,engine:"SOMETHING_ELSE"}
    ]){
      const result=exploreCardState(input);
      expect(result.state).toBe("RESEARCH");
      expect(result.startAction).toBe("NONE");
    }
  });

  it("exposes plan limits separately without changing availability",()=>{
    const limited=exploreCardState(released,{atLimit:true,inPlan:true});
    expect(limited.state).toBe("AVAILABLE");
    expect(limited.startAction).toBe("PLAN_OPTIONS");
    const excluded=exploreCardState(released,{atLimit:false,inPlan:false});
    expect(excluded.state).toBe("AVAILABLE");
    expect(excluded.startAction).toBe("PLAN_OPTIONS");
    // A plan can never turn a blocked strategy into a startable one.
    expect(exploreCardState({...released,definitionEnabled:false},{atLimit:false,inPlan:true}).startAction).toBe("NONE");
  });
});

describe("summariseRules",()=>{
  it("describes fixed weights as exposure-level percentages without tickers",()=>{
    const summary=summariseRules(getStrategyPlugin("60-40")!);
    expect(summary.reviewFrequency).toBe("annually");
    expect(summary.allocations.map(row=>row.percent)).toEqual(["60","40"]);
    expect(summary.leveraged).toBe(false);
  });

  it("flags leveraged strategies and never emits registered ticker-like names",()=>{
    const hfea=summariseRules(getStrategyPlugin("hfea")!);
    expect(hfea.leveraged).toBe(true);
    expect(summariseRules(getStrategyPlugin("9sig")!).leveraged).toBe(true);
    for(const plugin of STRATEGY_PLUGINS){
      const summary=summariseRules(plugin);
      const text=[...summary.allocations.map(row=>row.label),summary.targetExposure??""].join(" ");
      expect(text).not.toMatch(/\b(UPRO|TMF|TQQQ|VTI|SPY|QQQ)\b/);
    }
  });

  it("returns nothing for strategies without implemented rules",()=>{
    const summary=summariseRules(getStrategyPlugin("dual-momentum")!);
    expect(summary.allocations).toEqual([]);
    expect(summary.targetExposure).toBeNull();
  });
});

describe("preselectedStrategyKey",()=>{
  it("accepts only keys in the allowed list",()=>{
    expect(preselectedStrategyKey("hfea",["9sig","hfea"])).toBe("hfea");
    expect(preselectedStrategyKey("hfea",["9sig"])).toBeNull();
    expect(preselectedStrategyKey("__proto__",["9sig"])).toBeNull();
    expect(preselectedStrategyKey(undefined,["9sig"])).toBeNull();
    expect(preselectedStrategyKey(["9sig","hfea"],["9sig","hfea"])).toBe("9sig");
    expect(preselectedStrategyKey(42,["9sig"])).toBeNull();
  });
});

describe("Explore wiring",()=>{
  const page=read("src/app/app/explore/page.tsx");

  it("requires a signed-in page user and derives state only from the pure function",()=>{
    expect(page).toContain("requirePageUser()");
    expect(page).toContain("exploreCardState(");
    expect(page).toContain("assertCuratedRules(");
    expect(page).toContain("assessStrategyMarket(");
  });

  it("renders Start links only for the START action",()=>{
    const links=page.match(/\/app\/strategies\/new\?strategy=/g)??[];
    expect(links).toHaveLength(1);
    const before=page.slice(0,page.indexOf("/app/strategies/new?strategy="));
    expect(before.slice(before.lastIndexOf("{card.result.startAction"))).toContain('card.result.startAction==="START"');
    expect(page).not.toContain("profile?.rules");
    expect(page).not.toContain(".rules}");
  });

  it("keeps community stats reachable and filters community versions to PUBLISHED",()=>{
    expect(page).toContain('href="/app/community"');
    expect(read("src/app/app/community/page.tsx")).toContain("v.lifecycle_status='PUBLISHED'");
  });

  it("points the Explore nav item at the catalogue",()=>{
    expect(read("src/components/AppShell.tsx")).toContain('<WorkspaceNavLink href="/app/explore">');
  });

  it("validates the preselected strategy against the allowed list server-side",()=>{
    const source=read("src/app/app/strategies/new/page.tsx");
    expect(source).toContain("preselectedStrategyKey(query.strategy,strategies.map(");
    expect(source).toContain("initialStrategyKey={initialStrategyKey}");
    expect(read("src/components/CreateStrategyForm.tsx")).toContain("strategies.find((s)=>s.key===initialStrategyKey)");
  });
});
