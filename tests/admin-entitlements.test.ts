import { describe,expect,it } from "vitest";
import { readFileSync } from "node:fs";
import { ALL_CHANNELS,ALL_FEATURES,adminEntitlementSnapshot,assertCanCreateStrategy,assertStrategyFeatureAccess,buildEntitlementSnapshot } from "../src/domain/entitlements";

const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

describe("admin entitlement snapshot",()=>{
  const snapshot=adminEntitlementSnapshot();
  it("has no strategy limit and no strategy-key restriction",()=>{
    expect(snapshot.planSlug).toBe("admin");
    expect(snapshot.maxActiveStrategies).toBeNull();
    expect(snapshot.availableStrategyKeys).toBeNull();
    expect(()=>assertCanCreateStrategy(snapshot,500,"any-strategy-key")).not.toThrow();
    expect(()=>assertStrategyFeatureAccess(snapshot,{accountCount:10})).not.toThrow();
  });
  it("includes every feature and every channel",()=>{
    for(const feature of ALL_FEATURES)expect(snapshot.features.has(feature)).toBe(true);
    for(const channel of ALL_CHANNELS)expect(snapshot.notificationChannels.has(channel)).toBe(true);
    expect(snapshot.notificationChannels.has("IN_APP")).toBe(true);
    expect(snapshot.features.size).toBe(ALL_FEATURES.length);
  });
  it("offers exactly the features and channels the plan editor and plan API accept",()=>{
    // Both derive from the single domain constants; no literal list may reappear.
    const route=read("src/app/api/admin/plans/route.ts");
    const editor=read("src/components/SimplePlanEditor.tsx");
    expect(route).toContain("z.enum(ALL_FEATURES)");
    expect(route).toContain("z.enum(ALL_CHANNELS)");
    expect(route).not.toContain('"what_if"');
    expect(editor).toContain("ALL_FEATURES.map");
    expect(editor).toContain("ALL_CHANNELS.map");
    expect(ALL_FEATURES).toContain("what_if");
    expect(ALL_FEATURES).toContain("multi_account");
  });
});

describe("admin entitlement wiring",()=>{
  it("resolves plan entitlements in one role-aware loader",()=>{
    const service=read("src/lib/entitlement-service.ts");
    const loader=service.slice(service.indexOf("export async function loadEntitlementsWith"),service.indexOf("export async function loadEntitlements("));
    expect(loader).toContain("deleted_at IS NULL");
    expect(loader).toContain('"ADMIN"');
    expect(loader.indexOf("adminEntitlementSnapshot()")).toBeGreaterThan(-1);
    expect(loader.indexOf("adminEntitlementSnapshot()")).toBeLessThan(loader.indexOf("FROM subscriptions s JOIN plans"));
    expect(loader).toContain("FOR UPDATE OF s");
  });
  it("makes createStrategy and enforceStrategyEntitlements go through it with no inline plan query",()=>{
    const strategy=read("src/lib/strategy-service.ts");
    const create=strategy.slice(strategy.indexOf("export async function createStrategy"),strategy.indexOf("export async function migrateStrategyVersion"));
    expect(create).toContain("loadEntitlementsWith(tx, userId)");
    expect(create).not.toContain("JOIN plans");
    expect(create).not.toContain("buildEntitlementSnapshot");
    const service=read("src/lib/entitlement-service.ts");
    const enforce=service.slice(service.indexOf("export async function enforceStrategyEntitlements"));
    expect(enforce).toContain("await loadEntitlements(userId)");
    expect(enforce).not.toContain("JOIN plans");
  });
  it("keeps the subscription row lock for the race-sensitive callers",()=>{
    expect(read("src/lib/strategy-switch-service.ts")).toContain("loadEntitlementsWith(tx,userId,{lockSubscription:true})");
    expect(read("src/app/api/strategies/[id]/accounts/route.ts")).toContain("loadEntitlementsWith(tx,user.id,{lockSubscription:true})");
    expect(read("src/lib/entitlement-service.ts")).toContain("FOR UPDATE OF s");
  });
  it("leaves no other call site resolving a plan on its own",()=>{
    for(const path of ["src/lib/strategy-service.ts","src/lib/strategy-switch-service.ts","src/app/api/strategies/[id]/accounts/route.ts","src/lib/notification-service.ts","src/app/api/strategies/[id]/preview/route.ts","src/app/api/integrations/telegram/webhook/route.ts"]){
      const source=read(path);
      expect(source,path).not.toContain("JOIN plans p ON p.id=s.plan_id");
      expect(source,path).not.toContain("buildEntitlementSnapshot");
    }
  });
});

