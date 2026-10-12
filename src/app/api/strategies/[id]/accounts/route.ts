import { z } from "zod";
import { requireUser } from "@/lib/session";
import { listStrategyAccounts } from "@/lib/strategy-service";
import { recalculateAfterMutation } from "@/lib/action-service";
import { assertSameOrigin } from "@/lib/security";
import { sql } from "@/lib/db";
import { loadEntitlementsWith } from "@/lib/entitlement-service";
import { authFailure } from "@/lib/api-auth";

const schema=z.object({
  name:z.string().min(1).max(80),
  wrapper:z.string().min(1).max(40),
  broker:z.string().max(80).optional().nullable(),
  currency:z.string().length(3)
});

export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
  try{
    const user=await requireUser();
    const {id}=await context.params;
    return Response.json({accounts:await listStrategyAccounts(user.id,id)});
  }catch(error){
    const denied=authFailure(error);
    if(denied)return denied;
    return Response.json({error:"Could not load accounts."},{status:500});
  }
}

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    const {id}=await context.params;
    const input=schema.parse(await request.json());

    const result=await sql.begin(async(tx)=>{
      const rows=await tx.unsafe(
        "SELECT i.id,i.status,d.supported_regions,d.supported_wrappers,a.currency,a.country "+
        "FROM strategy_instances i JOIN strategy_definitions d ON d.id=i.strategy_definition_id JOIN accounts a ON a.id=i.account_id "+
        "WHERE i.id=$1 AND i.user_id=$2 FOR UPDATE OF i",
        [id,user.id]
      );
      const strategy=rows[0];
      if(!strategy)throw new Error("STRATEGY_NOT_FOUND");
      if(String(strategy.status)==="CLOSED")throw new Error("STRATEGY_CLOSED");

      // Entitlement is checked under the subscription row lock so a concurrent
      // downgrade cannot race a second-account insert.
      // Admins are entitlement super-users (no plan row to race), so no lock is taken for them.
      const entitlements=await loadEntitlementsWith(tx,user.id,{lockSubscription:true});
      if(!entitlements.features.has("multi_account"))throw new Error("MULTI_ACCOUNT_NOT_IN_PLAN");

      const currency=input.currency.toUpperCase();
      if(currency!==String(strategy.currency).toUpperCase())throw new Error("MULTI_ACCOUNT_FX_NOT_SUPPORTED");
      const regions=Array.isArray(strategy.supported_regions)?strategy.supported_regions.map(String):[];
      const wrappers=Array.isArray(strategy.supported_wrappers)?strategy.supported_wrappers.map(String):[];
      if(regions.length&&!regions.includes(String(strategy.country)))throw new Error("STRATEGY_NOT_SUPPORTED_IN_REGION");
      if(wrappers.length&&!wrappers.includes(input.wrapper))throw new Error("STRATEGY_NOT_SUPPORTED_FOR_WRAPPER");
      const counts=await tx.unsafe("SELECT count(*)::int AS count FROM strategy_accounts WHERE strategy_instance_id=$1",[id]);
      if(Number(counts[0]?.count??0)>=10)throw new Error("ACCOUNT_LIMIT");
      const accounts=await tx.unsafe(
        "INSERT INTO accounts (user_id,name,wrapper,country,currency,broker_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [user.id,input.name,input.wrapper,strategy.country,currency,input.broker??null]
      );
      const newId=String(accounts[0].id);
      await tx.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'SECONDARY')",[id,newId]);
      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'strategy.account-added','strategy_instance',$2,$3::jsonb)",
        [user.id,id,JSON.stringify({accountId:newId,wrapper:input.wrapper,currency,broker:input.broker??null})]
      );
      return {accountId:newId,status:String(strategy.status)};
    });
    const recalc=result.status==="ACTIVE"?await recalculateAfterMutation(id,user.id,"linked-account-added"):{actionId:null,recalculationPending:false,errorCode:null};
    return Response.json({ok:true,accountId:result.accountId,actionId:recalc.actionId,recalculationPending:recalc.recalculationPending},{status:201});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Check the account details."},{status:400});
    const code=error instanceof Error?error.message:"FAILED";
    const messages:Record<string,string>={
      STRATEGY_NOT_FOUND:"Strategy not found.",
      STRATEGY_CLOSED:"Closed strategies are read-only.",
      MULTI_ACCOUNT_FX_NOT_SUPPORTED:"For now, accounts inside one strategy must use the same currency. Mixed-currency strategies stay blocked until explicit FX support is configured.",
      STRATEGY_NOT_SUPPORTED_IN_REGION:"This strategy is not supported in that region.",
      STRATEGY_NOT_SUPPORTED_FOR_WRAPPER:"This strategy is not supported for that account type.",
      ACCOUNT_LIMIT:"This strategy already has the maximum number of linked accounts.",
      MULTI_ACCOUNT_NOT_IN_PLAN:"Multiple accounts are not included in your current plan."
    };
    const status=code==="STRATEGY_NOT_FOUND"?404:code==="MULTI_ACCOUNT_NOT_IN_PLAN"?403:code==="STRATEGY_CLOSED"?409:400;
    return Response.json({error:messages[code]??"Could not add the account."},{status});
  }
}
