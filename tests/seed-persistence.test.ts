import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

/**
 * Idempotent bootstrap MUST NEVER reset an operator's plans, prices or strategy releases
 * just because they pulled a new commit and reran deployment.
 */
describe("seed is initial-install-only",()=>{
 const seed=readFileSync("scripts/seed.ts","utf8");
 it("never grants itself permission to change published releases",()=>{
   expect(seed).not.toContain("app.allow_published_edit");
 });
 it("preserves existing plan prices, entitlements and definitions",()=>{
   expect(seed).not.toMatch(/ON CONFLICT \(slug\) DO UPDATE/);
   expect(seed).not.toMatch(/ON CONFLICT \(plan_id,currency,cadence\) DO UPDATE/);
   expect(seed).not.toMatch(/ON CONFLICT \(key\) DO UPDATE/);
 });
 it("never mutates existing named strategy version snapshots",()=>{
   expect(seed).toContain("ON CONFLICT (strategy_definition_id,version) DO NOTHING");
 });
 it("seeds only explicitly approved definitions and never inserts research-only stubs",()=>{
   expect(seed).toContain("STRATEGY_PLUGINS");
   expect(seed).toContain("seedableStrategies(STRATEGY_PLUGINS,disposableTestDb)");
   expect(seed.match(/INSERT INTO strategy_definitions/g)?.length).toBe(1);
   expect(seed.match(/INSERT INTO strategy_definitions[^;]*?ON CONFLICT \(key\) DO NOTHING/gs)?.length).toBe(2);
   expect(seed).not.toMatch(/INSERT INTO strategy_versions[^;]*?DO UPDATE/s);
 });
});
