import Decimal from "decimal.js";

/**
 * Exact algebra of ordinary quarters in the author's publicly released
 * historical 3Sig sample worksheet (the 2014 book-era spreadsheet).
 *
 * Source: https://www.jasonkelly.com/worksheets/My%203%25%20Signal%20Plan.xlsx
 * Formula cells J3/J4, M3/M4, O3/O4, Q3/Q4, S3/S4, W3/W4, X3/X4.
 *
 * Research-only: skips protective 30 Down, age-dependent rebalance resets,
 * order timing, share rounding and brokerage eligibility. Do NOT publish as
 * a complete Kelly Letter strategy or emit live financial instructions.
 */
export type HistoricalThreeSigQuarterInput={
  previousStockShares:Decimal.Value;
  previousStockClose:Decimal.Value;
  previousBondShares:Decimal.Value;
  stockClose:Decimal.Value;
  bondClose:Decimal.Value;
  stockDividendPerShare:Decimal.Value;
  bondDistributionPerShare:Decimal.Value;
  contribution:Decimal.Value;
  /** Confirmed broker fill; absence never implies an executed order. */
  confirmedStockShareDelta?:Decimal.Value;
};
export type HistoricalThreeSigQuarter={
  precedingStockValue:string;
  currentStockValue:string;
  targetStockValue:string;
  desiredShareDelta:string;
  desiredBondSharesAfterTrade:string;
  externalCashNeededIfFullyFilled:string;
  bondSharesBeforeTrade:string;
  confirmedStockSharesAfterTrade:string|null;
  confirmedBondSharesAfterTrade:string|null;
  confirmedStockValueAfterTrade:string|null;
  confirmedBondValueAfterTrade:string|null;
};
function positive(n:Decimal.Value,name:string){
  const value=new Decimal(n);
  if(!value.isFinite()||value.lte(0))throw new Error("INVALID_3SIG_PRICE:"+name);
  return value;
}
function nonnegative(n:Decimal.Value,name:string){
  const value=new Decimal(n);
  if(!value.isFinite()||value.lt(0))throw new Error("INVALID_3SIG_POSITION:"+name);
  return value;
}
export function calculateHistoricalThreeSigQuarter(i:HistoricalThreeSigQuarterInput):HistoricalThreeSigQuarter{
  const priorShares=nonnegative(i.previousStockShares,"previousStockShares");
  const priorStockClose=positive(i.previousStockClose,"previousStockClose");
  const priorBonds=nonnegative(i.previousBondShares,"previousBondShares");
  const stockClose=positive(i.stockClose,"stockClose");
  const bondClose=positive(i.bondClose,"bondClose");
  const stockDividend=nonnegative(i.stockDividendPerShare,"stockDividendPerShare");
  const bondDistribution=nonnegative(i.bondDistributionPerShare,"bondDistributionPerShare");
  const contribution=nonnegative(i.contribution,"contribution");
  const priorStockValue=priorShares.mul(priorStockClose);
  const currentStockValue=priorShares.mul(stockClose);
  const target=priorStockValue.mul("1.03").plus(contribution.mul("0.50"));
  const shareChange=target.minus(currentStockValue).div(stockClose);

  // Original worksheet reserves all stock/bond distributions and deposits in
  // the bond fund before applying the stock share change.
  const bondIncome=priorBonds.mul(bondDistribution).plus(priorShares.mul(stockDividend)).plus(contribution);
  const reserveShares=priorBonds.plus(bondIncome.div(bondClose));
  const bondSharesAfterDesired=reserveShares.minus(shareChange.mul(stockClose).div(bondClose));
  const cashNeeded=Decimal.max(0,bondSharesAfterDesired.neg().mul(bondClose));

  let actualStockShares:string|null=null;
  let actualBondShares:string|null=null;
  let actualStockValue:string|null=null;
  let actualBondValue:string|null=null;
  if(i.confirmedStockShareDelta!==undefined){
    const confirmed=new Decimal(i.confirmedStockShareDelta);
    if(!confirmed.isFinite())throw new Error("INVALID_3SIG_CONFIRMED_FILL");
    const stockAfter=priorShares.plus(confirmed);
    const bondsAfter=reserveShares.minus(confirmed.mul(stockClose).div(bondClose));
    if(stockAfter.isNegative()||bondsAfter.isNegative())
      throw new Error("3SIG_CONFIRMED_TRADE_EXCEEDS_HOLDINGS");
    actualStockShares=stockAfter.toString();
    actualBondShares=bondsAfter.toString();
    actualStockValue=stockAfter.mul(stockClose).toString();
    actualBondValue=bondsAfter.mul(bondClose).toString();
  }
  return {
    precedingStockValue:priorStockValue.toString(),
    currentStockValue:currentStockValue.toString(),
    targetStockValue:target.toString(),
    desiredShareDelta:shareChange.toString(),
    desiredBondSharesAfterTrade:bondSharesAfterDesired.toString(),
    externalCashNeededIfFullyFilled:cashNeeded.toString(),
    bondSharesBeforeTrade:reserveShares.toString(),
    confirmedStockSharesAfterTrade:actualStockShares,
    confirmedBondSharesAfterTrade:actualBondShares,
    confirmedStockValueAfterTrade:actualStockValue,
    confirmedBondValueAfterTrade:actualBondValue
  };
}
