import Stripe from "stripe";
import {createHash} from "node:crypto";
import {z} from "zod";
import {sql} from "@/lib/db";
import {requireAdmin} from "@/lib/session";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import {authFailure} from "@/lib/api-auth";
import {ensureSettings} from "@/lib/settings";
import {isSinglePeriodPrice} from "@/domain/billing-price";

export const dynamic="force-dynamic";
const schema=z.object({
  planSlug:z.string().regex(/^[a-z][a-z0-9-]{0,59}$/).refine(slug=>slug!=="free"),
  currency:z.string().regex(/^[A-Z]{3}$/),cadence:z.enum(["MONTHLY","ANNUAL"])
});
const headers={"cache-control":"private, no-store"};
const key=(...parts:string[])=>"wealtharr-"+createHash("sha256").update(parts.join("|")).digest("hex");

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const admin=await requireAdmin();
    await consumeRateLimit("admin-stripe-prices:"+admin.id,12,60*60);
    const parsed=schema.parse(await request.json());
    // Encrypted settings configured in Master Admin are loaded into the effective process
    // environment; Docker-level credentials remain the fallback, not a requirement.
    await ensureSettings(true);
    const secret=process.env.STRIPE_SECRET_KEY;
    if(!secret||!/^((sk|rk)_(test|live)_)/.test(secret))
      return Response.json({error:"Configure Stripe credentials in Master Admin first."},{status:503,headers});
    const rows=await sql.unsafe(
      "SELECT pp.id,pp.plan_id,pp.amount_minor,pp.stripe_price_id,p.display_name,p.slug "+
      "FROM plan_prices pp JOIN plans p ON p.id=pp.plan_id WHERE p.slug=$1 AND p.slug<>'free' "+
      "AND pp.currency=$2 AND pp.cadence=$3 AND pp.active=true AND pp.amount_minor>0 LIMIT 1",
      [parsed.planSlug,parsed.currency,parsed.cadence]
    );
    if(!rows[0])return Response.json({error:"An active positive price must exist in Master Admin first."},{status:404,headers});
    const row=rows[0],stripe=new Stripe(secret,{timeout:10000,maxNetworkRetries:0});
    const interval=parsed.cadence==="ANNUAL"?"year":"month";
    const existingId=String(row.stripe_price_id??"");
    if(existingId){
      try{
        const remote=await stripe.prices.retrieve(existingId);
        if(remote.active&&isSinglePeriodPrice(remote)&&remote.currency.toUpperCase()===parsed.currency&&
          remote.unit_amount===Number(row.amount_minor)&&remote.recurring?.interval===interval)
          return Response.json({ok:true,priceId:existingId,created:false},{headers});
      }catch{/* A stale or invalid ID does not enable checkout. Create a new verified price below. */}
    }
    let productId="";
    const productRows=await sql.unsafe("SELECT stripe_product_id FROM stripe_plan_products WHERE plan_id=$1",[row.plan_id]);
    if(productRows[0])productId=String(productRows[0].stripe_product_id);
    if(!productId){
      const product=await stripe.products.create({name:String(row.display_name),metadata:{wealtharrPlan:String(row.slug)}},
        {idempotencyKey:key("product",String(row.plan_id))});
      productId=product.id;
      await sql.unsafe(
        "INSERT INTO stripe_plan_products (plan_id,stripe_product_id) VALUES ($1,$2) ON CONFLICT (plan_id) DO NOTHING",
        [row.plan_id,productId]
      );
      const canonical=await sql.unsafe("SELECT stripe_product_id FROM stripe_plan_products WHERE plan_id=$1",[row.plan_id]);
      productId=String(canonical[0].stripe_product_id);
    }
    const price=await stripe.prices.create({
      product:productId,currency:parsed.currency.toLowerCase(),
      unit_amount:Number(row.amount_minor),recurring:{interval},
      metadata:{wealtharrPlan:String(row.slug),wealtharrCadence:parsed.cadence}
    },{idempotencyKey:key("price",String(row.plan_id),parsed.currency,parsed.cadence,String(row.amount_minor))});
    // Record the old price as immutable billing history before promoting a replacement.
    // Refuse any concurrent operator price change; the remote price will still be available
    // to pick up idempotently if configuration is retried.
    const updated=await sql.begin(async tx=>{
      const current=await tx.unsafe("SELECT stripe_price_id,amount_minor FROM plan_prices WHERE id=$1 FOR UPDATE",[row.id]);
      if(!current[0]||Number(current[0].amount_minor)!==Number(row.amount_minor)||
         String(current[0].stripe_price_id??"")!==String(row.stripe_price_id??""))return false;
      if(current[0].stripe_price_id){
        await tx.unsafe("INSERT INTO stripe_price_mappings (stripe_price_id,plan_id,currency,cadence,amount_minor) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (stripe_price_id) DO NOTHING",
          [current[0].stripe_price_id,row.plan_id,parsed.currency,parsed.cadence,row.amount_minor]);
      }
      const conflict=await tx.unsafe("SELECT plan_id,currency,cadence,amount_minor FROM stripe_price_mappings WHERE stripe_price_id=$1",[price.id]);
      if(conflict[0]&&(String(conflict[0].plan_id)!==String(row.plan_id)||
         String(conflict[0].currency).toUpperCase()!==parsed.currency||
         String(conflict[0].cadence)!==parsed.cadence||
         Number(conflict[0].amount_minor)!==Number(row.amount_minor)))
         throw new Error("PRICE_HISTORY_CONFLICT");
      await tx.unsafe("INSERT INTO stripe_price_mappings (stripe_price_id,plan_id,currency,cadence,amount_minor) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (stripe_price_id) DO NOTHING",
        [price.id,row.plan_id,parsed.currency,parsed.cadence,row.amount_minor]);
      await tx.unsafe("UPDATE plan_prices SET stripe_price_id=$1,updated_at=now() WHERE id=$2",[price.id,row.id]);
      await tx.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'billing.stripe-price-synced','plan',$2,$3::jsonb)",
        [admin.id,String(row.plan_id),JSON.stringify({currency:parsed.currency,cadence:parsed.cadence,priceId:price.id,amountMinor:Number(row.amount_minor)})]);
      return true;
    });
    if(!updated)return Response.json({error:"The plan price changed during sync. Refresh and retry."},{status:409,headers});
    return Response.json({ok:true,priceId:price.id,created:true},{headers});
  }catch(error){
    const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Choose an existing paid plan, currency and billing cadence."},{status:400,headers});
    if(error instanceof Error&&error.message==="RATE_LIMITED")return Response.json({error:"Too many Stripe sync attempts."},{status:429,headers});
    return Response.json({error:"Could not sync this price to Stripe. Verify the API key permissions and Stripe account."},{status:503,headers});
  }
}
