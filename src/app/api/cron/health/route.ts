import { ensureSettings } from "@/lib/settings";
import { cronAuthorized } from "@/lib/cron-auth";
import { runOpsCheck } from "@/lib/ops-monitor";

export const dynamic = "force-dynamic";

// Runs the operational health check and emails administrators about changes. The hourly job calls
// the same check itself; this endpoint exists so a SECOND scheduler or an uptime monitor can call it
// too, which is the only way to notice that the hourly job itself has stopped. A 503 answer when a
// critical problem exists lets a plain uptime monitor alert on it as well.
async function handle(request: Request) {
  if (!cronAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  await ensureSettings();
  try {
    const result = await runOpsCheck();
    const critical = result.alerts.some((a) => a.severity === "critical");
    return Response.json({ ok: !critical, ...result }, { status: critical ? 503 : 200, headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "check failed" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
export const GET = handle;
export const POST = handle;
