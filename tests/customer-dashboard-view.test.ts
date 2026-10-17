import {describe,expect,it} from "vitest";
import {STRATEGY_PLUGINS,curatedRelease} from "../src/domain/strategy/catalog";
import {strategyDashboardContext,strategyDashboardView} from "../src/domain/strategy/customer-dashboard-view";

const healthy={status:"ACTIVE",healthStatus:"HEALTHY"};
describe("adaptive dashboard status contract",()=>{
  it("does not call an unhealthy or stale strategy on track",()=>{
    expect(strategyDashboardView({...healthy,healthStatus:"NEEDS_ATTENTION"}).status).toBe("DATA_NEEDED");
    expect(strategyDashboardView({...healthy,actionStale:true,actionType:"BUY"}).status).toBe("DATA_NEEDED");
    expect(strategyDashboardView({...healthy,actionType:"DATA_REQUIRED"}).status).toBe("DATA_NEEDED");
  });
  it("distinguishes trade decisions, HOLD confirmations and no-action strategies",()=>{
    expect(strategyDashboardView({...healthy,actionType:"BUY"}).status).toBe("ACTION_REQUIRED");
    expect(strategyDashboardView({...healthy,actionType:"SELL"}).status).toBe("ACTION_REQUIRED");
    expect(strategyDashboardView({...healthy,actionType:"REBALANCE"}).status).toBe("ACTION_REQUIRED");
    expect(strategyDashboardView({...healthy,actionType:"HOLD"}).status).toBe("AWAITING_CONFIRMATION");
    expect(strategyDashboardView({...healthy,actionType:"NO_ACTION"}).status).toBe("ON_TRACK");
    expect(strategyDashboardView(healthy).status).toBe("ON_TRACK");
  });
  it("never marks paused or closed strategies as live",()=>{
    expect(strategyDashboardView({...healthy,status:"PAUSED",actionType:"BUY"}).status).toBe("PAUSED");
    expect(strategyDashboardView({...healthy,status:"CLOSED",actionType:"BUY"}).status).toBe("CLOSED");
  });
  it("always puts data blocks ahead of trade actions and on-track strategies",()=>{
    const states=[
      strategyDashboardView(healthy),
      strategyDashboardView({...healthy,actionType:"BUY"}),
      strategyDashboardView({...healthy,healthStatus:"NEEDS_ATTENTION"})
    ].sort((a,b)=>a.priority-b.priority);
    expect(states.map(s=>s.status)).toEqual(["DATA_NEEDED","ACTION_REQUIRED","ON_TRACK"]);
  });
});

describe("adaptive detail context is complete across the plugin catalogue",()=>{
  it("each registered strategy has a nonblank, safely described context",()=>{
    for(const plugin of STRATEGY_PLUGINS){
      const release=curatedRelease(plugin);
      const view=strategyDashboardContext(release?.engine??"RESEARCH_PENDING",release?.config??{});
      expect(view.label.trim().length,plugin.key).toBeGreaterThan(3);
      expect(view.detail.trim().length,plugin.key).toBeGreaterThan(20);
    }
  });
  it("shows published weights instead of claiming unverified current allocations",()=>{
    const fixed=strategyDashboardContext("FIXED_ALLOCATION",{
      allocations:[{exposure:"US_EQUITY_3X_LONG",weight:"0.55"},{exposure:"LONG_TREASURY_3X_LONG",weight:"0.45"}]
    });
    expect(fixed.kind).toBe("allocation");
    expect(fixed.detail).toContain("55%");
    expect(fixed.detail).toContain("45%");
    expect(fixed.detail).toContain("Target weights");
    expect(fixed.detail).not.toContain("current");
  });
  it("shows strategy-specific explanations only where the engine supports them",()=>{
    expect(strategyDashboardContext("QUARTERLY_SIGNAL_TARGET",{}).kind).toBe("target");
    expect(strategyDashboardContext("TACTICAL_ALLOCATION",{}).kind).toBe("momentum");
    expect(strategyDashboardContext("TRINITY_HYBRID",{}).kind).toBe("hybrid");
    expect(strategyDashboardContext("VALUE_TARGET",{}).kind).toBe("target");
  });
});
