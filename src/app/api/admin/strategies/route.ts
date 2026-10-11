import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { assertSameOrigin } from "@/lib/security";
import { sql } from "@/lib/db";
import { supportedEngineKeys, validateEngineConfig, assertCustomerPublishableEngine } from "@/domain/strategy/registry";
import { parseInputSchema } from "@/domain/strategy/config";
import { authFailure } from "@/lib/api-auth";
import { RESEARCH_STRATEGIES } from "@/domain/strategy/research-catalog";
import { assessStrategyMarket } from "@/domain/strategy/market-eligibility";
import { VERIFIED_MARKET_MAPPINGS_SQL, verifiedCandidates } from "@/lib/verified-market-mappings";
import { assertCuratedRules } from "@/domain/strategy/curated-release";

const definitionSchema=z.object({
  key:z.string().min(1),name:z.string().min(1),family:z.string().min(1),description:z.string(),
  engine:z.string().min(1),enabled:z.boolean(),proprietary:z.boolean(),
  defaultBenchmarkKey:z.string().nullable().optional(),supportedRegions:z.array(z.string()),
  supportedWrappers:z.array(z.string()),requiredInputs:z.array(z.unknown()).default([])
});
const versionSchema=z.object({
  strategyKey:z.string().min(1),version:z.string().min(1),effectiveFrom:z.string(),
  effectiveTo:z.string().nullable().optional(),engineKey:z.string().optional(),
  inputSchema:z.array(z.unknown()).optional(),config:z.record(z.string(),z.unknown()),
  disclosure:z.string().default(""),releaseNotes:z.string().default(""),
  upgradePolicy:z.enum(["OPTIONAL","RECOMMENDED","REQUIRED"]).default("OPTIONAL")
});
const patchSchema=z.discriminatedUnion("action",[
  z.object({
    action:z.literal("UPDATE_DRAFT"),versionId:z.string().uuid(),
    effectiveFrom:z.string().optional(),effectiveTo:z.string().nullable().optional(),
    engineKey:z.string().optional(),inputSchema:z.array(z.unknown()).optional(),
    config:z.record(z.string(),z.unknown()).optional(),disclosure:z.string().optional(),
    releaseNotes:z.string().optional(),upgradePolicy:z.enum(["OPTIONAL","RECOMMENDED","REQUIRED"]).optional()
  }),
  z.object({
    action:z.literal("ATTEST"),versionId:z.string().uuid(),
    specCard:z.string().regex(/^docs\/strategy-specs\/[a-z0-9-]+\.md$/),
    goldenTests:z.string().min(3).max(300),notes:z.string().max(1000).default("")
  }),
  z.object({action:z.literal("PUBLISH"),versionId:z.string().uuid()}),
  z.object({action:z.literal("RETIRE"),versionId:z.string().uuid()}),
  z.object({action:z.literal("TOGGLE_DEFINITION"),strategyKey:z.string().min(1),enabled:z.boolean()})
]);

function assertEngine(key:string){
  if(!supportedEngineKeys().includes(key))throw new Error("UNSUPPORTED_ENGINE");
}

