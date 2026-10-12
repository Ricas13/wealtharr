import { sql } from "@/lib/db";
import { PerformanceChart } from "@/components/PerformanceChart";

export default async function CommunityPage(){
  const strategies=await sql.unsafe(
    "SELECT d.id,d.name,d.key,d.description,v.id AS version_id,v.version FROM strategy_definitions d JOIN LATERAL (SELECT id,version FROM strategy_versions v WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED' AND v.effective_from<=current_date AND (v.effective_to IS NULL OR v.effective_to>=current_date) ORDER BY v.effective_from DESC,v.published_at DESC NULLS LAST LIMIT 1) v ON true WHERE d.enabled=true ORDER BY d.name"
  );
  const cards=[];
  for(const strategy of strategies){
    const aggregates=await sql.unsafe("SELECT metric_key,value,sample_size,as_of_date FROM anonymous_aggregates WHERE strategy_definition_id=$1 AND cohort_key='ALL' AND sample_size>=20 ORDER BY as_of_date DESC,metric_key",[strategy.id]);
    const model=await sql.unsafe("SELECT date,value,benchmark_value FROM canonical_model_performance WHERE strategy_version_id=$1 ORDER BY date",[strategy.version_id]);
    cards.push({strategy,aggregates,model:model.map((p:any)=>({date:String(p.date).slice(0,10),model:Number(p.value),benchmark:p.benchmark_value==null?undefined:Number(p.benchmark_value)}))});
  }
  return <><div className="page-title"><div><div className="eyebrow">Community / Strategies</div><h1>Compare the rules, not people.</h1><p>Canonical model series stay separate from privacy-qualified real-user aggregates.</p></div></div>
  <div className="strategy-grid">{cards.map(({strategy,aggregates,model}:any)=><section className="glass form-card" key={strategy.id}><div className="pill">{strategy.name} · v{strategy.version}</div><h2>{strategy.name}</h2><p className="help">{strategy.description}</p>{model.length?<PerformanceChart data={model}/>:<div className="empty">Canonical model history has not been loaded yet.</div>}
  <div className="strategy-meta">{aggregates.length?aggregates.slice(0,3).map((a:any)=><span className="pill good" key={a.metric_key}>{String(a.metric_key).replaceAll("_"," ")} · {Number(a.value).toFixed(2)} · n={a.sample_size}</span>):<span className="pill">Not enough publishable user data</span>}</div></section>)}</div></>;
}
