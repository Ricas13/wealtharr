import {describe,expect,it} from "vitest";
import {STRATEGY_PLUGINS} from "@/domain/strategy/catalog";
import {SHIPPING_STRATEGY_KEYS,isDisposableStrategyTestSeed,seedableStrategies} from "@/domain/strategy/seed-policy";

const db="postgresql://strategyos:strategyos@127.0.0.1:5432/strategyos_test";
describe("shipping catalogue bootstrap",()=>{
  it("does not invent completion evidence for any currently unverified strategy",()=>{
    expect(SHIPPING_STRATEGY_KEYS).toEqual([]);
    expect(seedableStrategies(STRATEGY_PLUGINS,false)).toEqual([]);
  });
  it("seeds all strategy test fixtures only in the exact disposable GitHub CI database",()=>{
    expect(isDisposableStrategyTestSeed({CI:"true",GITHUB_ACTIONS:"true"},db)).toBe(true);
    for(const [env,url] of [
      [{CI:"true",GITHUB_ACTIONS:"false"},db],
      [{CI:"false",GITHUB_ACTIONS:"true"},db],
      [{CI:"true",GITHUB_ACTIONS:"true"},"postgresql://app:pass@127.0.0.1:5432/wealtharr_prod"],
      [{CI:"true",GITHUB_ACTIONS:"true"},"postgresql://app:pass@production:5432/strategyos_test"]
    ] as const)expect(isDisposableStrategyTestSeed(env,url)).toBe(false);
    expect(seedableStrategies(STRATEGY_PLUGINS,true)).toHaveLength(STRATEGY_PLUGINS.length);
  });
  it("does not remove historic strategy rows or ledgers during bootstrap",()=>{
    // The only production seed effect on strategy tables is INSERT ... DO NOTHING;
    // filtering new entries never changes existing ledgers or customer version pins.
    expect(seedableStrategies([],false)).toEqual([]);
  });
});
