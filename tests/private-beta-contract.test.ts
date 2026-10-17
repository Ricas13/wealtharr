import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
describe("private beta operator controls",()=>{
 const api=readFileSync("src/app/api/admin/beta-access/route.ts","utf8");
 it("enforces CSRF guard, admin permissions, request bounds and an audit trail",()=>{
  expect(api).toContain("assertSameOrigin(request)");
  expect(api).toContain("requireAdmin()");
  expect(api).toContain("consumeRateLimit");
  expect(api).toContain('z.enum(["investor","pro"])');
  expect(api).toContain("z.number().int().min(7).max(180)");
  expect(api).toContain("beta.access-granted");
  expect(api).toContain("beta.access-revoked");
 });
 it("keeps billing ownership separate from beta grants",()=>{
  expect(api).not.toContain("stripe.subscriptions");
  expect(api).not.toContain("UPDATE subscriptions SET");
  const entitlement=readFileSync("src/lib/entitlement-service.ts","utf8");
  expect(entitlement).toContain("private_beta_grants");
  expect(entitlement).toContain("g.expires_at>now()");
  expect(entitlement).toContain("g.revoked_at IS NULL");
  expect(entitlement).toContain('String(rows[0].slug)==="free"');
 });
});
