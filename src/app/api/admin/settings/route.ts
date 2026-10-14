import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { assertSameOrigin, consumeRateLimit } from "@/lib/security";
import { authFailure } from "@/lib/api-auth";
import { listSettings, saveSettings } from "@/lib/settings";
import { isMfaEnabled } from "@/lib/mfa";

const body = z.object({
  changes: z.array(z.object({ key: z.string().min(1).max(80), value: z.string().max(4000).nullable() })).min(1).max(60)
});

export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ settings: await listSettings() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const denied = authFailure(error);
    if (denied) return denied;
    return Response.json({ error: "Could not load settings." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    await consumeRateLimit("admin-settings:" + admin.id, 60, 15 * 60);
    const input = body.parse(await request.json());

    // Two changes that could shut the operator out of their own screen are refused up front.
    const errors: Record<string, string> = {};
    for (const change of input.changes) {
      if (change.key === "NEXT_PUBLIC_APP_URL" && change.value) {
        const requestOrigin = request.headers.get("origin");
        let target = "";
        try { target = new URL(change.value).origin; } catch { /* validated by saveSettings */ }
        if (target && requestOrigin && target !== requestOrigin) {
          errors[change.key] = "This must be the address you are using right now (" + requestOrigin + "). A different address would block every request from this browser, including the one that could undo it.";
        }
      }
      if (change.key === "ADMIN_MFA_REQUIRED" && change.value === "true" && !(await isMfaEnabled(admin.id))) {
        errors[change.key] = "Turn on two-step sign-in for your own account first (Settings > Security), otherwise you would lock yourself out of admin tools.";
      }
    }
    // Apply the proposed Turnstile changes as a set, rather than letting a
    // half-configured widget lock customers out of registration or sign-in.
    if(input.changes.some(c=>c.key.startsWith("TURNSTILE_"))){
      const current=await listSettings();
      const values=new Map(input.changes.map(c=>[c.key,c.value]));
      const effective=(key:string)=>values.has(key)?values.get(key):current.find(s=>s.key===key)?.value;
      const enabled=effective("TURNSTILE_ENABLED")==="true";
      const hasSecret=values.has("TURNSTILE_SECRET_KEY")?Boolean(values.get("TURNSTILE_SECRET_KEY")):
        current.some(s=>s.key==="TURNSTILE_SECRET_KEY"&&s.source!=="unset");
      const changingSite=values.has("TURNSTILE_SITE_KEY");
      const changingSecret=values.has("TURNSTILE_SECRET_KEY");
      if(changingSite&&!changingSecret){
        errors.TURNSTILE_SITE_KEY="Change the site key and matching secret together, or clear both.";
      }
      if(enabled&&changingSite){
        errors.TURNSTILE_ENABLED="Turn off protection and save before replacing your Cloudflare keys.";
      }else if(enabled&&(!effective("TURNSTILE_SITE_KEY")||!hasSecret)){
        errors.TURNSTILE_ENABLED="Save the Cloudflare site key and secret key before enabling protection.";
      }
    }
    if (Object.keys(errors).length) return Response.json({ error: "Some settings were not saved.", errors }, { status: 400 });

    const result = await saveSettings(admin.id, input.changes);
    if (!result.ok) return Response.json({ error: "Some settings were not saved.", errors: result.errors }, { status: 400 });
    return Response.json({ ok: true, changed: result.changed, settings: await listSettings() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const denied = authFailure(error);
    if (denied) return denied;
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid request." }, { status: 400 });
    if (error instanceof Error && error.message === "RATE_LIMITED") return Response.json({ error: "Too many changes. Try again in a few minutes." }, { status: 429 });
    return Response.json({ error: "Could not save settings." }, { status: 500 });
  }
}
