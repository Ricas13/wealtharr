import { requestIp } from "@/domain/client-ip";
import { sql } from "@/lib/db";
import { assertSameOrigin, consumeRateLimit, hashToken } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await consumeRateLimit("verify-email:" + requestIp(request), 20, 3600);
    const body = await request.json();
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token) return Response.json({error:"Invalid token."},{status:400});
    const verified = await sql.begin(async (tx) => {
      // Consuming the token is the check, so concurrent submissions cannot both succeed.
      const consumed = await tx.unsafe(
        "UPDATE auth_tokens SET used_at=now() WHERE token_hash=$1 AND type='VERIFY_EMAIL' AND used_at IS NULL AND expires_at>now() RETURNING user_id",
        [hashToken(token)]
      );
      if (!consumed[0]) return false;
      await tx.unsafe("UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$1 AND deleted_at IS NULL",[consumed[0].user_id]);
      return true;
    });
    if (!verified) return Response.json({error:"Token is invalid or expired."},{status:400});
    return Response.json({ok:true});
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return Response.json({error:"Too many attempts. Try again later."},{status:429});
    return Response.json({error:"Could not verify email."},{status:500});
  }
}