describe("admin may start disabled strategies (server-derived only)",()=>{
  it("sets includeDisabledStrategies only in the admin snapshot",()=>{
    expect(adminEntitlementSnapshot().includeDisabledStrategies).toBe(true);
    const plan=buildEntitlementSnapshot({slug:"pro",maxActiveStrategies:3,entitlements:{features:["what_if"],notificationChannels:[]},availableStrategyKeys:[]});
    expect(plan.includeDisabledStrategies).toBe(false);
    const domain=read("src/domain/entitlements.ts");
    expect(domain.match(/includeDisabledStrategies:\s*true/g)).toHaveLength(1);
    const admin=domain.slice(domain.indexOf("export function adminEntitlementSnapshot"),domain.indexOf("export function assertCanCreateStrategy"));
    expect(admin).toContain("includeDisabledStrategies: true");
  });
  it("never reads the flag from request input, query string or token",()=>{
    for(const path of ["src/app/api/strategies/route.ts","src/app/api/strategies/[id]/switch/route.ts","src/app/api/strategies/[id]/preview/route.ts"]){
      const source=read(path);
      expect(source,path).not.toMatch(/includeDisabled\w*\s*:\s*z\./);
      expect(source,path).not.toMatch(/(input|body|params|searchParams|payload)\.includeDisabled/);
      expect(source,path).not.toMatch(/\.(get|searchParams)\(["']includeDisabled/);
    }
    // The only sources of the flag are the loaded snapshot (and a literal in tests).
    expect(read("src/app/app/strategies/new/page.tsx")).toContain("includeDisabled:entitlements.includeDisabledStrategies");
    expect(read("src/app/app/strategies/[id]/page.tsx")).toContain("includeDisabled:entitlements.includeDisabledStrategies");
    expect(read("src/app/api/strategies/[id]/preview/route.ts")).toContain("entitlements.includeDisabledStrategies");
    const create=read("src/lib/strategy-service.ts");
    expect(create).toContain("snapshot.includeDisabledStrategies===true");
    expect(read("src/lib/strategy-switch-service.ts")).toContain("entitlements.includeDisabledStrategies===true");
  });
  it("keeps every disabled-definition bypass behind a PUBLISHED version lookup and the market check",()=>{
    const strategy=read("src/lib/strategy-service.ts");
    const list=strategy.slice(strategy.indexOf("export async function listAvailableStrategies"),strategy.indexOf("export async function listUserStrategies"));
    expect(list).toContain("lifecycle_status='PUBLISHED'");
    expect(list).not.toContain("DRAFT");
    const create=strategy.slice(strategy.indexOf("export async function createStrategy"),strategy.indexOf("export async function migrateStrategyVersion"));
    expect(create).toContain("lifecycle_status='PUBLISHED'");
    expect(create).toContain("assessStrategyMarket(");
    expect(create.indexOf("(d.enabled=true OR $2::boolean)")).toBeGreaterThan(create.indexOf("lifecycle_status='PUBLISHED'"));
    const sw=read("src/lib/strategy-switch-service.ts");
    expect(sw).toContain("lifecycle_status='PUBLISHED'");
    expect(sw).toContain("assessStrategyMarket(");
    expect(read("src/lib/action-service.ts")).toContain("(d.enabled=true OR $2::boolean)");
  });
  it("pauses only admin-preview instances of a still-disabled definition for a non-admin owner",()=>{
    const service=read("src/lib/entitlement-service.ts");
    const enforce=service.slice(service.indexOf("export async function enforceStrategyEntitlements"));
    expect(enforce).toContain("!entitlements.includeDisabledStrategies");
    expect(enforce).toContain("row.admin_disabled_preview === true");
    expect(enforce).toContain("row.definition_enabled !== true");
    expect(enforce).not.toContain("JOIN plans");
  });
});

describe("admin preview applies the same gates as enabling a strategy",()=>{
  const gates=read("src/lib/admin-preview-gates.ts");
  it("requires a publishable engine, the curated rules and an attestation for a disabled definition",()=>{
    expect(gates).toContain("assertCustomerPublishableEngine");
    expect(gates).toContain("assertCuratedRules");
    expect(gates).toContain("strategy_version_attestations");
    expect(gates).not.toMatch(/definition\.enabled === true\) return/);
    expect(gates).toContain("attested_by_email IS NOT NULL");
  });
  it("is applied on create, switch and switch preview, after the target lookup",()=>{
    for(const path of ["src/lib/strategy-service.ts","src/lib/strategy-switch-service.ts","src/lib/action-service.ts"]){
      expect(read(path),path).toContain("assertDisabledStrategyPreviewGates(");
    }
  });
  it("maps a refused resume to 409 rather than 500",()=>{
    expect(read("src/app/api/strategies/[id]/status/route.ts")).toMatch(/STRATEGY_NOT_AVAILABLE[\s\S]{0,160}status:\s*409/);
  });
});
