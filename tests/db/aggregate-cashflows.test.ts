import { afterAll,beforeAll,describe,expect,it } from "vitest";
import postgres from "postgres";
import { rebuildAnonymousAggregates } from "@/lib/aggregate-service";

// Community money-weighted return must only use cash flows that really happened, and only for
// portfolios whose value those flows fully explain.
const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:2,prepare:false}):null;

describe.skipIf(!url)("community XIRR inputs",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const key="agg-"+run;
  let definitionId="";
  const userIds:string[]=[];

  async function portfolio(label:string,events:Array<{type:string;amount:number;daysAgo:number}>){
    const users=await sql!.unsafe("INSERT INTO users (email,password_hash,anonymous_aggregate_opt_in) VALUES ($1,'x',true) RETURNING id",[`agg-${label}-${run}@example.test`]);
    const userId=String(users[0].id);
    userIds.push(userId);
    const versions=await sql!.unsafe("SELECT id FROM strategy_versions WHERE strategy_definition_id=$1 LIMIT 1",[definitionId]);
    const inst=await sql!.unsafe("INSERT INTO strategy_instances (user_id,strategy_definition_id,strategy_version_id,name) VALUES ($1,$2,$3,$4) RETURNING id",[userId,definitionId,versions[0].id,label]);
    const instanceId=String(inst[0].id);
    const ids:string[]=[];
    for(const e of events){
      const row=await sql!.unsafe(
        "INSERT INTO ledger_events (strategy_instance_id,occurred_at,event_type,currency,cash_amount) VALUES ($1,now()-($2::int*interval '1 day'),$3,'GBP',$4) RETURNING id",
        [instanceId,e.daysAgo,e.type,e.amount]
      );
      ids.push(String(row[0].id));
    }
    await sql!.unsafe("INSERT INTO performance_series (strategy_instance_id,series_type,date,value) VALUES ($1,'USER_VALUE',current_date,$2)",[instanceId,1100]);
    return {instanceId,ids};
  }
  const sampleSize=async()=>{
    await rebuildAnonymousAggregates();
    const rows=await sql!.unsafe("SELECT sample_size FROM anonymous_aggregates WHERE strategy_definition_id=$1 AND metric_key='MEDIAN_USER_XIRR' ORDER BY as_of_date DESC LIMIT 1",[definitionId]);
    return rows[0]?Number(rows[0].sample_size):0;
  };

  beforeAll(async()=>{
    const defs=await sql!.unsafe("INSERT INTO strategy_definitions (key,name,family,engine,enabled) VALUES ($1,'Aggregate test','SIGNAL_VALUE_TARGET','VALUE_TARGET',false) RETURNING id",[key]);
    definitionId=String(defs[0].id);
    await sql!.unsafe(
      "INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,input_schema,config) VALUES ($1,'1.0','2031-01-01','VALUE_TARGET','DRAFT','[]'::jsonb,'{}'::jsonb)",[definitionId]
    );
  });
  afterAll(async()=>{
    if(!sql)return;
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])",[userIds]);
    await sql.unsafe("DELETE FROM anonymous_aggregates WHERE strategy_definition_id=$1",[definitionId]);
    await sql.unsafe("DELETE FROM strategy_versions WHERE strategy_definition_id=$1",[definitionId]);
    await sql.unsafe("DELETE FROM strategy_definitions WHERE id=$1",[definitionId]);
    await sql.end();
  });

  it("counts an ordinary portfolio",async()=>{
    await portfolio("plain",[{type:"CONTRIBUTION",amount:1000,daysAgo:400}]);
    expect(await sampleSize()).toBe(1);
  });

  it("leaves out a portfolio with less than a year of history rather than annualising a few weeks",async()=>{
    await portfolio("short",[{type:"CONTRIBUTION",amount:1000,daysAgo:30}]);
    expect(await sampleSize()).toBe(1);
  });

  it("leaves out a resumed portfolio, whose opening value its cash flows do not explain",async()=>{
    await portfolio("resumed",[{type:"OPENING_CASH",amount:900,daysAgo:400},{type:"CONTRIBUTION",amount:900,daysAgo:300}]);
    expect(await sampleSize()).toBe(1);
  });

  it("ignores a contribution that was reversed by a correction",async()=>{
    const { instanceId,ids }=await portfolio("corrected",[{type:"CONTRIBUTION",amount:1000,daysAgo:400},{type:"CONTRIBUTION",amount:5000,daysAgo:350}]);
    await sql!.unsafe(
      "INSERT INTO ledger_events (strategy_instance_id,occurred_at,event_type,currency,cash_amount,correction_of_event_id) VALUES ($1,now(),'CORRECTION','GBP',-5000,$2)",[instanceId,ids[1]]
    );
    // The reversed 5,000 would otherwise make this portfolio look like a large loss, so assert on
    // the value as well as the count.
    expect(await sampleSize()).toBe(2);
    const median=await sql!.unsafe("SELECT value FROM anonymous_aggregates WHERE strategy_definition_id=$1 AND metric_key='MEDIAN_USER_XIRR' ORDER BY as_of_date DESC LIMIT 1",[definitionId]);
    // Both counted portfolios invested 1,000 about 400 days ago and are worth 1,100: 1.1^(365.25/400) = +9.1% a year.
    expect(Number(median[0].value)).toBeGreaterThan(0.08);
    expect(Number(median[0].value)).toBeLessThan(0.1);
  });
});
