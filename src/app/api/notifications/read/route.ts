import { z } from "zod";
import { requireUser } from "@/lib/session";
import { sql } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";
import { authFailure } from "@/lib/api-auth";

const schema=z.union([
  z.object({all:z.literal(true)}).strict(),
  z.object({ids:z.array(z.string().uuid()).min(1).max(100)}).strict()
]);

// Marks the caller's own notifications as read. The Activity page shows one row per action
// (DISTINCT ON COALESCE(action_id,id)), so a row id marks its whole group.
export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    const input=schema.parse(await request.json());
    if("all" in input){
      await sql.unsafe("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL",[user.id]);
    }else{
      await sql.unsafe(
        "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND COALESCE(action_id,id) IN (SELECT COALESCE(action_id,id) FROM notifications WHERE user_id=$1 AND id=ANY($2::uuid[]))",
        [user.id,input.ids]
      );
    }
    return Response.json({ok:true});
  }catch(error){
    const denied=authFailure(error);
    if(denied)return denied;
    if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"Invalid request."},{status:400});
    if(error instanceof Error&&error.message==="INVALID_ORIGIN")return Response.json({error:"Request origin not allowed."},{status:403});
    return Response.json({error:"Could not update notifications."},{status:500});
  }
}
