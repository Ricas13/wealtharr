/** Owner-selected calendar quarter schedule. Never invent exchange holidays: the
 * caller supplies a verified trading calendar of YYYY-MM-DD dates. */
export function calendarQuarterReviewDates(tradingDays:readonly string[],through:string):string[]{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(through))throw new Error("SIG_INVALID_AS_OF");
  const byQuarter=new Map<string,string>();
  let prev="";
  for(const day of tradingDays){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day<=prev||!Number.isFinite(Date.parse(day+"T00:00:00Z")))
      throw new Error("SIG_INVALID_TRADING_CALENDAR");
    prev=day;
    if(day>through)break;
    const month=Number(day.slice(5,7));
    if(month<1||month>12)throw new Error("SIG_INVALID_TRADING_CALENDAR");
    const key=day.slice(0,4)+"-Q"+Math.ceil(month/3);
    byQuarter.set(key,day);
  }
  const complete=[...byQuarter.entries()].filter(([q,chosen])=>{
    const [year,quarter]=q.split("-Q").map(Number);
    const endMonth=quarter*3;
    const last=new Date(Date.UTC(year,endMonth,0)).toISOString().slice(0,10);
    // Exchange calendar must include a subsequent trading day (next quarter) to
    // prove no remaining sessions exist in this quarter. Without one, only a
    // quarter whose calendar end has passed is safe to declare complete.
    const distance=(Date.parse(last+"T00:00:00Z")-Date.parse(chosen+"T00:00:00Z"))/86400000;
    const provedByNextQuarter=tradingDays.some(d=>d>last);
    return chosen<=through&&(provedByNextQuarter||last<=through)&&distance>=0&&distance<=5;
  });
  if(complete.length<9)throw new Error("SIG_NINE_COMPLETE_QUARTERS_REQUIRED");
  return complete.slice(-9).map(([,day])=>day);
}
