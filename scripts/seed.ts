import { RESEARCH_STRATEGIES } from "../src/domain/strategy/research-catalog";
import {CANONICAL_9SIG_CONFIG} from "../src/domain/strategy/curated-release";
import postgres from "postgres";

async function main(){
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error("DATABASE_URL is required");
  const sql=postgres(url,{max:1,prepare:false});
  try{
    // Seed missing initial defaults only. Every existing plan, price, instrument, strategy release
    // and operator change belongs to Master Admin, not to the deployment script.
    async function seedPlan(slug:string,name:string,monthly:number,annual:number,discountBps:number,max:number|null,entitlements:object,sort:number){
      const query="INSERT INTO plans (slug,display_name,description,monthly_price_minor,annual_price_minor,annual_discount_bps,billing_currency,supported_billing_currencies,max_active_strategies,entitlements,sort_order) VALUES ($1,$2,$3,$4,$5,$6,'GBP','[\"GBP\"]'::jsonb,$7,$8::text::jsonb,$9) ON CONFLICT (slug) DO NOTHING";
      const rows=await sql.unsafe(query,[slug,name,name+" plan",monthly,annual,discountBps,max,JSON.stringify(entitlements),sort]);
      const id=rows[0]?.id??(await sql.unsafe("SELECT id FROM plans WHERE slug=$1",[slug]))[0]?.id;
      if(!id)throw new Error("PLAN_SEED_LOOKUP_FAILED:"+slug);
      if(monthly>0)await sql.unsafe("INSERT INTO plan_prices (plan_id,currency,cadence,amount_minor,active) VALUES ($1,'GBP','MONTHLY',$2,true) ON CONFLICT (plan_id,currency,cadence) DO NOTHING",[id,monthly]);
      if(annual>0)await sql.unsafe("INSERT INTO plan_prices (plan_id,currency,cadence,amount_minor,active) VALUES ($1,'GBP','ANNUAL',$2,true) ON CONFLICT (plan_id,currency,cadence) DO NOTHING",[id,annual]);
    }

    await seedPlan("free","Free",0,0,0,1,{features:["history","reconciliation","resume","community"],notificationChannels:[]},0);
    await seedPlan("investor","Investor",999,9900,1742,3,{features:["history","reconciliation","resume","community","analytics","comparisons"],notificationChannels:["EMAIL","DISCORD","TELEGRAM"]},10);
    await seedPlan("pro","Pro",2999,29900,1692,null,{features:["history","reconciliation","resume","community","analytics","comparisons","what_if","advanced_imports","multi_account"],notificationChannels:["EMAIL","DISCORD","TELEGRAM"]},20);

    const definitions=[
      ["9sig","9Sig","SIGNAL_VALUE_TARGET","Rules-based value target strategy","VALUE_TARGET",true,true],
      ["hfea","HFEA","FIXED_ALLOCATION","Leveraged fixed-allocation strategy","FIXED_ALLOCATION",false,false],
      ["golden-butterfly","Golden Butterfly","FIXED_ALLOCATION","Diversified fixed-allocation strategy","FIXED_ALLOCATION",false,false],
      ["three-fund","Three-Fund Portfolio — 40/40/20 model","FIXED_ALLOCATION","Named fixed-allocation strategy","FIXED_ALLOCATION",false,false],
      ["60-40","60/40 Portfolio","FIXED_ALLOCATION","Named fixed-allocation strategy","FIXED_ALLOCATION",false,false],
      ["80-20","80/20 Portfolio","FIXED_ALLOCATION","Named fixed-allocation strategy","FIXED_ALLOCATION",false,false],
      ["permanent-portfolio","Permanent Portfolio","FIXED_ALLOCATION","Four equal asset sleeves","FIXED_ALLOCATION",false,false],
      ["all-weather","All Weather (reference)","FIXED_ALLOCATION","Published unlevered reference approximation","FIXED_ALLOCATION",false,false],
      ["buffett-90-10","Buffett 90/10 Portfolio","FIXED_ALLOCATION","Fixed 90/10 reference model","FIXED_ALLOCATION",false,false],
      ["coffeehouse","Coffeehouse Portfolio — US seven-fund reference","FIXED_ALLOCATION","Research-only seven-asset profile","FIXED_ALLOCATION",false,false],
      ["core-four","Four-Fund Stocks/Bonds/REIT Reference","FIXED_ALLOCATION","Research-only four-asset profile; source name requires brand licensing","FIXED_ALLOCATION",false,false],
      ["swensen","Swensen Lazy Portfolio — US reference","FIXED_ALLOCATION","Research-only six-asset profile","FIXED_ALLOCATION",false,false],
      ["gtaa-ivy","GTAA / Ivy","MOMENTUM","Research pending","MOMENTUM_ROTATION",false,false],
      ["paa","Protective Asset Allocation","MOMENTUM","Research pending","MOMENTUM_ROTATION",false,false],
      ["vaa","Vigilant Asset Allocation","MOMENTUM","Research pending","MOMENTUM_ROTATION",false,false],
      ["dual-momentum","Dual Momentum","MOMENTUM","Momentum rotation strategy","MOMENTUM_ROTATION",false,false]
    ] as const;

    for(const item of definitions){
      const [key,name,family,description,engine,proprietary,enabled]=item;
      const defQuery="INSERT INTO strategy_definitions (key,name,family,description,engine,proprietary,enabled,supported_regions,supported_wrappers) VALUES ($1,$2,$3,$4,$5,$6,$7,'[]'::jsonb,'[]'::jsonb) ON CONFLICT (key) DO NOTHING";
      const rows=await sql.unsafe(defQuery,[key,name,family,description,engine,proprietary,enabled]);
      const id=rows[0]?.id??(await sql.unsafe("SELECT id FROM strategy_definitions WHERE key=$1",[key]))[0]?.id;
      if(!id)throw new Error("STRATEGY_SEED_LOOKUP_FAILED:"+key);

      // On an earlier install these three were research-only definitions without
      // versions. Seeding the new code-approved DRAFT must not leave their
      // definition.engine stuck on RESEARCH_PENDING. Never mutate a definition
      // with a published version or operator-enabled status.
      if(["coffeehouse","core-four","swensen"].includes(key)){
        await sql.unsafe(
          "UPDATE strategy_definitions SET name=$2,description=$3,family='FIXED_ALLOCATION',engine='FIXED_ALLOCATION' "+
          "WHERE id=$1 AND enabled=false AND NOT EXISTS ("+
          " SELECT 1 FROM strategy_versions WHERE strategy_definition_id=$1 AND lifecycle_status='PUBLISHED')",
          [id,name,description]
        );
      }

      if(engine==="MOMENTUM_ROTATION")continue;

      let config:object={};
      if(key==="9sig")config=CANONICAL_9SIG_CONFIG;
      let inputSchema:object[]=[];
      let disclosure="Rule calculator for a user-selected strategy. Not a suitability recommendation.";
      if(engine==="FIXED_ALLOCATION"){const preset=RESEARCH_STRATEGIES.find((p)=>p.key===key);if(!preset?.config)throw new Error("Missing reference configuration for "+key);config=preset.config;inputSchema=preset.inputSchema??[];if(preset.disclosure)disclosure=preset.disclosure;}

      const lifecycle=key==="9sig"?"PUBLISHED":"DRAFT";
      await sql.unsafe(
        "INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,upgrade_policy,input_schema,config,disclosure,published_at) VALUES ($1,'1.0','2026-01-01',$2,$3,'OPTIONAL',$6::text::jsonb,$4::text::jsonb,$5,CASE WHEN $3='PUBLISHED' THEN now() ELSE NULL END) ON CONFLICT (strategy_definition_id,version) DO NOTHING",
        [id,engine,lifecycle,JSON.stringify(config),disclosure,JSON.stringify(inputSchema)]
      );
    }

    // Persist *all* research names for admin inventory without exposing any as an executable release.
    // Published versions and engine validation remain separate review and code gates.
    for(const research of RESEARCH_STRATEGIES){
      await sql.unsafe(
        "INSERT INTO strategy_definitions (key,name,family,description,engine,enabled,proprietary,supported_regions,supported_wrappers) "+
        "VALUES ($1,$2,'RESEARCH', $3,$4,false,false,'[]'::jsonb,'[]'::jsonb) ON CONFLICT (key) DO NOTHING",
        [research.key,research.name,research.rules,research.engine]
      );
    }

    await sql.unsafe("INSERT INTO benchmarks (key,name,economic_exposure,description) VALUES ('global-equity','Global Equity','GLOBAL_EQUITY','Broad global equity benchmark') ON CONFLICT (key) DO NOTHING");
    // Names only, never fake index history. Market comparisons require licensed total-return series.
    for(const [ticker,name] of [["vti","Vanguard Total Stock Market ETF"],["spy","SPDR S&P 500 ETF Trust"],["qqq","Invesco QQQ Trust"]]){
      await sql.unsafe("INSERT INTO benchmarks (key,name,economic_exposure,description) VALUES ($1,$2,$3,'Requires licensed total-return and FX-normalised history') ON CONFLICT (key) DO NOTHING",[ticker,name,"BENCHMARK_"+ticker.toUpperCase()]);
    }
    console.log("Seed complete");
  }finally{
    await sql.end();
  }
}

main().catch((error)=>{
  console.error(error);
  process.exit(1);
});
