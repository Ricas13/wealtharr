import "server-only";
import Decimal from "decimal.js";
import { sql } from "@/lib/db";
import { assertCanCreateStrategy, assertStrategyFeatureAccess, buildEntitlementSnapshot } from "@/domain/entitlements";
import { effectiveAllocations } from "@/domain/strategy/fixed-allocation";
import { parseInputSchema, validateInstanceSettings } from "@/domain/strategy/config";
import { serializeExecutionConstraints } from "@/domain/execution";
import { normalizeContributionPlan } from "@/domain/contribution-plan";
import { assessStrategyMarket, StrategyMarketUnavailableError } from "@/domain/strategy/market-eligibility";
import { VERIFIED_MARKET_MAPPINGS_SQL, verifiedCandidates } from "@/lib/verified-market-mappings";

export type CreateStrategyInput = {
  requestKey?: string;
  strategyKey: string;
  name: string;
  wrapper: string;
  broker?: string | null;
  currency: string;
  onboardingMode: "START_NEW" | "RESUME";
  startingCash?: string;
  approximateValue?: string;
  settings?: Record<string, unknown>;
  executionConstraints?: Record<string, unknown>;
  contributionPlan?: Record<string, unknown>;
};

export async function listAvailableStrategies() {
  return sql.unsafe(
    "SELECT d.id,d.key,d.name,d.family,d.description,d.engine,d.proprietary,d.supported_regions,d.supported_wrappers,"+
    "v.id AS version_id,v.version,v.config,v.input_schema,v.release_notes,v.engine_key "+
    "FROM strategy_definitions d JOIN LATERAL ("+
    " SELECT * FROM strategy_versions v WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED'"+
    " AND v.effective_from<=current_date AND (v.effective_to IS NULL OR v.effective_to>=current_date)"+
    " ORDER BY v.effective_from DESC,v.published_at DESC NULLS LAST LIMIT 1"+
    ") v ON true WHERE d.enabled=true ORDER BY d.name"
  );
}

export async function listUserStrategies(userId: string) {
  return sql.unsafe(
    "SELECT i.id,i.name,i.status,i.health_status,i.started_at,i.last_reconciled_at,i.contribution_plan,d.key AS strategy_key,d.name AS strategy_name,d.family,a.wrapper,a.currency,a.broker_name,v.version "+
    "FROM strategy_instances i JOIN strategy_definitions d ON d.id=i.strategy_definition_id JOIN strategy_versions v ON v.id=i.strategy_version_id "+
    "LEFT JOIN accounts a ON a.id=i.account_id WHERE i.user_id=$1 ORDER BY i.created_at DESC",
    [userId]
  );
}

export async function getStrategyForUser(userId: string, instanceId: string) {
  const rows = await sql.unsafe(
    "SELECT i.*,d.key AS strategy_key,d.name AS strategy_name,d.family,d.description,d.proprietary,d.supported_wrappers,"+
    "v.version,v.engine_key AS engine,v.config,v.disclosure,v.release_notes,v.input_schema,v.upgrade_policy,"+
    "a.wrapper,a.currency,a.country,a.broker_name,s.state,s.confidence AS state_confidence,"+
    "latest.id AS latest_version_id,latest.version AS latest_version,latest.release_notes AS latest_release_notes,"+
    "latest.upgrade_policy AS latest_upgrade_policy,latest.input_schema AS latest_input_schema,latest.config AS latest_config "+
    "FROM strategy_instances i JOIN strategy_definitions d ON d.id=i.strategy_definition_id "+
    "JOIN strategy_versions v ON v.id=i.strategy_version_id LEFT JOIN accounts a ON a.id=i.account_id "+
    "JOIN strategy_states s ON s.strategy_instance_id=i.id "+
    "LEFT JOIN LATERAL ("+
    " SELECT nv.id,nv.version,nv.release_notes,nv.upgrade_policy,nv.input_schema,nv.config FROM strategy_versions nv"+
    " WHERE nv.strategy_definition_id=i.strategy_definition_id AND nv.lifecycle_status='PUBLISHED'"+
    " AND nv.effective_from<=current_date AND (nv.effective_to IS NULL OR nv.effective_to>=current_date)"+
    " ORDER BY nv.effective_from DESC,nv.published_at DESC NULLS LAST LIMIT 1"+
    ") latest ON true WHERE i.id=$1 AND i.user_id=$2 LIMIT 1",
    [instanceId,userId]
  );
  return rows[0] ?? null;
}

