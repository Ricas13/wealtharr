import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import postgres from "postgres";

const session=vi.hoisted(()=>({adminId:""}));
vi.mock("@/lib/session",()=>({requireAdmin:async()=>({id:session.adminId})}));

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:1,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,11);
const slug="priceidentity-"+suffix;
const otherSlug="priceidentity-other-"+suffix;
const original="price_priceidentity_original_"+suffix;
const replacement="price_priceidentity_replacement_"+suffix;
let planId="",otherPlanId="";
const request=(id:string,amountMinor:number,cadence="MONTHLY",currency="GBP",targetSlug=slug)=>
  new Request("http://localhost/api/admin/plan-prices",{method:"PUT",
    headers:{"content-type":"application/json"},body:JSON.stringify({
      planSlug:targetSlug,currency,cadence,amountMinor,stripePriceId:id,active:true
    })});

describe.skipIf(!url)("Stripe Price identity is immutable across admin edits",()=>{
 beforeAll(async()=>{
   const admin=await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id",["price-identity-"+suffix+"@example.test"]);
   session.adminId=String(admin[0].id);
   const plan=await sql!.unsafe("INSERT INTO plans (slug,display_name,visible) VALUES ($1,'Billing identity test',false) RETURNING id",[slug]);
   planId=String(plan[0].id);
   const second=await sql!.unsafe("INSERT INTO plans (slug,display_name,visible) VALUES ($1,'Billing identity secondary',false) RETURNING id",[otherSlug]);
   otherPlanId=String(second[0].id);
 });
 afterAll(async()=>{
   if(!sql)return;
   await sql.unsafe("DELETE FROM audit_events WHERE actor_user_id=$1",[session.adminId]);
   await sql.unsafe("DELETE FROM stripe_price_mappings WHERE plan_id=ANY($1::uuid[])",[[planId,otherPlanId]]);
   await sql.unsafe("DELETE FROM plan_prices WHERE plan_id=ANY($1::uuid[])",[[planId,otherPlanId]]);
   await sql.unsafe("DELETE FROM plans WHERE id=ANY($1::uuid[])",[[planId,otherPlanId]]);
   await sql.unsafe("DELETE FROM users WHERE id=$1",[session.adminId]);
   await sql.end();
 });
 it("rejects amount, currency and cadence changes to a reused provider price ID",async()=>{
   const {PUT}=await import("@/app/api/admin/plan-prices/route");
   expect((await PUT(request(original,999))).status).toBe(200);
   expect((await PUT(request(original,999))).status).toBe(200);
   const amountChange=await PUT(request(original,1099));
   expect(amountChange.status).toBe(409);
   expect((await amountChange.json()).error).toMatch(/Create a new Stripe Price/i);
   expect((await PUT(request(original,999,"ANNUAL"))).status).toBe(409);
   expect((await PUT(request(original,999,"MONTHLY","EUR"))).status).toBe(409);
   const current=await sql!.unsafe("SELECT amount_minor,stripe_price_id FROM plan_prices WHERE plan_id=$1 AND currency='GBP' AND cadence='MONTHLY'",[planId]);
   expect(Number(current[0].amount_minor)).toBe(999);
   expect(String(current[0].stripe_price_id)).toBe(original);
 });
 it("allows a newly created price while preserving the historical price mapping",async()=>{
   const {PUT}=await import("@/app/api/admin/plan-prices/route");
   expect((await PUT(request(replacement,1099))).status).toBe(200);
   const historical=await sql!.unsafe("SELECT stripe_price_id,amount_minor FROM stripe_price_mappings WHERE plan_id=$1 ORDER BY stripe_price_id",[planId]);
   expect(historical.map(row=>[String(row.stripe_price_id),Number(row.amount_minor)])).toEqual([
     [original,999],[replacement,1099]
   ]);
   const active=await sql!.unsafe("SELECT amount_minor,stripe_price_id FROM plan_prices WHERE plan_id=$1",[planId]);
   expect(Number(active[0].amount_minor)).toBe(1099);
   expect(String(active[0].stripe_price_id)).toBe(replacement);
 });
 it("serialises concurrent first-time claims of one Stripe Price ID across different plans",async()=>{
   const {PUT}=await import("@/app/api/admin/plan-prices/route");
   const shared="price_concurrent_claim_"+suffix;
   const [first,second]=await Promise.all([
     PUT(request(shared,1499,"MONTHLY","GBP",slug)),
     PUT(request(shared,1899,"MONTHLY","GBP",otherSlug))
   ]);
   expect([first.status,second.status].sort()).toEqual([200,409]);
   const mapping=await sql!.unsafe("SELECT plan_id,amount_minor FROM stripe_price_mappings WHERE stripe_price_id=$1",[shared]);
   expect(mapping).toHaveLength(1);
   const current=await sql!.unsafe("SELECT plan_id,amount_minor FROM plan_prices WHERE stripe_price_id=$1",[shared]);
   expect(current).toHaveLength(1);
   expect(String(mapping[0].plan_id)).toBe(String(current[0].plan_id));
   expect(Number(mapping[0].amount_minor)).toBe(Number(current[0].amount_minor));
 });
});