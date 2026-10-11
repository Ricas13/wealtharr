import { afterAll,describe,expect,it } from "vitest";
import postgres from "postgres";
import { createStrategy,changeStrategyStatus } from "@/lib/strategy-service";
import { enforceStrategyEntitlements,loadEntitlements } from "@/lib/entitlement-service";

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:1,prepare:false}):null;

// An ADMIN is an entitlement super-user (bypass only). Normal users must be unaffected.
describe.skipIf(!url)("admin entitlement super-user",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const users:string[]=[];
  const instruments:string[]=[];
  let lineInstalled=false;
  // One verified GB/ISA line for the whole file: trading_lines is unique on (exchange,ticker,effective_from)
  // and two equally-ranked EXACT mappings would make the resolver ambiguous (fail closed).
  async function installVerifiedLine(){
    if(lineInstalled)return;
    lineInstalled=true;
    const instrument=await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,direction,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'LONG','GBP') RETURNING id",["Admin entitlement test "+run]);
    const instrumentId=String(instrument[0].id);
    instruments.push(instrumentId);
    const line=await sql!.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) VALUES ($1,$2,'LSE','GBP','Europe/London','2026-01-01') RETURNING id",[instrumentId,"A"+run.toUpperCase()]);
    await sql!.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,direction,country,wrapper,trading_line_id,fidelity,effective_from,enabled) VALUES ('NASDAQ_100_3X_LONG',3,'LONG','GB','ISA',$1,'EXACT','2026-01-01',true)",[line[0].id]);
  }
  async function user(label:string,role:"USER"|"ADMIN",planSlug:"free"|"pro"){
    const rows=await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x',$2) RETURNING id",[`ae-${label}-${run}@example.test`,role]);
    const id=String(rows[0].id);
    users.push(id);
    const plan=await sql!.unsafe("SELECT id FROM plans WHERE slug=$1",[planSlug]);
    await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,$3,$4)",[id,plan[0].id,planSlug==="free"?"FREE":"ACTIVE",planSlug==="free"?"FREE":"MONTHLY"]);
    return id;
  }
  const input=(name:string)=>({strategyKey:"9sig",name,wrapper:"ISA",currency:"GBP",onboardingMode:"START_NEW" as const,startingCash:"100"});
  const statuses=async(id:string)=>(await sql!.unsafe("SELECT status FROM strategy_instances WHERE user_id=$1 ORDER BY created_at",[id])).map((r)=>String(r.status));

  afterAll(async()=>{
    if(!sql)return;
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])",[users]);
    if(instruments.length){
      await sql.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id IN (SELECT id FROM trading_lines WHERE instrument_id=ANY($1::uuid[]))",[instruments]);
      await sql.unsafe("DELETE FROM trading_lines WHERE instrument_id=ANY($1::uuid[])",[instruments]);
      await sql.unsafe("DELETE FROM instruments WHERE id=ANY($1::uuid[])",[instruments]);
    }
    await sql.end();
  });

  it("gives an admin on the Free plan every feature, every channel and no limits",async()=>{
    const admin=await user("snap","ADMIN","free");
    const snapshot=await loadEntitlements(admin);
    expect(snapshot.maxActiveStrategies).toBeNull();
    expect(snapshot.availableStrategyKeys).toBeNull();
    for(const feature of ["what_if","multi_account","analytics","advanced_imports"])expect(snapshot.features.has(feature)).toBe(true);
    for(const channel of ["EMAIL","DISCORD","TELEGRAM","IN_APP"])expect(snapshot.notificationChannels.has(channel)).toBe(true);
    // A normal Free user is unchanged.
    const normal=await user("snap-free","USER","free");
    const free=await loadEntitlements(normal);
    expect(free.maxActiveStrategies).toBe(1);
    expect(free.features.has("what_if")).toBe(false);
    expect(free.features.has("multi_account")).toBe(false);
    expect(free.notificationChannels.has("DISCORD")).toBe(false);
  });

  it("lets an admin on Free create several strategies and survive enforcement; a normal Free user is still blocked",async()=>{
    await installVerifiedLine();
    const admin=await user("create","ADMIN","free");
    await createStrategy(admin,"GB",input("Admin one"));
    await createStrategy(admin,"GB",input("Admin two"));
    await createStrategy(admin,"GB",input("Admin three"));
    expect(await statuses(admin)).toEqual(["ACTIVE","ACTIVE","ACTIVE"]);
    // A multi-account strategy (a plan feature) must not be paused for an admin either.
    const first=(await sql!.unsafe("SELECT id FROM strategy_instances WHERE user_id=$1 ORDER BY created_at LIMIT 1",[admin]))[0].id;
    const extra=await sql!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'Second','ISA','GB','GBP') RETURNING id",[admin]);
    await sql!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'SECONDARY')",[first,extra[0].id]);
    expect(await enforceStrategyEntitlements(admin)).toEqual({paused:0});
    expect(await statuses(admin)).toEqual(["ACTIVE","ACTIVE","ACTIVE"]);

    const normal=await user("create-free","USER","free");
    await createStrategy(normal,"GB",input("Free one"));
    await expect(createStrategy(normal,"GB",input("Free two"))).rejects.toThrow("PLAN_STRATEGY_LIMIT");
    expect(await statuses(normal)).toEqual(["ACTIVE"]);
  });

  it("still pauses a downgraded normal user's extras, and re-applies limits when an admin is demoted",async()=>{
    await installVerifiedLine();
    const downgraded=await user("down","USER","pro");
    await createStrategy(downgraded,"GB",input("Pro one"));
    await createStrategy(downgraded,"GB",input("Pro two"));
    await sql!.unsafe("UPDATE subscriptions SET plan_id=(SELECT id FROM plans WHERE slug='free'),status='FREE',cadence='FREE' WHERE user_id=$1",[downgraded]);
    expect(await enforceStrategyEntitlements(downgraded)).toEqual({paused:1});
    expect((await statuses(downgraded)).filter((s)=>s==="ACTIVE")).toHaveLength(1);

    const admin=await user("demote","ADMIN","free");
    await createStrategy(admin,"GB",input("Admin a"));
    await createStrategy(admin,"GB",input("Admin b"));
    expect(await enforceStrategyEntitlements(admin)).toEqual({paused:0});
    await sql!.unsafe("UPDATE users SET role='USER' WHERE id=$1",[admin]);
    expect(await enforceStrategyEntitlements(admin)).toEqual({paused:1});
    expect((await statuses(admin)).filter((s)=>s==="ACTIVE")).toHaveLength(1);
  });

  it("lets an admin reactivate a paused strategy past the Free limit",async()=>{
    await installVerifiedLine();
    const admin=await user("reactivate","ADMIN","free");
    const a=await createStrategy(admin,"GB",input("Admin x"));
    await createStrategy(admin,"GB",input("Admin y"));
    await changeStrategyStatus(admin,a,"PAUSED");
    await expect(changeStrategyStatus(admin,a,"ACTIVE")).resolves.toEqual({status:"ACTIVE"});
  });
});
