import { requestIp } from "@/domain/client-ip";
import { ensureSettings } from "@/lib/settings";
import { z } from "zod";
import { sql } from "@/lib/db";
import { assertSameOrigin, consumeRateLimit, hashToken, newToken } from "@/lib/security";
import { getEmailProvider } from "@/lib/email";

const schema = z.object({email:z.string().email()});

export async function POST(request: Request) {
  await ensureSettings();
  try {
    assertSameOrigin(request);
    const input = schema.parse(await request.json());
    const ip = requestIp(request);
    await consumeRateLimit("reset:" + ip, 6, 3600);
    const rows = await sql.unsafe("SELECT id,email FROM users WHERE lower(email)=lower($1) AND deleted_at IS NULL LIMIT 1",[input.email]);
    if (rows[0]) {
      const token = newToken();
      // Only the newest link works: earlier unused ones are retired in the same step the new one is created.
      await sql.begin(async (tx) => {
        await tx.unsafe("UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND type='RESET_PASSWORD' AND used_at IS NULL",[rows[0].id]);
        await tx.unsafe("INSERT INTO auth_tokens (user_id,type,token_hash,expires_at) VALUES ($1,'RESET_PASSWORD',$2,now()+interval '30 minutes')",[rows[0].id,hashToken(token)]);
      });
      const url = (process.env.NEXT_PUBLIC_APP_URL ?? "") + "/reset-password?token=" + encodeURIComponent(token);
      await getEmailProvider().send({to:String(rows[0].email),subject:"Reset your password",text:"Reset your password: " + url});
    }
    return Response.json({ok:true});
  } catch {
    return Response.json({ok:true});
  }
}
