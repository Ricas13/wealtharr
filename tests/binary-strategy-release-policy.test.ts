import {afterEach,describe,expect,it,vi} from "vitest";
import {assertReleaseMethodComplete,syntheticCatalogueFixtureAllowed} from "@/domain/strategy/curated-release";
import {readFileSync} from "node:fs";

afterEach(()=>vi.unstubAllEnvs());
describe("binary production strategy release policy",()=>{
  it("never treats the incomplete proprietary 9Sig draft as shippable on a live host",()=>{
    vi.stubEnv("NODE_ENV","production");
    vi.stubEnv("CI","false");
    vi.stubEnv("GITHUB_ACTIONS","false");
    vi.stubEnv("DATABASE_URL","postgresql://production@private-db:5432/wealtharr");
    expect(syntheticCatalogueFixtureAllowed()).toBe(false);
    expect(()=>assertReleaseMethodComplete("9sig")).toThrow("STRATEGY_METHOD_NOT_COMPLETE");
    // 60-40 was listed here while its method was incomplete; it is now the one complete method
    // (see the case below). A still-incomplete fixed allocation takes its place.
    expect(()=>assertReleaseMethodComplete("hfea")).toThrow("STRATEGY_METHOD_NOT_COMPLETE");
    expect(()=>assertReleaseMethodComplete("all-weather")).toThrow("STRATEGY_METHOD_NOT_COMPLETE");
    expect(()=>assertReleaseMethodComplete("unknown-strategy")).toThrow("STRATEGY_METHOD_NOT_COMPLETE");
  });
  it("accepts only the complete Global 60/40 (GBP) method on a live host, and still fails closed for the rest",()=>{
    vi.stubEnv("NODE_ENV","production");
    vi.stubEnv("CI","false");
    vi.stubEnv("GITHUB_ACTIONS","false");
    vi.stubEnv("DATABASE_URL","postgresql://production@private-db:5432/wealtharr");
    for(const key of ["60-40","80-20","three-fund","golden-butterfly","permanent-portfolio","buffett-90-10","trend-200d","risk-parity","dual-momentum","gtaa-ivy","paa","vaa","vaa-g12"]) expect(()=>assertReleaseMethodComplete(key)).not.toThrow();
    for(const key of ["9sig","hfea","all-weather","coffeehouse","core-four","swensen","3sig","6sig","nope"])
      expect(()=>assertReleaseMethodComplete(key),key).toThrow("STRATEGY_METHOD_NOT_COMPLETE");
  });
  it("CI exception is allowed only on the exact disposable localhost test database",()=>{
    vi.stubEnv("NODE_ENV","production");
    vi.stubEnv("CI","true");
    vi.stubEnv("GITHUB_ACTIONS","true");
    vi.stubEnv("DATABASE_URL","postgresql://strategyos:strategyos@127.0.0.1:5432/strategyos_test");
    expect(syntheticCatalogueFixtureAllowed()).toBe(true);
    expect(()=>assertReleaseMethodComplete("9sig")).not.toThrow();
    vi.stubEnv("DATABASE_URL","postgresql://strategyos:strategyos@db:5432/wealtharr");
    expect(syntheticCatalogueFixtureAllowed()).toBe(false);
  });
  it("the fresh production bootstrap does not seed unfinished research definitions",()=>{
    const seed=readFileSync("scripts/seed.ts","utf8");
    const migrate=readFileSync("db/migrations/0053_disable_incomplete_9sig.sql","utf8");
    expect(seed).toContain("if(!syntheticCiCatalogue)continue;");
    expect(migrate).toContain("UPDATE strategy_definitions SET enabled=false");
    expect(migrate).not.toContain("DELETE FROM strategy_versions");
    expect(migrate).not.toContain("DELETE FROM ledger_events");
  });
});
