import {sql} from "@/lib/db";
import {RESEARCH_STRATEGIES} from "@/domain/strategy/research-catalog";
import {strategyReadiness,type StrategyReleaseEvidence} from "@/domain/strategy/release-readiness";
import {VERIFIED_MARKET_MAPPINGS_SQL,verifiedCandidates} from "@/lib/verified-market-mappings";

export const dynamic="force-dynamic";
export default async function ResearchCatalogPage(){
 const [versions,mappings]=await Promise.all([
  sql.unsafe(
   "SELECT d.key,d.enabled,v.version,v.engine_key,v.lifecycle_status,v.config,v.input_schema,"+
   " a.spec_card,a.golden_tests,a.attested_at "+
   "FROM strategy_definitions d LEFT JOIN LATERAL ("+
   " SELECT * FROM strategy_versions x WHERE x.strategy_definition_id=d.id "+
   " ORDER BY CASE WHEN x.lifecycle_status='PUBLISHED' THEN 0 WHEN x.lifecycle_status='DRAFT' THEN 1 ELSE 2 END,"+
   " x.effective_from DESC,x.created_at DESC LIMIT 1"+
   ") v ON true LEFT JOIN strategy_version_attestations a ON a.strategy_version_id=v.id"
  ),
  sql.unsafe(VERIFIED_MARKET_MAPPINGS_SQL)
 ]);
 const releases:StrategyReleaseEvidence[]=versions.map(v=>({
  key:String(v.key),enabled:v.enabled===true,
  version:v.version==null?null:String(v.version),
  engineKey:v.engine_key==null?null:String(v.engine_key),
  lifecycleStatus:v.lifecycle_status==null?null:String(v.lifecycle_status),
  config:v.config==null?null:v.config as Record<string,unknown>,
  inputSchema:v.input_schema??[],
  specCard:v.spec_card==null?null:String(v.spec_card),
  goldenTests:v.golden_tests==null?null:String(v.golden_tests),
  attestedAt:v.attested_at==null?null:String(v.attested_at)
 }));
 const evidence=strategyReadiness(releases,verifiedCandidates(mappings),new Date().toISOString().slice(0,10));
 const states=new Map(evidence.map(g=>[g.key,g]));
 const configured=evidence.filter(g=>g.marketNames.length>0).length;
 const attested=evidence.filter(g=>g.attested).length;
 return <><div className="page-title"><div><div className="eyebrow">Admin · Strategies</div>
 <h1>Strategy research & release evidence</h1>
 <p>A live inventory of built-in rules, code/release agreement, recorded sign-offs and complete instrument mappings. It does not claim independent methodology certification, market-data licensing or broker purchasability.</p></div></div>
 <section className="card"><h2>{evidence.length} curated reference profiles</h2>
 <p className="help">{attested} with a recorded version attestation · {configured} with at least one complete operator-defined market mapping. Neither number is a commercial approval.</p>
 <p><a href="/admin/strategies">Manage version releases</a> · <a href="/admin/instruments">Configure instrument mappings</a> · <a href="/admin/launch">Launch readiness</a></p></section>
 <div className="detail-grid" style={{marginTop:16}}>{RESEARCH_STRATEGIES.map(profile=>{
   const gate=states.get(profile.key)!;
   return <section className="card" key={profile.key}>
     <div className="eyebrow">{profile.engine}</div><h3>{profile.name}</h3>
     <p><strong>{gate.state}</strong></p><p>{profile.rules}</p>
     <p className="help">Stored rules match: {gate.rulesMatch?"Yes":"No / unavailable"} · Published: {gate.published?"Yes":"No"} · Evidence recorded: {gate.attested?"Yes":"No"} · Enabled: {gate.operatorEnabled?"Yes":"No"}</p>
     <p className="help"><strong>Full configured markets:</strong> {gate.marketNames.length?gate.marketNames.join(" · "):"None"} (configuration only; tradeability not independently checked)</p>
     {!gate.marketNames.length&&gate.missing.length>0&&<p className="help">Example missing/ambiguous exposures for UK ISA: {gate.missing.join(", ")}</p>}
     {profile.config&&<details><summary>Read-only canonical reference rules</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(profile.config,null,2)}</pre></details>}
     <h4>Risks</h4><ul>{profile.risks.map(r=><li key={r}>{r}</li>)}</ul>
     <h4>Research sources</h4><ul>{profile.research.map(url=><li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{new URL(url).hostname}</a></li>)}</ul>
   </section>;
 })}</div></>;
}
