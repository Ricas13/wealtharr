import Decimal from "decimal.js";
import { sql } from "@/lib/db";
import { InstrumentEditor,TradingLineEditor } from "@/components/AdminEditors";
import { InstrumentCandidates,type CandidateView } from "@/components/AdminInstrumentCandidates";
import { coverageReport } from "@/domain/instrument-import";
import { RESEARCH_STRATEGIES } from "@/domain/strategy/research-catalog";

const plainLeverage=(value:unknown)=>{try{return new Decimal(String(value)).toString();}catch{return String(value);}};

export default async function InstrumentsAdmin(){
  const rows=await sql.unsafe("SELECT i.id,i.isin,i.name,i.economic_exposure,i.leverage,tl.id AS trading_line_id,tl.ticker,tl.exchange,tl.currency FROM instruments i LEFT JOIN trading_lines tl ON tl.instrument_id=i.id AND tl.effective_from<=current_date AND (tl.effective_to IS NULL OR tl.effective_to>=current_date) ORDER BY i.name,tl.exchange");
  const candidateRows=await sql.unsafe("SELECT m.id::text AS id,m.economic_exposure,m.leverage::text AS leverage,m.direction,m.country,m.wrapper,m.trading_line_id::text AS trading_line_id,tl.ticker,tl.exchange,tl.currency,tl.provider_symbol,i.isin,i.name FROM regional_instrument_mappings m JOIN trading_lines tl ON tl.id=m.trading_line_id JOIN instruments i ON i.id=tl.instrument_id WHERE m.fidelity='CANDIDATE' ORDER BY m.country,m.wrapper,m.economic_exposure,tl.ticker");
  const candidates:CandidateView[]=candidateRows.map((r:any)=>({id:r.id,economicExposure:r.economic_exposure,leverage:plainLeverage(r.leverage),direction:r.direction,country:r.country,wrapper:r.wrapper,tradingLineId:r.trading_line_id,ticker:r.ticker,exchange:r.exchange,currency:r.currency,isin:r.isin??null,instrumentName:r.name,providerSymbol:r.provider_symbol??null}));
  const mappings=(await sql.unsafe("SELECT economic_exposure AS exposure,country,wrapper,fidelity FROM regional_instrument_mappings WHERE enabled=true")) as unknown as Array<{exposure:string;country:string;wrapper:string;fidelity:string}>;
  const required=RESEARCH_STRATEGIES.flatMap((s)=>((s.config as {allocations?:Array<{exposure:string}>}|undefined)?.allocations??[]).map((a)=>a.exposure));
  const places=[...new Set(mappings.map((m)=>m.country+"/"+m.wrapper))].sort();
  return <><div className="page-title"><div><div className="eyebrow">Admin · Instruments</div><h1>Regional resolver</h1><p>Stable instruments, trading lines and dated exact mappings. No strategy is tied directly to a ticker.</p></div></div>
    {rows.length?<div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table><thead><tr><th>Instrument</th><th>UUID</th><th>ISIN</th><th>Exposure</th><th>Leverage</th><th>Trading line</th><th>Line UUID</th></tr></thead><tbody>{rows.map((i:any)=><tr key={String(i.id)+String(i.ticker)}><td>{i.name}</td><td>{i.id}</td><td>{i.isin??"—"}</td><td>{i.economic_exposure}</td><td>{i.leverage}x</td><td>{i.ticker?i.ticker+" · "+i.exchange+" · "+i.currency:"No active trading line"}</td><td>{i.trading_line_id??"—"}</td></tr>)}</tbody></table></div>:<div className="empty">No production instrument mappings are seeded deliberately. Add only verified, faithful regional implementations before enabling financial actions.</div>}
    <h2 style={{marginTop:28}}>Candidates awaiting verification</h2>
    <p>Imported candidates are ignored by every calculation. Verify each one against the issuer documents to promote it to an exact mapping; nothing is verified automatically.</p>
    <InstrumentCandidates candidates={candidates}/>
    <h2 style={{marginTop:28}}>Coverage</h2>
    <p>Exposures used by the research strategies, per country and wrapper: READY has an enabled EXACT mapping, CANDIDATE_ONLY still needs verification, MISSING has nothing.</p>
    {places.length?places.map((place)=>{const [country,wrapper]=place.split("/");const report=coverageReport(required,mappings,country,wrapper);return <div key={place} className="table-wrap" tabIndex={0} role="region" aria-label={"Coverage for "+place}><table><caption>{country} · {wrapper}</caption><thead><tr><th>Exposure</th><th>Status</th></tr></thead><tbody>{report.map((r)=><tr key={r.exposure}><td>{r.exposure}</td><td>{r.status}</td></tr>)}</tbody></table></div>;}):<div className="empty">No mappings exist yet, so every exposure is missing in every country.</div>}
    <div style={{marginTop:18}}><TradingLineEditor/></div><InstrumentEditor/></>;
}
