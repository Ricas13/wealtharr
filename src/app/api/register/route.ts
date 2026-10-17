import { requestIp } from "@/domain/client-ip";
import { newAccountIsInvited } from "@/domain/beta-invites";
import { ensureSettings } from "@/lib/settings";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sql } from "@/lib/db";
import { assertSameOrigin, consumeRateLimit, hashToken, newToken } from "@/lib/security";
import { getEmailProvider } from "@/lib/email";
import { requireTurnstile, TurnstileError } from "@/domain/turnstile";

const schema = z.object({
  email:z.string().email().max(254),
  password:z.string().min(12).max(128),
  country:z.string().length(2).default("GB"),
  baseCurrency:z.string().length(3).default("GBP"),
  turnstileToken:z.string().max(2048).optional()
});

export async function POST(request: Request) {
  await ensureSettings();
  try {
    assertSameOrigin(request);
    const ip = requestIp(request);
    await consumeRateLimit("register:" + ip, 8, 3600);
    const parsed = schema.parse(await request.json());
    await requireTurnstile({action:"register",token:parsed.turnstileToken,env:process.env});
    if (!newAccountIsInvited(parsed.email,process.env)) {
      return Response.json({error:"Registration is currently by invitation."},{status:403});
    }
    // Stored lowercase: the database enforces uniqueness on lower(email).
    const input = { ...parsed, email: parsed.email.trim().toLowerCase() };
    const passwordHash = await bcrypt.hash(input.password, 12);
    const token = newToken();
    const tokenHash = hashToken(token);
    const verifyUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "") + "/verify-email?token=" + encodeURIComponent(token);

    const result = await sql.begin(async (tx) => {
      const existing = await tx.unsafe("SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1",[input.email]);
      if (existing[0]) throw new Error("EMAIL_IN_USE");
      const users = await tx.unsafe(
        "INSERT INTO users (email,password_hash,email_verified_at,country,base_currency) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [input.email,passwordHash,process.env.NODE_ENV === "production" ? null : new Date(),input.country.toUpperCase(),input.baseCurrency.toUpperCase()]
      );
      const free = await tx.unsafe("SELECT id FROM plans WHERE slug='free' LIMIT 1");
      if (!free[0]) throw new Error("FREE_PLAN_MISSING");
      await tx.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'FREE','FREE')",[users[0].id,free[0].id]);
      if (process.env.NODE_ENV === "production") {
        await tx.unsafe("INSERT INTO auth_tokens (user_id,type,token_hash,expires_at) VALUES ($1,'VERIFY_EMAIL',$2,now()+interval '24 hours')",[users[0].id,tokenHash]);
      }
      return String(users[0].id);
    });

    if (process.env.NODE_ENV === "production") {
      const sent = await getEmailProvider().send({to:input.email,subject:"Verify your account",text:"Verify your account: " + verifyUrl});
      if (!sent) return Response.json({ok:true,verificationDelivery:"unavailable"},{status:202});
    }
    return Response.json({ok:true,userId:result});
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({error:"Check your registration details."},{status:400});
    const message = error instanceof Error ? error.message : "REGISTER_FAILED";
    if(error instanceof TurnstileError)return Response.json({error:"Security verification failed. Please complete the challenge and try again."},{status:error.code==="TURNSTILE_UNAVAILABLE"||error.code==="TURNSTILE_CONFIGURATION_ERROR"?503:403});
    if (message === "RATE_LIMITED") return Response.json({error:"Too many attempts."},{status:429});
    if (message === "EMAIL_IN_USE") return Response.json({error:"An account already exists for that email."},{status:409});
    return Response.json({error:"Could not create account."},{status:500});
  }
}
