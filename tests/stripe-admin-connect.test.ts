import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

describe("Admin Stripe connector invariants",()=>{
 const source=readFileSync("src/app/api/admin/operations/connect-stripe/route.ts","utf8");
 it("constructs the webhook URL only from the configured server origin",()=>{
  expect(source).toContain('new URL("/api/stripe/webhook",origin.origin)');
  expect(source).toContain('origin.protocol!=="https:"');
  expect(source).not.toContain("request.json()");
 });
 it("never creates a duplicate endpoint or returns its signing secret",()=>{
  expect(source).toContain("endpoint.url===target.href");
  expect(source).toContain('saveSettings(admin.id,[{key:"STRIPE_WEBHOOK_SECRET",value:secret}])');
  expect(source).toContain("stripe.webhookEndpoints.del(created)");
  expect(source).not.toContain("secret:secret");
 });
});
