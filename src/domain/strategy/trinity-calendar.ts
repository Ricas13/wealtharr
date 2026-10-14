/**
 * NYSE regular full-day market closure rules. Derived from official NYSE
 * 2026-28 schedule; future years apply current public holiday convention and
 * cannot anticipate unscheduled exchange closures, so daily market history must
 * still confirm the supposed last trading session.
 * https://www.nyse.com/trade/hours-calendars
 */
const iso=(d:Date)=>d.toISOString().slice(0,10);
const day=(y:number,m:number,d:number)=>new Date(Date.UTC(y,m-1,d));
const weekday=(d:Date)=>d.getUTCDay();
function observed(d:Date,noSaturday=false):Date|null{
  if(weekday(d)===0)return new Date(d.getTime()+86400_000);
  if(weekday(d)===6)return noSaturday?null:new Date(d.getTime()-86400_000);
  return d;
}
function nthMonday(y:number,m:number,n:number){
  const first=day(y,m,1);return day(y,m,1+((8-weekday(first))%7)+7*(n-1));
}
function lastMonday(y:number,m:number){
  const last=day(y,m+1,0);
  return new Date(last.getTime()-((weekday(last)+6)%7)*86400_000);
}
function easter(y:number):Date{
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25);
  const g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4;
  const correction=(32+2*e+2*i-h-k)%7;
  const m=Math.floor((a+11*h+22*correction)/451);
  const month=Math.floor((h+correction-7*m+114)/31);
  const dom=(h+correction-7*m+114)%31+1;
  return day(y,month,dom);
}
export function trinityNyseHolidays(year:number):string[]{
  if(!Number.isInteger(year)||year<2024||year>2100)throw new Error("NYSE_CALENDAR_YEAR_UNSUPPORTED");
  const items=[observed(day(year,1,1),true),nthMonday(year,1,3),nthMonday(year,2,3),
    new Date(easter(year).getTime()-2*86400_000),lastMonday(year,5),
    observed(day(year,6,19)),observed(day(year,7,4)),nthMonday(year,9,1),
    day(year,11,1+((4-weekday(day(year,11,1))+7)%7)+21),
    observed(day(year,12,25))].filter((v):v is Date=>Boolean(v));
  return [...new Set(items.map(iso))].sort();
}
export function trinityNyseHolidayWindow(asOf:Date):string[]{
  const year=asOf.getUTCFullYear();
  return [...new Set([year-1,year,year+1].flatMap(trinityNyseHolidays))].sort();
}
