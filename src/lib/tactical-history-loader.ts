import "server-only";
import Decimal from "decimal.js";
import type {Sql} from "postgres";
import {sql} from "@/lib/db";
import type {TrustedHistoricalSeries} from "@/domain/strategy/types";

type Row={trading_day:string;adjusted_close:string;currency:string;provider:string;
 licensed:boolean;adjustment_verified:boolean;session_calendar_certified:boolean;
 month_terminal_certified:boolean;total_return_certified:boolean;source_calendar:string|null;
 session_sequence:string|null;provider_corporate_actions_revision:string|null;};
const CUTOFF_AGE_DAYS=45;
function certifiedSeries(exposure:string,rows:Row[],currency:string,reviewMonth:string,now:Date):TrustedHistoricalSeries|null{
 if(rows.length<200||!rows.every(r=>r.licensed===true&&r.adjustment_verified===true&&
   r.session_calendar_certified===true&&r.total_return_certified===true&&
   Boolean(r.source_calendar)&&Boolean(r.provider_corporate_actions_revision)&&
   r.currency.toUpperCase()===currency.toUpperCase()))return null;
 const provider=rows[0].provider,calendar=rows[0].source_calendar,revision=rows[0].provider_corporate_actions_revision;
 if(rows.some(r=>r.provider!==provider||r.source_calendar!==calendar||r.provider_corporate_actions_revision!==revision))return null;
 let sequence:number|null=null,prev=-Infinity;
 const points:TrustedHistoricalSeries["points"]=[];
 const months=new Set<string>(),terminals=new Set<string>();
 for(const r of rows){
  const day=r.trading_day,at=new Date(day+"T00:00:00.000Z");
  const s=Number(r.session_sequence),price=new Decimal(r.adjusted_close);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(at.getTime())||
    at.toISOString().slice(0,10)!==day||at.getTime()<=prev||at>now||
    !Number.isSafeInteger(s)||s<0||(sequence!==null&&s!==sequence+1)||
    !price.isFinite()||price.lte(0))return null;
  prev=at.getTime();sequence=s;
  const month=day.slice(0,7);months.add(month);
  if(r.month_terminal_certified)terminals.add(month);
  points.push({at,adjustedClose:price,monthTerminalCertified:r.month_terminal_certified});
 }
 if(!points.length||now.getTime()-points[points.length-1].at.getTime()>CUTOFF_AGE_DAYS*86400_000)return null;
 const [year,month]=reviewMonth.split("-").map(Number);
 for(let offset=0;offset<13;offset++){
  const m=new Date(Date.UTC(year,month-1-offset,1)).toISOString().slice(0,7);
  if(!months.has(m)||!terminals.has(m))return null;
 }
 if(rows[rows.length-1].trading_day.slice(0,7)!==reviewMonth||!rows[rows.length-1].month_terminal_certified)return null;
 return {exposure,currency:currency.toUpperCase(),source:provider,points,calendarCertified:true,totalReturnCertified:true};
}
/** Loads ONLY verifiably complete provider histories.
 * A trading line with missing sessions, a mixed revision, absent final-month bar or
 * ambiguous economic exposure maps to no history. The engine then refuses the trade.
 */
export async function loadTacticalCertifiedHistory(
 exposures:readonly string[],currency:string,reviewMonth:string,mappedLines:readonly {exposure:string;tradingLineId:string}[],now=new Date(),db:Pick<Sql,"unsafe">=sql
):Promise<TrustedHistoricalSeries[]>{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(reviewMonth)||new Set(exposures).size!==exposures.length)
  throw new Error("TACTICAL_BAD_HISTORY_QUERY");
 const result:TrustedHistoricalSeries[]=[];
 for(const exposure of exposures){
  const mapped=mappedLines.filter(m=>m.exposure===exposure);
  if(mapped.length!==1||!mapped[0].tradingLineId)continue;
  const lines=await db.unsafe(
   "SELECT tl.id FROM trading_lines tl JOIN instruments i ON i.id=tl.instrument_id "+
   "WHERE tl.id=$1 AND i.economic_exposure=$2 AND upper(tl.currency)=upper($3) "+
   "AND tl.effective_from<=$4::date AND (tl.effective_to IS NULL OR tl.effective_to>=$4::date)",
   [mapped[0].tradingLineId,exposure,currency,now.toISOString().slice(0,10)]);
  if(lines.length!==1)continue;
  const rows=await db.unsafe(
   "SELECT to_char(trading_day,'YYYY-MM-DD') AS trading_day,adjusted_close::text AS adjusted_close,"+
   "currency,provider,licensed,adjustment_verified,session_calendar_certified,month_terminal_certified,"+
   "total_return_certified,source_calendar,session_sequence::text AS session_sequence,provider_corporate_actions_revision "+
   "FROM price_history WHERE trading_line_id=$1 AND trading_day>=($2::date - interval '520 days') "+
   "AND trading_day < ($3::date + interval '1 month') ORDER BY trading_day",
   [lines[0].id,now.toISOString().slice(0,10),reviewMonth+"-01"]);
  const parsed:Row[]=rows.map(r=>({
   trading_day:String(r.trading_day),adjusted_close:String(r.adjusted_close),
   currency:String(r.currency),provider:String(r.provider),licensed:r.licensed===true,
   adjustment_verified:r.adjustment_verified===true,session_calendar_certified:r.session_calendar_certified===true,
   month_terminal_certified:r.month_terminal_certified===true,total_return_certified:r.total_return_certified===true,
   source_calendar:r.source_calendar?String(r.source_calendar):null,
   session_sequence:r.session_sequence==null?null:String(r.session_sequence),
   provider_corporate_actions_revision:r.provider_corporate_actions_revision?String(r.provider_corporate_actions_revision):null
  }));
  const certified=certifiedSeries(exposure,parsed,currency,reviewMonth,now);
  if(certified)result.push(certified);
 }
 return result;
}
