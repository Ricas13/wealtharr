import type {TrustedHistoricalSeries} from "./types";
import Decimal from "decimal.js";

/**
 * Locate exact, independently specified quarterly-review closes.
 * Never infer the Kelly Letter's review dates from calendar quarter ends:
 * its 2026 review schedule differs on multiple occasions.
 */
export function verifiedSigQuarterCloses(
  series:TrustedHistoricalSeries|undefined,
  expectedCloseDates:readonly string[],
  expectedCurrency:string
):Decimal[]{
  if(!series||series.currency.toUpperCase()!==expectedCurrency.toUpperCase())
    throw new Error("SIG_QUARTER_HISTORY_UNAVAILABLE");
  if(expectedCloseDates.length!==9||new Set(expectedCloseDates).size!==9)
    throw new Error("SIG_NINE_UNIQUE_REVIEW_DATES_REQUIRED");
  const prices=new Map<string,Decimal>();
  for(const row of series.points){
    const key=row.at.toISOString().slice(0,10);
    if(prices.has(key))throw new Error("SIG_DUPLICATE_REVIEW_PRICE");
    if(!row.adjustedClose.isFinite()||row.adjustedClose.lte(0))
      throw new Error("SIG_INVALID_TRUSTED_QUARTER_CLOSE");
    prices.set(key,row.adjustedClose);
  }
  let previous="";
  return expectedCloseDates.map(date=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<=previous)
      throw new Error("SIG_REVIEW_DATES_OUT_OF_ORDER");
    previous=date;
    const found=prices.get(date);
    if(!found)throw new Error("SIG_REVIEW_CLOSE_UNAVAILABLE:"+date);
    return found;
  });
}
