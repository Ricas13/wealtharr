import "server-only";
import Decimal from "decimal.js";
import { sql } from "@/lib/db";
import { isAnnualisableSpan, xirr } from "@/domain/performance";

const PUBLIC_THRESHOLD=20;

function median(values:Decimal[]){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a.cmp(b));
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:sorted[middle-1].plus(sorted[middle]).div(2);
}

export async function rebuildAnonymousAggregates(asOf=new Date()){
  const runRows=await sql.unsafe("INSERT INTO worker_runs (worker_key,status,details) VALUES ('anonymous-aggregates','RUNNING','{}'::jsonb) RETURNING id");
  const runId=String(runRows[0].id);
  try{
    const definitions=await sql.unsafe("SELECT id FROM strategy_definitions ORDER BY id");
    let written=0;
    for(const definition of definitions){
      const strategyDefinitionId=String(definition.id);
      const instances=await sql.unsafe(
        "SELECT i.id,p.date,p.value FROM strategy_instances i JOIN users u ON u.id=i.user_id JOIN LATERAL ("+
        " SELECT date,value FROM performance_series ps WHERE ps.strategy_instance_id=i.id AND ps.series_type='USER_VALUE' ORDER BY date DESC LIMIT 1"+
        ") p ON true WHERE i.strategy_definition_id=$1 AND u.anonymous_aggregate_opt_in=true AND u.deleted_at IS NULL"+
        // A portfolio resumed from an opening snapshot has value the cash flows do not explain, so
        // its money-weighted return would be inflated; it is left out of this metric.
        " AND NOT EXISTS (SELECT 1 FROM ledger_events o WHERE o.strategy_instance_id=i.id AND o.event_type IN ('OPENING_CASH','OPENING_POSITION'))",
        [strategyDefinitionId]
      );

      const mwrr:Decimal[]=[];
      for(const instance of instances){
        const latestDate=String(instance.date).slice(0,10);
        const flows=await sql.unsafe(
          "SELECT l.occurred_at,l.event_type,l.cash_amount FROM ledger_events l WHERE l.strategy_instance_id=$1 AND l.event_type IN ('CONTRIBUTION','WITHDRAWAL') AND l.occurred_at::date<=$2::date AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=l.id) ORDER BY l.occurred_at,l.created_at",
          [instance.id,latestDate]
        );
        if(!flows.length)continue;
        const cashFlows=flows.map((flow)=>({
          at:new Date(flow.occurred_at),
          amount:new Decimal(String(flow.cash_amount)).neg()
        }));
        cashFlows.push({at:new Date(latestDate+"T23:59:59Z"),amount:new Decimal(String(instance.value))});
        // Only histories of at least a year are annualised into the community figure.
        if(!isAnnualisableSpan(cashFlows))continue;
        try{
          const result=xirr(cashFlows);
          if(result.isFinite()&&result.gt("-1")&&result.lt("1000"))mwrr.push(result);
        }catch{}
      }

      const actionRows=await sql.unsafe(
        "WITH eligible AS (SELECT i.id FROM strategy_instances i JOIN users u ON u.id=i.user_id WHERE i.strategy_definition_id=$1 AND u.anonymous_aggregate_opt_in=true AND u.deleted_at IS NULL)"+
        " SELECT count(*)::int AS tracked_instances,"+
        " (SELECT count(DISTINCT a.strategy_instance_id)::numeric/NULLIF((SELECT count(*) FROM eligible),0) FROM actions a JOIN eligible e ON e.id=a.strategy_instance_id WHERE a.status IN ('CALCULATED','NOTIFIED','ACKNOWLEDGED') AND a.action_type NOT IN ('NO_ACTION','HOLD')) AS action_required_pct"+
        " FROM eligible",
        [strategyDefinitionId]
      );
      const row=actionRows[0];
      const tracked=Number(row?.tracked_instances??0);
      const date=asOf.toISOString().slice(0,10);
      const metrics:Array<[string,number,string|null,Record<string,unknown>]>=[
        ["TRACKED_INSTANCES",tracked,String(tracked),{method:"eligible-instance-count"}]
      ];
      const med=median(mwrr);
      if(med)metrics.push(["MEDIAN_USER_XIRR",mwrr.length,med.toString(),{method:"median-per-instance-xirr",cashFlowAware:true,annualized:true}]);
      if(row?.action_required_pct!=null)metrics.push(["ACTION_REQUIRED_PCT",tracked,String(row.action_required_pct),{method:"derived-cohort-statistic"}]);

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
    return {written,publicThreshold:PUBLIC_THRESHOLD};
  }catch(error){
    await sql.unsafe("UPDATE worker_runs SET status='FAILED',finished_at=now(),details=$1::jsonb WHERE id=$2",[JSON.stringify({error:error instanceof Error?error.message:"unknown"}),runId]);
    throw error;
  }
}

export function publicAggregateThreshold(){return PUBLIC_THRESHOLD;}
