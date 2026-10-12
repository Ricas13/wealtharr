import "server-only";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";

// First-run setup. A fresh install has no administrator, so the browser needs a way to create the
// first one without anyone editing files. To stop whoever reaches the address first from taking over,
// the server prints a one-time code in its own log at start-up; only someone who can read that log
// can finish setup. Once an administrator exists the setup page is closed for good.

const hashCode = (code: string) => crypto.createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");

export async function adminExists() {
  const rows = await sql.unsafe("SELECT 1 FROM users WHERE role='ADMIN' AND deleted_at IS NULL LIMIT 1");
  return Boolean(rows[0]);
}

export function newSetupCode() {
  const raw = crypto.randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "").toUpperCase().padEnd(12, "7").slice(0, 12);
  return raw.slice(0, 4) + "-" + raw.slice(4, 8) + "-" + raw.slice(8, 12);
}

/** Creates (and logs) a fresh code when no administrator exists. Safe to call on every start-up. */
export async function announceSetupIfNeeded(log: (line: string) => void = console.log) {
  try {
    if (await adminExists()) return null;
    const code = newSetupCode();
    await sql.begin(async (tx) => {
      await tx.unsafe("DELETE FROM setup_codes WHERE used_at IS NULL");
      await tx.unsafe("INSERT INTO setup_codes (code_hash) VALUES ($1)", [hashCode(code)]);
    });
    log("[setup] No administrator exists yet. Open /setup in your browser and enter this one-time code: " + code);
    return code;
  } catch {
    return null;
  }
}

export type SetupResult = { ok: true; userId: string } | { ok: false; reason: "CLOSED" | "BAD_CODE" | "EMAIL_IN_USE" };

export async function completeSetup(input: { code: string; email: string; password: string }): Promise<SetupResult> {
  const passwordHash = await bcrypt.hash(input.password, 12);
  return sql.begin(async (tx) => {
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended('first-run-setup',3))");
    const admin = await tx.unsafe("SELECT 1 FROM users WHERE role='ADMIN' AND deleted_at IS NULL LIMIT 1");
    if (admin[0]) return { ok: false, reason: "CLOSED" } as const;
    const consumed = await tx.unsafe(
      "UPDATE setup_codes SET used_at=now() WHERE id=(SELECT id FROM setup_codes WHERE code_hash=$1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1) RETURNING id",
      [hashCode(input.code)]
    );
    if (!consumed[0]) return { ok: false, reason: "BAD_CODE" } as const;
    const existing = await tx.unsafe("SELECT id,deleted_at FROM users WHERE lower(email)=lower($1) FOR UPDATE", [input.email]);
    let userId: string;
    if (existing[0]) {
      if (existing[0].deleted_at) return { ok: false, reason: "EMAIL_IN_USE" } as const;
      // Promote an existing account, replacing its credentials: the person with the log code is the operator.
      userId = String(existing[0].id);
      await tx.unsafe("UPDATE users SET role='ADMIN',password_hash=$2,email_verified_at=COALESCE(email_verified_at,now()),session_version=session_version+1,updated_at=now() WHERE id=$1", [userId, passwordHash]);
    } else {
      const created = await tx.unsafe("INSERT INTO users (email,password_hash,role,email_verified_at) VALUES ($1,$2,'ADMIN',now()) RETURNING id", [input.email.trim().toLowerCase(), passwordHash]);
      userId = String(created[0].id);
      const free = await tx.unsafe("SELECT id FROM plans WHERE slug='free' LIMIT 1");
      if (free[0]) await tx.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'FREE','FREE')", [userId, free[0].id]);
    }
    await tx.unsafe("DELETE FROM setup_codes");
    await tx.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1::uuid,'setup.first-admin-created','user',$1::text,'{}'::jsonb)", [userId]);
    return { ok: true, userId } as const;
  });
}
