import { describe,expect,it } from "vitest";
import { readFileSync,readdirSync,statSync } from "node:fs";
import { join } from "node:path";
import { adminAccessDecision,signedInRecently,RECENT_SIGN_IN_MS } from "@/domain/admin-access";
import { isUuid } from "@/domain/uuid";
import { invalidPathId } from "@/lib/route-params";

const root=new URL("../",import.meta.url);
const read=(path:string)=>readFileSync(new URL(path,root),"utf8");
const walk=(dir:string):string[]=>readdirSync(new URL(dir,root)).flatMap((name)=>{
  const rel=join(dir,name).replaceAll("\\","/");
  return statSync(new URL(rel,root)).isDirectory()?walk(rel):[rel];
});
const pages=(dir:string)=>walk(dir).filter((f)=>f.endsWith("/page.tsx"));

describe("admin pages guard themselves",()=>{
  const adminPages=pages("src/app/admin");

  it("finds the admin pages",()=>{
    expect(adminPages.length).toBeGreaterThanOrEqual(13);
  });

  // Next.js can render a page without re-running an unchanged parent layout, so the layout is not
  // a guard. Each page must run the check itself, before it reads anything from the database.
  it("calls requireAdminPage as the first awaited statement of every admin page",()=>{
    for(const page of adminPages){
      const source=read(page);
      expect(source,page).toContain("requireAdminPage");
      const call=source.indexOf("requireAdminPage()");
      expect(call,page).toBeGreaterThan(-1);
      const body=source.slice(source.indexOf("export default"));
      const firstAwait=body.indexOf("await ");
      expect(body.indexOf("await requireAdminPage()"),page).toBe(firstAwait);
    }
  });

  it("keeps the layout guard as well",()=>{
    expect(read("src/app/admin/layout.tsx")).toContain("await requireAdminPage()");
  });

  it("has no admin page or layout file this test would miss",()=>{
    const others=walk("src/app/admin").filter((f)=>/\.(tsx|ts)$/.test(f)&&!f.endsWith("/page.tsx")&&!f.endsWith("/layout.tsx")&&!f.endsWith("/error.tsx")&&!f.endsWith("/loading.tsx"));
    expect(others).toEqual([]);
  });

  it("builds requireAdminPage on requireAdmin and redirects instead of rendering",()=>{
    const session=read("src/lib/session.ts");
    const helper=session.slice(session.indexOf("export async function requireAdminPage"));
    expect(helper).toContain("await requireAdmin()");
    expect(helper).toContain('redirect("/login")');
    expect(helper).toContain('redirect("/app")');
    expect(helper).toContain('redirect("/app/settings#security")');
  });

  it("keeps non-admin tokens out of /admin at the proxy",()=>{
    const proxy=read("src/proxy.ts");
    expect(proxy).toContain('"ADMIN"');
    expect(proxy).toContain('startsWith("/admin/")');
    expect(proxy.indexOf("!request.auth")).toBeLessThan(proxy.indexOf('"ADMIN"'));
  });
});

describe("customer pages require a session",()=>{
  it("calls requirePageUser in every page under /app",()=>{
    const appPages=pages("src/app/app");
    expect(appPages.length).toBeGreaterThanOrEqual(7);
    for(const page of appPages)expect(read(page),page).toContain("requirePageUser");
  });
  it("covers the community page specifically",()=>{
    expect(read("src/app/app/community/page.tsx")).toContain("await requirePageUser()");
  });
});

describe("admin access decision",()=>{
  const base={role:"ADMIN",mfaEnabled:false,sessionMfa:false,mfaRequired:false};
  it("refuses everyone who is not an admin, whatever else is true",()=>{
    for(const role of ["USER","","admin"])expect(adminAccessDecision({...base,role,mfaEnabled:true,sessionMfa:true})).toBe("FORBIDDEN");
  });
  it("lets an admin without two-step sign-in in only while the operator does not require it",()=>{
    expect(adminAccessDecision(base)).toBe("OK");
    expect(adminAccessDecision({...base,mfaRequired:true})).toBe("MFA_REQUIRED");
  });
  it("requires the session itself to have passed the second factor once the account has one",()=>{
    expect(adminAccessDecision({...base,mfaEnabled:true,sessionMfa:false})).toBe("REAUTH_REQUIRED");
    expect(adminAccessDecision({...base,mfaEnabled:true,sessionMfa:false,mfaRequired:true})).toBe("REAUTH_REQUIRED");
    expect(adminAccessDecision({...base,mfaEnabled:true,sessionMfa:true})).toBe("OK");
    expect(adminAccessDecision({...base,mfaEnabled:true,sessionMfa:true,mfaRequired:true})).toBe("OK");
  });
});

describe("recent sign-in window",()=>{
  const now=1_800_000_000_000;
  it("accepts a sign-in inside the window and refuses older, missing and future times",()=>{
    expect(signedInRecently(now-1000,now)).toBe(true);
    expect(signedInRecently(now-RECENT_SIGN_IN_MS,now)).toBe(true);
    expect(signedInRecently(now-RECENT_SIGN_IN_MS-1,now)).toBe(false);
    expect(signedInRecently(0,now)).toBe(false);
    expect(signedInRecently(Number.NaN,now)).toBe(false);
    expect(signedInRecently(now+10*60_000,now)).toBe(false);
  });
});

