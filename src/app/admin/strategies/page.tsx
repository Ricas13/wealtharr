import Link from "next/link";
import {requireAdminPage} from "@/lib/session";
import {sql} from "@/lib/db";
import {STRATEGY_PLUGINS,curatedRelease} from "@/domain/strategy/catalog";
import {assertCuratedRules} from "@/domain/strategy/curated-release";
import {assertCustomerPublishableEngine} from "@/domain/strategy/registry";
import {assessStrategyMarket} from "@/domain/strategy/market-eligibility";
import {VERIFIED_MARKET_MAPPINGS_SQL,verifiedCandidates} from "@/lib/verified-market-mappings";
import {AdminStrategyInventory,type CatalogEntry} from "@/components/AdminStrategyInventory";
import {ModelPerformanceEditor,StrategyVersionManager} from "@/components/AdminEditors";

export const dynamic="force-dynamic";

export default async function StrategiesAdmin(){
 await requireAdminPage();
 const [definitions,versions,mappingRows]=await Promise.all([
  sql.unsafe("SELECT key,name,family,engine,enabled FROM strategy_definitions ORDER BY name"),
  sql.unsafe(
    "SELECT d.key,d.name,v.id AS version_id,v.version,v.engine_key,v.lifecycle_status,v.upgrade_policy,v.effective_from,v.effective_to,v.published_at,v.config,v.input_schema,"+
    " (a.strategy_version_id IS NOT NULL) AS attested"+
    " FROM strategy_versions v JOIN strategy_definitions d ON d.id=v.strategy_definition_id"+
    " LEFT JOIN strategy_version_attestations a ON a.strategy_version_id=v.id"+
    " ORDER BY d.name,v.effective_from DESC,v.created_at DESC"
  ),
  sql.unsafe(VERIFIED_MARKET_MAPPINGS_SQL)
 ]);
 const candidates=verifiedCandidates(mappingRows);
 const asOf=new Date().toISOString().slice(0,10);
 const dateKey=(value:unknown)=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
 const installed=new Map(definitions.map(d=>[String(d.key),d]));
 const plugins=new Map(STRATEGY_PLUGINS.map(p=>[p.key,p]));
 const list=[...new Set([...STRATEGY_PLUGINS.map(p=>p.key),...definitions.map(d=>String(d.key))])];
 const entries:CatalogEntry[]=list.map(key=>{
   const def=installed.get(key);
   const plugin=plugins.get(key);
   const profile=plugin?.profile??undefined;
   const release=versions.find(v=>String(v.key)===key&&v.lifecycle_status==="PUBLISHED"&&
      dateKey(v.effective_from)<=asOf&&(!v.effective_to||dateKey(v.effective_to)>=asOf));
   const name=String(def?.name??profile?.name??key);
   const engine=String(def?.engine??profile?.engine??"UNAVAILABLE");
   const base={key,name,family:String(def?.family??"RESEARCH"),engine,enabled:def?.enabled===true,
     version:release?.version==null?null:String(release.version),rules:profile?.rules??(plugin?curatedRelease(plugin)?.summary:undefined)??null};
   if(engine==="RESEARCH_PENDING"||!profile&&!def)return {...base,status:"RESEARCH",reason:"Source rules or calculation engine not yet implemented."};
   if(!release)return {...base,status:"NO_RELEASE",reason:"No executable published version is installed."};
   try{
     assertCustomerPublishableEngine(String(release.engine_key));
     assertCuratedRules(key,String(release.engine_key),release.config,release.input_schema);
   }catch{
     return {...base,status:"NEEDS_REVIEW",reason:"Stored rules or engine do not match the code-reviewed version."};
   }
   const market=assessStrategyMarket(String(release.engine_key),
     (release.config??{}) as Record<string,unknown>,candidates,
     {country:"GB",wrapper:"ISA",currency:"GBP"},asOf);
   if(!market.supportedMarkets.length)return {...base,status:"NO_MARKET",reason:"A complete UK ISA instrument mapping is required before customer access."};
   return {...base,status:base.enabled?"ENABLED":"READY",reason:base.enabled?"Enabled. User-plan and exact trading eligibility controls remain enforced.":"Code rules match; enable when a complete trading-account mapping exists."};
 }) as CatalogEntry[];
 const published=versions.filter(v=>v.lifecycle_status==="PUBLISHED").length;
 return <div className="admin-strategy-workspace">
  <div className="page-title admin-page-head"><div><div className="eyebrow">PRODUCT / STRATEGY STUDIO</div>
    <h1>Strategy Studio</h1><p>Manage implemented strategies, global availability and instrument eligibility.</p></div>
    <Link href="/admin/strategies/research" className="button">Evidence library ↗</Link>
  </div>
  <AdminStrategyInventory entries={entries}/>
  <div className="admin-release-banner"><div><strong>{published} published version{published===1?"":"s"}</strong><p>Global availability depends on executable code and complete matching instruments, not an operator sign-off. Published rules are immutable.</p></div><Link href="/admin/instruments" className="button">Manage instruments →</Link></div>
  <details id="release-workflow" className="admin-advanced-workflow"><summary><span><strong>Release management</strong><small>Immutable versions and optional audit notes</small></span><span aria-hidden="true">⌄</span></summary>
    <div className="admin-advanced-content">
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Version releases"><table><thead><tr><th>Strategy</th><th>Version</th><th>Status</th><th>Approval</th><th>Effective</th><th>UUID</th></tr></thead><tbody>
      {versions.map(v=><tr key={String(v.version_id)}><td>{String(v.name)}</td><td>{String(v.version)}</td><td>{String(v.lifecycle_status)}</td><td>{v.attested?"Recorded":"Missing"}</td><td>{dateKey(v.effective_from)}</td><td><code>{String(v.version_id)}</code></td></tr>)}
      </tbody></table></div>
      <StrategyVersionManager/>
    </div>
  </details>
  <details className="admin-advanced-workflow"><summary><span><strong>Historical model data</strong><small>Advanced benchmark and canonical performance imports</small></span><span aria-hidden="true">⌄</span></summary><div className="admin-advanced-content"><ModelPerformanceEditor/></div></details>
 </div>;
}
