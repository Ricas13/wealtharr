import {trinityNyseHolidays} from "./trinity-calendar";

/**
 * Quarter-end reference dates for the quarterly signal family, derived from the NYSE full-day closure
 * rules in `trinity-calendar.ts` (never from a calendar copied into an immutable strategy version).
 * Wealtharr convention (owner decision): the signal is set by the close of the LAST NYSE trading day of
 * each calendar quarter (March, June, September, December).
 *
 * Unscheduled closures cannot be predicted by rule. A missing trusted close on a derived reference date
 * fails closed in `sig-quarter-closes.ts`, so such a closure cannot silently produce a signal.
 */
const NEW_YORK="America/New_York";
export const NYSE_CLOSE_MINUTES=16*60;

const holidayCache=new Map<number,ReadonlySet<string>>();
function holidays(year:number):ReadonlySet<string>{
  let cached=holidayCache.get(year);
  if(!cached){cached=new Set(trinityNyseHolidays(year));holidayCache.set(year,cached);}
  return cached;
}

const ISO=/^(\d{4})-(\d{2})-(\d{2})$/;
function parts(date:string){
  const match=ISO.exec(date);
  if(!match)throw new Error("SIG_INVALID_DATE");
  return {year:Number(match[1]),month:Number(match[2]),day:Number(match[3])};
}
const isoOf=(ms:number)=>new Date(ms).toISOString().slice(0,10);
const msOf=(date:string)=>{const {year,month,day}=parts(date);return Date.UTC(year,month-1,day);};
export const addDaysIso=(date:string,days:number)=>isoOf(msOf(date)+days*86_400_000);

/** The calendar date in New York at an instant. */
export function newYorkDate(now:Date):string{
  if(!Number.isFinite(now.getTime()))throw new Error("SIG_INVALID_INSTANT");
  return new Intl.DateTimeFormat("en-CA",{timeZone:NEW_YORK,year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}
/** Minutes after local midnight in New York at an instant (0..1439). */
export function newYorkMinutes(now:Date):number{
  const p=new Intl.DateTimeFormat("en-GB",{timeZone:NEW_YORK,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const hour=Number(p.find(x=>x.type==="hour")?.value);
  const minute=Number(p.find(x=>x.type==="minute")?.value);
  if(!Number.isInteger(hour)||!Number.isInteger(minute))throw new Error("SIG_INVALID_INSTANT");
  return hour*60+minute;
}

export function isNyseTradingDay(date:string):boolean{
  const {year}=parts(date);
  const weekday=new Date(msOf(date)).getUTCDay();
  return weekday!==0&&weekday!==6&&!holidays(year).has(date);
}

/** Last NYSE trading day of calendar quarter 1..4 of a year. */
export function quarterEndTradingDay(year:number,quarter:number):string{
  if(!Number.isInteger(year)||!Number.isInteger(quarter)||quarter<1||quarter>4)throw new Error("SIG_INVALID_QUARTER");
  let cursor=isoOf(Date.UTC(year,quarter*3,0));
  for(let i=0;i<14;i++){
    if(isNyseTradingDay(cursor))return cursor;
    cursor=addDaysIso(cursor,-1);
  }
  throw new Error("SIG_QUARTER_END_UNAVAILABLE");
}

/** Absolute quarter number, so a skipped quarter never desynchronises protection windows. */
export const quarterIndexOf=(year:number,quarter:number)=>year*4+(quarter-1);
export function quarterFromIndex(index:number){
  if(!Number.isInteger(index)||index<0)throw new Error("SIG_INVALID_QUARTER");
  return {year:Math.floor(index/4),quarter:(index%4)+1};
}

export type SigReference={
  referenceDate:string;
  quarterIndex:number;
  /** NYSE trading days strictly after the reference date up to and including today (New York). */
  tradingDaysSince:number;
};

/**
 * The latest quarter-end reference whose close is final at `now`: the reference date itself only counts
 * from the NYSE close (16:00 New York) onward.
 */
export function latestSigReference(now:Date):SigReference{
  const today=newYorkDate(now);
  const afterClose=newYorkMinutes(now)>=NYSE_CLOSE_MINUTES;
  const {year,month}=parts(today);
  let index=quarterIndexOf(year,Math.ceil(month/3));
  for(let i=0;i<8;i++,index--){
    const {year:y,quarter}=quarterFromIndex(index);
    const referenceDate=quarterEndTradingDay(y,quarter);
    if(referenceDate<today||(referenceDate===today&&afterClose)){
      let tradingDaysSince=0;
      for(let d=addDaysIso(referenceDate,1);d<=today;d=addDaysIso(d,1))if(isNyseTradingDay(d))tradingDaysSince++;
      return {referenceDate,quarterIndex:index,tradingDaysSince};
    }
  }
  throw new Error("SIG_REFERENCE_UNAVAILABLE");
}

/** The nine consecutive quarter-end trading days ending at (and including) a reference quarter. */
export function referenceHistoryDates(quarterIndex:number):string[]{
  const dates:string[]=[];
  for(let i=8;i>=0;i--){
    const {year,quarter}=quarterFromIndex(quarterIndex-i);
    dates.push(quarterEndTradingDay(year,quarter));
  }
  return dates;
}

/** The instant of the NYSE close (16:00 New York) on a date, correct across daylight-saving changes. */
export function nyseCloseInstant(date:string):Date{
  for(const hourUtc of [20,21]){
    const candidate=new Date(`${date}T${String(hourUtc).padStart(2,"0")}:00:00Z`);
    if(newYorkDate(candidate)===date&&newYorkMinutes(candidate)===NYSE_CLOSE_MINUTES)return candidate;
  }
  throw new Error("SIG_CLOSE_INSTANT_UNAVAILABLE");
}
