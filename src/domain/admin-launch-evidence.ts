/** Dashboard evidence labels are observations, never production approvals. */
export type ProviderCheckResult={service:string;ok:string|null;occurredAt:Date|null};
export type ProviderEvidence={label:string;status:"No test recorded"|"Test failed"|"Recent test passed"|"Previous test passed";at:Date|null};
const SERVICES=[
 ["STRIPE","Stripe authentication"],["EMAIL","Transactional email request"],
 ["MARKET_DATA","Market-data quote"],["MARKET_DATA_HISTORY","Historical market-data sample"],
 ["TELEGRAM","Telegram bot and webhook"]
] as const;
export function providerLaunchEvidence(
 rows:readonly ProviderCheckResult[], now:Date
):ProviderEvidence[]{
 return SERVICES.map(([key,label])=>{
  const row=rows.find(x=>x.service===key);
  const time=row?.occurredAt??null;
  const recent=Boolean(time&&Number.isFinite(time.getTime())&&time.getTime()<=now.getTime()&&now.getTime()-time.getTime()<=7*86400000);
  return {label,status:!time?"No test recorded":row?.ok!=="true"?"Test failed":recent?"Recent test passed":"Previous test passed",at:time};
 });
}
