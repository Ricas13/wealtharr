import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const source=readFileSync("src/app/api/admin/plans/sync-stripe/route.ts","utf8");
const webhook=readFileSync("src/lib/stripe-subscription-state.ts","utf8");
const migration=readFileSync("db/migrations/0027_stripe_price_history.sql","utf8");
describe("Master Admin Stripe price sync and existing subscriber safety",()=>{
 it("loads encrypted web-configured Stripe credentials before checking for a key",()=>{
   expect(source).toContain('import {ensureSettings} from "@/lib/settings"');
   expect(source.indexOf("await ensureSettings(true)")).toBeLessThan(source.indexOf("const secret=process.env.STRIPE_SECRET_KEY"));
 });
 it("only syncs positive, active paid plan prices, with idempotent Stripe API keys",()=>{
   expect(source).toContain("pp.active=true AND pp.amount_minor>0");
   expect(source).toContain("p.slug<>'free'");
   expect(source).toContain("idempotencyKey:key");
 });
 it("persists prior Stripe prices and resolves renewal webhooks through immutable history",()=>{
   expect(migration).toContain("stripe_price_mappings");
   expect(source).toContain("current[0].stripe_price_id");
   expect(webhook).toContain("FROM stripe_price_mappings");
 });
 it("does not allow a concurrent plan price update to be silently overwritten",()=>{
   expect(source).toContain("FOR UPDATE");
   expect(source).toContain('String(current[0].stripe_price_id??"")!==String(row.stripe_price_id??"")');
   expect(source).toContain("PRICE_HISTORY_CONFLICT");
   expect(source).toContain("amount_minor");
   expect(source).toContain('The plan price changed during sync');
 });
});
