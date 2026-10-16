import {describe,expect,it} from "vitest";
import {existsSync,readFileSync} from "node:fs";
import {STRATEGY_PLUGINS,getStrategyPlugin} from "@/domain/strategy/catalog";
import type {StrategyPlugin} from "@/domain/strategy/catalog/plugin";
import {strategiesToSeed} from "@/domain/strategy/seed-plan";
import {evaluateMethodCompleteness} from "@/domain/strategy/method-complete";

const files={exists:(p:string)=>existsSync(p),read:(p:string)=>existsSync(p)?readFileSync(p,"utf8"):null};
const sixtyForty=getStrategyPlugin("60-40")!;

describe("production seeding of strategy definitions",()=>{
  it("seeds only complete methods, as disabled definitions with a PUBLISHED version",()=>{
    const entries=strategiesToSeed(STRATEGY_PLUGINS,"PRODUCTION");
    expect(entries.map(e=>e.plugin.key)).toEqual(["hfea","golden-butterfly","permanent-portfolio","all-weather","three-fund","60-40","80-20","buffett-90-10","coffeehouse","core-four","swensen","merriman-ultimate","two-funds-for-life","bernstein-no-brainer","larry-portfolio","pinwheel","trinity","trend-200d","risk-parity","dual-momentum","gtaa-ivy","paa","vaa","vaa-g12","quarterly-target-nasdaq-3x","quarterly-target-midcap-2x","quarterly-target-smallcap"]);
    for(const entry of entries){
      expect(entry.enabled,entry.plugin.key).toBe(false);
      expect(entry.initialVersion,entry.plugin.key).toBe("PUBLISHED");
      expect(entry.realignsResearchOnlyDefinition,entry.plugin.key).toBe(false);
      expect(evaluateMethodCompleteness(entry.plugin,files).failures,entry.plugin.key).toEqual([]);
    }
  });
  it("never seeds an incomplete plugin, even one that is enabled-by-default and published-on-seed",()=>{
    const nine=getStrategyPlugin("9sig")!;
    expect(nine.seedDefinition?.enabled).toBe(true);
    expect(nine.seedDefinition?.initialVersion).toBe("PUBLISHED");
    expect(strategiesToSeed([nine],"PRODUCTION")).toEqual([]);
    const undeclared:StrategyPlugin={...sixtyForty,releaseStatus:undefined};
    expect(strategiesToSeed([undeclared],"PRODUCTION")).toEqual([]);
    const draft:StrategyPlugin={...sixtyForty,seedDefinition:{...sixtyForty.seedDefinition!,initialVersion:"DRAFT"}};
    expect(strategiesToSeed([draft],"PRODUCTION")).toEqual([]);
  });
  it("forces a complete plugin to be seeded disabled even if its seed definition says enabled",()=>{
    const eager:StrategyPlugin={...sixtyForty,seedDefinition:{...sixtyForty.seedDefinition!,enabled:true}};
    const [entry]=strategiesToSeed([eager],"PRODUCTION");
    expect(entry.enabled).toBe(false);
  });
  it("keeps the CI fixture catalogue exactly as declared",()=>{
    const entries=strategiesToSeed(STRATEGY_PLUGINS,"CI_FIXTURE");
    expect(entries.map(e=>e.plugin.key)).toEqual(STRATEGY_PLUGINS.filter(p=>p.seedDefinition).map(p=>p.key));
    const byKey=new Map(entries.map(e=>[e.plugin.key,e]));
    expect(byKey.get("9sig")).toMatchObject({enabled:true,initialVersion:"PUBLISHED"});
    expect(byKey.get("60-40")).toMatchObject({enabled:false,initialVersion:"PUBLISHED"});
    expect(byKey.get("hfea")).toMatchObject({enabled:false,initialVersion:"PUBLISHED"});
    expect(byKey.get("coffeehouse")).toMatchObject({realignsResearchOnlyDefinition:true});
  });
});

describe("the seed script wiring",()=>{
  const seed=readFileSync("scripts/seed.ts","utf8");
  it("selects strategies through strategiesToSeed and keeps the CI guard",()=>{
    expect(seed).toContain("strategiesToSeed(STRATEGY_PLUGINS");
    expect(seed).toContain('syntheticCiCatalogue?"CI_FIXTURE":"PRODUCTION"');
    expect(seed).toContain("if(!syntheticCiCatalogue)continue;");
  });
  it("compares the canonical upgrade config as JSON text, so a fresh install is not upgraded and a redeploy is idempotent",()=>{
    // A bare $n::jsonb parameter is sent by the driver as a JSON *string*, which never equals the stored
    // object: a fresh install then received a duplicate upgrade version and the next deploy failed
    // with a version conflict. Verified against a real database on 2026-10-16.
    expect(seed).toContain("AND config=$3::text::jsonb");
    expect(seed).toContain("AND input_schema=$4::text::jsonb");
    expect(seed).not.toMatch(/config=\$3::jsonb/);
  });
  it("never writes an attestation row or enables anything itself",()=>{
    expect(seed).not.toContain("strategy_version_attestations");
    expect(seed).not.toMatch(/UPDATE strategy_definitions SET enabled/);
  });
});
