import { EXECUTABLE_ACTION_STATUS_SQL } from "@/domain/actions";
import "server-only";
import {assertUserStrategyAccessWith} from "@/lib/user-strategy-access";
import { sql } from "@/lib/db";
import { foldAccountLedger } from "@/domain/ledger";
import { getStrategyEngine } from "@/domain/strategy/registry";
import { parseInputSchema, validateInstanceSettings } from "@/domain/strategy/config";
import { assertCanCreateStrategy, assertStrategyFeatureAccess } from "@/domain/entitlements";
import { loadEntitlementsWith } from "@/lib/entitlement-service";
import { recalculateAfterMutation } from "@/lib/action-service";
import { assessStrategyMarket, StrategyMarketUnavailableError } from "@/domain/strategy/market-eligibility";
import { requiredPositions } from "@/domain/strategy/market-eligibility";
import { switchPositionDiscrepancies } from "@/domain/strategy/switch-position-eligibility";
import {TRINITY_US_SIGNAL} from "@/domain/strategy/trinity-model";
import { VERIFIED_MARKET_MAPPINGS_SQL, verifiedCandidates } from "@/lib/verified-market-mappings";
import { assertDisabledStrategyPreviewGates } from "@/lib/admin-preview-gates";

export async function switchStrategy(
  userId:string,
  strategyInstanceId:string,
  input:{targetStrategyKey:string;settings?:Record<string,unknown>;name?:string}
){
  const switched=await sql.begin(async(tx)=>{
    const userRows=await tx.unsafe("SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[userId]);
    if(!userRows[0])throw new Error("UNAUTHENTICATED");

    const currentRows=await tx.unsafe(
      "SELECT i.*,d.key AS strategy_key,s.state FROM strategy_instances i JOIN strategy_definitions d ON d.id=i.strategy_definition_id JOIN strategy_states s ON s.strategy_instance_id=i.id "+
      "WHERE i.id=$1 AND i.user_id=$2 FOR UPDATE OF i",
      [strategyInstanceId,userId]
    );
    const current=currentRows[0];
    if(!current)throw new Error("STRATEGY_INSTANCE_NOT_FOUND");
    if(String(current.status)==="CLOSED")throw new Error("STRATEGY_ALREADY_CLOSED");
    const currentState=(current.state??{}) as Record<string,unknown>;
    if(currentState.resumeNeedsReconciliation||currentState.unresolvedReconciliation)throw new Error("STRATEGY_SWITCH_REQUIRES_RECONCILIATION");

    // Role-aware (an ADMIN is an entitlement super-user) and loaded before the target lookup because
    // only the server-derived snapshot may let a disabled definition through.
    const entitlements=await loadEntitlementsWith(tx,userId,{lockSubscription:true});
    const targets=await tx.unsafe(
      "SELECT d.id AS definition_id,d.key,d.name,d.enabled,d.supported_regions,d.supported_wrappers,v.id AS version_id,v.version,v.engine_key,v.config,v.input_schema "+
      "FROM strategy_definitions d JOIN LATERAL ("+
      " SELECT * FROM strategy_versions v WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED' "+
      " AND v.effective_from<=current_date AND (v.effective_to IS NULL OR v.effective_to>=current_date) "+
      " ORDER BY v.effective_from DESC,v.published_at DESC NULLS LAST LIMIT 1"+
      ") v ON true WHERE d.key=$1 AND (d.enabled=true OR $2::boolean) LIMIT 1",
      [input.targetStrategyKey,entitlements.includeDisabledStrategies===true]
    );
    const target=targets[0];
    if(!target)throw new Error("STRATEGY_NOT_AVAILABLE");
    await assertDisabledStrategyPreviewGates(tx,target);
    await assertUserStrategyAccessWith(tx,userId,String(target.definition_id));
    if(String(target.definition_id)===String(current.strategy_definition_id))throw new Error("STRATEGY_ALREADY_SELECTED");

    const activeRows=await tx.unsafe(
      "SELECT count(*)::int AS count FROM strategy_instances WHERE user_id=$1 AND status='ACTIVE' AND id<>$2",
      [userId,strategyInstanceId]
    );
    assertCanCreateStrategy(entitlements,Number(activeRows[0]?.count??0),String(target.key));

    const accounts=await tx.unsafe(
      "SELECT a.id,a.name,a.wrapper,a.country,a.currency,a.broker_name,sa.role "+
      "FROM strategy_accounts sa JOIN accounts a ON a.id=sa.account_id "+
      "WHERE sa.strategy_instance_id=$1 ORDER BY CASE WHEN sa.role='PRIMARY' THEN 0 ELSE 1 END,a.created_at,a.name",
      [strategyInstanceId]
    );
    if(!accounts.length)throw new Error("STRATEGY_ACCOUNT_MISSING");
    assertStrategyFeatureAccess(entitlements,{accountCount:accounts.length});
    const accountCurrencies=new Set(accounts.map((account)=>String(account.currency).toUpperCase()));
    if(accountCurrencies.size!==1)throw new Error("SWITCH_MIXED_ACCOUNT_CURRENCIES_UNSUPPORTED");

    const regions=Array.isArray(target.supported_regions)?target.supported_regions.map(String):[];
    const wrappers=Array.isArray(target.supported_wrappers)?target.supported_wrappers.map(String):[];
    for(const account of accounts){
      if(regions.length&&!regions.includes(String(account.country)))throw new Error("STRATEGY_NOT_SUPPORTED_IN_REGION");
      if(wrappers.length&&!wrappers.includes(String(account.wrapper)))throw new Error("STRATEGY_NOT_SUPPORTED_FOR_WRAPPER");
    }

    const approvedMappings=verifiedCandidates(await tx.unsafe(VERIFIED_MARKET_MAPPINGS_SQL));
    for(const account of accounts){
      const choice={country:String(account.country),wrapper:String(account.wrapper),currency:String(account.currency).toUpperCase(),broker:account.broker_name?String(account.broker_name):null};
      const market=assessStrategyMarket(String(target.engine_key),(target.config??{}) as Record<string,unknown>,approvedMappings,choice,new Date().toISOString().slice(0,10));
      if(!market.available)throw new StrategyMarketUnavailableError(market,choice);
    }

    const engine=getStrategyEngine(String(target.engine_key));
    const config=(target.config??{}) as Record<string,unknown>;
    engine.validateConfig(config);
    const settings=validateInstanceSettings(parseInputSchema(target.input_schema),input.settings);

    const snapshots:Array<{
      account:any;
      cash:string;
      quantities:Array<{instrumentId:string;quantity:string}>;
    }>=[];
    const ledger=await tx.unsafe(
      "SELECT account_id,event_type,currency,cash_amount,fee_amount,instrument_id,quantity FROM ledger_events "+
      "WHERE strategy_instance_id=$1 ORDER BY occurred_at,created_at",
      [strategyInstanceId]
    );
    const primaryAccountId=current.account_id?String(current.account_id):null;
    for(const account of accounts){
      // Canonical per-account fold shared with calculation and execution: a null-account row
      // (legacy / ON DELETE SET NULL) belongs to the strategy's primary account.
      const folded=foldAccountLedger(ledger,String(account.id),primaryAccountId,String(account.currency));
      const foreign=[...folded.cashByCurrency.entries()].filter(([currency,value])=>currency!==String(account.currency).toUpperCase()&&!value.eq(0));
      if(foreign.length)throw new Error("SWITCH_FOREIGN_CASH_UNSUPPORTED");
      if(folded.cash.lt(0))throw new Error("SWITCH_NEGATIVE_CASH_UNSUPPORTED");
      snapshots.push({
        account,
        cash:folded.cash.toString(),
        quantities:[...folded.quantities.entries()].filter(([,quantity])=>!quantity.eq(0)).map(([instrumentId,quantity])=>({instrumentId,quantity:quantity.toString()}))
      });
    }

    // Refuse to close the original strategy when the destination cannot manage
    // the EXISTING positions. Otherwise the switch creates a permanently blocked
    // new journey (unrecognised exposure) after irrevocably closing the old one.
    const positions=snapshots.flatMap(snapshot=>snapshot.quantities);
    if(positions.length){
      const instrumentIds=[...new Set(positions.map(position=>position.instrumentId))];
      const instruments=await tx.unsafe(
        "SELECT id::text AS id,economic_exposure AS exposure,leverage::text AS leverage,direction FROM instruments WHERE id=ANY($1::uuid[])",
        [instrumentIds]
      );
      const blocked=switchPositionDiscrepancies(positions,instruments.map(row=>({
        id:String(row.id),exposure:String(row.exposure),
        leverage:String(row.leverage),direction:String(row.direction)
      })),requiredPositions(String(target.engine_key),config).filter(position=>
        !(String(target.engine_key)==="TRINITY_HYBRID"&&position.economicExposure===TRINITY_US_SIGNAL)));
      if(blocked.length)throw new Error("STRATEGY_SWITCH_REQUIRES_RECONCILIATION");
    }

    await tx.unsafe(
      "UPDATE strategy_instances SET status='CLOSED',closed_at=now(),paused_at=NULL,updated_at=now() WHERE id=$1",
      [strategyInstanceId]
    );
    await tx.unsafe(
      "UPDATE actions SET status='CANCELLED',cancelled_at=now(),updated_at=now() "+
      "WHERE strategy_instance_id=$1 AND status IN ("+EXECUTABLE_ACTION_STATUS_SQL+")",
      [strategyInstanceId]
    );

    const primary=accounts.find((account)=>String(account.role)==="PRIMARY")??accounts[0];
    const inserted=await tx.unsafe(
      "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name,status,onboarding_mode,started_at,health_status,settings,execution_constraints,contribution_plan,admin_disabled_preview) "+
      "VALUES ($1,$2,$3,$4,$5,'ACTIVE','RESUME',now(),'NEEDS_ATTENTION',$6::jsonb,$7::jsonb,$8::jsonb,$9) RETURNING id",
      [
        userId,primary.id,target.definition_id,target.version_id,
        input.name?.trim()||String(current.name),
        JSON.stringify(settings),
        JSON.stringify(current.execution_constraints??{}),
        JSON.stringify(current.contribution_plan??{}),
        target.enabled!==true
      ]
    );
    const newId=String(inserted[0].id);

    for(const account of accounts){
      await tx.unsafe(
        "INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,$3)",
        [newId,account.id,account.role]
      );
    }

    await tx.unsafe(
      "INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state,confidence) VALUES ($1,$2,$3::jsonb,'MEDIUM')",
      [newId,target.version_id,JSON.stringify({forceReview:true,switchedFromStrategyInstanceId:strategyInstanceId,switchStartedAt:new Date().toISOString()})]
    );

    for(const snapshot of snapshots){
      if(snapshot.cash!=="0"){
        await tx.unsafe(
          "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,provenance,confidence,metadata) "+
          "VALUES ($1,$2,now(),'OPENING_CASH',$3,$4,'SYSTEM','VERIFIED',$5::jsonb)",
          [newId,snapshot.account.id,snapshot.account.currency,snapshot.cash,JSON.stringify({strategySwitch:true,switchedFromStrategyInstanceId:strategyInstanceId})]
        );
      }
      for(const position of snapshot.quantities){
        await tx.unsafe(
          "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,provenance,confidence,metadata) "+
          "VALUES ($1,$2,now(),'OPENING_POSITION',$3,0,$4,$5,'SYSTEM','VERIFIED',$6::jsonb)",
          [newId,snapshot.account.id,snapshot.account.currency,position.instrumentId,position.quantity,JSON.stringify({strategySwitch:true,switchedFromStrategyInstanceId:strategyInstanceId})]
        );
      }
    }

    await tx.unsafe(
      "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'strategy.switched','strategy_instance',$2,$3::jsonb)",
      [userId,newId,JSON.stringify({fromStrategyInstanceId:strategyInstanceId,fromStrategyKey:String(current.strategy_key),toStrategyKey:String(target.key),targetVersion:String(target.version),accountIds:accounts.map((account)=>String(account.id))})]
    );
    return {newStrategyInstanceId:newId,targetName:String(target.name)};
  });

  const recalc=await recalculateAfterMutation(switched.newStrategyInstanceId,userId,"strategy-switch");
  return {...switched,actionId:recalc.actionId,recalculationPending:recalc.recalculationPending};
}
