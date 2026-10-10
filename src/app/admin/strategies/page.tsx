import { sql } from "@/lib/db";
import { RESEARCH_STRATEGIES } from "@/domain/strategy/research-catalog";
import { CuratedStrategyToggle } from "@/components/CuratedStrategyToggle";
import { ModelPerformanceEditor, StrategyVersionManager } from "@/components/AdminEditors";

export default async function StrategiesAdmin() {
  const definitions = await sql.unsafe(
    "SELECT key,name,family,engine,enabled,proprietary FROM strategy_definitions ORDER BY name"
  );
  const versions = await sql.unsafe(
    "SELECT d.key,d.name,v.id AS version_id,v.version,v.engine_key,v.lifecycle_status,v.upgrade_policy,v.effective_from,v.effective_to,v.published_at "+
    "FROM strategy_versions v JOIN strategy_definitions d ON d.id=v.strategy_definition_id ORDER BY d.name,v.effective_from DESC,v.created_at DESC"
  );

  return <>
    <div className="page-title"><div>
      <div className="eyebrow">Admin · Strategies</div>
      <h1>Definitions & releases</h1>
      <p>Use only code-curated strategy identities. Release a strategy after its rules and complete regional instruments are verified.</p>
    </div></div>

    <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table>
      <thead><tr><th>Strategy</th><th>Family</th><th>Default engine</th><th>Enabled</th><th>Proprietary</th><th>Catalogue availability</th></tr></thead>
      <tbody>{definitions.map((s:any)=><tr key={s.key}><td>{s.name}</td><td>{s.family}</td><td>{s.engine}</td><td>{s.enabled?"Yes":"No"}</td><td>{s.proprietary?"Yes":"No"}</td><td><CuratedStrategyToggle strategyKey={String(s.key)} enabled={Boolean(s.enabled)} /></td></tr>)}</tbody>
    </table></div>

    <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table" style={{marginTop:16}}><table>
      <thead><tr><th>Strategy</th><th>Version</th><th>UUID</th><th>Engine snapshot</th><th>Status</th><th>Upgrade</th><th>Effective</th></tr></thead>
      <tbody>{versions.map((v:any)=><tr key={v.version_id}><td>{v.name}</td><td>{v.version}</td><td>{v.version_id}</td><td>{v.engine_key}</td><td>{v.lifecycle_status}</td><td>{v.upgrade_policy}</td><td>{String(v.effective_from).slice(0,10)}{v.effective_to?" → "+String(v.effective_to).slice(0,10):""}</td></tr>)}</tbody>
    </table></div>

    <section className="glass form-card" style={{marginTop:18}}><h2>Built-in research catalogue</h2><p className="help">Research entries are not available to customers. New strategies and new calculation methods must be reviewed in code; published versions need source sign-off and verified instrument coverage.</p><div className="table-wrap" tabIndex={0} role="region" aria-label="Curated strategy research catalogue"><table><thead><tr><th>Strategy</th><th>Engine</th><th>Research status</th><th>Source</th></tr></thead><tbody>{RESEARCH_STRATEGIES.map(profile=><tr key={profile.key}><td>{profile.name}</td><td>{profile.engine}</td><td>Requires verification</td><td><a href={profile.research[0]} target="_blank" rel="noopener noreferrer">Source</a></td></tr>)}</tbody></table></div></section>
    <div style={{marginTop:18}}><StrategyVersionManager/></div>
    <div style={{marginTop:18}}><ModelPerformanceEditor/></div>
  </>;
}
