import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

describe("What-if preview safety boundary",()=>{
  it("keeps the shared preview calculation path free of database mutations",()=>{
    const source=readFileSync(new URL("../src/lib/action-service.ts",import.meta.url),"utf8");
    const start=source.indexOf("async function buildActionCalculation");
    const end=source.indexOf("export async function previewCashScenario",start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const calculation=source.slice(start,end);
    expect(calculation).not.toMatch(/(?:sql|db|tx)\.unsafe\(\s*["'`]INSERT\b/i);
    expect(calculation).not.toMatch(/(?:sql|db|tx)\.unsafe\(\s*["'`]UPDATE\b/i);
    expect(calculation).not.toMatch(/(?:sql|db|tx)\.unsafe\(\s*["'`]DELETE\b/i);
    expect(calculation).not.toMatch(/sql\.begin\(/i);
  });

  it("keeps the preview route free of direct database access",()=>{
    const source=readFileSync(new URL("../src/app/api/strategies/[id]/preview/route.ts",import.meta.url),"utf8");
    expect(source).not.toContain('from "@/lib/db"');
    expect(source).not.toMatch(/\bsql\./);
  });

  it("keeps version impact previews separate from the migration write path",()=>{
    const route=readFileSync(new URL("../src/app/api/strategies/[id]/version/route.ts",import.meta.url),"utf8");
    const postStart=route.indexOf("export async function POST");
    const patchStart=route.indexOf("export async function PATCH");
    expect(postStart).toBeGreaterThanOrEqual(0);
    expect(patchStart).toBeGreaterThan(postStart);
    const previewHandler=route.slice(postStart,patchStart);
    expect(previewHandler).toContain("previewStrategyVersionScenario");
    expect(previewHandler).not.toContain("migrateStrategyVersion");
    expect(previewHandler).not.toContain("calculateAction");
  });

  it("keeps the version preview helper free of database mutations",()=>{
    const source=readFileSync(new URL("../src/lib/action-service.ts",import.meta.url),"utf8");
    const start=source.indexOf("export async function previewStrategyVersionScenario");
    const end=source.indexOf("export async function previewExecutionConstraintsScenario",start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const preview=source.slice(start,end);
    expect(preview).not.toMatch(/sql\.unsafe\(\s*["'`]INSERT\b/i);
    expect(preview).not.toMatch(/sql\.unsafe\(\s*["'`]UPDATE\b/i);
    expect(preview).not.toMatch(/sql\.unsafe\(\s*["'`]DELETE\b/i);
    expect(preview).not.toMatch(/sql\.begin\(/i);
  });


  it("keeps strategy switch previews read-only",()=>{
    const source=readFileSync(new URL("../src/lib/action-service.ts",import.meta.url),"utf8");
    const start=source.indexOf("export async function previewStrategySwitchScenario");
    const end=source.indexOf("export async function previewStrategyVersionScenario",start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const preview=source.slice(start,end);
    expect(preview).not.toMatch(/sql\.unsafe\(\s*["'`]INSERT\b/i);
    expect(preview).not.toMatch(/sql\.unsafe\(\s*["'`]UPDATE\b/i);
    expect(preview).not.toMatch(/sql\.unsafe\(\s*["'`]DELETE\b/i);
    expect(preview).not.toMatch(/sql\.begin\(/i);
  });

});