export async function createStrategy(userId: string, country: string, rawInput: CreateStrategyInput, timezone?: string) {
  // Currency is stored and compared as an upper-case ISO code everywhere else.
  const currency = rawInput.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("INVALID_CURRENCY");
  const input = { ...rawInput, currency };
  if (input.requestKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestKey))
    throw new Error("INVALID_REQUEST_KEY");
  const { requestKey, ...requestInput } = input;
  const requestPayload = JSON.stringify({ country, timezone: timezone ?? null, input: requestInput });
  return sql.begin(async (tx) => {
    const locked = await tx.unsafe("SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[userId]);
    if (!locked[0]) throw new Error("UNAUTHENTICATED");

    // The user lock serializes concurrent retries before any account or ledger write.
    // Replay precedes current plan limits: a successful request must still be recoverable
    // after its newly created strategy fills the last available plan slot.
    if (requestKey) {
      const previous = await tx.unsafe(
        "SELECT strategy_instance_id,request_payload=$3::jsonb AS matches FROM strategy_creation_requests WHERE user_id=$1 AND request_key=$2",
        [userId,requestKey,requestPayload]
      );
      if (previous[0]) {
        if (!previous[0].matches) throw new Error("STRATEGY_REQUEST_CONFLICT");
        return String(previous[0].strategy_instance_id);
      }
    }

    let planRows = await tx.unsafe(
      "SELECT p.slug,p.max_active_strategies,p.entitlements,p.available_strategy_keys FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=$1 AND s.status IN ('FREE','ACTIVE','TRIALING','PAST_DUE') LIMIT 1",
      [userId]
    );
    if (!planRows[0]) planRows = await tx.unsafe("SELECT slug,max_active_strategies,entitlements,available_strategy_keys FROM plans WHERE slug='free' LIMIT 1");
    if (!planRows[0]) throw new Error("FREE_PLAN_MISSING");
    const snapshot = buildEntitlementSnapshot({
      slug:String(planRows[0].slug),
      maxActiveStrategies:planRows[0].max_active_strategies==null?null:Number(planRows[0].max_active_strategies),
      entitlements:planRows[0].entitlements,
      availableStrategyKeys:planRows[0].available_strategy_keys
    });
    const countRows = await tx.unsafe("SELECT count(*)::int AS count FROM strategy_instances WHERE user_id=$1 AND status='ACTIVE'",[userId]);
    assertCanCreateStrategy(snapshot,Number(countRows[0]?.count??0),input.strategyKey);

    const definitions = await tx.unsafe(
      "SELECT d.id,d.key,d.name,d.supported_regions,d.supported_wrappers,d.required_inputs,"+
      "v.id AS version_id,v.engine_key,v.config,v.input_schema FROM strategy_definitions d JOIN LATERAL ("+
      " SELECT * FROM strategy_versions v WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED'"+
      " AND v.effective_from<=current_date AND (v.effective_to IS NULL OR v.effective_to>=current_date)"+
      " ORDER BY v.effective_from DESC,v.published_at DESC NULLS LAST LIMIT 1"+
      ") v ON true WHERE d.key=$1 AND d.enabled=true LIMIT 1",
      [input.strategyKey]
    );
    const definition = definitions[0];
    if (!definition) throw new Error("STRATEGY_NOT_AVAILABLE");

    const regions=Array.isArray(definition.supported_regions)?definition.supported_regions.map(String):[];
    const wrappers=Array.isArray(definition.supported_wrappers)?definition.supported_wrappers.map(String):[];
    if(regions.length&&!regions.includes(country))throw new Error("STRATEGY_NOT_SUPPORTED_IN_REGION");
    if(wrappers.length&&!wrappers.includes(input.wrapper))throw new Error("STRATEGY_NOT_SUPPORTED_FOR_WRAPPER");

    // A named strategy can only be enabled when every leg has an exact, unambiguous,
    // country/wrapper/currency/broker-eligible instrument. Never guess an ETF substitute.
    const marketChoice={country,wrapper:input.wrapper,currency:input.currency,broker:input.broker??null};
    const market=assessStrategyMarket(String(definition.engine_key),
      (definition.config??{}) as Record<string,unknown>,
      verifiedCandidates(await tx.unsafe(VERIFIED_MARKET_MAPPINGS_SQL)),
      marketChoice,new Date().toISOString().slice(0,10));
    if(!market.available)throw new StrategyMarketUnavailableError(market,marketChoice);

    const inputSchema=parseInputSchema(
      Array.isArray(definition.input_schema)&&definition.input_schema.length?definition.input_schema:definition.required_inputs
    );
    const settings=validateInstanceSettings(inputSchema,input.settings);
    // Investor-chosen weights must already total 100% when the strategy starts, not at first calculation.
    if(definition.engine_key==="FIXED_ALLOCATION"&&!effectiveAllocations((definition.config??{}) as Record<string,unknown>,settings))
      throw new Error("INVALID_STRATEGY_WEIGHTS");
    const executionConstraints=serializeExecutionConstraints(input.executionConstraints);
    const contributionPlan=normalizeContributionPlan(input.contributionPlan,new Date(),timezone);

    const accounts = await tx.unsafe(
      "INSERT INTO accounts (user_id,name,wrapper,country,currency,broker_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [userId,input.name + " account",input.wrapper,country,input.currency,input.broker ?? null]
    );
    const state = input.onboardingMode === "RESUME"
      ? { resumeNeedsReconciliation:true, approximateValue:input.approximateValue ?? null, forceReview:false }
      : { forceReview:true };
    const instances = await tx.unsafe(
      "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name,onboarding_mode,health_status,settings,execution_constraints,contribution_plan) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb) RETURNING id",
      [userId,accounts[0].id,definition.id,definition.version_id,input.name,input.onboardingMode,input.onboardingMode==="RESUME"?"NEEDS_ATTENTION":"HEALTHY",JSON.stringify(settings),JSON.stringify(executionConstraints),JSON.stringify(contributionPlan)]
    );
    const id=String(instances[0].id);
    await tx.unsafe(
      "INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY') ON CONFLICT DO NOTHING",
      [id,accounts[0].id]
    );
    await tx.unsafe(
      "INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state,confidence) VALUES ($1,$2,$3::jsonb,$4)",
      [id,definition.version_id,JSON.stringify(state),input.onboardingMode==="RESUME"?"LOW":"HIGH"]
    );

    const startingCash = new Decimal(input.startingCash ?? "0");
    if (!startingCash.isFinite() || startingCash.lt(0)) throw new Error("INVALID_STARTING_CASH");
    if (startingCash.decimalPlaces()>8 || startingCash.gte("10000000000000000")) throw new Error("INVALID_STARTING_CASH");
    // A resumed account receives its actual cash in the opening snapshot. An
    // advance contribution would block that snapshot or count the cash twice.
    if (input.onboardingMode==="RESUME" && startingCash.gt(0)) throw new Error("RESUME_CASH_REQUIRES_SNAPSHOT");
    if (startingCash.gt(0)) {
      await tx.unsafe(
        "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,provenance,confidence,metadata) VALUES ($1,$2,now(),'CONTRIBUTION',$3,$4,'USER_ENTERED','VERIFIED',$5::jsonb)",
        [id,accounts[0].id,input.currency,startingCash.toString(),JSON.stringify({opening:true})]
      );
    }
    await tx.unsafe(
      "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'strategy.created','strategy_instance',$2,$3::jsonb)",
      [userId,id,JSON.stringify({strategyKey:input.strategyKey,onboardingMode:input.onboardingMode,plan:snapshot.planSlug,versionId:String(definition.version_id)})]
    );
    if (requestKey) await tx.unsafe(
      "INSERT INTO strategy_creation_requests (user_id,request_key,request_payload,strategy_instance_id) VALUES ($1,$2,$3::jsonb,$4)",
      [userId,requestKey,requestPayload,id]
    );
    return id;
  });
}

