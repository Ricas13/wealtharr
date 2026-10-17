import Decimal from "decimal.js";

/**
 * Community simulation-sheet v1.07 optional VIX overlay, NOT a rule of any
 * historical Kelly Letter release. VIX is a risk indicator (SPX implied
 * volatility), not a TQQQ price or an executable quote.
 *
 * The accompanying v1.07 text says >30 is Fear. The original spreadsheet
 * colours >=30 red: follow the explicit text, and test the threshold boundary.
 */
export type VixRegime="CALM"|"NORMAL"|"FEAR";
export type VixChoice="DO_NOTHING"|"SETTLE_EARLY"|"REBALANCE_EARLY"|"SELL_HALF";
export type HeldRiskLine={instrumentId:string;accountId:string;ticker:string;exchange:string;quantity:string};
export type HalfSale={instrumentId:string;accountId:string;ticker:string;exchange:string;
  heldQuantity:string;indicativeSellQuantity:string;residualQuantity:string;exactHalf:boolean};

export function classifySheet107Vix(value:Decimal.Value):VixRegime{
  const v=new Decimal(value);
  if(!v.isFinite()||v.lt(0)||v.gt(150))throw new Error("SIG_107_VIX_INVALID");
  return v.lt(15)?"CALM":v.gt(30)?"FEAR":"NORMAL";
}

export function sheet107HalfRiskPositions(lines:readonly HeldRiskLine[]):HalfSale[]{
  const seen=new Set<string>();
  return lines.map(line=>{
    const id=line.accountId+"|"+line.instrumentId;
    if(seen.has(id))throw new Error("SIG_107_DUPLICATE_POSITION");
    seen.add(id);
    if(!line.accountId||!line.instrumentId||!line.ticker||!line.exchange)
      throw new Error("SIG_107_UNIDENTIFIED_POSITION");
    const held=new Decimal(line.quantity);
    if(!held.isFinite()||held.lte(0)||held.decimalPlaces()>8)
      throw new Error("SIG_107_INVALID_POSITION");
    // No claimed fill: sizing is informational only. Fractional eligibility,
    // minimum lot, fees, quotes and final executed quantity remain broker facts.
    const half=held.div(2);
    const sell=half.toDecimalPlaces(8,Decimal.ROUND_DOWN);
    if(sell.lte(0))throw new Error("SIG_107_TOO_SMALL");
    return {instrumentId:line.instrumentId,accountId:line.accountId,
      ticker:line.ticker,exchange:line.exchange,heldQuantity:held.toString(),
      indicativeSellQuantity:sell.toString(),residualQuantity:held.minus(sell).toString(),
      exactHalf:half.eq(sell)};
  });
}

/** This is a preview, not a contribution. The real target uses only confirmed ledger cash. */
export function sheet107ContributionImpact(amount:Decimal.Value,baseline:Decimal.Value,lift:Decimal.Value="0.50"){
  const actual=new Decimal(amount),regular=new Decimal(baseline),ratio=new Decimal(lift);
  if([actual,regular,ratio].some(x=>!x.isFinite())||actual.lt(0)||regular.lt(0)||ratio.lt(0)||ratio.gt(1))
    throw new Error("SIG_107_INVALID_CONTRIBUTION");
  return {change:actual.minus(regular).toString(),targetAdjustment:actual.minus(regular).mul(ratio).toString()};
}

/** Informational decision ONLY: never turn this into an order without an
 * explicit opt-in, version-specific trade workflow and a later confirmed fill.
 */
export function sheet107VixChoices(value:Decimal.Value,completedClose:boolean):VixChoice[]{
  if(!completedClose||classifySheet107Vix(value)!=="FEAR")return ["DO_NOTHING"];
  return ["DO_NOTHING","SETTLE_EARLY","REBALANCE_EARLY","SELL_HALF"];
}
