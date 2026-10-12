import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { assertSameOrigin } from "@/lib/security";
import { sql } from "@/lib/db";
import { authFailure } from "@/lib/api-auth";
import { PROMOTION_REFUSALS,PromotionRefused,promoteMappingSchema,rejectMappingSchema } from "@/domain/instrument-promotion";
import { promoteCandidateMapping,rejectCandidateMapping } from "@/lib/instrument-promotion";

const instrument=z.object({kind:z.literal("instrument"),id:z.string().uuid().optional(),isin:z.string().nullable().optional(),providerInstrumentId:z.string().nullable().optional(),name:z.string().min(1),economicExposure:z.string().min(1),leverage:z.string(),direction:z.string().default("LONG"),fundCurrency:z.string().nullable().optional()});
const tradingLine=z.object({kind:z.literal("tradingLine"),instrumentId:z.string().uuid(),ticker:z.string().min(1),exchange:z.string().min(1),currency:z.string().length(3),exchangeTimezone:z.string().min(1),providerSymbol:z.string().nullable().optional(),effectiveFrom:z.string(),effectiveTo:z.string().nullable().optional()});
const mapping=z.object({kind:z.literal("mapping"),economicExposure:z.string().min(1),leverage:z.string(),direction:z.string().default("LONG"),country:z.string().length(2),wrapper:z.string().min(1),broker:z.string().nullable().optional(),preferredCurrency:z.string().length(3).nullable().optional(),tradingLineId:z.string().uuid(),fidelity:z.literal("EXACT"),effectiveFrom:z.string(),effectiveTo:z.string().nullable().optional(),enabled:z.boolean().default(true)});
const schema=z.discriminatedUnion("kind",[instrument,tradingLine,mapping,promoteMappingSchema,rejectMappingSchema]);

export async function PUT(request:Request){
  try{assertSameOrigin(request);const admin=await requireAdmin();const p=schema.parse(await request.json());
    if(p.kind==="promote"){const done=await promoteCandidateMapping(admin.id,p);return Response.json({ok:true,...done});}
    if(p.kind==="reject"){const done=await rejectCandidateMapping(admin.id,p);return Response.json({ok:true,...done});}
    if(p.kind==="instrument"){
      if(p.id)await sql.unsafe("UPDATE instruments SET isin=$1,provider_instrument_id=$2,name=$3,economic_exposure=$4,leverage=$5,direction=$6,fund_currency=$7,updated_at=now() WHERE id=$8",[p.isin??null,p.providerInstrumentId??null,p.name,p.economicExposure,p.leverage,p.direction,p.fundCurrency??null,p.id]);
      else await sql.unsafe("INSERT INTO instruments (isin,provider_instrument_id,name,economic_exposure,leverage,direction,fund_currency) VALUES ($1,$2,$3,$4,$5,$6,$7)",[p.isin??null,p.providerInstrumentId??null,p.name,p.economicExposure,p.leverage,p.direction,p.fundCurrency??null]);
    } else if(p.kind==="tradingLine"){
      await sql.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from,effective_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (exchange,ticker,effective_from) DO UPDATE SET instrument_id=EXCLUDED.instrument_id,currency=EXCLUDED.currency,exchange_timezone=EXCLUDED.exchange_timezone,provider_symbol=EXCLUDED.provider_symbol,effective_to=EXCLUDED.effective_to,updated_at=now()",[p.instrumentId,p.ticker,p.exchange,p.currency,p.exchangeTimezone,p.providerSymbol??null,p.effectiveFrom,p.effectiveTo??null]);
    } else {
      await sql.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,direction,country,wrapper,broker,preferred_currency,trading_line_id,fidelity,effective_from,effective_to,enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'EXACT',$9,$10,$11)",[p.economicExposure,p.leverage,p.direction,p.country,p.wrapper,p.broker??null,p.preferredCurrency??null,p.tradingLineId,p.effectiveFrom,p.effectiveTo??null,p.enabled]);
    }
    await sql.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,metadata) VALUES ($1,'instrument-config.upsert','instrument_config',$2::jsonb)",[admin.id,JSON.stringify({kind:p.kind})]);return Response.json({ok:true});
  }catch(error){const denied=authFailure(error);if(denied)return denied;if(error instanceof PromotionRefused){const refusal=PROMOTION_REFUSALS[error.code];return Response.json({error:refusal.message,code:error.code},{status:refusal.status});}if(error instanceof z.ZodError)return Response.json({error:error.issues[0]?.message&&error.issues[0].path.some((part)=>["checklist","note","isin","providerSymbol"].includes(String(part)))?error.issues[0].message:"Invalid instrument configuration."},{status:400});return Response.json({error:"Could not update instrument configuration."},{status:500});}
}
