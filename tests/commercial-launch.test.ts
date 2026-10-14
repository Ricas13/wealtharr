import {describe,it,expect} from "vitest";
import {checkCommercialLaunch} from "../src/domain/commercial-launch";
const baseline={
 NEXT_PUBLIC_APP_URL:"https://invest.example.org",
 DATABASE_URL:"postgresql://prod-db.example.org/db",
 AUTH_SECRET:"a".repeat(40),APP_ENCRYPTION_KEY:Buffer.from("b".repeat(32)).toString("base64"),
 CRON_SECRET:"c".repeat(40),STRIPE_SECRET_KEY:"sk_live_"+"d".repeat(30),STRIPE_WEBHOOK_SECRET:"whsec_"+"e".repeat(30),
 EMAIL_PROVIDER:"http",EMAIL_HTTP_ENDPOINT:"https://email.example.org",EMAIL_HTTP_TOKEN:"f".repeat(20),EMAIL_FROM:"support@invest.example.org",
 MARKET_DATA_PROVIDER:"http",MARKET_DATA_HTTP_BASE_URL:"https://quotes.example.org",MARKET_DATA_HTTP_TOKEN:"g".repeat(20),
 BACKUPS_RESTORE_VERIFIED:"true",UK_REGULATORY_SIGNOFF_VERIFIED:"true",REGIONAL_INSTRUMENTS_VERIFIED:"true",ADMIN_MFA_REQUIRED:"true",
 TURNSTILE_ENABLED:"true",TURNSTILE_SITE_KEY:"s".repeat(25),TURNSTILE_SECRET_KEY:"t".repeat(36)
};
describe("commercial launch preflight",()=>{
 it("rejects development defaults and empty environment",()=>expect(checkCommercialLaunch({}).every(x=>!x.passed)).toBe(true));
 it("validates explicitly supplied launch prerequisites",()=>expect(checkCommercialLaunch(baseline).every(x=>x.passed)).toBe(true));
 it("supports explicit user-entered market prices without an external feed",()=>{
  const result=checkCommercialLaunch({...baseline,MARKET_DATA_MODE:"MANUAL",MARKET_DATA_PROVIDER:"",MARKET_DATA_HTTP_BASE_URL:"",MARKET_DATA_HTTP_TOKEN:"",DATABASE_URL:"postgresql://strategyos:secret@db:5432/strategyos"});
  expect(result.find(x=>x.key==="market_data_mode")?.passed).toBe(false);
  expect(result.find(x=>x.key==="database")?.passed).toBe(true);
 });
 it("blocks Stripe test credentials",()=>{
  const r=checkCommercialLaunch({...baseline,STRIPE_SECRET_KEY:"sk_test_"+"a".repeat(30)});
  expect(r.find(x=>x.key==="stripe_live")?.passed).toBe(false);
 });
 it("accepts a restricted live key, which Stripe recommends for production, but still blocks test keys",()=>{
  expect(checkCommercialLaunch({...baseline,STRIPE_SECRET_KEY:"rk_live_"+"d".repeat(30)}).find(x=>x.key==="stripe_live")?.passed).toBe(true);
  expect(checkCommercialLaunch({...baseline,STRIPE_SECRET_KEY:"rk_test_"+"d".repeat(30)}).find(x=>x.key==="stripe_live")?.passed).toBe(false);
  expect(checkCommercialLaunch({...baseline,STRIPE_SECRET_KEY:"pk_live_"+"d".repeat(30)}).find(x=>x.key==="stripe_live")?.passed).toBe(false);
 });
 it("blocks unverified legal, backup and instrument attestations",()=>{
  const r=checkCommercialLaunch({...baseline,UK_REGULATORY_SIGNOFF_VERIFIED:"false",BACKUPS_RESTORE_VERIFIED:"false",REGIONAL_INSTRUMENTS_VERIFIED:"false"});
  expect(r.filter(x=>!x.passed).map(x=>x.key)).toEqual(["backup_operator_attestation","regulatory_signoff","instrument_review"]);
 });
 it("blocks live commercial checkout for disabled or dummy Turnstile credentials",()=>{
  const missing=checkCommercialLaunch({...baseline,TURNSTILE_ENABLED:"false"});
  expect(missing.find(x=>x.key==="turnstile")?.passed).toBe(false);
  const dummy=checkCommercialLaunch({...baseline,TURNSTILE_SITE_KEY:"1x00000000000000000000AA",TURNSTILE_SECRET_KEY:"1x0000000000000000000000000000000AA"});
  expect(dummy.find(x=>x.key==="turnstile")?.passed).toBe(false);
 });
 it("blocks HTTP provider origin and local database",()=>{
  const r=checkCommercialLaunch({...baseline,MARKET_DATA_HTTP_BASE_URL:"http://quotes.example.org",DATABASE_URL:"postgresql://localhost/db"});
  expect(r.find(x=>x.key==="market_data_mode")?.passed).toBe(false);
  expect(r.find(x=>x.key==="database")?.passed).toBe(false);
 });
});

import {paidCheckoutBlockers} from "@/domain/commercial-launch";
describe("paidCheckoutBlockers",()=>{
 it("lets a Stripe test key through so staging can exercise checkout",()=>{
  expect(paidCheckoutBlockers({STRIPE_SECRET_KEY:"sk_test_"+"a".repeat(30)})).toEqual([]);
  expect(paidCheckoutBlockers({})).toEqual([]);
 });
 it("blocks a live key until every launch check passes",()=>{
  const blockers=paidCheckoutBlockers({STRIPE_SECRET_KEY:"sk_live_"+"a".repeat(30)});
  expect(blockers.length).toBeGreaterThan(0);
  expect(blockers.map((b)=>b.key)).toContain("regulatory_signoff");
  expect(paidCheckoutBlockers({STRIPE_SECRET_KEY:"rk_live_"+"a".repeat(30)}).length).toBeGreaterThan(0);
 });
});
