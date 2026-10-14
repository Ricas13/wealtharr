import Decimal from "decimal.js";
import {requireAdminPage} from "@/lib/session";
import { sql } from "@/lib/db";
import { InstrumentEditor,TradingLineEditor } from "@/components/AdminEditors";
import { InstrumentCandidates,type CandidateView } from "@/components/AdminInstrumentCandidates";
import { AdminCorporateActions,type CorporateActionView } from "@/components/AdminCorporateActions";
import { coverageReport } from "@/domain/instrument-import";
import { RESEARCH_STRATEGIES } from "@/domain/strategy/research-catalog";

const plainLeverage=(value:unknown)=>{try{return new Decimal(String(value)).toString();}catch{return String(value);}};

export default async function InstrumentsAdmin(){
 await requireAdminPage();
  const rows=await sql.unsafe("SELECT i.id,i.isin,i.name,i.economic_exposure,i.leverage,tl.id AS trading_line_id,tl.ticker,tl.exchange,tl.currency FROM instruments i LEFT JOIN trading_lines tl ON tl.instrument_id=i.id AND tl.effective_from<=current_date AND (tl.effective_to IS NULL OR tl.effective_to>=current_date) ORDER BY i.name,tl.exchange");
  const candidateRows=await sql.unsafe("SELECT m.id::text AS id,m.economic_exposure,m.leverage::text AS leverage,m.direction,m.country,m.wrapper,m.trading_line_id::text AS trading_line_id,m.broker,tl.ticker,tl.exchange,tl.currency,tl.provider_symbol,i.isin,i.name FROM regional_instrument_mappings m JOIN trading_lines tl ON tl.id=m.trading_line_id JOIN instruments i ON i.id=tl.instrument_id WHERE m.fidelity='CANDIDATE' ORDER BY m.country,m.wrapper,m.economic_exposure,tl.ticker");
  const candidates:CandidateView[]=candidateRows.map((r:any)=>({id:r.id,economicExposure:r.economic_exposure,leverage:plainLeverage(r.leverage),direction:r.direction,country:r.country,wrapper:r.wrapper,tradingLineId:r.trading_line_id,ticker:r.ticker,exchange:r.exchange,currency:r.currency,isin:r.isin??null,instrumentName:r.name,providerSymbol:r.provider_symbol??null,broker:r.broker??null}));
  const actionRows=await sql.unsafe("SELECT a.id::text AS id,a.instrument_id::text AS instrument_id,i.name,a.ratio_to,a.ratio_from,a.effective_date::text AS effective_date,a.status,a.confirmed_at::text AS confirmed_at,a.evidence->>'sourceUrl' AS source_url,a.evidence->>'retrievedAt' AS retrieved_at FROM corporate_actions a JOIN instruments i ON i.id=a.instrument_id ORDER BY a.effective_date DESC,a.confirmed_at DESC LIMIT 200");
  const corporateActions:CorporateActionView[]=actionRows.map((r:any)=>({id:r.id,instrumentId:r.instrument_id,instrumentName:r.name,ratioTo:Number(r.ratio_to),ratioFrom:Number(r.ratio_from),effectiveDate:String(r.effective_date).slice(0,10),sourceUrl:String(r.source_url??""),retrievedAt:String(r.retrieved_at??""),confirmedAt:String(r.confirmed_at),status:r.status}));
  const instrumentOptions=(await sql.unsafe("SELECT id::text AS id,name FROM instruments ORDER BY name")).map((r:any)=>({id:String(r.id),name:String(r.name)}));
  const mappings=(await sql.unsafe("SELECT economic_exposure AS exposure,country,wrapper,fidelity FROM regional_instrument_mappings WHERE enabled=true OR fidelity='CANDIDATE'")) as unknown as Array<{exposure:string;country:string;wrapper:string;fidelity:string}>;
  const required=RESEARCH_STRATEGIES.flatMap((s)=>((s.config as {allocations?:Array<{exposure:string}>}|undefined)?.allocations??[]).map((a)=>a.exposure));
  const places=[...new Set(mappings.map((m)=>m.country+"/"+m.wrapper))].sort();
  return <><div className="page-title"><div><div className="eyebrow">Admin · Instruments</div><h1>Regional resolver</h1><p>Stable instruments, trading lines and dated exact mappings. No strategy is tied directly to a ticker.</p></div></div>
    {rows.length?<div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table><thead><tr><th>Instrument</th><th>UUID</th><th>ISIN</th><th>Exposure</th><th>Leverage</th><th>Trading line</th><th>Line UUID</th></tr></thead><tbody>{rows.map((i:any)=><tr key={String(i.id)+String(i.ticker)}><td>{i.name}</td><td>{i.id}</td><td>{i.isin??"—"}</td><td>{i.economic_exposure}</td><td>{i.leverage}x</td><td>{i.ticker?i.ticker+" · "+i.exchange+" · "+i.currency:"No active trading line"}</td><td>{i.trading_line_id??"—"}</td></tr>)}</tbody></table></div>:<div className="empty">No production instrument mappings are seeded deliberately. Add only verified, faithful regional implementations before enabling financial actions.</div>}
    <h2 style={{marginTop:28}}>Candidates awaiting verification</h2>
    <p>Imported candidates are ignored by every calculation. Verify each one against the issuer documents to promote it to an exact mapping; nothing is verified automatically. A mapping with no broker resolves for every broker but does not prove the instrument can be bought at any of them; only a dated broker snapshot in its evidence does.</p>
    <InstrumentCandidates candidates={candidates}/>
    <h2 style={{marginTop:28}}>Corporate actions</h2>
    <p>A provider quote that moves by a confirmed split&apos;s ratio is accepted only while a confirmed action here explains it. A split recorded in a user&apos;s own ledger restates that strategy&apos;s units and never changes which quotes are accepted.</p>
    <AdminCorporateActions actions={corporateActions} instruments={instrumentOptions}/>
    <h2 style={{marginTop:28}}>Coverage</h2>
    <p>Exposures used by the research strategies, per country and wrapper: READY has an enabled EXACT mapping, CANDIDATE_ONLY still needs verification, MISSING has nothing.</p>
    {places.length?places.map((place)=>{const [country,wrapper]=place.split("/");const report=coverageReport(required,mappings,country,wrapper);return <div key={place} className="table-wrap" tabIndex={0} role="region" aria-label={"Coverage for "+place}><table><caption>{country} · {wrapper}</caption><thead><tr><th>Exposure</th><th>Status</th></tr></thead><tbody>{report.map((r)=><tr key={r.exposure}><td>{r.exposure}</td><td>{r.status}</td></tr>)}</tbody></table></div>;}):<div className="empty">No mappings exist yet, so every exposure is missing in every country.</div>}
    <div style={{marginTop:18}}><TradingLineEditor/></div><InstrumentEditor/></>;
}
