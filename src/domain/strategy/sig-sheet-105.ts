import Decimal from "decimal.js";
import type {Community9SigProtection} from "./9sig-community-rules";

/**
 * Reconstruction of the *editable YES/NO decisions* in the community simulation
 * workbook "Copy of signal strategy simulation sheet v1.05".
 *
 * Demo sheets: V=YES means third qualifying sell after two skipped sells -> 60/40;
 * W=YES means a 30-Down episode has lasted eight consecutive review quarters -> 60/40.
 * Neither flag is computed by the Excel formulas: these are labelled Wealtharr
 * conventions, not author-certified/current Kelly Letter rules.
 *
 * Kept separate from WEALTHARR_OWNER_2026_V1 so existing strategy versions,
 * historical actions and ledgers retain their previous semantics.
 */
export type Sheet105ResetReason="THIRD_SELL"|"EIGHT_CONSECUTIVE_DOWN_QUARTERS";
export type Sheet105ResetDecision={
  belowThirty:boolean;
  consecutiveDownQuarters:number;
  resetReason:Sheet105ResetReason|null;
};

export function assessSheet105Reset(input:{
  quarterIndex:number;
  previousObservedQuarter:number|null;
  previousConsecutiveDownQuarters:number;
  currentRiskClose:Decimal.Value;
  precedingEightRiskCloses:readonly Decimal.Value[];
  triggerRatio:Decimal.Value;
  protection:Community9SigProtection;
  sellSkipCap:number;
  signal:"BUY"|"SELL"|"HOLD";
  lastResetProtectionStartQuarter:number|null;
}):Sheet105ResetDecision{
  const {quarterIndex,previousObservedQuarter,previousConsecutiveDownQuarters,protection}=input;
  if(!Number.isInteger(quarterIndex)||quarterIndex<8||
    (previousObservedQuarter!==null&&(!Number.isInteger(previousObservedQuarter)||previousObservedQuarter>=quarterIndex))||
    !Number.isInteger(previousConsecutiveDownQuarters)||previousConsecutiveDownQuarters<0||
    !Number.isInteger(input.sellSkipCap)||input.sellSkipCap<1||
    !Number.isInteger(protection.skippedSellCount)||protection.skippedSellCount<0||
    (protection.startQuarter!==null&&(!Number.isInteger(protection.startQuarter)||protection.startQuarter>quarterIndex))||
    (input.lastResetProtectionStartQuarter!==null&&!Number.isInteger(input.lastResetProtectionStartQuarter)))
    throw new Error("SIG_SHEET105_INVALID_STATE");
  if(input.precedingEightRiskCloses.length!==8)throw new Error("SIG_SHEET105_EIGHT_CLOSES_REQUIRED");
  const prices=[...input.precedingEightRiskCloses,input.currentRiskClose].map(value=>{
    const d=new Decimal(value);
    if(!d.isFinite()||d.lte(0))throw new Error("SIG_SHEET105_INVALID_CLOSE");
    return d;
  });
  const threshold=new Decimal(input.triggerRatio);
  if(!threshold.isFinite()||threshold.lte(0)||threshold.gte(1))throw new Error("SIG_SHEET105_INVALID_THRESHOLD");
  const belowThirty=prices[8].lte(Decimal.max(...prices.slice(0,8)).mul(threshold));
  // A missed or unverified quarter must NOT be counted as a consecutive observation.
  const consecutiveDownQuarters=!belowThirty?0:
    previousObservedQuarter===quarterIndex-1?previousConsecutiveDownQuarters+1:1;
  const episode=protection.startQuarter;
  const alreadyReset=episode!==null&&input.lastResetProtectionStartQuarter===episode;
  const resetReason:Sheet105ResetReason|null=
    episode===null||alreadyReset||!belowThirty?null:
    consecutiveDownQuarters>=8?"EIGHT_CONSECUTIVE_DOWN_QUARTERS":
    input.signal==="SELL"&&protection.skippedSellCount>=input.sellSkipCap?"THIRD_SELL":null;
  return {belowThirty,consecutiveDownQuarters,resetReason};
}
