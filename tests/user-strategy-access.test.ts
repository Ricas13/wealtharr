import {describe,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import {assertUserStrategyAccessWith,effectiveUserStrategyPermission} from "@/lib/user-strategy-access";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

describe("individual customer strategy access",()=>{
  it("defaults to the plan when no override exists",()=>{
    expect(effectiveUserStrategyPermission(null)).toBe(true);
    expect(effectiveUserStrategyPermission(undefined)).toBe(true);
    expect(effectiveUserStrategyPermission(true)).toBe(true);
    expect(effectiveUserStrategyPermission(false)).toBe(false);
  });
  it("enforces explicit denial even when other gates pass",async()=>{
    const db={unsafe:vi.fn(async()=>[{allowed:false}])} as never;
    await expect(assertUserStrategyAccessWith(db,"user-1","def-1")).rejects.toThrow("STRATEGY_NOT_ALLOWED_FOR_USER");
  });
  it("allows missing or affirmative override while preserving the other gates",async()=>{
    for(const rows of [[],[{allowed:true}]]){
      const db={unsafe:vi.fn(async()=>rows)} as never;
      await expect(assertUserStrategyAccessWith(db,"user-1","def-1")).resolves.toBeUndefined();
    }
  });
  it("applies restrictions to Explore, onboarding, create, switch, preview, resume and entitlement enforcement",()=>{
    expect(read("src/app/app/explore/page.tsx")).toContain("listAvailableStrategies({userId:user.id})");
    expect(read("src/app/app/strategies/new/page.tsx")).toContain("userId:user.id");
    for(const path of ["src/lib/strategy-service.ts","src/lib/strategy-switch-service.ts","src/lib/action-service.ts"])
      expect(read(path),path).toContain("assertUserStrategyAccessWith(");
    expect(read("src/lib/entitlement-service.ts")).toContain("user_strategy_allowed===false");
    expect(read("src/app/api/admin/user-strategy-access/route.ts")).toContain("enforceStrategyEntitlements(userId)");
  });
});
