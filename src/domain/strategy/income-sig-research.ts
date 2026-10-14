import Decimal from "decimal.js";

/**
 * Research-only Income Sig (2026 Generator/Reserve) cashflow reconciliation.
 * https://jasonkelly.com/income-sig/
 * Does not derive proprietary allocation, skim rates or executable trades.
 */
export type IncomeSigFlow = {
  generatorOpening: string;
  reserveOpening: string;
  contributionsToGeneratorBondSlot: string;
  distributionsToReserve: string;
  profitSkimsToReserve: string;
  withdrawalsFromReserveBondSlot: string;
  generatorClosing: string;
  reserveClosing: string;
  totalClosing: string;
};
function amount(value: Decimal.Value, field:string): Decimal {
  const n=new Decimal(value);
  if(!n.isFinite() || n.isNegative())throw new Error("INVALID_INCOME_SIG_INPUT:"+field);
  return n;
}
/**
 * Bookkeeping identity, not a recommendation: value changes attributable to
 * market movement are intentionally excluded and must first be marked to market.
 * An extraction is blocked when it exceeds recorded available reserve cash.
 */
export function reconcileIncomeSigFlows(input:{
  generatorOpening:Decimal.Value;
  reserveOpening:Decimal.Value;
  contributions:Decimal.Value;
  receivedDistributions:Decimal.Value;
  confirmedProfitSkims:Decimal.Value;
  reserveWithdrawals:Decimal.Value;
}):IncomeSigFlow{
  const g=amount(input.generatorOpening,"generatorOpening");
  const r=amount(input.reserveOpening,"reserveOpening");
  const c=amount(input.contributions,"contributions");
  const d=amount(input.receivedDistributions,"receivedDistributions");
  const s=amount(input.confirmedProfitSkims,"confirmedProfitSkims");
  const w=amount(input.reserveWithdrawals,"reserveWithdrawals");
  const reserveAvailable=r.plus(d).plus(s);
  if(w.gt(reserveAvailable))throw new Error("INCOME_SIG_RESERVE_EXHAUSTED");
  const generatorClosing=g.plus(c).minus(s).minus(d);
  if(generatorClosing.isNegative())throw new Error("INCOME_SIG_GENERATOR_EXHAUSTED");
  const reserveClosing=reserveAvailable.minus(w);
  return {
    generatorOpening:g.toFixed(),
    reserveOpening:r.toFixed(),
    contributionsToGeneratorBondSlot:c.toFixed(),
    distributionsToReserve:d.toFixed(),
    profitSkimsToReserve:s.toFixed(),
    withdrawalsFromReserveBondSlot:w.toFixed(),
    generatorClosing:generatorClosing.toFixed(),
    reserveClosing:reserveClosing.toFixed(),
    totalClosing:generatorClosing.plus(reserveClosing).toFixed()
  };
}
