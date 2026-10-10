import { z } from "zod";
import { requireUser } from "@/lib/session";
import { migrateStrategyVersion } from "@/lib/strategy-service";
import { previewStrategyVersionScenario, recalculateAfterMutation } from "@/lib/action-service";
import { assertSameOrigin } from "@/lib/security";
import { authFailure } from "@/lib/api-auth";
import { StrategyMarketUnavailableError } from "@/domain/strategy/market-eligibility";

const schema=z.object({targetVersionId:z.string().uuid(),settings:z.record(z.string(),z.unknown()).optional()});

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    const {id}=await context.params;
    const input=schema.parse(await request.json());
    const result=await previewStrategyVersionScenario(user.id,id,input.targetVersionId,input.settings);
    return Response.json({ok:true,preview:true,result});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof StrategyMarketUnavailableError)return Response.json({error:error.message,code:error.code,missingExposures:error.assessment.missingExposures,supportedMarkets:error.assessment.supportedMarkets},{status:422});
    if(error instanceof z.ZodError)return Response.json({error:"Invalid version preview."},{status:400});
    const code=error instanceof Error?error.message:"FAILED";
    const messages:Record<string,string>={
      INVALID_TARGET_VERSION:"That strategy version is not available.",
      ENGINE_MIGRATION_NOT_SUPPORTED:"This release changes engine families and cannot be previewed with the current migration path.",
      STRATEGY_INSTANCE_NOT_FOUND:"Strategy not found."
    };
    if(code.startsWith("MISSING_STRATEGY_INPUT:"))return Response.json({error:"This strategy release requires additional setup information before it can be previewed."},{status:409});
    return Response.json({error:messages[code]??"Could not preview this strategy version."},{status:400});
  }
}

export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    const {id}=await context.params;
    const input=schema.parse(await request.json());
    const result=await migrateStrategyVersion(user.id,id,input.targetVersionId,input.settings);
    const recalc=result.changed&&result.status==="ACTIVE"?await recalculateAfterMutation(id,user.id,"strategy-version-update"):{actionId:null,recalculationPending:false,errorCode:null};
    return Response.json({ok:true,changed:result.changed,actionId:recalc.actionId,recalculationPending:recalc.recalculationPending});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof StrategyMarketUnavailableError)return Response.json({error:error.message,code:error.code,missingExposures:error.assessment.missingExposures,supportedMarkets:error.assessment.supportedMarkets},{status:422});
    if(error instanceof z.ZodError)return Response.json({error:"Invalid version update."},{status:400});
    const code=error instanceof Error?error.message:"FAILED";
    const messages:Record<string,string>={
      STRATEGY_INSTANCE_NOT_FOUND:"Strategy not found.",
      STRATEGY_ALREADY_CLOSED:"A closed strategy cannot be updated.",
      INVALID_TARGET_VERSION:"That strategy version is not available.",
      ENGINE_MIGRATION_NOT_SUPPORTED:"This release changes engine families and requires an administrator migration path."
    };
    if(code.startsWith("MISSING_STRATEGY_INPUT:"))return Response.json({error:"This strategy release requires additional setup information."},{status:409});
    return Response.json({error:messages[code]??"Could not update the strategy version."},{status:400});
  }
}
