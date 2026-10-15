import Decimal from "decimal.js";

/**
 * Historical published Sig starting/reset allocations, distinguished from
 * ordinary quarterly value targeting. Never run these as automatic resets:
 * the trigger / timing of a reset is a separate, version-dependent rule.
 *
 * Jason Kelly (2016/2018):
 * https://jasonkelly.com/resources/strategies/
 * 3Sig 80/20, 6Sig 50/50. 9Sig 60/40: published Kelly explanations.
 */
export type SigResetVariant="3sig-book"|"6sig-historical"|"9sig-historical";
const STOCK_WEIGHTS:Readonly<Record<SigResetVariant,string>>={
  "3sig-book":"0.80","6sig-historical":"0.50","9sig-historical":"0.60"
};
export function previewHistoricalSigBaseReset(input:{
  variant:SigResetVariant;stockValue:Decimal.Value;bondValue:Decimal.Value;
  /** Asserted by independently verified strategy-specific reset trigger. */
  resetConfirmed:boolean;
}):{stockTarget:string;bondTarget:string;stockTrade:string;bondTrade:string;ready:boolean}{
  const weight=STOCK_WEIGHTS[input.variant];
  if(weight===undefined)throw new Error("UNKNOWN_SIG_RESET_VARIANT");
  const stock=new Decimal(input.stockValue),bond=new Decimal(input.bondValue);
  if(!stock.isFinite()||!bond.isFinite()||stock.lt(0)||bond.lt(0)||stock.plus(bond).lte(0))
    throw new Error("INVALID_SIG_RESET_VALUES");
  const total=stock.plus(bond),target=total.mul(weight);
  const diff=target.minus(stock);
  if(!input.resetConfirmed)
    return {stockTarget:target.toFixed(),bondTarget:total.minus(target).toFixed(),
      stockTrade:"0",bondTrade:"0",ready:false};
  return {stockTarget:target.toFixed(),bondTarget:total.minus(target).toFixed(),
    stockTrade:diff.toFixed(),bondTrade:diff.neg().toFixed(),ready:true};
}
