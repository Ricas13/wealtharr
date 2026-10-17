import {STRATEGY_PLUGINS,curatedRelease} from "../src/domain/strategy/catalog/index";
import {strategiesToSeed} from "../src/domain/strategy/seed-plan";
import {insertSafeTacticalRelease} from "../src/lib/tactical-release-upgrade";
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

    // Existing installs preserve their immutable versions and ledgers. An empty production
    // catalogue is preferable to automatically offering research/partial financial methods.
    // Historical catalogue fixtures remain available ONLY in ephemeral GitHub Actions tests.
    const syntheticCiCatalogue=process.env.GITHUB_ACTIONS==="true" && process.env.CI==="true" &&
      /^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1:5432\/strategyos_test$/.test(process.env.DATABASE_URL??"");
    // Group 2 methods are code-released. Legacy installations can contain disabled draft v1.0
    // rows; a code-complete release installs a NEW immutable v2.0 rather than rewriting history.
    // This set identifies an upgrade cohort, not an alternative definitions catalogue.
    const group2ReleaseKeys=new Set(["all-weather","hfea","coffeehouse","core-four","swensen","merriman-ultimate"]);
    // Quarterly target family: an install that already seeded the 2026-10-15 rules as v1.0 receives the
    // owner's 2026-10-16 rules (daily-close spike, 6% two skips, withdrawals lower the line) as a NEW
    // immutable v1.1; existing instances stay pinned to v1.0. Nasdaq sheet v1.05 resets are a further v1.2. A fresh install seeds the current rules as v1.0.
    const quarterlyReleaseKeys=new Set(["quarterly-target-nasdaq-3x","quarterly-target-midcap-2x","quarterly-target-smallcap"]);
    // Sheet v1.07 is a NEW release. Never overwrite older Nasdaq 1.0 / 1.1 / 1.2
    // immutable versions, whose stored ruleVersion still selects the v1 engine.
    const upgradeVersionOf=(key:string)=>group2ReleaseKeys.has(key)?"2.0":
      key==="quarterly-target-nasdaq-3x"?"1.3":quarterlyReleaseKeys.has(key)?"1.1":null;
    // Strategy definitions and their first versions come from the plugin registry
    // (src/domain/strategy/catalog); there is no second list here. Insert-only: an existing
    // definition or version is never modified (except the guarded research-only realignment below).
    // On a real install only plugins whose method is complete (isMethodComplete) are seeded, always
    // as a DISABLED definition with a PUBLISHED version and no attestation row; no incomplete/DRAFT
    // reference model or partial 9Sig release is seeded. An administrator enables a strategy later
    // and only a complete EXACT market makes it reachable. The CI fixture keeps its full catalogue.
    for(const entry of strategiesToSeed(STRATEGY_PLUGINS,syntheticCiCatalogue?"CI_FIXTURE":"PRODUCTION")){
      const {plugin,definition,enabled}=entry;
      const key=plugin.key;
      const {name,family,description,engine,proprietary}=definition;
      const defQuery="INSERT INTO strategy_definitions (key,name,family,description,engine,proprietary,enabled,supported_regions,supported_wrappers) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text::jsonb,$9::text::jsonb) ON CONFLICT (key) DO NOTHING";
      const rows=await sql.unsafe(defQuery,[key,name,family,description,engine,proprietary,enabled,JSON.stringify(definition.supportedRegions),JSON.stringify(definition.supportedWrappers)]);
      const id=rows[0]?.id??(await sql.unsafe("SELECT id FROM strategy_definitions WHERE key=$1",[key]))[0]?.id;
      if(!id)throw new Error("STRATEGY_SEED_LOOKUP_FAILED:"+key);

      // On an earlier install these were research-only definitions without versions.
      // Seeding the new code-approved DRAFT must not leave their definition.engine stuck on
      // RESEARCH_PENDING. Never mutate a definition with a published version or
      // operator-enabled status.
      if(entry.realignsResearchOnlyDefinition){
        await sql.unsafe(
          "UPDATE strategy_definitions SET name=$2,description=$3,family='FIXED_ALLOCATION',engine='FIXED_ALLOCATION' "+
          "WHERE id=$1 AND enabled=false AND NOT EXISTS ("+
          " SELECT 1 FROM strategy_versions WHERE strategy_definition_id=$1 AND lifecycle_status='PUBLISHED')",
          [id,name,description]
        );
      }

      const group2ProductionRelease=!syntheticCiCatalogue&&group2ReleaseKeys.has(key);
      if(group2ProductionRelease){
        // Research-only rows may have RESEARCH_PENDING engines. Align only disabled definitions
        // without a published version; never change an enabled or already published definition.
        await sql.unsafe(
          "UPDATE strategy_definitions SET engine=$2,name=$3,description=$4,family=$5,updated_at=now() "+
          "WHERE id=$1 AND enabled=false AND NOT EXISTS ("+
          "SELECT 1 FROM strategy_versions v WHERE v.strategy_definition_id=$1 AND v.lifecycle_status='PUBLISHED')",
          [id,engine,name,description,family]
        );
      }

      // Source-complete tactical releases upgrade safely without altering historical instances.
      if(engine==="TACTICAL_ALLOCATION"&&entry.initialVersion==="PUBLISHED"&&!syntheticCiCatalogue){
        const release=curatedRelease(plugin);
        if(!release?.config)throw new Error("TACTICAL_RELEASE_CONFIG_MISSING:"+key);
        await sql.begin(async tx=>{
          await insertSafeTacticalRelease(tx,{
            definitionId:String(id),name,description,family,
            config:release.config!,inputSchema:release.inputSchema??[],
            disclosure:release.disclosure??"Rules-based portfolio calculation, not suitability or individual investment advice."
          });
        });
        continue;
      }
      if(entry.initialVersion===null)continue;

      const release=curatedRelease(plugin);
      if(!release?.config)throw new Error("Missing reference configuration for "+key);
      const config:object=release.config;
      const inputSchema:object[]=release.inputSchema??[];
      const disclosure=release.disclosure||"Rule calculator for a user-selected strategy. Not a suitability recommendation.";

      const lifecycle=entry.initialVersion;
      await sql.unsafe(
        "INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,upgrade_policy,input_schema,config,disclosure,published_at) VALUES ($1,'1.0','2026-01-01',$2,$3,'OPTIONAL',$6::text::jsonb,$4::text::jsonb,$5,CASE WHEN $3='PUBLISHED' THEN now() ELSE NULL END) ON CONFLICT (strategy_definition_id,version) DO NOTHING",
        [id,engine,lifecycle,JSON.stringify(config),disclosure,JSON.stringify(inputSchema)]
      );

      const upgradeVersion=syntheticCiCatalogue?null:upgradeVersionOf(key);
      if(upgradeVersion){
        // A pre-existing v1.0 DRAFT cannot be mutated into a published version during deploy.
        // Deterministically create v2.0 on today's date, leaving old instances pinned to v1.0.
        // Repeated deployment is a no-op. Conflicting operator-created v2.0 fails closed.
        await sql.begin(async tx=>{
          const locked=await tx.unsafe("SELECT id,enabled FROM strategy_definitions WHERE id=$1 FOR UPDATE",[id]);
          if(!locked[0]||locked[0].enabled)return;
          // No-op only when a canonical published version already exists. A legacy operator-
          // published v1.0 with old rules must stay immutable, not block a new correct v2.0.
          const canonical=await tx.unsafe(
            "SELECT id FROM strategy_versions WHERE strategy_definition_id=$1 "+
            "AND lifecycle_status='PUBLISHED' AND engine_key=$2 AND config=$3::text::jsonb "+
            "AND input_schema=$4::text::jsonb LIMIT 1",
            [id,engine,JSON.stringify(config),JSON.stringify(inputSchema)]
          );
          if(canonical.length)return;
          const historical=await tx.unsafe(
            "SELECT id FROM strategy_versions WHERE strategy_definition_id=$1 AND version='1.0' LIMIT 1",[id]
          );
          if(!historical.length)return;
          const conflicting=await tx.unsafe(
            "SELECT id FROM strategy_versions WHERE strategy_definition_id=$1 AND version=$2 LIMIT 1",[id,upgradeVersion]
          );
          if(conflicting.length)throw new Error("CANONICAL_UPGRADE_VERSION_CONFLICT:"+key);
          await tx.unsafe(
            "INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,upgrade_policy,input_schema,config,disclosure,published_at) "+
            "VALUES ($1,$6,current_date,$2,'PUBLISHED','OPTIONAL',$5::text::jsonb,$3::text::jsonb,$4,now())",
            [id,engine,JSON.stringify(config),disclosure,JSON.stringify(inputSchema),upgradeVersion]
          );
        });
      }
    }

    // Persist *all* research names for admin inventory without exposing any as an executable release.
    // Published versions and engine validation remain separate review and code gates.
    for(const plugin of STRATEGY_PLUGINS){
      const research=plugin.profile;
      // Research names are documentation, not selectable code. Do not seed them in production.
      if(!syntheticCiCatalogue)continue;
      if(!research)continue;
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
