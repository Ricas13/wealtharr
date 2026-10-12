import { z } from "zod";
import { requireUser } from "@/lib/session";
import { sql } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";
import { authFailure } from "@/lib/api-auth";

const schema=z.object({all:z.literal(true)}).strict();

// Marks all of the caller's own notifications as read. Always scoped by user_id.
export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    schema.parse(await request.json());
    await sql.unsafe("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL",[user.id]);
    return Response.json({ok:true});
  }catch(error){
    const denied=authFailure(error);
    if(denied)return denied;
    if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"Invalid request."},{status:400});
    if(error instanceof Error&&error.message==="INVALID_ORIGIN")return Response.json({error:"Request origin not allowed."},{status:403});
    return Response.json({error:"Could not update notifications."},{status:500});
  }
}
