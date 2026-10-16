/** The public instrument is an illustrative two-sleeve identity, not a strategy engine or quote feed. */
export const EXAMPLE_EQUITY_MINOR=640000;
export const EXAMPLE_BOND_MINOR=360000;
export const EXAMPLE_INITIAL_MINOR=EXAMPLE_EQUITY_MINOR+EXAMPLE_BOND_MINOR;
export const EXAMPLE_EPOCH="2026-10-16";

export type InstrumentCalculation={
  equityCurrentMinor:number;
  bondCurrentMinor:number;
  contributionMinor:number;
  totalMinor:number;
  equityTargetMinor:number;
  bondTargetMinor:number;
  equityGapMinor:number;
  bondGapMinor:number;
  currentEquityPct:number;
  targetEquityPct:number;
};

/** All monetary arithmetic is carried out in integer minor units. Inputs are illustrative whole units. */
export function calculateInstrument(contributionUnits:number,targetEquityPercent:number):InstrumentCalculation{
 if(!Number.isSafeInteger(contributionUnits)||contributionUnits<0||contributionUnits>2000)
  throw new Error("INVALID_EXAMPLE_CONTRIBUTION");
 if(!Number.isSafeInteger(targetEquityPercent)||targetEquityPercent<30||targetEquityPercent>80||targetEquityPercent%5!==0)
  throw new Error("INVALID_EXAMPLE_TARGET");
 const contributionMinor=contributionUnits*100;
 const totalMinor=EXAMPLE_INITIAL_MINOR+contributionMinor;
 const equityTargetMinor=Math.round(totalMinor*targetEquityPercent/100);
 const bondTargetMinor=totalMinor-equityTargetMinor;
 return {
  equityCurrentMinor:EXAMPLE_EQUITY_MINOR,bondCurrentMinor:EXAMPLE_BOND_MINOR,
  contributionMinor,totalMinor,equityTargetMinor,bondTargetMinor,
  equityGapMinor:equityTargetMinor-EXAMPLE_EQUITY_MINOR,
  bondGapMinor:bondTargetMinor-EXAMPLE_BOND_MINOR,
  currentEquityPct:EXAMPLE_EQUITY_MINOR/EXAMPLE_INITIAL_MINOR*100,
  targetEquityPct:targetEquityPercent
 };
}

/** Calendar days from a fixed labelled illustrative date; not a published strategy review rule. */
export function illustrativeReviewDate(days:30|90|365):string{
 const date=new Date(Date.UTC(2026,9,16)+days*86_400_000);
 return new Intl.DateTimeFormat("en-GB",{timeZone:"UTC",day:"numeric",month:"short",year:"numeric"}).format(date);
}
