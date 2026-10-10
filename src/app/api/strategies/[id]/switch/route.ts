import { z } from "zod";
import { requireUser } from "@/lib/session";
import { assertSameOrigin } from "@/lib/security";
import { switchStrategy } from "@/lib/strategy-switch-service";
import { authFailure } from "@/lib/api-auth";
import { StrategyMarketUnavailableError } from "@/domain/strategy/market-eligibility";

const schema=z.object({
  targetStrategyKey:z.string().min(1).max(80),
  settings:z.record(z.string(),z.unknown()).optional(),
  name:z.string().min(1).max(120).optional()
});

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    const {id}=await context.params;
    const input=schema.parse(await request.json());
    const result=await switchStrategy(user.id,id,input);
    return Response.json({ok:true,...result});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Check the strategy-switch details."},{status:400});
    if(error instanceof StrategyMarketUnavailableError)return Response.json({error:error.message,code:error.code,supportedMarkets:error.assessment.supportedMarkets},{status:422});
    const code=error instanceof Error?error.message:"FAILED";
    const messages:Record<string,string>={
      STRATEGY_INSTANCE_NOT_FOUND:"Strategy not found.",
      STRATEGY_ALREADY_CLOSED:"A closed strategy cannot be switched.",
      STRATEGY_NOT_AVAILABLE:"That strategy is not currently available.",
      STRATEGY_ALREADY_SELECTED:"You are already using that strategy.",
      PLAN_STRATEGY_LIMIT:"Your current plan does not allow another active strategy.",
      STRATEGY_NOT_IN_PLAN:"That strategy is not included in your current plan.",
      MULTI_ACCOUNT_NOT_IN_PLAN:"Your current plan does not support the linked accounts used by this strategy.",
      STRATEGY_NOT_SUPPORTED_IN_REGION:"The target strategy does not support one of your linked account regions.",
      STRATEGY_NOT_SUPPORTED_FOR_WRAPPER:"The target strategy does not support one of your linked account types.",
      STRATEGY_SWITCH_REQUIRES_RECONCILIATION:"Resolve the current portfolio discrepancy before switching strategies.",
      SWITCH_FOREIGN_CASH_UNSUPPORTED:"Convert foreign-currency cash before switching strategies.",
      SWITCH_MIXED_ACCOUNT_CURRENCIES_UNSUPPORTED:"Linked accounts must use one currency before switching strategies.",
      SWITCH_NEGATIVE_CASH_UNSUPPORTED:"Resolve the negative cash balance before switching strategies.",
      STRATEGY_ACCOUNT_MISSING:"This strategy has no account to carry into the new journey."
    };
    if(code.startsWith("MISSING_STRATEGY_INPUT:"))return Response.json({error:"The target strategy needs additional setup information."},{status:409});
    const status=code==="STRATEGY_INSTANCE_NOT_FOUND"?404:["PLAN_STRATEGY_LIMIT","STRATEGY_NOT_IN_PLAN","MULTI_ACCOUNT_NOT_IN_PLAN"].includes(code)?403:409;
    return Response.json({error:messages[code]??"Could not switch strategies."},{status});
  }
}
