import { requireUser } from "@/lib/session";
import { sql } from "@/lib/db";
import { authFailure } from "@/lib/api-auth";
import { consumeRateLimit } from "@/lib/security";

// An export is a bulk read of everything the user owns, so it is bounded three ways: a per-user rate
// limit, a row cap per table, and sequential queries (one pooled connection at a time rather than a
// fan-out of parallel scans).
const EXPORT_ROWS_PER_TABLE = 50_000;
const EXPORT_LIMIT = 5;
const EXPORT_WINDOW_SECONDS = 60 * 60;
const NO_STORE = { "cache-control": "no-store" } as const;

// Everything the user owns, scoped by user_id or by their own strategy instances. Secrets are not
// exported: notification endpoints hold an encrypted webhook URL and are listed without it.
// A table that reaches the cap is returned truncated (oldest rows first) and named in `truncatedTables`.
export async function GET() {
  try {
    const user = await requireUser();
    await consumeRateLimit("account-export:" + user.id, EXPORT_LIMIT, EXPORT_WINDOW_SECONDS);
    const truncatedTables: string[] = [];
    const capped = async (label: string, query: string, params: Parameters<typeof sql.unsafe>[1]) => {
      // Table and ORDER BY names passed in are string literals in this file, never request input.
      const rows = await sql.unsafe(query + " LIMIT " + (EXPORT_ROWS_PER_TABLE + 1), params);
      if (rows.length > EXPORT_ROWS_PER_TABLE) {
        truncatedTables.push(label);
        return rows.slice(0, EXPORT_ROWS_PER_TABLE);
      }
      return rows;
    };
    const instances = await capped("strategyInstances", "SELECT * FROM strategy_instances WHERE user_id=$1 ORDER BY created_at", [user.id]);
    const ids = instances.map((x: any) => x.id);
    const byInstance = async (table: string, order: string) =>
      ids.length ? await capped(table, `SELECT * FROM ${table} WHERE strategy_instance_id=ANY($1::uuid[]) ORDER BY ${order}`, [ids]) : [];
    const ledger = await byInstance("ledger_events", "occurred_at");
    const actions = await byInstance("actions", "created_at");
    const reconciliations = await byInstance("reconciliations", "occurred_at");
    const overrides = await byInstance("overrides", "created_at");
    const states = await byInstance("strategy_states", "calculated_at");
    const strategyAccounts = await byInstance("strategy_accounts", "created_at");
    const accounts = await capped("accounts", "SELECT * FROM accounts WHERE user_id=$1 ORDER BY created_at", [user.id]);
    const notifications = await capped("notifications", "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at", [user.id]);
    const notificationEndpoints = await capped("notificationEndpoints", "SELECT id,channel,enabled,created_at,updated_at FROM notification_endpoints WHERE user_id=$1 ORDER BY created_at", [user.id]);
    const signInMethods = await capped("signInMethods", "SELECT provider,email,created_at FROM oauth_accounts WHERE user_id=$1 ORDER BY created_at", [user.id]);
    return Response.json({
      exportedAt: new Date().toISOString(),
      rowLimitPerTable: EXPORT_ROWS_PER_TABLE,
      truncatedTables,
      user: { email: user.email, country: user.country, baseCurrency: user.baseCurrency, timezone: user.timezone, anonymousAggregateOptIn: user.anonymousAggregateOptIn },
      accounts, strategyInstances: instances, strategyAccounts, strategyStates: states,
      ledger, actions, reconciliations, overrides, notifications, notificationEndpoints, signInMethods
    }, { headers: NO_STORE });
  } catch (error) {
    const denied = authFailure(error);
    if (denied) return denied;
    if (error instanceof Error && error.message === "RATE_LIMITED") {
      return Response.json({ error: "Too many exports. Try again later." }, { status: 429, headers: NO_STORE });
    }
    return Response.json({ error: "Could not export account." }, { status: 500, headers: NO_STORE });
  }
}