export async function PUT(request:Request){
  try{
    assertSameOrigin(request);
    const admin=await requireAdmin();
    const p=definitionSchema.parse(await request.json());
    assertEngine(p.engine);
    const approved=RESEARCH_STRATEGIES.find(profile=>profile.key===p.key);
    if(p.key!=="9sig"&&(!approved||approved.engine!==p.engine))return Response.json({error:"Only built-in, code-reviewed strategies can be managed."},{status:400});
    parseInputSchema(p.requiredInputs);
    // A catalogue's availability is controlled ONLY by the verified release toggle.
    // A free-form PUT request must not bypass publisher, market and attestation checks.
    await sql.unsafe(
      "INSERT INTO strategy_definitions (key,name,family,description,engine,enabled,proprietary,default_benchmark_key,supported_regions,supported_wrappers,required_inputs)"+
      " VALUES ($1,$2,$3,$4,$5,false,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)"+
      " ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name,family=EXCLUDED.family,description=EXCLUDED.description,proprietary=EXCLUDED.proprietary,default_benchmark_key=EXCLUDED.default_benchmark_key,supported_regions=EXCLUDED.supported_regions,supported_wrappers=EXCLUDED.supported_wrappers,updated_at=now()",
      [p.key,p.name,p.family,p.description,p.engine,p.proprietary,p.defaultBenchmarkKey??null,JSON.stringify(p.supportedRegions),JSON.stringify(p.supportedWrappers),JSON.stringify(p.requiredInputs)]
    );
    await sql.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id) VALUES ($1,'strategy-definition.upsert','strategy_definition',$2)",[admin.id,p.key]);
    return Response.json({ok:true});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Invalid strategy definition."},{status:400});
    const code=error instanceof Error?error.message:"FAILED";
    if(code==="UNSUPPORTED_ENGINE"||code==="INVALID_INPUT_SCHEMA")return Response.json({error:"The strategy engine or input schema is invalid."},{status:400});
    return Response.json({error:"Could not update strategy."},{status:500});
  }
}

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const admin=await requireAdmin();
    const p=versionSchema.parse(await request.json());
    const approved=RESEARCH_STRATEGIES.find(profile=>profile.key===p.strategyKey);
    if(p.strategyKey!=="9sig"&&(!approved||approved.engine==="RESEARCH_PENDING"))return Response.json({error:"Strategy rules have not yet been implemented."},{status:400});
    const defs=await sql.unsafe("SELECT id,engine,required_inputs FROM strategy_definitions WHERE key=$1 LIMIT 1",[p.strategyKey]);
    if(!defs[0])return Response.json({error:"Strategy not found."},{status:404});
    const engineKey=p.engineKey??String(defs[0].engine);
    if(engineKey!==(p.strategyKey==="9sig"?"VALUE_TARGET":approved?.engine))return Response.json({error:"A built-in strategy cannot switch calculation engines."},{status:400});
    if(p.config.userWeights===true)return Response.json({error:"Custom allocation weights are not supported."},{status:400});
    const inputSchema=p.inputSchema??(Array.isArray(defs[0].required_inputs)?defs[0].required_inputs:[]);
    assertEngine(engineKey);
    validateEngineConfig(engineKey,p.config);
    parseInputSchema(inputSchema);
    assertCuratedRules(p.strategyKey,engineKey,p.config,inputSchema);
    const rows=await sql.unsafe(
      "INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,effective_to,engine_key,lifecycle_status,upgrade_policy,input_schema,config,disclosure,release_notes)"+
      " VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,$7::jsonb,$8::jsonb,$9,$10) RETURNING id",
      [defs[0].id,p.version,p.effectiveFrom,p.effectiveTo??null,engineKey,p.upgradePolicy,JSON.stringify(inputSchema),JSON.stringify(p.config),p.disclosure,p.releaseNotes]
    );
    await sql.unsafe(
      "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'strategy-version.draft-created','strategy_version',$2,$3::jsonb)",
      [admin.id,String(rows[0].id),JSON.stringify({strategyKey:p.strategyKey,version:p.version})]
    );
    return Response.json({ok:true,id:String(rows[0].id),status:"DRAFT"});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Invalid strategy version."},{status:400});
    const message=error instanceof Error?error.message:"FAILED";
    return Response.json({error:message.startsWith("INVALID_")||message.includes("REQUIRES")||message.includes("WEIGHTS")||message==="ENGINE_NOT_CUSTOMER_VERIFIED"?"Strategy configuration failed validation.":"Could not create strategy version."},{status:400});
  }
}

// A state conflict found while holding the lifecycle locks; reported to the operator as-is.
class LifecycleConflict extends Error{
  constructor(message:string,readonly status:number){super(message);}
}

