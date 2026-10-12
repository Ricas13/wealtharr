import Decimal from "decimal.js";
import {z} from "zod";
import {assessFreshness,MANUAL_PRICE_SKEW_MS,MAX_QUOTE_AGE_MS} from "./market-freshness";

const schema=z.object({
  fieldKey:z.union([
    z.literal("strategy_state.targetValue"),
    z.string().regex(/^market_price:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  ]),
  manualValue:z.string().regex(/^\d+(?:\.\d{1,10})?$/),
  reason:z.string().trim().min(8).max(240),
  observedAt:z.string().datetime({offset:true}).optional(),
  confirmed:z.literal(true)
}).strict();

export function parseManualOverride(value:unknown,now=new Date()){
  const parsed=schema.parse(value);
  const manual=new Decimal(parsed.manualValue);
  if(!manual.isFinite()||manual.lt(0)||manual.gt("999999999999"))
    throw new Error("INVALID_OVERRIDE_AMOUNT");
  const price=parsed.fieldKey.startsWith("market_price:");
  if(price&&manual.lte(0))throw new Error("INVALID_OVERRIDE_PRICE");
  let observedAt:Date|null=null,expiresAt:Date|null=null;
  if(price){
    if(!parsed.observedAt)throw new Error("OVERRIDE_TIMESTAMP_REQUIRED");
    observedAt=new Date(parsed.observedAt);
    if(assessFreshness(observedAt,now,{maxAgeMs:MAX_QUOTE_AGE_MS,skewMs:MANUAL_PRICE_SKEW_MS})!=="CURRENT")
      throw new Error("OVERRIDE_PRICE_STALE");
    expiresAt=new Date(Math.min(observedAt.getTime()+MAX_QUOTE_AGE_MS,now.getTime()+12*3_600_000));
  }else if(parsed.observedAt){
    throw new Error("TARGET_VALUE_HAS_NO_MARKET_TIMESTAMP");
  }
  return {...parsed,manualValue:manual.toString(),observedAt,expiresAt};
}
export function validatedEffectivePrice(raw:unknown){
  if(typeof raw!=="string"&&typeof raw!=="number")throw new Error("INVALID_EFFECTIVE_PRICE");
  const price=new Decimal(String(raw));
  if(!price.isFinite()||price.lte(0)||price.gt("999999999999"))
    throw new Error("INVALID_EFFECTIVE_PRICE");
  return price;
}