export async function migrateStrategyVersion(
  userId:string,
  instanceId:string,
  targetVersionId:string,
  suppliedSettings?:Record<string,unknown>
){
  return sql.begin(async(tx)=>{
    const userRows=await tx.unsafe("SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[userId]);
    if(!userRows[0])throw new Error("UNAUTHENTICATED");
    const rows=await tx.unsafe(
      "SELECT i.id,i.status,i.strategy_definition_id,i.strategy_version_id,i.settings,s.state,cv.engine_key AS current_engine "+
      "FROM strategy_instances i JOIN strategy_states s ON s.strategy_instance_id=i.id JOIN strategy_versions cv ON cv.id=i.strategy_version_id "+
      "WHERE i.id=$1 AND i.user_id=$2 FOR UPDATE OF i,s",
      [instanceId,userId]
    );
    const instance=rows[0];
    if(!instance)throw new Error("STRATEGY_INSTANCE_NOT_FOUND");
    if(String(instance.status)==="CLOSED")throw new Error("STRATEGY_ALREADY_CLOSED");
    if(String(instance.strategy_version_id)===targetVersionId)return {changed:false,status:String(instance.status)};

    const targets=await tx.unsafe(
      "SELECT id,strategy_definition_id,engine_key,input_schema,config,version FROM strategy_versions WHERE id=$1 AND lifecycle_status='PUBLISHED'"+
      " AND effective_from<=current_date AND (effective_to IS NULL OR effective_to>=current_date) LIMIT 1",
      [targetVersionId]
    );
    const target=targets[0];
    if(!target||String(target.strategy_definition_id)!==String(instance.strategy_definition_id))throw new Error("INVALID_TARGET_VERSION");
    if(String(target.engine_key)!==String(instance.current_engine))throw new Error("ENGINE_MIGRATION_NOT_SUPPORTED");

    // The proposed version can introduce new exposures or change leverage.
    // Check ALL linked accounts with the new immutable code-reviewed rules before
    // superseding actions or committing the version change.
    const linked=await tx.unsafe(
      "SELECT a.country,a.wrapper,a.currency,a.broker_name FROM strategy_accounts sa "+
      "JOIN accounts a ON a.id=sa.account_id WHERE sa.strategy_instance_id=$1",
      [instanceId]
    );
    if(!linked.length)throw new Error("STRATEGY_ACCOUNT_MISSING");
    const mappings=verifiedCandidates(await tx.unsafe(VERIFIED_MARKET_MAPPINGS_SQL));
    for(const account of linked){
      const choice={
        country:String(account.country),wrapper:String(account.wrapper),
        currency:String(account.currency).toUpperCase(),
        broker:account.broker_name?String(account.broker_name):null
      };
      const market=assessStrategyMarket(String(target.engine_key),
        (target.config??{}) as Record<string,unknown>,mappings,choice,
        new Date().toISOString().slice(0,10));
      if(!market.available)throw new StrategyMarketUnavailableError(market,choice);
    }

    const merged={...((instance.settings??{}) as Record<string,unknown>),...(suppliedSettings??{})};
    const settings=validateInstanceSettings(parseInputSchema(target.input_schema),merged);
    const before=(instance.state??{}) as Record<string,unknown>;
    const after:Record<string,unknown>={...before,forceReview:true,versionMigratedAt:new Date().toISOString()};
    // A target frozen under the old algorithm is not valid after changing
    // the method. Preserve the *committed* historical target only.
    delete after.reviewTargetValue;
    delete after.reviewContributionsSnapshot;
    delete after.lastCalculatedAt;

    await tx.unsafe(
      "UPDATE actions SET status='SUPERSEDED',cancelled_at=COALESCE(cancelled_at,now()),updated_at=now() WHERE strategy_instance_id=$1 AND status IN ('CALCULATED','NOTIFIED','ACKNOWLEDGED')",
      [instanceId]
    );
    await tx.unsafe("UPDATE strategy_instances SET strategy_version_id=$1,settings=$2::jsonb,health_status='NEEDS_ATTENTION',updated_at=now() WHERE id=$3",[targetVersionId,JSON.stringify(settings),instanceId]);
    await tx.unsafe("UPDATE strategy_states SET strategy_version_id=$1,state=$2::jsonb,confidence='MEDIUM',calculated_at=now() WHERE strategy_instance_id=$3",[targetVersionId,JSON.stringify(after),instanceId]);
    await tx.unsafe(
      "INSERT INTO strategy_version_migrations (strategy_instance_id,from_version_id,to_version_id,state_before,state_after,migrated_by) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'USER')",
      [instanceId,instance.strategy_version_id,targetVersionId,JSON.stringify(before),JSON.stringify(after)]
    );
    await tx.unsafe(
      "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'strategy.version-migrated','strategy_instance',$2,$3::jsonb)",
      [userId,instanceId,JSON.stringify({fromVersionId:String(instance.strategy_version_id),toVersionId:targetVersionId,toVersion:String(target.version)})]
    );
    return {changed:true,status:String(instance.status)};
  });
}

export async function changeStrategyStatus(
  userId: string,
  instanceId: string,
  target: "ACTIVE" | "PAUSED" | "CLOSED"
) {
  return sql.begin(async (tx) => {
    const userRows = await tx.unsafe("SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [userId]);
    if (!userRows[0]) throw new Error("UNAUTHENTICATED");
    const rows = await tx.unsafe(
      "SELECT i.id,i.status,d.key AS strategy_key FROM strategy_instances i JOIN strategy_definitions d ON d.id=i.strategy_definition_id WHERE i.id=$1 AND i.user_id=$2 FOR UPDATE OF i",
      [instanceId, userId]
    );
    const instance = rows[0];
    if (!instance) throw new Error("STRATEGY_INSTANCE_NOT_FOUND");
    const current = String(instance.status);
    if (current === "CLOSED") throw new Error("STRATEGY_ALREADY_CLOSED");
    if (target === current) return { status: current };

    if (target === "ACTIVE") {
      let planRows = await tx.unsafe(
        "SELECT p.slug,p.max_active_strategies,p.entitlements,p.available_strategy_keys FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=$1 AND s.status IN ('FREE','ACTIVE','TRIALING','PAST_DUE') LIMIT 1",
        [userId]
      );
      if (!planRows[0]) planRows=await tx.unsafe("SELECT slug,max_active_strategies,entitlements,available_strategy_keys FROM plans WHERE slug='free' LIMIT 1");
      if (!planRows[0]) throw new Error("FREE_PLAN_MISSING");
      const snapshot = buildEntitlementSnapshot({
        slug:String(planRows[0].slug),
        maxActiveStrategies:planRows[0].max_active_strategies==null?null:Number(planRows[0].max_active_strategies),
        entitlements:planRows[0].entitlements,
        availableStrategyKeys:planRows[0].available_strategy_keys
      });
      const [countRows,accountRows]=await Promise.all([
        tx.unsafe("SELECT count(*)::int AS count FROM strategy_instances WHERE user_id=$1 AND status='ACTIVE' AND id<>$2",[userId,instanceId]),
        tx.unsafe("SELECT count(*)::int AS count FROM strategy_accounts WHERE strategy_instance_id=$1",[instanceId])
      ]);
      assertCanCreateStrategy(snapshot,Number(countRows[0]?.count??0),String(instance.strategy_key));
      assertStrategyFeatureAccess(snapshot,{accountCount:Number(accountRows[0]?.count??1)});
      await tx.unsafe("UPDATE strategy_instances SET status='ACTIVE',paused_at=NULL,health_status='NEEDS_ATTENTION',updated_at=now() WHERE id=$1",[instanceId]);
      await tx.unsafe("UPDATE strategy_states SET state=jsonb_set(state,'{forceReview}','true'::jsonb,true),calculated_at=now() WHERE strategy_instance_id=$1",[instanceId]);
    } else if (target === "PAUSED") {
      await tx.unsafe("UPDATE strategy_instances SET status='PAUSED',paused_at=now(),updated_at=now() WHERE id=$1",[instanceId]);
      await tx.unsafe("UPDATE actions SET status='CANCELLED',cancelled_at=now(),updated_at=now() WHERE strategy_instance_id=$1 AND status IN ('CALCULATED','NOTIFIED','ACKNOWLEDGED')",[instanceId]);
    } else {
      await tx.unsafe("UPDATE strategy_instances SET status='CLOSED',closed_at=now(),paused_at=NULL,updated_at=now() WHERE id=$1",[instanceId]);
      await tx.unsafe("UPDATE actions SET status='CANCELLED',cancelled_at=now(),updated_at=now() WHERE strategy_instance_id=$1 AND status IN ('CALCULATED','NOTIFIED','ACKNOWLEDGED')",[instanceId]);
    }
    await tx.unsafe(
      "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'strategy.status-changed','strategy_instance',$2,$3::jsonb)",
      [userId,instanceId,JSON.stringify({from:current,to:target})]
    );
    return {status:target};
  });
}


export async function listStrategyAccounts(userId:string,instanceId:string){
  return sql.unsafe(
    "SELECT a.id,a.name,a.wrapper,a.country,a.currency,a.broker_name,sa.role,"+
    "(SELECT count(*)::int FROM ledger_events l WHERE l.strategy_instance_id=sa.strategy_instance_id AND l.account_id=a.id) AS ledger_event_count,"+
    "(SELECT count(*)::int FROM ledger_events l WHERE l.strategy_instance_id=sa.strategy_instance_id AND l.account_id=a.id AND l.event_type IN ('OPENING_CASH','OPENING_POSITION')) AS opening_event_count "+
    "FROM strategy_accounts sa JOIN accounts a ON a.id=sa.account_id JOIN strategy_instances i ON i.id=sa.strategy_instance_id "+
    "WHERE sa.strategy_instance_id=$1 AND i.user_id=$2 ORDER BY CASE WHEN sa.role='PRIMARY' THEN 0 ELSE 1 END,a.created_at,a.name",
    [instanceId,userId]
  );
}
