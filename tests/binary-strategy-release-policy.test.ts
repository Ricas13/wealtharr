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
    expect(()=>assertReleaseMethodComplete("60-40")).toThrow("STRATEGY_METHOD_NOT_COMPLETE");
    expect(()=>assertReleaseMethodComplete("unknown-strategy")).toThrow("STRATEGY_METHOD_NOT_COMPLETE");
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
