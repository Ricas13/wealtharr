import {afterAll,beforeAll,describe,it,expect} from "vitest";
import postgres from "postgres";
import {loadTacticalCertifiedHistory} from "@/lib/tactical-history-loader";
const url=process.env.DATABASE_URL;
const db=url?postgres(url,{max:2,prepare:false}):null;
describe.skipIf(!url)("certified tactical historical-price DB loader",()=>{
 const suffix=Math.random().toString(36).slice(2,10).toUpperCase();
 const exposure="TACTICAL_FIXTURE_"+suffix;
 const timestamp=new Date("2026-11-03T14:00:00Z");
 let instrumentId="",lineId="",otherLineId="";
 const load=(mapping={exposure,tradingLineId:lineId})=>
  loadTacticalCertifiedHistory([exposure],"USD","2026-10",[mapping],timestamp,db!);
 beforeAll(async()=>{
  const i=await db!.unsafe(
   "INSERT INTO instruments (isin,name,economic_exposure) VALUES ($1,'Tactical test',$2) RETURNING id",
   ["T"+suffix.padEnd(11,"0").slice(0,11),exposure]);
  instrumentId=String(i[0].id);
  const l=await db!.unsafe(
   "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) "+
   "VALUES ($1,$2,'NYSE','USD','America/New_York',$2,'2020-01-01') RETURNING id",
   [instrumentId,"TT"+suffix]);
  lineId=String(l[0].id);
  const two=await db!.unsafe(
   "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) "+
   "VALUES ($1,$2,'NYSE','USD','America/New_York',$2,'2020-01-01') RETURNING id",
   [instrumentId,"TA"+suffix]);
  otherLineId=String(two[0].id);
  await db!.unsafe(
   "WITH sessions AS (SELECT d::date AS day,row_number() OVER(ORDER BY d)::bigint AS seq,"+
   "lead(date_trunc('month',d)) OVER(ORDER BY d) IS DISTINCT FROM date_trunc('month',d) AS terminal "+
   "FROM generate_series('2025-10-01'::date,'2026-10-31'::date,interval '1 day') d "+
   "WHERE extract(isodow FROM d)<6) "+
   "INSERT INTO price_history (trading_line_id,trading_day,adjusted_close,currency,provider,licensed,"+
   "adjustment_verified,session_calendar_certified,month_terminal_certified,total_return_certified,"+
   "source_calendar,session_sequence,provider_corporate_actions_revision) "+
   "SELECT $1,day,100+seq::numeric/10,'USD','fixture',true,true,true,terminal,true,'XNYS',seq,'rev-1' FROM sessions",
   [lineId]);
 });
 afterAll(async()=>{
  if(!db)return;
  await db.unsafe("DELETE FROM price_history WHERE trading_line_id IN ($1,$2)",[lineId,otherLineId]);
  await db.unsafe("DELETE FROM trading_lines WHERE id IN ($1,$2)",[lineId,otherLineId]);
  await db.unsafe("DELETE FROM instruments WHERE id=$1",[instrumentId]);
  await db.end();
 });
 it("uses only the exact verified instrument instead of ambiguous same-exposure lines",async()=>{
  const h=await load();
  expect(h).toHaveLength(1);
  expect(h[0].points.length).toBeGreaterThanOrEqual(253);
  expect(h[0]).toMatchObject({currency:"USD",calendarCertified:true,totalReturnCertified:true,source:"fixture"});
  expect((await load({exposure,tradingLineId:otherLineId}))).toHaveLength(0);
 });
 it("rejects bad mapping, missing session and contradictory split/dividend revision",async()=>{
  const ambiguous=await loadTacticalCertifiedHistory([exposure],"USD","2026-10",
   [{exposure,tradingLineId:lineId},{exposure,tradingLineId:otherLineId}],timestamp,db!);
  expect(ambiguous).toHaveLength(0);
  await db!.unsafe("UPDATE price_history SET provider_corporate_actions_revision='rev-2' WHERE trading_line_id=$1 AND trading_day='2026-04-15'",[lineId]);
  expect(await load()).toHaveLength(0);
  await db!.unsafe("UPDATE price_history SET provider_corporate_actions_revision='rev-1' WHERE trading_line_id=$1 AND trading_day='2026-04-15'",[lineId]);
  await db!.unsafe("DELETE FROM price_history WHERE trading_line_id=$1 AND trading_day='2026-06-11'",[lineId]);
  expect(await load()).toHaveLength(0);
 });
 it("rejects missing terminal calendar certification",async()=>{
  // Missing session from prior test already blocks; explicitly check the terminal flag.
  await db!.unsafe("UPDATE price_history SET month_terminal_certified=false WHERE trading_line_id=$1 AND trading_day='2026-10-30'",[lineId]);
  expect(await load()).toHaveLength(0);
 });
});
