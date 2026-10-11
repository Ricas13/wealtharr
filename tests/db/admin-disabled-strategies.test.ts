import { afterAll,beforeAll,describe,expect,it } from "vitest";
import postgres from "postgres";
import { changeStrategyStatus,createStrategy,listAvailableStrategies } from "@/lib/strategy-service";
import { switchStrategy } from "@/lib/strategy-switch-service";
import { enforceStrategyEntitlements } from "@/lib/entitlement-service";

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:1,prepare:false}):null;

// An ADMIN may start a disabled-but-PUBLISHED strategy to test it; customers never can.
describe.skipIf(!url)("admin may start disabled strategies; customers may not",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const config={targetExposure:"NASDAQ_100_3X_LONG",reviewFrequency:"QUARTERLY",targetRate:"0.09",
    initialTargetRatio:"0.60",contributionTargetRatio:"0.50",tolerance:"0.01"};
  const users:string[]=[];
  const definitions:string[]=[];
  const instruments:string[]=[];
  const keys={published:"adm-dis-pub-"+run,draft:"adm-dis-draft-"+run,customer:"adm-dis-cust-"+run};
  const ids={published:"",draft:"",customer:""};

  async function definition(key:string,enabled:boolean,lifecycle:"PUBLISHED"|"DRAFT"){
    const rows=await sql!.unsafe(
      "INSERT INTO strategy_definitions (key,name,family,engine,enabled) VALUES ($1,$2,'SIGNAL_VALUE_TARGET','VALUE_TARGET',$3) RETURNING id",
      [key,"Admin disabled test "+key,enabled]
    );
    const id=String(rows[0].id);
    definitions.push(id);
    await sql!.unsafe(
      "INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,input_schema,config) "+
      "VALUES ($1,'1.0','2026-01-01','VALUE_TARGET',$2,'[]'::jsonb,$3::text::jsonb)",
      [id,lifecycle,JSON.stringify(config)]
    );
    return id;
  }
  async function user(label:string,role:"USER"|"ADMIN"){
    const rows=await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x',$2) RETURNING id",[`ads-${label}-${run}@example.test`,role]);
    const id=String(rows[0].id);
    users.push(id);
    const plan=await sql!.unsafe("SELECT id FROM plans WHERE slug='pro'");
    await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'ACTIVE','MONTHLY')",[id,plan[0].id]);
    return id;
  }
  const input=(strategyKey:string,name:string)=>({strategyKey,name,wrapper:"ISA",currency:"GBP",onboardingMode:"START_NEW" as const,startingCash:"100"});
  const status=async(instanceId:string)=>String((await sql!.unsafe("SELECT status FROM strategy_instances WHERE id=$1",[instanceId]))[0].status);

  beforeAll(async()=>{
    // One verified GB/ISA line for the whole file: trading_lines is unique on (exchange,ticker,effective_from)
    // and two equally-ranked EXACT mappings would make the resolver ambiguous (fail closed).
    const instrument=await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,direction,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'LONG','GBP') RETURNING id",["Admin disabled test "+run]);
    const instrumentId=String(instrument[0].id);
    instruments.push(instrumentId);
    const line=await sql!.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) VALUES ($1,$2,'LSE','GBP','Europe/London','2026-01-01') RETURNING id",[instrumentId,"D"+run.toUpperCase()]);
    await sql!.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,direction,country,wrapper,trading_line_id,fidelity,effective_from,enabled) VALUES ('NASDAQ_100_3X_LONG',3,'LONG','GB','ISA',$1,'EXACT','2026-01-01',true)",[line[0].id]);
    ids.published=await definition(keys.published,false,"PUBLISHED");
    ids.draft=await definition(keys.draft,false,"DRAFT");
    ids.customer=await definition(keys.customer,true,"PUBLISHED");
  });

  afterAll(async()=>{
    if(!sql)return;
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])",[users]);
    if(definitions.length){
      await sql.unsafe("DELETE FROM strategy_versions WHERE strategy_definition_id=ANY($1::uuid[])",[definitions]);
      await sql.unsafe("DELETE FROM strategy_definitions WHERE id=ANY($1::uuid[])",[definitions]);
    }
    if(instruments.length){
      await sql.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id IN (SELECT id FROM trading_lines WHERE instrument_id=ANY($1::uuid[]))",[instruments]);
      await sql.unsafe("DELETE FROM trading_lines WHERE instrument_id=ANY($1::uuid[])",[instruments]);
      await sql.unsafe("DELETE FROM instruments WHERE id=ANY($1::uuid[])",[instruments]);
    }
    await sql.end();
  });

  it("lists a disabled published strategy only when includeDisabled is requested",async()=>{
    const without=(await listAvailableStrategies()).map((r)=>String(r.key));
    expect(without).not.toContain(keys.published);
    const withDisabled=await listAvailableStrategies({includeDisabled:true});
    const row=withDisabled.find((r)=>String(r.key)===keys.published);
    expect(row).toBeTruthy();
    expect(row!.enabled).toBe(false);
    // A definition with only a DRAFT version is never listed, even for includeDisabled.
    expect(withDisabled.map((r)=>String(r.key))).not.toContain(keys.draft);
  });

  it("lets an admin create on a disabled definition with a PUBLISHED version, pinned to that version and flagged",async()=>{
    const admin=await user("create","ADMIN");
    const instanceId=await createStrategy(admin,"GB",input(keys.published,"Admin preview"));
    const rows=await sql!.unsafe(
      "SELECT i.admin_disabled_preview,i.strategy_version_id,v.lifecycle_status FROM strategy_instances i JOIN strategy_versions v ON v.id=i.strategy_version_id WHERE i.id=$1",[instanceId]);
    expect(rows[0].admin_disabled_preview).toBe(true);
    expect(String(rows[0].lifecycle_status)).toBe("PUBLISHED");
    // A normal strategy started by an admin is not flagged.
    const normalId=await createStrategy(admin,"GB",input(keys.customer,"Admin normal"));
    const normal=await sql!.unsafe("SELECT admin_disabled_preview FROM strategy_instances WHERE id=$1",[normalId]);
    expect(normal[0].admin_disabled_preview).toBe(false);
  });

  it("refuses a normal user on a disabled definition and leaves nothing behind",async()=>{
    const customer=await user("customer-refused","USER");
    await expect(createStrategy(customer,"GB",input(keys.published,"Nope"))).rejects.toThrow("STRATEGY_NOT_AVAILABLE");
    const counts=await sql!.unsafe("SELECT (SELECT count(*)::int FROM strategy_instances WHERE user_id=$1) AS instances,(SELECT count(*)::int FROM accounts WHERE user_id=$1) AS accounts",[customer]);
    expect(counts[0]).toMatchObject({instances:0,accounts:0});
  });

  it("refuses a definition that only has a DRAFT version, for admin and customer alike",async()=>{
    const admin=await user("draft-admin","ADMIN");
    const customer=await user("draft-customer","USER");
    await expect(createStrategy(admin,"GB",input(keys.draft,"Draft admin"))).rejects.toThrow("STRATEGY_NOT_AVAILABLE");
    await expect(createStrategy(customer,"GB",input(keys.draft,"Draft customer"))).rejects.toThrow("STRATEGY_NOT_AVAILABLE");
  });

  it("still applies the market availability check for an admin",async()=>{
    const admin=await user("market","ADMIN");
    // AQ has no approved local exchange or account mapping.
    await expect(createStrategy(admin,"AQ",input(keys.published,"No market"))).rejects.toMatchObject({code:"STRATEGY_MARKET_UNAVAILABLE"});
    const rows=await sql!.unsafe("SELECT count(*)::int AS n FROM strategy_instances WHERE user_id=$1",[admin]);
    expect(rows[0].n).toBe(0);
  });

  it("does not let a normal user switch to a disabled strategy",async()=>{
    const customer=await user("switch","USER");
    const current=await createStrategy(customer,"GB",input(keys.customer,"Customer current"));
    await expect(switchStrategy(customer,current,{targetStrategyKey:keys.published})).rejects.toThrow("STRATEGY_NOT_AVAILABLE");
    expect(await status(current)).toBe("ACTIVE");
  });

  it("pauses a demoted admin's preview instance, blocks reactivation, and leaves a customer's later-disabled strategy running",async()=>{
    const demoted=await user("demoted","ADMIN");
    const preview=await createStrategy(demoted,"GB",input(keys.published,"Preview to demote"));
    expect(await enforceStrategyEntitlements(demoted)).toEqual({paused:0});
    expect(await status(preview)).toBe("ACTIVE");
    await sql!.unsafe("UPDATE users SET role='USER' WHERE id=$1",[demoted]);
    expect(await enforceStrategyEntitlements(demoted)).toEqual({paused:1});
    expect(await status(preview)).toBe("PAUSED");
    await expect(changeStrategyStatus(demoted,preview,"ACTIVE")).rejects.toThrow("STRATEGY_NOT_AVAILABLE");

    // A customer who legitimately started a strategy that the operator disabled later keeps running.
    const customer=await user("legit","USER");
    const own=await createStrategy(customer,"GB",input(keys.customer,"Legit customer"));
    await sql!.unsafe("UPDATE strategy_definitions SET enabled=false WHERE id=$1",[ids.customer]);
    try{
      expect(await enforceStrategyEntitlements(customer)).toEqual({paused:0});
      expect(await status(own)).toBe("ACTIVE");
    }finally{
      await sql!.unsafe("UPDATE strategy_definitions SET enabled=true WHERE id=$1",[ids.customer]);
    }
  });

  it("does not pause a demoted admin's instance once the definition is enabled for everyone",async()=>{
    const admin=await user("enabled-later","ADMIN");
    const preview=await createStrategy(admin,"GB",input(keys.published,"Preview then enabled"));
    await sql!.unsafe("UPDATE strategy_definitions SET enabled=true WHERE id=$1",[ids.published]);
    try{
      await sql!.unsafe("UPDATE users SET role='USER' WHERE id=$1",[admin]);
      expect(await enforceStrategyEntitlements(admin)).toEqual({paused:0});
      expect(await status(preview)).toBe("ACTIVE");
    }finally{
      await sql!.unsafe("UPDATE strategy_definitions SET enabled=false WHERE id=$1",[ids.published]);
    }
  });
});
