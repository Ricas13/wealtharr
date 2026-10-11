import { afterAll,describe,expect,it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { createStrategy } from "@/lib/strategy-service";

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:1,prepare:false}):null;

describe.skipIf(!url)("strategy creation normalises currency",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const users:string[]=[];
  const createdInstruments:string[]=[];
  async function installVerifiedLine(){
    const instrument=await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,direction,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'LONG','GBP') RETURNING id",["Currency test "+run]);
    const instrumentId=String(instrument[0].id);
    createdInstruments.push(instrumentId);
    const line=await sql!.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) VALUES ($1,$2,'LSE','GBP','Europe/London','2026-01-01') RETURNING id",[instrumentId,"C"+run.toUpperCase()]);
    await sql!.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,direction,country,wrapper,trading_line_id,fidelity,effective_from,enabled) VALUES ('NASDAQ_100_3X_LONG',3,'LONG','GB','ISA',$1,'EXACT','2026-01-01',true)",[line[0].id]);
  }
  async function user(label:string){
    const rows=await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",[`cc-${label}-${run}@example.test`]);
    const id=String(rows[0].id);
    users.push(id);
    const plan=await sql!.unsafe("SELECT id FROM plans WHERE slug='pro'");
    await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'ACTIVE','MONTHLY')",[id,plan[0].id]);
    return id;
  }
  const input=(currency:string)=>({strategyKey:"9sig",name:"Currency case",wrapper:"ISA",currency,onboardingMode:"START_NEW" as const,startingCash:"100"});

  afterAll(async()=>{
    if(!sql)return;
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])",[users]);
    if(createdInstruments.length){
      await sql.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id IN (SELECT id FROM trading_lines WHERE instrument_id=ANY($1::uuid[]))",[createdInstruments]);
      await sql.unsafe("DELETE FROM trading_lines WHERE instrument_id=ANY($1::uuid[])",[createdInstruments]);
      await sql.unsafe("DELETE FROM instruments WHERE id=ANY($1::uuid[])",[createdInstruments]);
    }
    await sql.end();
  });

  it("stores a lower-case currency as upper-case on the account and the opening cash entry",async()=>{
    await installVerifiedLine();
    const id=await user("lower");
    const strategyId=await createStrategy(id,"GB",input("gbp"));
    const account=await sql!.unsafe("SELECT a.currency FROM strategy_instances i JOIN accounts a ON a.id=i.account_id WHERE i.id=$1",[strategyId]);
    expect(account[0].currency).toBe("GBP");
    const ledger=await sql!.unsafe("SELECT currency FROM ledger_events WHERE strategy_instance_id=$1",[strategyId]);
    expect(ledger.map((r)=>String(r.currency))).toEqual(["GBP"]);
  });

  it("rejects unsupported markets atomically without creating an account, strategy, or cash ledger",async()=>{
    const id=await user("unsupported");
    // AQ has no approved local exchange or account mapping in the curated catalogue.
    // A failure is not permission to substitute an unrelated US or UK ticker.
    await expect(createStrategy(id,"AQ",input("GBP"))).rejects.toMatchObject({
      code:"STRATEGY_MARKET_UNAVAILABLE"
    });
    const rows=await sql!.unsafe(
      "SELECT (SELECT count(*)::int FROM accounts WHERE user_id=$1) AS accounts,"+
      "(SELECT count(*)::int FROM strategy_instances WHERE user_id=$1) AS strategies,"+
      "(SELECT count(*)::int FROM ledger_events l JOIN strategy_instances i ON i.id=l.strategy_instance_id WHERE i.user_id=$1) AS ledger",
      [id]
    );
    expect(rows[0]).toMatchObject({accounts:0,strategies:0,ledger:0});
  });

  it("rejects something that is not a three-letter code",async()=>{
    const id=await user("bad");
    await expect(createStrategy(id,"GB",input("1$3"))).rejects.toThrow("INVALID_CURRENCY");
    const created=await sql!.unsafe("SELECT count(*)::int AS n FROM strategy_instances WHERE user_id=$1",[id]);
    expect(created[0].n).toBe(0);
  });

  it("serializes simultaneous onboarding retries into one account and one deposit",async()=>{
    const id=await user("retry");
    const request={...input("GBP"),requestKey:randomUUID()};
    const results=await Promise.all(Array.from({length:4},()=>createStrategy(id,"GB",request)));
    expect(new Set(results).size).toBe(1);
    const counts=(await sql!.unsafe(
      "SELECT (SELECT count(*)::int FROM accounts WHERE user_id=$1) AS accounts,"+
      "(SELECT count(*)::int FROM strategy_instances WHERE user_id=$1) AS strategies,"+
      "(SELECT count(*)::int FROM ledger_events WHERE strategy_instance_id=$2) AS deposits,"+
      "(SELECT sum(cash_amount)::text FROM ledger_events WHERE strategy_instance_id=$2) AS cash",
      [id,results[0]]
    ))[0];
    expect(counts).toMatchObject({accounts:1,strategies:1,deposits:1,cash:"100.00000000"});
    await expect(createStrategy(id,"GB",{...request,startingCash:"200"})).rejects.toThrow("STRATEGY_REQUEST_CONFLICT");
    // A response lost at the final free-plan slot can still be recovered.
    await sql!.unsafe("UPDATE subscriptions SET plan_id=(SELECT id FROM plans WHERE slug='free'),status='FREE' WHERE user_id=$1",[id]);
    expect(await createStrategy(id,"GB",request)).toBe(results[0]);
  });

  it("scopes request keys to the owner and rolls back failed attempts",async()=>{
    const request={...input("GBP"),requestKey:randomUUID()};
    const first=await user("owner-a"),second=await user("owner-b");
    await expect(createStrategy(first,"GB",{...request,startingCash:"-1"})).rejects.toThrow("INVALID_STARTING_CASH");
    expect(await sql!.unsafe("SELECT 1 FROM strategy_creation_requests WHERE user_id=$1",[first])).toHaveLength(0);
    const a=await createStrategy(first,"GB",request);
    const b=await createStrategy(second,"GB",request);
    expect(a).not.toBe(b);
    expect((await sql!.unsafe("SELECT count(*)::int AS n FROM accounts WHERE user_id=$1",[first]))[0].n).toBe(1);
  });

  it("does not seed resumed cash ahead of its opening snapshot or round starting cash",async()=>{
    const id=await user("resume-cash");
    await expect(createStrategy(id,"GB",{...input("GBP"),onboardingMode:"RESUME"})).rejects.toThrow("RESUME_CASH_REQUIRES_SNAPSHOT");
    await expect(createStrategy(id,"GB",{...input("GBP"),startingCash:"0.000000001"})).rejects.toThrow("INVALID_STARTING_CASH");
    expect((await sql!.unsafe("SELECT count(*)::int AS n FROM accounts WHERE user_id=$1",[id]))[0].n).toBe(0);
  });
});
