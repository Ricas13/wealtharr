import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { assertSameOrigin } from "@/lib/security";
import { sql } from "@/lib/db";
import { authFailure } from "@/lib/api-auth";

const schema=z.object({
  planSlug:z.string().min(1).max(60),
  currency:z.string().length(3),
  cadence:z.enum(["MONTHLY","ANNUAL"]),
  amountMinor:z.number().int().nonnegative(),
  stripePriceId:z.string().nullable().optional(),
  appleProductId:z.string().trim().max(200).regex(/^[A-Za-z0-9._-]+$/).nullable().optional(),
  googleProductId:z.string().trim().max(200).regex(/^[A-Za-z0-9._:-]+$/).nullable().optional(),
  active:z.boolean().default(true)
});

export async function PUT(request:Request){
  try{assertSameOrigin(request);const admin=await requireAdmin();
    const p=schema.parse(await request.json());
    const plans=await sql.unsafe("SELECT id FROM plans WHERE slug=$1 LIMIT 1",[p.planSlug]);
    if(!plans[0])return Response.json({error:"Plan not found."},{status:404});
    await sql.begin(async tx=>{
      const previous=await tx.unsafe("SELECT stripe_price_id,currency,cadence,amount_minor FROM plan_prices WHERE plan_id=$1 AND currency=$2 AND cadence=$3 FOR UPDATE",[plans[0].id,p.currency.toUpperCase(),p.cadence]);
      if(previous[0]?.stripe_price_id){
        await tx.unsafe("INSERT INTO stripe_price_mappings (stripe_price_id,plan_id,currency,cadence,amount_minor) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (stripe_price_id) DO NOTHING",
          [previous[0].stripe_price_id,plans[0].id,previous[0].currency,previous[0].cadence,previous[0].amount_minor]);
      }
      if(p.stripePriceId){
        const owner=await tx.unsafe("SELECT plan_id,currency,cadence FROM stripe_price_mappings WHERE stripe_price_id=$1",[p.stripePriceId]);
        if(owner[0]&&String(owner[0].plan_id)!==String(plans[0].id))throw new Error("STRIPE_PRICE_BELONGS_TO_OTHER_PLAN");
        if(owner[0]&&(String(owner[0].currency).toUpperCase()!==p.currency.toUpperCase()||
          String(owner[0].cadence)!==p.cadence))
          throw new Error("STRIPE_PRICE_HISTORY_MISMATCH");
        await tx.unsafe("INSERT INTO stripe_price_mappings (stripe_price_id,plan_id,currency,cadence,amount_minor) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (stripe_price_id) DO NOTHING",
          [p.stripePriceId,plans[0].id,p.currency.toUpperCase(),p.cadence,p.amountMinor]);
      }
      await tx.unsafe(
      "INSERT INTO plan_prices (plan_id,currency,cadence,amount_minor,stripe_price_id,active,apple_product_id,google_product_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)"+
      " ON CONFLICT (plan_id,currency,cadence) DO UPDATE SET amount_minor=EXCLUDED.amount_minor,stripe_price_id=EXCLUDED.stripe_price_id,active=EXCLUDED.active,apple_product_id=EXCLUDED.apple_product_id,google_product_id=EXCLUDED.google_product_id,updated_at=now()",
      [plans[0].id,p.currency.toUpperCase(),p.cadence,p.amountMinor,p.stripePriceId??null,p.active,p.appleProductId||null,p.googleProductId||null]
    );
      await tx.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'plan-price.upsert','plan',$2,$3::jsonb)",[admin.id,p.planSlug,JSON.stringify({currency:p.currency.toUpperCase(),cadence:p.cadence})]);
    });
    return Response.json({ok:true});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Invalid plan price."},{status:400});
    if(error instanceof Error&&error.message==="STRIPE_PRICE_BELONGS_TO_OTHER_PLAN")return Response.json({error:"That Stripe price is already assigned to another plan."},{status:409});
    if(error instanceof Error&&error.message==="STRIPE_PRICE_HISTORY_MISMATCH")
      return Response.json({error:"This Stripe price is already recorded for a different currency or billing cycle."},{status:409});
    if(error instanceof Error&&/plan_price_(apple|google)_unique/.test(error.message))return Response.json({error:"That store product is already assigned to another price."},{status:409});
    return Response.json({error:"Could not update plan price."},{status:500});
  }
}
