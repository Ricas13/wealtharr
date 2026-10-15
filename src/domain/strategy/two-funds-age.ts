/**
 * Paul Merriman Foundation "2 Funds for Life" MODERATE variant:
 * US small-cap-value allocation = min(100%, 1.5% x years until retirement),
 * target-date fund = remainder.
 *
 * Years-until-retirement is explicit, not current age. Reference arithmetic
 * only: Wealtharr must still integrate a retirement-date-aware engine with a
 * verifiable target-date-fund listing and anniversary/yearly review lifecycle.
 * https://www.paulmerriman.com/two-funds-for-life-calculator
 */
export function moderateTwoFundsWeights(yearsUntilRetirement:number):Readonly<{targetDateFund:string;smallCapValue:string}>{
  if(!Number.isInteger(yearsUntilRetirement)||yearsUntilRetirement<0||yearsUntilRetirement>100)
    throw new Error("TWO_FUNDS_YEARS_UNTIL_RETIREMENT_OUT_OF_RANGE");
  const scvBps=Math.min(10000,yearsUntilRetirement*150);
  return {targetDateFund:((10000-scvBps)/10000).toFixed(4),smallCapValue:(scvBps/10000).toFixed(4)};
}