export async function PATCH(request:Request){
  try{
    assertSameOrigin(request);
    const admin=await requireAdmin();
    const p=patchSchema.parse(await request.json());
    if(p.action==="TOGGLE_DEFINITION"){
      if(p.strategyKey!=="9sig"&&!RESEARCH_STRATEGIES.some(profile=>profile.key===p.strategyKey))
        return Response.json({error:"Only built-in strategies can be managed."},{status:400});
      // Serialize the definition toggle with PUBLISH/RETIRE (same definition lock).
      // Otherwise an operator can enable a version while someone else retires it.
      const enabled=await sql.begin(async tx=>{
        const definitions=await tx.unsafe(
          "SELECT id FROM strategy_definitions WHERE key=$1 FOR UPDATE",[p.strategyKey]
        );
        if(!definitions[0])throw new LifecycleConflict("Strategy is not installed in the database.",404);
        if(p.enabled){
          const releases=await tx.unsafe(
            "SELECT v.id,v.engine_key,v.config,v.input_schema,a.strategy_version_id AS attestation_id "+
            "FROM strategy_versions v LEFT JOIN strategy_version_attestations a ON a.strategy_version_id=v.id "+
            "WHERE v.strategy_definition_id=$1 AND v.lifecycle_status='PUBLISHED' "+
            "AND v.effective_from<=current_date AND (v.effective_to IS NULL OR v.effective_to>=current_date) "+
            "ORDER BY v.effective_from DESC,v.published_at DESC NULLS LAST LIMIT 1 FOR UPDATE OF v",
            [definitions[0].id]
          );
          const release=releases[0];
          if(!release)throw new LifecycleConflict("Publish and verify this strategy before enabling it.",409);
          if(!release.attestation_id)
            throw new LifecycleConflict("A published strategy needs a recorded independent methodology and golden-test sign-off before activation.",409);
          try{
            assertCustomerPublishableEngine(String(release.engine_key));
            assertCuratedRules(p.strategyKey,String(release.engine_key),
              release.config,release.input_schema);
          }catch{
            throw new LifecycleConflict("The release does not match the built-in reviewed strategy method.",409);
          }
          const market=assessStrategyMarket(String(release.engine_key),
            (release.config??{}) as Record<string,unknown>,
            verifiedCandidates(await tx.unsafe(VERIFIED_MARKET_MAPPINGS_SQL)),
            {country:"GB",wrapper:"ISA",currency:"GBP"},new Date().toISOString().slice(0,10));
          if(!market.supportedMarkets.length)
            throw new LifecycleConflict("No complete configured country/account instrument mapping is available.",409);
          // These are technical enablement prerequisites, NOT evidence that the
          // broker permits purchases or that data/licensing/legal gates have passed.
        }
        await tx.unsafe("UPDATE strategy_definitions SET enabled=$2,updated_at=now() WHERE id=$1",
          [definitions[0].id,p.enabled]);
        await tx.unsafe(
          "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'strategy-definition.toggled','strategy_definition',$2,$3::jsonb)",
          [admin.id,p.strategyKey,JSON.stringify({enabled:p.enabled})]
        );
        return p.enabled;
      });
      return Response.json({ok:true,enabled});
    }
    const result=await sql.begin(async(tx)=>{
      // Lock the definition first, then the version, always in that order. Every lifecycle change
      // for one strategy is serialised, so state read below is still true when it is written.
      await tx.unsafe(
        "SELECT d.id FROM strategy_definitions d WHERE d.id=(SELECT strategy_definition_id FROM strategy_versions WHERE id=$1) FOR UPDATE",
        [p.versionId]
      );
      const rows=await tx.unsafe(
        "SELECT v.*,d.key AS strategy_key,d.enabled AS strategy_enabled FROM strategy_versions v JOIN strategy_definitions d ON d.id=v.strategy_definition_id WHERE v.id=$1 FOR UPDATE OF v",
        [p.versionId]
      );
      const current=rows[0];
      if(!current)throw new LifecycleConflict("Version not found.",404);

      if(p.action==="UPDATE_DRAFT"){
        if(String(current.lifecycle_status)!=="DRAFT")throw new LifecycleConflict("Published strategy versions are immutable. Create a new version instead.",409);
        const engineKey=p.engineKey??String(current.engine_key);
        if(p.config?.userWeights===true)throw new LifecycleConflict("Custom allocation weights are not supported.",400);
        const config=p.config??((current.config??{}) as Record<string,unknown>);
        const inputSchema=p.inputSchema??(Array.isArray(current.input_schema)?current.input_schema:[]);
        assertEngine(engineKey);validateEngineConfig(engineKey,config);parseInputSchema(inputSchema);
        if(String(current.strategy_key)==="9sig"||RESEARCH_STRATEGIES.some(profile=>profile.key===String(current.strategy_key)))
          assertCuratedRules(String(current.strategy_key),engineKey,config,inputSchema);
        const updated=await tx.unsafe(
          "UPDATE strategy_versions SET effective_from=$1,effective_to=$2,engine_key=$3,upgrade_policy=$4,input_schema=$5::jsonb,config=$6::jsonb,disclosure=$7,release_notes=$8 WHERE id=$9 AND lifecycle_status='DRAFT' RETURNING id",
          [p.effectiveFrom??current.effective_from,p.effectiveTo===undefined?current.effective_to:p.effectiveTo,engineKey,p.upgradePolicy??current.upgrade_policy,JSON.stringify(inputSchema),JSON.stringify(config),p.disclosure??current.disclosure,p.releaseNotes??current.release_notes,p.versionId]
        );
        if(!updated[0])throw new LifecycleConflict("This version is no longer a draft.",409);
        // An attestation covers exactly the reviewed rules, disclosures and release
        // metadata. Editing ANY draft field invalidates the sign-off. This runs under
        // the same definition+version locks as PUBLISH so no race can reuse stale approval.
        await tx.unsafe("DELETE FROM strategy_version_attestations WHERE strategy_version_id=$1",[p.versionId]);
        await tx.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id) VALUES ($1,'strategy-version.draft-updated','strategy_version',$2)",[admin.id,p.versionId]);
        return "DRAFT";
      }

      if(p.action==="ATTEST"){
        if(!["DRAFT","PUBLISHED"].includes(String(current.lifecycle_status)))throw new LifecycleConflict("Only a draft or published version can be attested.",409);
        await tx.unsafe(
          "INSERT INTO strategy_version_attestations (strategy_version_id,spec_card,golden_tests,notes,attested_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (strategy_version_id) DO UPDATE SET spec_card=EXCLUDED.spec_card,golden_tests=EXCLUDED.golden_tests,notes=EXCLUDED.notes,attested_by=EXCLUDED.attested_by,attested_at=now()",
          [p.versionId,p.specCard,p.goldenTests,p.notes,admin.id]
        );
        await tx.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'strategy-version.attested','strategy_version',$2,$3::jsonb)",[admin.id,p.versionId,JSON.stringify({specCard:p.specCard})]);
        return "DRAFT";
      }

      if(p.action==="PUBLISH"){
        if(String(current.lifecycle_status)!=="DRAFT")throw new LifecycleConflict("Only a draft version can be published.",409);
        assertEngine(String(current.engine_key));
        assertCustomerPublishableEngine(String(current.engine_key));
        if((current.config as Record<string,unknown> | null)?.userWeights===true)throw new LifecycleConflict("Custom allocation versions cannot be published.",409);
        const attested=await tx.unsafe("SELECT 1 FROM strategy_version_attestations WHERE strategy_version_id=$1",[p.versionId]);
        if(!attested[0])throw new LifecycleConflict("Record the specification sign-off and golden tests for this version before publishing it.",409);
        validateEngineConfig(String(current.engine_key),(current.config??{}) as Record<string,unknown>);
        parseInputSchema(current.input_schema);
        if(String(current.strategy_key)==="9sig"||RESEARCH_STRATEGIES.some(profile=>profile.key===String(current.strategy_key)))
          assertCuratedRules(String(current.strategy_key),String(current.engine_key),current.config,current.input_schema);
        const duplicate=await tx.unsafe(
          "SELECT id FROM strategy_versions WHERE strategy_definition_id=$1 AND lifecycle_status='PUBLISHED' AND effective_from=$2 AND id<>$3 LIMIT 1",
          [current.strategy_definition_id,current.effective_from,p.versionId]
        );
        if(duplicate[0])throw new LifecycleConflict("Another published version already has that effective date.",409);
        const published=await tx.unsafe(
          "UPDATE strategy_versions SET lifecycle_status='PUBLISHED',published_at=now() WHERE id=$1 AND lifecycle_status='DRAFT' RETURNING id",
          [p.versionId]
        );
        if(!published[0])throw new LifecycleConflict("This version is no longer a draft.",409);
        await tx.unsafe(
          "INSERT INTO notifications (user_id,type,title,body) SELECT DISTINCT i.user_id,'STRATEGY_VERSION',$1,$2 FROM strategy_instances i WHERE i.strategy_definition_id=$3 AND i.strategy_version_id<>$4 AND i.status IN ('ACTIVE','PAUSED')",
          ["Strategy update available: "+String(current.strategy_key)+" v"+String(current.version),String(current.release_notes||"A new strategy rules version is available to review."),current.strategy_definition_id,p.versionId]
        );
        await tx.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id) VALUES ($1,'strategy-version.published','strategy_version',$2)",[admin.id,p.versionId]);
        return "PUBLISHED";
      }

      if(String(current.lifecycle_status)!=="PUBLISHED")throw new LifecycleConflict("Only a published version can be retired.",409);
      const remaining=await tx.unsafe(
        "SELECT id FROM strategy_versions WHERE strategy_definition_id=$1 AND lifecycle_status='PUBLISHED' AND id<>$2 LIMIT 1",
        [current.strategy_definition_id,p.versionId]
      );
      if(!remaining[0]&&current.strategy_enabled)
        throw new LifecycleConflict("This is the only published version of an enabled strategy. Publish a replacement or disable the strategy first.",409);
      const retired=await tx.unsafe(
        "UPDATE strategy_versions SET lifecycle_status='RETIRED',effective_to=COALESCE(effective_to,current_date) WHERE id=$1 AND lifecycle_status='PUBLISHED' RETURNING id",
        [p.versionId]
      );
      if(!retired[0])throw new LifecycleConflict("This version is no longer published.",409);
      await tx.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id) VALUES ($1,'strategy-version.retired','strategy_version',$2)",[admin.id,p.versionId]);
      return "RETIRED";
    });
    return Response.json({ok:true,status:result});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof LifecycleConflict)return Response.json({error:error.message},{status:error.status});
    if(error instanceof z.ZodError)return Response.json({error:"Invalid strategy version operation."},{status:400});
    // The partial unique index is the last line of defence against two published versions with the same date.
    if((error as {code?:string})?.code==="23505")return Response.json({error:"Another published version already has that effective date."},{status:409});
    const message=error instanceof Error?error.message:"FAILED";
    return Response.json({error:message.startsWith("INVALID_")||message.includes("REQUIRES")||message.includes("WEIGHTS")?"Strategy configuration failed validation.":"Could not update strategy version."},{status:400});
  }
}
