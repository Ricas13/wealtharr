import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

describe("notification read route",()=>{
  const route=read("src/app/api/notifications/read/route.ts");
  it("checks origin, then authentication, before touching the database",()=>{
    const origin=route.indexOf("assertSameOrigin(request)");
    const auth=route.indexOf("await requireUser()");
    const query=route.indexOf("sql.unsafe");
    expect(origin).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(origin);
    expect(query).toBeGreaterThan(auth);
  });
  it("only accepts POST and never reads or writes without the caller's user id",()=>{
    expect(route).toMatch(/export async function POST/);
    expect(route).not.toMatch(/export async function (GET|PUT|PATCH|DELETE)/);
    const updates=route.match(/UPDATE notifications[^"]*/g)??[];
    expect(updates.length).toBe(2);
    for(const update of updates)expect(update).toMatch(/user_id=\$1/);
  });
  it("maps auth, origin and validation failures to proper statuses",()=>{
    expect(route).toContain("authFailure(error)");
    expect(route).toContain("status:400");
    expect(route).toContain("status:403");
  });
});

describe("shell and settings wiring",()=>{
  const shell=read("src/components/AppShell.tsx");
  it("shows an unread badge with a screen-reader label and leaves the sidebar geometry alone",()=>{
    expect(shell).toContain('className="nav-badge" aria-hidden="true"');
    expect(shell).toContain("unread)");
    expect(shell).not.toContain("signOut");
    expect(read("src/app/app/layout.tsx")).toContain("read_at IS NULL");
  });
  it("offers sign out from the Settings page via the client signOut",()=>{
    expect(read("src/components/SettingsForms.tsx")).toMatch(/export function SignOutButton/);
    expect(read("src/app/app/settings/page.tsx")).toContain("<SignOutButton/>");
  });
  it("only marks notifications read through the POST button, never on page render",()=>{
    const page=read("src/app/app/notifications/page.tsx");
    expect(page).not.toMatch(/UPDATE notifications/);
    expect(page).toContain("MarkAllReadButton");
  });
});
