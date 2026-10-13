import {requireAdmin} from "@/lib/session";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import {authFailure} from "@/lib/api-auth";
import {ensureSettings} from "@/lib/settings";
import {requireTurnstile,TurnstileError} from "@/domain/turnstile";
import {z} from "zod";

const inputSchema=z.object({token:z.string().min(1).max(2048)});
/** Admin-only functional test using a real browser challenge against the saved widget credentials.
 * This endpoint never returns or logs the private Cloudflare key.
 */
export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const admin=await requireAdmin();
    await consumeRateLimit("admin-turnstile-test:"+admin.id,6,300);
    const {token}=inputSchema.parse(await request.json());
    await ensureSettings(true);
    await requireTurnstile({
      action:"admin-test",
      token,
      env:{...process.env,TURNSTILE_ENABLED:"true"}
    });
    return Response.json({ok:true,verified:true},{headers:{"cache-control":"no-store"}});
  }catch(error){
    const denied=authFailure(error);if(denied)return denied;
    if(error instanceof TurnstileError){
      const unavailable=error.code==="TURNSTILE_UNAVAILABLE"||error.code==="TURNSTILE_CONFIGURATION_ERROR";
      return Response.json({ok:false,error:unavailable?
        "Cloudflare verification is unavailable or not configured. Check the saved site/secret keys.":
        "Challenge rejected. Check that the Cloudflare widget allows this hostname and the keys match."},
        {status:unavailable?503:403,headers:{"cache-control":"no-store"}});
    }
    if(error instanceof z.ZodError)return Response.json({ok:false,error:"Complete the challenge before testing."},{status:400});
    if(error instanceof Error&&error.message==="RATE_LIMITED")return Response.json({ok:false,error:"Too many tests. Try again later."},{status:429});
    return Response.json({ok:false,error:"Could not test Cloudflare Turnstile."},{status:500});
  }
}
