import { z } from "zod";
import { requireUser } from "@/lib/session";
import { assertSameOrigin } from "@/lib/security";
import { previewCashScenario, previewExecutionConstraintsScenario, previewStrategySwitchScenario } from "@/lib/action-service";
import { loadEntitlements } from "@/lib/entitlement-service";
import { authFailure } from "@/lib/api-auth";
import { StrategyMarketUnavailableError } from "@/domain/strategy/market-eligibility";

const cashSchema=z.object({
  type:z.enum(["CONTRIBUTION","WITHDRAWAL"]),
  amount:z.string().regex(/^\d+(?:\.\d{1,8})?$/)
});

const constraintsSchema=z.object({
  type:z.literal("EXECUTION_CONSTRAINTS"),
  constraints:z.object({
    fractionalShares:z.boolean().default(true),
    minimumTradeAmount:z.string().regex(/^\d+(?:\.\d{1,8})?$/).default("0"),
    cashBufferAmount:z.string().regex(/^\d+(?:\.\d{1,8})?$/).default("0"),
    flatFee:z.string().regex(/^\d+(?:\.\d{1,8})?$/).default("0"),
    allowSelling:z.boolean().default(true)
  })
});

const switchSchema=z.object({
  type:z.literal("STRATEGY_SWITCH"),
  targetStrategyKey:z.string().min(1).max(80),
  settings:z.record(z.string(),z.unknown()).optional()
});

const schema=z.discriminatedUnion("type",[cashSchema,constraintsSchema,switchSchema]);

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    const {id}=await context.params;
    const entitlements=await loadEntitlements(user.id);
    const input=schema.parse(await request.json());
    if(input.type!=="STRATEGY_SWITCH"&&!entitlements.features.has("what_if")){
      return Response.json({error:"What-if previews are not included in your current plan."},{status:403});
    }
    const result=input.type==="EXECUTION_CONSTRAINTS"
      ?await previewExecutionConstraintsScenario(user.id,id,input.constraints)
      :input.type==="STRATEGY_SWITCH"
        ?await previewStrategySwitchScenario(user.id,id,input.targetStrategyKey,input.settings,entitlements.availableStrategyKeys)
        :await previewCashScenario(user.id,id,input);
    return Response.json({ok:true,preview:true,result});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Enter valid preview settings."},{status:400});
    if(error instanceof StrategyMarketUnavailableError)return Response.json({error:error.message,code:error.code,supportedMarkets:error.assessment.supportedMarkets},{status:422});
    const code=error instanceof Error?error.message:"FAILED";
    if(code==="STRATEGY_INSTANCE_NOT_FOUND")return Response.json({error:"Strategy not found."},{status:404});
    if(code==="INVALID_PREVIEW_AMOUNT")return Response.json({error:"Enter an amount greater than zero."},{status:400});
    const messages:Record<string,string>={
      STRATEGY_NOT_AVAILABLE:"That strategy is not currently available.",
      STRATEGY_NOT_IN_PLAN:"That strategy is not included in your current plan.",
      STRATEGY_ALREADY_SELECTED:"You are already using that strategy.",
      STRATEGY_NOT_SUPPORTED_IN_REGION:"That strategy does not support one of your linked account regions.",
      STRATEGY_NOT_SUPPORTED_FOR_WRAPPER:"That strategy does not support one of your linked account types."
    };
    if(code.startsWith("MISSING_STRATEGY_INPUT:"))return Response.json({error:"This strategy needs additional setup information before it can be previewed."},{status:409});
    return Response.json({error:messages[code]??"Could not preview that scenario."},{status:400});
  }
}
