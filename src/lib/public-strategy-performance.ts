import {sql} from "@/lib/db";
import {STRATEGY_PLUGINS} from "@/domain/strategy/catalog";
import {isApprovedModelPoint,isApprovedSpyPoint,validatedObservations,type DatedValue,type PublicComparisonEntry} from "@/domain/public-strategy-comparison";

type VersionRow={key:string;version_id:string;enabled:boolean;engine_key:string};
type HistoricalRow={key:string;version_id:string;date:string;value:string;source:string;metadata:unknown};
type SpyRow={date:string;value:string;source:string;economic_exposure:string;metadata:unknown};

export type PublicHistoryResult={entries:PublicComparisonEntry[];spy:DatedValue[];asOf:string;
  spySource:string|null;ready:boolean};

/**
 * Only show admin-attested, rights-cleared, cash-flow-neutral TOTAL RETURN
 * model histories alongside an adjusted, licensed USD SPY series.
 * This public page never uses user portfolio or billing data.
 */
export async function loadPublicComparison():Promise<PublicHistoryResult>{
  const asOf=new Date().toISOString().slice(0,10);
  const versions=new Map<string,VersionRow>();
  const models=new Map<string,DatedValue[]>();
  let spy:DatedValue[]=[];
  let spySource:string|null=null;
  try{
    const [versionRows,historical,benchmark]=await Promise.all([
      sql.unsafe(
        "SELECT DISTINCT ON (d.key) d.key,v.id::text AS version_id,d.enabled,v.engine_key "+
        "FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id "+
        "WHERE v.lifecycle_status='PUBLISHED' AND v.effective_from<=current_date "+
        "AND (v.effective_to IS NULL OR v.effective_to>=current_date) "+
        "ORDER BY d.key,v.effective_from DESC,v.published_at DESC NULLS LAST"
      ) as Promise<VersionRow[]>,
      sql.unsafe(
        "SELECT d.key,v.id::text AS version_id,m.date::text,m.value::text,m.source,m.metadata "+
        "FROM canonical_model_performance m "+
        "JOIN strategy_versions v ON v.id=m.strategy_version_id "+
        "JOIN strategy_definitions d ON d.id=v.strategy_definition_id "+
        "WHERE d.enabled=true AND v.lifecycle_status='PUBLISHED' "+
        "AND v.effective_from<=current_date AND (v.effective_to IS NULL OR v.effective_to>=current_date) "+
        "AND m.source='PUBLIC_VERIFIED_TOTAL_RETURN' "+
        "AND m.date>=current_date-interval '6 years' AND m.date<=current_date "+
        "ORDER BY d.key,m.date LIMIT 100001"
      ) as Promise<HistoricalRow[]>,
      sql.unsafe(
        "SELECT bp.date::text,bp.value::text,bp.source,b.economic_exposure,bp.metadata "+
        "FROM benchmark_performance bp JOIN benchmarks b ON b.id=bp.benchmark_id "+
        "WHERE b.key='SPY' AND bp.date>=current_date-interval '6 years' "+
        "AND bp.date<=current_date ORDER BY bp.date LIMIT 5001"
      ) as Promise<SpyRow[]>
    ]);
    for(const row of versionRows)versions.set(row.key,row);
    if(benchmark.length>=2&&benchmark.length<=5000&&
      benchmark.every(row=>isApprovedSpyPoint(row.economic_exposure,row.metadata))){
      spy=validatedObservations(benchmark.map(row=>({date:row.date,value:row.value})));
      if(spy.length!==benchmark.length)spy=[];
      if(spy.length)spySource=String((benchmark[0].metadata as {provider?:string}).provider??"");
    }
    // Reject a truncated result, and require ALL observations of any shown
    // strategy to carry the signed public publication metadata.
    if(historical.length<=100000){
      const grouped=new Map<string,HistoricalRow[]>();
      for(const row of historical){
        if(row.version_id!==versions.get(row.key)?.version_id)continue;
        const group=grouped.get(row.key)??[];
        group.push(row);grouped.set(row.key,group);
      }
      for(const [key,rows] of grouped){
        const approved=rows.every(row=>isApprovedModelPoint(row.source,row.metadata));
        const points=approved?validatedObservations(rows.map(row=>({date:row.date,value:row.value}))):[];
        if(points.length===rows.length&&points.length>=2)models.set(key,points);
      }
    }
  }catch{
    // DB unavailable: still show the complete public strategy catalogue,
    // but never publish made-up performance or claim SPY is live.
  }
  // Hide the proprietary legacy implementation key from public marketing.
  // The newer owner-labelled Nasdaq strategy remains visible.
  const entries=STRATEGY_PLUGINS.filter(plugin=>plugin.key!=="9sig").map(plugin=>{
    const release=versions.get(plugin.key);
    const series=release?.enabled?models.get(plugin.key)??[]:[];
    const available=series.length>=2&&spy.length>=2;
    const engine=plugin.profile?.engine??plugin.seedDefinition?.engine??"RESEARCH_PENDING";
    const family=engine==="FIXED_ALLOCATION"?"Fixed allocation":
      engine==="QUARTERLY_SIGNAL_TARGET"?"Quarterly target":
      engine==="TACTICAL_ALLOCATION"?"Tactical / momentum":
      engine==="TRINITY_HYBRID"?"Hybrid":
      engine==="VALUE_TARGET"?"Value target":"Research";
    return {key:plugin.key,
      name:String(plugin.seedDefinition?.name??plugin.profile?.name??plugin.key),
      family,available,
      reason:!release?.enabled?"Not published for customers":
        !series.length?"No approved strategy history":
        !spy.length?"Licensed SPY history unavailable":"Available history",
      observations:series};
  });
  return {entries,spy,asOf,spySource,ready:spy.length>=2};
}
