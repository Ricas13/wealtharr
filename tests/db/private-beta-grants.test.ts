import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";
import {loadEntitlements} from "@/lib/entitlement-service";

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:2,prepare:false}):null;

describe.skipIf(!url)("complimentary beta entitlements and billing isolation",()=>{
 let userId="";
 let freePlan="";
 let proPlan="";
 let investorPlan="";
 const email="beta-grant-"+Math.random().toString(36).slice(2,11)+"@example.test";
 beforeAll(async()=>{
  const rows=await sql!.unsafe("SELECT id,slug FROM plans WHERE slug IN ('free','investor','pro')");
  freePlan=String(rows.find(x=>x.slug==="free")?.id);
  proPlan=String(rows.find(x=>x.slug==="pro")?.id);
  investorPlan=String(rows.find(x=>x.slug==="investor")?.id);
  if([freePlan,proPlan,investorPlan].some(x=>x==="undefined"))throw Error("Missing seeded beta test plan");
  userId=String((await sql!.unsafe(
   "INSERT INTO users (email,password_hash) VALUES($1,'fake-hash') RETURNING id",[email]))[0].id);
  await sql!.unsafe(
   "INSERT INTO subscriptions(user_id,plan_id,status,cadence) VALUES($1,$2,'FREE','FREE')",[userId,freePlan]);
 });
 afterAll(async()=>{
  if(!sql)return;
  if(userId)await sql.unsafe("DELETE FROM users WHERE id=$1",[userId]);
  await sql.end();
 });
 it("can evaluate Investor and Pro for months without inventing a payment",async()=>{
  expect((await loadEntitlements(userId)).planSlug).toBe("free");
  await sql!.unsafe(
   "INSERT INTO private_beta_grants(user_id,plan_id,expires_at) VALUES($1,$2,now()+interval '90 days')",
   [userId,proPlan]
  );
  const pro=await loadEntitlements(userId);
  expect(pro.planSlug).toBe("pro");
  expect(pro.includeDisabledStrategies).toBe(false);
  const billing=await sql!.unsafe(
   "SELECT status,cadence,stripe_customer_id,stripe_subscription_id FROM subscriptions WHERE user_id=$1",[userId]);
  expect(billing[0]).toMatchObject({status:"FREE",cadence:"FREE",stripe_customer_id:null,stripe_subscription_id:null});
 });
 it("always defers to the real paid subscription instead of an unbilled grant",async()=>{
  await sql!.unsafe("UPDATE subscriptions SET plan_id=$2,status='ACTIVE',cadence='MONTHLY' WHERE user_id=$1",[userId,investorPlan]);
  expect((await loadEntitlements(userId)).planSlug).toBe("investor");
  await sql!.unsafe("UPDATE subscriptions SET plan_id=$2,status='FREE',cadence='FREE' WHERE user_id=$1",[userId,freePlan]);
 });
 it("expires and revokes a grant without touching previous billing or history",async()=>{
  await sql!.unsafe("UPDATE private_beta_grants SET expires_at=now()-interval '1 day',granted_at=now()-interval '100 days' WHERE user_id=$1",[userId]);
  expect((await loadEntitlements(userId)).planSlug).toBe("free");
  await sql!.unsafe("UPDATE private_beta_grants SET expires_at=now()+interval '90 days',granted_at=now()-interval '1 day',revoked_at=now() WHERE user_id=$1",[userId]);
  expect((await loadEntitlements(userId)).planSlug).toBe("free");
  expect((await sql!.unsafe("SELECT status FROM subscriptions WHERE user_id=$1",[userId]))[0].status).toBe("FREE");
 });
});
