import "server-only";
import { sql } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { SETTINGS, SETTING_KEYS, isSecretKind, settingByKey, validateSetting, type SettingDefinition } from "@/domain/settings-registry";

// Settings saved in the admin screen are copied over the matching environment variables so the rest
// of the code keeps reading process.env unchanged. The environment value that was there before is
// remembered, so clearing a setting restores it instead of leaving a hole.
const REFRESH_MS = 15_000;
const originalEnv = new Map<string, string | undefined>();
let lastLoad = 0;
let inflight: Promise<void> | null = null;
// Counts loads started; lets a forced refresh tell a load that began after it was called from an older one.
let loadSeq = 0;

function applyToEnvironment(rows: Array<{ key: string; value: string }>) {
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  for (const def of SETTINGS) {
    if (!originalEnv.has(def.key)) originalEnv.set(def.key, process.env[def.key]);
    const value = stored.get(def.key);
    if (value !== undefined) process.env[def.key] = value;
    else if (originalEnv.get(def.key) === undefined) delete process.env[def.key];
    else process.env[def.key] = originalEnv.get(def.key);
  }
}

async function loadRows() {
  const rows = await sql.unsafe("SELECT key,value_encrypted FROM app_settings");
  const out: Array<{ key: string; value: string }> = [];
  for (const row of rows) {
    const key = String(row.key);
    if (!SETTING_KEYS.has(key)) continue;
    try {
      const value = decryptSecret(String(row.value_encrypted));
      // Preserve custom product names, but migrate the old default stored by the previous brand.
      out.push({ key, value: key === "NEXT_PUBLIC_BRAND_NAME" && value === "Rebalune" ? "Wealtharr" : value });
    } catch {
      // A value that cannot be decrypted (for example after the encryption key changed) is
      // skipped, so the environment fallback applies instead of the app failing to start.
    }
  }
  return out;
}

/** Refreshes the in-process view of the saved settings at most every few seconds. Never throws. */
export async function ensureSettings(force = false): Promise<void> {
  if (!force) {
    if (Date.now() - lastLoad < REFRESH_MS) return;
    if (inflight) return inflight;
    return startLoad();
  }
  // A forced refresh follows a write (or must see one). A load already in flight may have read the table
  // before that write committed, so joining it could return stale settings. Only a load that began
  // after this call is acceptable: wait out an older one, then start (or join) a newer one.
  const calledAt = loadSeq;
  for (;;) {
    if (inflight && loadSeq > calledAt) return inflight;
    if (inflight) {
      await inflight; // never rejects
      continue;
    }
    return startLoad();
  }
}

async function loadOnce(): Promise<void> {
  try {
    applyToEnvironment(await loadRows());
    lastLoad = Date.now();
  } catch {
    // Database unavailable: keep serving with what is already applied.
  }
}

function startLoad(): Promise<void> {
  loadSeq += 1;
  const run: Promise<void> = loadOnce().then(() => {
    if (inflight === run) inflight = null;
  });
  inflight = run;
  return run;
}

export type SettingView = {
  key: string;
  label: string;
  group: string;
  kind: SettingDefinition["kind"];
  help: string;
  options?: readonly string[];
  source: "database" | "environment" | "unset";
  /** Plain value for ordinary settings; secrets are never sent back, only whether one is set. */
  value: string | null;
};

export async function listSettings(): Promise<SettingView[]> {
  await ensureSettings(true); // also records the original environment values on first use
  const rows = new Map((await loadRows()).map((r) => [r.key, r.value]));
  return SETTINGS.map((def) => {
    const fromDb = rows.get(def.key);
    const fromEnv = originalEnv.has(def.key) ? originalEnv.get(def.key) : process.env[def.key];
    const source = fromDb !== undefined ? "database" : fromEnv ? "environment" : "unset";
    const effective = fromDb ?? fromEnv ?? null;
    return {
      key: def.key, label: def.label, group: def.group, kind: def.kind, help: def.help, options: def.options,
      source, value: isSecretKind(def.kind) ? null : effective
    };
  });
}

export type SettingChange = { key: string; value: string | null };
export type SaveResult = { ok: true; changed: string[] } | { ok: false; errors: Record<string, string> };

/** value null clears the saved setting. Everything is validated first; nothing is saved on any error. */
export async function saveSettings(adminId: string, changes: SettingChange[]): Promise<SaveResult> {
  const errors: Record<string, string> = {};
  const clean: SettingChange[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    const def = settingByKey(change.key);
    if (!def) { errors[change.key] = "Unknown setting."; continue; }
    if (seen.has(change.key)) { errors[change.key] = "Given twice."; continue; }
    seen.add(change.key);
    if (change.value === null) { clean.push(change); continue; }
    const result = validateSetting(def, change.value);
    if (!result.ok) errors[change.key] = result.error;
    else clean.push({ key: change.key, value: result.value });
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  await sql.begin(async (tx) => {
    for (const change of clean) {
      if (change.value === null) await tx.unsafe("DELETE FROM app_settings WHERE key=$1", [change.key]);
      else {
        await tx.unsafe(
          "INSERT INTO app_settings (key,value_encrypted,updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value_encrypted=EXCLUDED.value_encrypted,updated_by=EXCLUDED.updated_by,updated_at=now()",
          [change.key, encryptSecret(change.value), adminId]
        );
      }
    }
    // The audit trail names what changed and by whom, never the values.
    await tx.unsafe(
      "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1::uuid,'settings.changed','settings',NULL,$2::jsonb)",
      [adminId, JSON.stringify({ set: clean.filter((c) => c.value !== null).map((c) => c.key), cleared: clean.filter((c) => c.value === null).map((c) => c.key) })]
    );
  });
  await ensureSettings(true);
  return { ok: true, changed: clean.map((c) => c.key) };
}
