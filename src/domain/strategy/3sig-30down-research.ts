import Decimal from "decimal.js";

/**
 * Research-only implementation of the historical 3Sig BOOK variant's
 * 30-down sell suppression, not current Kelly Letter 6Sig/9Sig rules.
 *
 * Author primary source: https://jasonkelly.com/3sig/
 * 2015-03-13 comment: ignore four SELL signals when 30-down fires.
 * User's book spreadsheet establishes maximum eight-quarter interval;
 * current paid plan variants can differ.
 */
export type ThreeSigProtectionState = Readonly<{
  initiatedQuarterIndex: number | null;
  skippedSellSignals: number;
}>;
export type ThreeSigProtectionDecision={
  suppressSell:boolean;
  activated:boolean;
  remainingSellSkips:number;
  state:ThreeSigProtectionState;
};
export function evaluateHistoricalThreeSig30Down(input:{
  quarterIndex:number;
  spyQuarterClose:string;
  precedingEightQuarterCloses:readonly string[];
  proposedDirection:"BUY"|"SELL"|"HOLD";
  state:ThreeSigProtectionState;
}):ThreeSigProtectionDecision{
  const {quarterIndex,spyQuarterClose,precedingEightQuarterCloses,proposedDirection,state}=input;
  if(!Number.isInteger(quarterIndex)||quarterIndex<0||
    (state.initiatedQuarterIndex!==null&&(!Number.isInteger(state.initiatedQuarterIndex)||state.initiatedQuarterIndex>quarterIndex))||
    !Number.isInteger(state.skippedSellSignals)||state.skippedSellSignals<0||state.skippedSellSignals>4)
    throw new Error("INVALID_3SIG_PROTECTION_STATE");
  if(precedingEightQuarterCloses.length!==8)throw new Error("3SIG_REQUIRES_EIGHT_PRIOR_QUARTER_CLOSES");
  const values=[spyQuarterClose,...precedingEightQuarterCloses].map(value=>{
    const parsed=new Decimal(value);
    if(!parsed.isFinite()||parsed.lte(0))throw new Error("INVALID_3SIG_REFERENCE_CLOSE");
    return parsed;
  });
  const trailingMaximum=Decimal.max(...values.slice(1));
  const underThirty=values[0].lte(trailingMaximum.mul("0.70"));
  // A protected phase cannot be rearmed every quarter it remains under the
  // same drawdown threshold; caller must deliberately reconcile a new regime.
  const alreadyStarted=state.initiatedQuarterIndex!==null;
  const withinTwoYears=alreadyStarted && quarterIndex-state.initiatedQuarterIndex!<8;
  // A renewed crash after expiry may constitute a new protected period, but\n  // public comments do not pin down the re-arm event precisely. Fail closed.\n  if(alreadyStarted&&!withinTwoYears&&underThirty)\n    throw new Error("3SIG_PROTECTION_REARM_NEEDS_RECONCILIATION");\n  const activated=!alreadyStarted&&underThirty;
  const active=activated||withinTwoYears&&state.skippedSellSignals<4;
  const suppressSell=active&&proposedDirection==="SELL";
  const skips=state.skippedSellSignals+(suppressSell?1:0);
  const nextState=activated?{initiatedQuarterIndex:quarterIndex,skippedSellSignals:suppressSell?1:0}
    :alreadyStarted?{...state,skippedSellSignals:skips}:state;
  return {suppressSell,activated,remainingSellSkips:active?4-nextState.skippedSellSignals:0,state:nextState};
}