describe("two-step sign-in is bound to the session",()=>{
  it("ends existing sessions when two-step sign-in is turned on or off",()=>{
    const source=read("src/lib/mfa.ts");
    const enable=source.slice(source.indexOf("export async function confirmEnrollment"),source.indexOf("export async function disableMfa"));
    const disable=source.slice(source.indexOf("export async function disableMfa"));
    expect(enable).toContain("session_version=session_version+1");
    expect(disable).toContain("session_version=session_version+1");
  });
  it("records the second factor in the token only at sign-in",()=>{
    const auth=read("src/auth.ts");
    expect(auth).toContain("mfa: Boolean(user.mfa_enabled_at)");
    expect(auth).toContain("if (user) { token.mfa = user.mfa === true;");
    expect(auth).toContain("session.user.mfa = token.mfa === true");
    // Provider sign-ins never carry the claim.
    expect(auth.slice(auth.indexOf("async signIn("),auth.indexOf("jwt({"))).not.toContain("user.mfa");
  });
  it("makes requireAdmin consult the decision with the session claim",()=>{
    const session=read("src/lib/session.ts");
    expect(session).toContain("adminAccessDecision(");
    expect(session).toContain("sessionMfa");
  });
});

describe("sensitive account actions re-authenticate",()=>{
  const effects:Array<[string,string]>=[
    ["src/app/api/account/delete/route.ts","await beginAccountDeletion("],
    ["src/app/api/account/mfa/setup/route.ts","await beginEnrollment("],
    ["src/app/api/account/mfa/enable/route.ts","await confirmEnrollment("]
  ];
  for(const [path,effect] of effects){
    it(path+" checks identity before changing anything",()=>{
      const source=read(path);
      expect(source.indexOf("await reauthenticate(")).toBeGreaterThan(-1);
      expect(source.indexOf(effect)).toBeGreaterThan(-1);
      expect(source.indexOf("await reauthenticate(")).toBeLessThan(source.indexOf(effect));
    });
  }
  it("checks the password before the one-time code so a wrong password never spends a code",()=>{
    const source=read("src/lib/reauth.ts");
    expect(source.indexOf("bcrypt.compare")).toBeGreaterThan(-1);
    expect(source.indexOf("bcrypt.compare")).toBeLessThan(source.indexOf("verifySecondFactor(user.id"));
    expect(source).toContain("consumeRateLimit(");
  });
  it("lets a provider-only account delete only after a recent sign-in and a typed email",()=>{
    const source=read("src/lib/reauth.ts");
    expect(source).toContain("signedInRecently(user.authTime)");
    expect(source).toContain("confirmEmail");
    expect(read("src/app/api/account/delete/route.ts")).toContain("allowEmailConfirmation: true");
  });
});

describe("password reset links",()=>{
  it("retires earlier unused links when a new one is issued",()=>{
    const source=read("src/app/api/password-reset/request/route.ts");
    const retire=source.indexOf("UPDATE auth_tokens SET used_at=now()");
    const insert=source.indexOf("INSERT INTO auth_tokens");
    expect(retire).toBeGreaterThan(-1);
    expect(retire).toBeLessThan(insert);
    expect(source).toContain("sql.begin");
  });
});

describe("public health answer",()=>{
  it("hides configuration detail without the cron secret and keeps the HTTP status",()=>{
    const source=read("src/app/api/health/route.ts");
    expect(source).toContain("cronAuthorized(request)");
    expect(source).toContain('{status:coreReady?"ready":"degraded"}');
    expect(source).toContain("status:coreReady?200:503");
    // capabilities appear only inside the authorised branch
    expect(source).toMatch(/detailed\s*\?\{ok:coreReady[^}]*capabilities\}\s*:\{status:coreReady\?"ready":"degraded"\}/);
  });
});

describe("path ids are validated before they reach the database",()=>{
  it("recognises only canonical uuids",()=>{
    expect(isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
    expect(isUuid("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(true);
    for(const bad of ["","abc","1","not-a-uuid","3f2504e04f8941d39a0c0305e82c3301","{3f2504e0-4f89-41d3-9a0c-0305e82c3301}","3f2504e0-4f89-41d3-9a0c-0305e82c3301x","' OR 1=1 --",undefined,null,42])expect(isUuid(bad),String(bad)).toBe(false);
  });
  it("answers 404 without a body that echoes the id",async()=>{
    const id="3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(invalidPathId(id)).toBeNull();
    expect(invalidPathId(id,id)).toBeNull();
    const response=invalidPathId(id,"nope");
    expect(response?.status).toBe(404);
    expect(JSON.stringify(await response!.json())).not.toContain("nope");
  });
  it("is applied by every strategy and action route that takes an id",()=>{
    const routes=[...walk("src/app/api/strategies"),...walk("src/app/api/actions")].filter((f)=>f.includes("[id]")&&f.endsWith("/route.ts"));
    expect(routes.length).toBeGreaterThanOrEqual(16);
    for(const route of routes){
      const source=read(route);
      const handlers=(source.match(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)??[]).length;
      const checks=(source.match(/invalidPathId\(/g)??[]).length;
      expect(checks,route).toBe(handlers);
      expect(source,route).toContain('from "@/lib/route-params"');
      // one param read per handler, each followed by its check
      expect(source.match(/await context\.params/g)?.length??0,route).toBe(handlers);
    }
  });
  it("checks the page parameter too",()=>{
    expect(read("src/app/app/strategies/[id]/page.tsx")).toContain("if(!isUuid(id))notFound();");
  });
});
