/**
 * Historical classic "two funds for life" age schedule: target-date fund percentage
 * grows 1.5 percentage points per year, capped at 100%; complement is small-cap value.
 *
 * This is a reference calculation only. Never use it to trade: matching the target-date
 * fund to the user's retirement year and treating its internal glide path correctly
 * require a separately versioned, customer-publishable engine.
 */
export function classicTwoFundsAgeWeights(age:number):Readonly<{targetDateFund:string;smallCapValue:string}>{
  if(!Number.isInteger(age)||age<20||age>120)throw new Error("TWO_FUNDS_AGE_OUT_OF_RANGE");
  const targetBps=Math.min(10_000,age*150);
  return {
    targetDateFund:(targetBps/10_000).toFixed(4),
    smallCapValue:((10_000-targetBps)/10_000).toFixed(4)
  };
}
