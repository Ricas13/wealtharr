import { z } from "zod";
import { requireUser } from "@/lib/session";
import { executeAction } from "@/lib/action-service";
import { assertSameOrigin } from "@/lib/security";
import { authFailure } from "@/lib/api-auth";

const positive = z.string().regex(/^\d+(?:\.\d{1,12})?$/);
const nonNegative = z.string().regex(/^\d+(?:\.\d{1,12})?$/);
const schema = z.object({
  price: positive.optional(),
  quantity: positive.optional(),
  fee: nonNegative.optional(),
  partial: z.boolean().optional(),
  executedAt:z.string().datetime({offset:true}).optional()
});

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    const {id}=await context.params;
    const input=schema.parse(await request.json().catch(()=>({})));
    const result=await executeAction(user.id,id,input);
    return Response.json({ok:true,...result});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Enter valid price, quantity and fee values."},{status:400});
    const code=error instanceof Error?error.message:"FAILED";
    const messages:Record<string,string>={
      EXECUTION_DETAILS_REQUIRED:"Confirm the execution price before marking this trade complete.",
      EXECUTION_PRECISION_UNSUPPORTED:"These fill values exceed ledger precision (12 quantity, 10 price and 8 cash/fee decimal places). Check your broker confirmation; the fill has not been rounded or saved.",
      EXECUTION_AMOUNT_TOO_LARGE:"These fill values exceed the supported ledger amount. Check your broker confirmation.",
      ACTION_STALE_LEDGER_MUTATION:"Your portfolio changed after this instruction was calculated. Refresh and recalculate before recording a trade or completing the review.",
      ACTION_STALE_INPUTS:"This instruction no longer matches current prices or strategy settings. Recalculate first. If you already traded, record the actual broker fill using historical transaction import or reconciliation.",
      REBALANCE_TRADES_REQUIRED:"Record the individual rebalance trades before completing this action.",
      EXECUTION_NOTIONAL_MISMATCH:"The actual fill differs too much from the calculated action. Recalculate before confirming it.",
      INSUFFICIENT_CASH:"This execution would use more cash than the strategy ledger currently has.",
      INSUFFICIENT_HOLDINGS:"This execution would sell more units than the strategy ledger currently holds.",
      EXECUTION_CURRENCY_MISMATCH:"The execution currency does not match the account currency.",
      SELLING_DISABLED:"Sell recommendations are disabled in your trade preferences.",
      FRACTIONAL_SHARES_DISABLED:"Your broker is set to whole shares only. Enter a whole-share quantity or recalculate.",
      BELOW_MINIMUM_TRADE:"This execution is below your configured minimum trade size.",
      STRATEGY_NOT_ACTIVE:"Resume this strategy before completing an action.",
      INVALID_EXECUTION_TIMESTAMP:"Enter the real trade date and time, including your local timezone.",
      EXECUTION_BEFORE_ACTION:"This trade predates the calculated instruction. Add it as a historical transaction instead.",
      EXECUTION_OUT_OF_ORDER:"A more recent ledger transaction is already recorded. Use historical transaction import/reconciliation to correct the timeline."
    };
    return Response.json({error:messages[code]??"Could not complete this action."},{status:400});
  }
}
