import "server-only";
import Decimal from "decimal.js";
import { sql } from "@/lib/db";
import { isAnnualisableSpan, xirr } from "@/domain/performance";
import { EXECUTABLE_ACTION_STATUS_SQL } from "@/domain/actions";
import { safeErrorCode } from "@/lib/safe-error-code";

const PUBLIC_THRESHOLD=20;
// Instances whose cash flows are loaded per query. Bounds memory and keeps each statement short so the
// deadline is honoured between chunks.
const FLOW_CHUNK=500;

function median(values:Decimal[]){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a.cmp(b));
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:sorted[middle-1].plus(sorted[middle]).div(2);
}

/**
 * Rebuilds the anonymous community statistics. The queries are set-based (one for the cohort counts,
 * one for the latest values, one per chunk of instances for cash flows) rather than one per strategy
 * and instance, and `options.deadline` (epoch ms) stops the run between chunks. A run that is stopped
 * writes nothing: a median over some of the instances would be a wrong number, and the previous
 * day's rows stay in place. It is recorded PARTIAL so the next run retries it.
 */
export async function rebuildAnonymousAggregates(asOf=new Date(),options:{deadline?:number}={}){
  const runRows=await sql.unsafe("INSERT INTO worker_runs (worker_key,status,details) VALUES ('anonymous-aggregates','RUNNING','{}'::jsonb) RETURNING id");
  const runId=String(runRows[0].id);
  const deadline=options.deadline??Infinity;
  try{
    // Cohort size and the share needing action, for every definition (including empty ones).
    const cohorts=await sql.unsafe(
      "SELECT d.id AS definition_id,count(e.id)::int AS tracked_instances,"+
      " (count(DISTINCT e.id) FILTER (WHERE EXISTS (SELECT 1 FROM actions a WHERE a.strategy_instance_id=e.id AND a.status IN ("+EXECUTABLE_ACTION_STATUS_SQL+") AND a.action_type NOT IN ('NO_ACTION','HOLD'))))::numeric/NULLIF(count(e.id),0) AS action_required_pct"+
      " FROM strategy_definitions d LEFT JOIN ("+
      "  SELECT i.id,i.strategy_definition_id FROM strategy_instances i JOIN users u ON u.id=i.user_id WHERE u.anonymous_aggregate_opt_in=true AND u.deleted_at IS NULL"+
      " ) e ON e.strategy_definition_id=d.id GROUP BY d.id ORDER BY d.id"
    );

    // Latest portfolio value of every eligible instance. A portfolio resumed from an opening snapshot has
    // value the cash flows do not explain, so its money-weighted return would be inflated; it is left out
    // of this metric.
    const latest=await sql.unsafe(
      "SELECT i.id,i.strategy_definition_id,p.date,p.value FROM strategy_instances i JOIN users u ON u.id=i.user_id JOIN LATERAL ("+
      " SELECT date,value FROM performance_series ps WHERE ps.strategy_instance_id=i.id AND ps.series_type='USER_VALUE' ORDER BY date DESC LIMIT 1"+
      ") p ON true WHERE u.anonymous_aggregate_opt_in=true AND u.deleted_at IS NULL"+
      " AND NOT EXISTS (SELECT 1 FROM ledger_events o WHERE o.strategy_instance_id=i.id AND o.event_type IN ('OPENING_CASH','OPENING_POSITION'))"+
      " ORDER BY i.id"
    );

    const mwrrByDefinition=new Map<string,Decimal[]>();
    for(let start=0;start<latest.length;start+=FLOW_CHUNK){
      if(Date.now()>=deadline){
        await sql.unsafe("UPDATE worker_runs SET status='PARTIAL',finished_at=now(),details=$1::jsonb WHERE id=$2",[JSON.stringify({partial:true,written:0,publicThreshold:PUBLIC_THRESHOLD}),runId]);
        return {written:0,publicThreshold:PUBLIC_THRESHOLD,partial:true};
      }
      const chunk=latest.slice(start,start+FLOW_CHUNK);
      const dates=chunk.map((instance)=>String(instance.date).slice(0,10));
      const flowRows=await sql.unsafe(
        "SELECT l.strategy_instance_id,l.occurred_at,l.cash_amount FROM ledger_events l"+
        " JOIN jsonb_to_recordset($1::jsonb) AS x(id uuid,latest_date date) ON x.id=l.strategy_instance_id"+
        " WHERE l.event_type IN ('CONTRIBUTION','WITHDRAWAL') AND l.occurred_at::date<=x.latest_date"+
        " AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=l.id)"+
        " ORDER BY l.strategy_instance_id,l.occurred_at,l.created_at",
        [JSON.stringify(chunk.map((instance,i)=>({id:String(instance.id),latest_date:dates[i]})))]
      );
      const flowsByInstance=new Map<string,Array<{at:Date;amount:Decimal}>>();
      for(const flow of flowRows){
        const key=String(flow.strategy_instance_id);
        const list=flowsByInstance.get(key)??[];
        list.push({at:new Date(flow.occurred_at),amount:new Decimal(String(flow.cash_amount)).neg()});
        flowsByInstance.set(key,list);
      }
      chunk.forEach((instance,offset)=>{
        const cashFlows=flowsByInstance.get(String(instance.id));
        if(!cashFlows?.length)return;
        cashFlows.push({at:new Date(dates[offset]+"T23:59:59Z"),amount:new Decimal(String(instance.value))});
        // Only histories of at least a year are annualised into the community figure.
        if(!isAnnualisableSpan(cashFlows))return;
        try{
          const result=xirr(cashFlows);
          if(result.isFinite()&&result.gt("-1")&&result.lt("1000")){
            const key=String(instance.strategy_definition_id);
            const list=mwrrByDefinition.get(key)??[];
            list.push(result);
            mwrrByDefinition.set(key,list);
          }
        }catch{}
      });
    }

    let written=0;
    const date=asOf.toISOString().slice(0,10);
    for(const row of cohorts){
      const strategyDefinitionId=String(row.definition_id);
      const tracked=Number(row.tracked_instances??0);
      const mwrr=mwrrByDefinition.get(strategyDefinitionId)??[];
      const metrics:Array<[string,number,string|null,Record<string,unknown>]>=[
        ["TRACKED_INSTANCES",tracked,String(tracked),{method:"eligible-instance-count"}]
      ];
      const med=median(mwrr);
      if(med)metrics.push(["MEDIAN_USER_XIRR",mwrr.length,med.toString(),{method:"median-per-instance-xirr",cashFlowAware:true,annualized:true}]);
      if(row.action_required_pct!=null)metrics.push(["ACTION_REQUIRED_PCT",tracked,String(row.action_required_pct),{method:"derived-cohort-statistic"}]);

      for(const [metricKey,sampleSize,value,method] of metrics){
        if(value==null)continue;
        await sql.unsafe(
          "INSERT INTO anonymous_aggregates (strategy_definition_id,cohort_key,metric_key,as_of_date,sample_size,value,metadata) VALUES ($1,'ALL',$2,$3,$4,$5,$6::jsonb)"+
          " ON CONFLICT (strategy_definition_id,cohort_key,metric_key,as_of_date) DO UPDATE SET sample_size=EXCLUDED.sample_size,value=EXCLUDED.value,metadata=EXCLUDED.metadata",
          [strategyDefinitionId,metricKey,date,sampleSize,value,JSON.stringify({publicThreshold:PUBLIC_THRESHOLD,...method})]
        );
        written+=1;
      }
    }
    await sql.unsafe("UPDATE worker_runs SET status='SUCCESS',finished_at=now(),details=$1::jsonb WHERE id=$2",[JSON.stringify({written,publicThreshold:PUBLIC_THRESHOLD}),runId]);
    return {written,publicThreshold:PUBLIC_THRESHOLD,partial:false};
  }catch(error){
    // Driver and database messages can carry hosts, queries or identifiers: store only a safe code.
    await sql.unsafe("UPDATE worker_runs SET status='FAILED',finished_at=now(),details=$1::jsonb WHERE id=$2",[JSON.stringify({error:safeErrorCode(error)}),runId]);
    throw error;
  }
}

export function publicAggregateThreshold(){return PUBLIC_THRESHOLD;}
