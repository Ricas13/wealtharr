import Decimal from "decimal.js";

/**
 * Owner-selected Wealtharr Sig methodology, 2026-10-15.
 * These settings are NOT represented as current Kelly Letter rules.
 * They apply to NEW versioned Wealtharr models, never in-place to
 * previously published, immutable customer strategies.
 */
export const WEALTHARR_SIG_OWNER_RULES = {
  threeSig: {variant:"HISTORICAL_PUBLIC_SOURCE",protectionSellSkips:4,certification:"SOURCE_LIMITED"},
  sixSig: {variant:"WEALTHARR_TWO_SELL",protectionSellSkips:2,certification:"OWNER_CONVENTION"},
  nineSig: {
    variant:"WEALTHARR_DAILY_SPIKE",
    spikeObservation:"VERIFIED_DAILY_CLOSE",
    protectionReference:"TQQQ",
    targetAfterCappedBuy:"CONFIRMED_POST_FILL",
    quarterlyReview:"LAST_VERIFIED_TRADING_DAY",
    certification:"OWNER_CONVENTION"
  },
  income: {variant:"WEALTHARR_INCOME_MODEL",parameters:"ADMIN_VERSIONED",certification:"OWNER_CONVENTION"}
} as const;

const positive=(v:Decimal.Value,field:string)=>{
  const d=new Decimal(v);
  if(!d.isFinite()||d.lte(0))throw new Error("SIG_INVALID_"+field);
  return d;
};

/** Daily close spike monitoring using a verified TQQQ close and verified
 * preceding quarter-end TQQQ close. The last day's close is not an execution
 * price. This is an alert/action *candidate*, not an order or a certified rule.
 * 30-Down suppression and trading eligibility must be resolved before acting.
 */
export function assessWealtharr9SigDailySpike(input:{
  previousQuarterTqqqClose:Decimal.Value;
  observationTqqqClose:Decimal.Value;
  observationDate:string;
  previousQuarterLastTradingDay:string;
  verifiedDailyClose:boolean;
  in30DownProtection:boolean;
  stockValue:Decimal.Value;
  bondValue:Decimal.Value;
}):{triggered:boolean;targetStockWeight:"0.60"|null;gain:string}{
  const iso=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+"T00:00:00Z"))&&new Date(v+"T00:00:00Z").toISOString().slice(0,10)===v;
  if(!iso(input.observationDate)||!iso(input.previousQuarterLastTradingDay)||
    input.observationDate<=input.previousQuarterLastTradingDay||
    Math.floor((Number(input.observationDate.slice(5,7))-1)/3)===Math.floor((Number(input.previousQuarterLastTradingDay.slice(5,7))-1)/3)&&input.observationDate.slice(0,4)===input.previousQuarterLastTradingDay.slice(0,4))
    throw new Error("SIG_INVALID_SPIKE_OBSERVATION_DATE");
  if(!input.verifiedDailyClose)throw new Error("SIG_DAILY_CLOSE_NOT_VERIFIED");
  const before=positive(input.previousQuarterTqqqClose,"PREVIOUS_CLOSE");
  const now=positive(input.observationTqqqClose,"CURRENT_CLOSE");
  const stock=new Decimal(input.stockValue),bond=new Decimal(input.bondValue);
  if(!stock.isFinite()||!bond.isFinite()||stock.lt(0)||bond.lt(0)||stock.plus(bond).lte(0))
    throw new Error("SIG_INVALID_PORTFOLIO");
  // An owner's daily-close rule; never extrapolate intraday highs.
  const gain=now.div(before).minus(1);
  const triggered=gain.gte(1)&&!input.in30DownProtection;
  return {triggered,targetStockWeight:triggered?"0.60":null,gain:gain.toFixed()};
}

/** Admin-configurable Income Model parameters are versioned immutable inputs.
 * Validate here before a version is published; never change live instance
 * mathematics just because an administrator edits draft settings.
 */
export function validateWealtharrIncomeModelWeights(input:{
  generatorWeights:readonly Decimal.Value[];
  reserveWeights:readonly Decimal.Value[];
  skimFraction:Decimal.Value;
}):void{
  const validate=(weights:readonly Decimal.Value[],count:number,name:string)=>{
    if(weights.length!==count)throw new Error("SIG_INCOME_"+name+"_SLEEVE_COUNT");
    const values=weights.map(v=>new Decimal(v));
    if(values.some(v=>!v.isFinite()||v.lt(0))||!Decimal.sum(...values).eq(1))
      throw new Error("SIG_INCOME_"+name+"_WEIGHTS");
  };
  validate(input.generatorWeights,3,"GENERATOR");
  if(input.reserveWeights.length<1)throw new Error("SIG_INCOME_RESERVE_SLEEVE_COUNT");
  validate(input.reserveWeights,input.reserveWeights.length,"RESERVE");
  const skim=new Decimal(input.skimFraction);
  if(!skim.isFinite()||skim.lt(0)||skim.gt(1))throw new Error("SIG_INCOME_SKIM_FRACTION");
}
