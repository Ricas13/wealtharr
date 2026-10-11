import { z } from "zod";
import { sql } from "@/lib/db";
import { ensureSettings } from "@/lib/settings";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Lets a separate process (the backup container) report that its job just succeeded, so the app can
// raise an alert when it stops reporting. Only known worker names are accepted.
const schema = z.object({ worker: z.enum(["backup"]) });

export async function POST(request: Request) {
  if (!cronAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  await ensureSettings();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Unknown worker." }, { status: 400 });
  await sql.unsafe("INSERT INTO worker_runs (worker_key,status,finished_at,details) VALUES ($1,'SUCCESS',now(),'{}'::jsonb)", [parsed.data.worker]);
  // Keep the table small: one heartbeat a day is plenty of history.
  await sql.unsafe("DELETE FROM worker_runs WHERE worker_key=$1 AND started_at<now()-interval '30 days'", [parsed.data.worker]);
  return Response.json({ ok: true });
}
