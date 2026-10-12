import { requireUser } from "@/lib/session";
import { invalidPathId } from "@/lib/route-params";
import { getStrategyForUser } from "@/lib/strategy-service";
import { calculateAction } from "@/lib/action-service";
import { assertSameOrigin } from "@/lib/security";
import { authFailure } from "@/lib/api-auth";

export async function POST(request: Request, context: { params: Promise<{id:string}> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const {id} = await context.params;
    const badId = invalidPathId(id); if (badId) return badId;
    const strategy = await getStrategyForUser(user.id,id);
    if (!strategy) return Response.json({error:"Not found."},{status:404});
    const result = await calculateAction(id);
    return Response.json({ok:true,actionId:result.actionId});
  } catch(error){const denied=authFailure(error);if(denied)return denied;
    return Response.json({error:"Could not recalculate this strategy."},{status:500});
  }
}
