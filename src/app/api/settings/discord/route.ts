import { z } from "zod";
import { requireUser } from "@/lib/session";
import { assertNotificationAllowed } from "@/lib/entitlement-service";
import { encryptSecret } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";
import { authFailure } from "@/lib/api-auth";

import { isDiscordWebhookUrl } from "@/domain/discord-webhook";

const schema=z.object({webhook:z.string().max(500).refine(isDiscordWebhookUrl)});

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    await assertNotificationAllowed(user.id,"DISCORD");
    const input=schema.parse(await request.json());
    const encrypted=encryptSecret(input.webhook);
    await sql.unsafe(
      "INSERT INTO notification_endpoints (user_id,channel,encrypted_destination,enabled) VALUES ($1,'DISCORD',$2,true) ON CONFLICT (user_id,channel) DO UPDATE SET encrypted_destination=EXCLUDED.encrypted_destination,enabled=true,updated_at=now()",
      [user.id,encrypted]
    );
    return Response.json({ok:true});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Enter a valid Discord webhook."},{status:400});
    const code=error instanceof Error?error.message:"FAILED";
    if(code==="CHANNEL_NOT_IN_PLAN")return Response.json({error:"Discord notifications are not included in your plan."},{status:403});
    return Response.json({error:"Could not save webhook."},{status:500});
  }
}
