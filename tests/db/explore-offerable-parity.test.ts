import { afterAll,describe,expect,it } from "vitest";
import postgres from "postgres";
import { createStrategy,listAvailableStrategies } from "@/lib/strategy-service";
import { VERIFIED_MARKET_MAPPINGS_SQL,verifiedCandidates } from "@/lib/verified-market-mappings";
import { isOfferableForUser } from "@/domain/explore-catalogue";

// Explore / the add-strategy list must offer exactly what createStrategy would accept for the same
// country, wrapper, currency and broker.
const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:1,prepare:false}):null;

describe.skipIf(!url)("isOfferableForUser agrees with createStrategy",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const users:string[]=[];
  const instruments:string[]=[];
  async function installLine(country:string,wrapper:string,currency:string,broker:string|null){
    const instrument=await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,direction,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'LONG',$2) RETURNING id",["Parity "+run+country+wrapper,currency]);
    const instrumentId=String(instrument[0].id);
    instruments.push(instrumentId);
    const line=await sql!.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) VALUES ($1,$2,'LSE',$3,'Europe/London','2026-01-01') RETURNING id",[instrumentId,"P"+run.toUpperCase()+country+wrapper,currency]);
    await sql!.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,direction,country,wrapper,broker,trading_line_id,fidelity,effective_from,enabled) VALUES ('NASDAQ_100_3X_LONG',3,'LONG',$1,$2,$3,$4,'EXACT','2026-01-01',true)",[country,wrapper,broker,line[0].id]);
  }
  async function newUser(label:string){
    const rows=await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",[`par-${label}-${run}@example.test`]);
    const id=String(rows[0].id);
    users.push(id);
    const plan=await sql!.unsafe("SELECT id FROM plans WHERE slug='pro'");
    await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'ACTIVE','MONTHLY')",[id,plan[0].id]);
    return id;
  }
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

  it("matches createStrategy for own market, wrapper, currency and broker combinations",async()=>{
    await installLine("GB","ISA","GBP",null);
    await installLine("US","TAXABLE","USD","Special Broker");
    const release:any=(await listAvailableStrategies()).find((row:any)=>row.key==="9sig");
    expect(release).toBeTruthy();
    const mappings=verifiedCandidates(await sql!.unsafe(VERIFIED_MARKET_MAPPINGS_SQL));
    const asOf=new Date().toISOString().slice(0,10);
    const cases=[
      {country:"GB",wrapper:"ISA",currency:"GBP",broker:null},
      {country:"GB",wrapper:"ISA",currency:"USD",broker:null},
      {country:"GB",wrapper:"TAXABLE",currency:"GBP",broker:null},
      {country:"US",wrapper:"TAXABLE",currency:"USD",broker:null},
      {country:"US",wrapper:"TAXABLE",currency:"USD",broker:"Special Broker"},
      {country:"US",wrapper:"TAXABLE",currency:"USD",broker:"Other Broker"}
    ];
    const outcomes:Array<{case:typeof cases[number];offerable:boolean;created:boolean}>=[];
    for(const [index,choice] of cases.entries()){
      const offerable=isOfferableForUser({
        strategy:{
          engine:String(release.engine_key),config:(release.config??{}) as Record<string,unknown>,
          supportedRegions:Array.isArray(release.supported_regions)?release.supported_regions.map(String):[],
          supportedWrappers:Array.isArray(release.supported_wrappers)?release.supported_wrappers.map(String):[]
        },
        userMarket:{country:choice.country,currency:choice.currency,broker:choice.broker,wrapper:choice.wrapper},
        mappings,asOf
      }).offerable;
      const userId=await newUser("c"+index);
      let created=false;
      try{
        await createStrategy(userId,choice.country,{
          strategyKey:"9sig",name:"Parity "+index,wrapper:choice.wrapper,currency:choice.currency,broker:choice.broker,
          onboardingMode:"START_NEW" as const,startingCash:"100"
        });
        created=true;
      }catch{created=false;}
      outcomes.push({case:choice,offerable,created});
    }
    for(const outcome of outcomes)expect(outcome.offerable,JSON.stringify(outcome.case)).toBe(outcome.created);
    expect(outcomes[0].offerable).toBe(true);
    // Another currency never matches the GBP-listed line.
    expect(outcomes[1].offerable).toBe(false);
  });
});
