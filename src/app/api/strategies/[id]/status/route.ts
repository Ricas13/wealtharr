import { z } from "zod";
import { invalidPathId } from "@/lib/route-params";
import { requireUser } from "@/lib/session";
import { changeStrategyStatus } from "@/lib/strategy-service";
import { recalculateAfterMutation } from "@/lib/action-service";
import { assertSameOrigin } from "@/lib/security";
import { authFailure } from "@/lib/api-auth";

const schema = z.object({ status: z.enum(["ACTIVE", "PAUSED", "CLOSED"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const badId = invalidPathId(id); if (badId) return badId;
    const input = schema.parse(await request.json());
    const result = await changeStrategyStatus(user.id, id, input.status);

    const recalc=result.status==="ACTIVE"
      ?await recalculateAfterMutation(id,user.id,"strategy-resume")
      :{actionId:null,recalculationPending:false,errorCode:null};
    return Response.json({ok:true,status:result.status,actionId:recalc.actionId,recalculationPending:recalc.recalculationPending});
  } catch(error){const denied=authFailure(error);if(denied)return denied;
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid strategy status." }, { status: 400 });
    const code = error instanceof Error ? error.message : "FAILED";
    if (code === "STRATEGY_INSTANCE_NOT_FOUND") return Response.json({ error: "Not found." }, { status: 404 });
    if (code === "STRATEGY_ALREADY_CLOSED") return Response.json({ error: "A closed strategy cannot be reopened." }, { status: 409 });
    if (code === "STRATEGY_NOT_AVAILABLE") return Response.json({ error: "That strategy is not currently available to resume.", code }, { status: 409 });
    if (code === "PLAN_STRATEGY_LIMIT" || code === "STRATEGY_NOT_IN_PLAN" || code === "MULTI_ACCOUNT_NOT_IN_PLAN") {
      return Response.json({
        error: code==="MULTI_ACCOUNT_NOT_IN_PLAN"
          ? "This strategy uses multiple linked accounts, which are not included in your current plan."
          : "Your current plan does not allow this strategy to be resumed."
      }, { status: 403 });
    }
    return Response.json({ error: "Could not update strategy status." }, { status: 500 });
  }
}
