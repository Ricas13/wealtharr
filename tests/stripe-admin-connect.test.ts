import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

describe("Admin Stripe connector invariants",()=>{
 const source=readFileSync("src/app/api/admin/operations/connect-stripe/route.ts","utf8");
 it("constructs the webhook URL only from the configured server origin",()=>{
  expect(source).toContain('new URL("/api/stripe/webhook",origin.origin)');
  expect(source).toContain('origin.protocol!=="https:"');
  expect(source).not.toContain("request.json()");
 });
 it("reconciles one existing Wealtharr endpoint without rotating its signing secret",()=>{
  expect(source).toContain("endpoint.url===target.href");
  expect(source).toContain("matching.length>1");
  expect(source).toContain("if(!process.env.STRIPE_WEBHOOK_SECRET?.startsWith");
  expect(source).toContain("stripe.webhookEndpoints.update(endpoint.id,{enabled_events:desired})");
  expect(source).toContain("new Set([...originalEvents,...SUBSCRIPTION_EVENTS])");
  expect(source).toContain("originalEvents.includes");
  expect(source).toContain("existing:true");
  expect(source).not.toContain("webhookEndpoints.del(endpoint.id)");
 });
 it("creates at most one new endpoint, saving its secret or rolling it back",()=>{
  expect(source).toContain('saveSettings(admin.id,[{key:"STRIPE_WEBHOOK_SECRET",value:secret}])');
  expect(source).toContain("stripe.webhookEndpoints.del(created)");
  expect(source).not.toContain("secret:secret");
 });
});
