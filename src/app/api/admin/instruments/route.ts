import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { assertSameOrigin } from "@/lib/security";
import { sql } from "@/lib/db";
import { authFailure } from "@/lib/api-auth";
import { EvidenceRefused,PROMOTION_REFUSALS,PromotionRefused,promoteMappingSchema,rejectMappingSchema } from "@/domain/instrument-promotion";
import { insertCandidateMapping,promoteCandidateMapping,rejectCandidateMapping,updateInstrumentGuarded,upsertTradingLineGuarded } from "@/lib/instrument-promotion";

const instrument=z.object({kind:z.literal("instrument"),id:z.string().uuid().optional(),isin:z.string().nullable().optional(),providerInstrumentId:z.string().nullable().optional(),name:z.string().min(1),economicExposure:z.string().min(1),leverage:z.string(),direction:z.string().default("LONG"),fundCurrency:z.string().nullable().optional()});
const tradingLine=z.object({kind:z.literal("tradingLine"),instrumentId:z.string().uuid(),ticker:z.string().min(1),exchange:z.string().min(1),currency:z.string().length(3),exchangeTimezone:z.string().min(1),providerSymbol:z.string().nullable().optional(),effectiveFrom:z.string(),effectiveTo:z.string().nullable().optional()});
// A mapping created here is only ever an unverified candidate. Any client-supplied fidelity other than
// CANDIDATE, and any enabled flag, is not honoured: verification happens in the promote flow.
const mapping=z.object({kind:z.literal("mapping"),economicExposure:z.string().min(1),leverage:z.string(),direction:z.string().default("LONG"),country:z.string().length(2),wrapper:z.string().min(1),broker:z.string().nullable().optional(),preferredCurrency:z.string().length(3).nullable().optional(),tradingLineId:z.string().uuid(),fidelity:z.string().optional(),effectiveFrom:z.string(),effectiveTo:z.string().nullable().optional(),enabled:z.boolean().optional()});
const schema=z.discriminatedUnion("kind",[instrument,tradingLine,mapping,promoteMappingSchema,rejectMappingSchema]);

export async function PUT(request:Request){
  try{assertSameOrigin(request);const admin=await requireAdmin();const p=schema.parse(await request.json());
    if(p.kind==="promote"){const done=await promoteCandidateMapping(admin.id,p);return Response.json({ok:true,...done});}
    if(p.kind==="reject"){const done=await rejectCandidateMapping(admin.id,p);return Response.json({ok:true,...done});}
    if(p.kind==="instrument"){
      if(p.id)await updateInstrumentGuarded({id:p.id,isin:p.isin??null,providerInstrumentId:p.providerInstrumentId??null,name:p.name,economicExposure:p.economicExposure,leverage:p.leverage,direction:p.direction,fundCurrency:p.fundCurrency??null});
      else await sql.unsafe("INSERT INTO instruments (isin,provider_instrument_id,name,economic_exposure,leverage,direction,fund_currency) VALUES ($1,$2,$3,$4,$5,$6,$7)",[p.isin??null,p.providerInstrumentId??null,p.name,p.economicExposure,p.leverage,p.direction,p.fundCurrency??null]);
    } else if(p.kind==="tradingLine"){
      await upsertTradingLineGuarded({instrumentId:p.instrumentId,ticker:p.ticker,exchange:p.exchange,currency:p.currency,exchangeTimezone:p.exchangeTimezone,providerSymbol:p.providerSymbol??null,effectiveFrom:p.effectiveFrom,effectiveTo:p.effectiveTo??null});
    } else {
      if(p.fidelity!==undefined&&p.fidelity!=="CANDIDATE")return Response.json({error:"Mappings cannot be created as verified. Add a candidate, then verify and promote it from Candidates awaiting verification."},{status:400});
      await insertCandidateMapping({economicExposure:p.economicExposure,leverage:p.leverage,direction:p.direction,country:p.country,wrapper:p.wrapper,broker:p.broker??null,preferredCurrency:p.preferredCurrency??null,tradingLineId:p.tradingLineId,effectiveFrom:p.effectiveFrom,effectiveTo:p.effectiveTo??null});
    }
    await sql.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,metadata) VALUES ($1,'instrument-config.upsert','instrument_config',$2::jsonb)",[admin.id,JSON.stringify({kind:p.kind})]);return Response.json({ok:true});
  }catch(error){const denied=authFailure(error);if(denied)return denied;if(error instanceof EvidenceRefused){return Response.json({error:"Evidence is incomplete or invalid: "+error.issues.join("; "),code:error.code,issues:error.issues},{status:400});}if(error instanceof PromotionRefused){const refusal=PROMOTION_REFUSALS[error.code];return Response.json({error:refusal.message,code:error.code},{status:refusal.status});}if(error instanceof z.ZodError)return Response.json({error:error.issues[0]?.message&&error.issues[0].path.some((part)=>["checklist","note","isin","providerSymbol","evidence"].includes(String(part)))?error.issues[0].message:"Invalid instrument configuration."},{status:400});return Response.json({error:"Could not update instrument configuration."},{status:500});}
}
