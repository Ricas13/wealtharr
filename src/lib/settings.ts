import "server-only";
import { sql } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { ENDPOINT_SECRET_PAIRS, SETTINGS, SETTING_KEYS, isSecretKind, settingByKey, validateSetting, type SettingDefinition } from "@/domain/settings-registry";

// Settings saved in the admin screen are copied over the matching environment variables so the rest
// of the code keeps reading process.env unchanged. The environment value that was there before is
// remembered, so clearing a setting restores it instead of leaving a hole.
const REFRESH_MS = 15_000;
const originalEnv = new Map<string, string | undefined>();
let lastLoad = 0;
let inflight: Promise<void> | null = null;

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
  if (!force && Date.now() - lastLoad < REFRESH_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      applyToEnvironment(await loadRows());
      lastLoad = Date.now();
    } catch {
      // Database unavailable: keep serving with what is already applied.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
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
    // An empty stored value is the marker left when a token was withdrawn together with its address
    // (see saveSettings): it hides the environment fallback and reads as "not set".
    const withdrawn = fromDb === "";
    const source = withdrawn ? "unset" : fromDb !== undefined ? "database" : fromEnv ? "environment" : "unset";
    const effective = withdrawn ? null : (fromDb ?? fromEnv ?? null);
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

  // Makes sure the environment values that were in place before any saved setting are recorded.
  await ensureSettings();
  const present = new Set(clean.map((c) => c.key));
  const endpointChanged: Array<{ key: string; secretKey: string; clearedSecret: boolean }> = [];

  await sql.begin(async (tx) => {
    // A saved address and its bearer token travel together. When the address changes, the token is
    // withdrawn unless a new one is in the same save, so an admin cannot point a stored token at a
    // host of their choosing (the connection test and the senders would send it there).
    for (const change of clean) {
      if (!Object.prototype.hasOwnProperty.call(ENDPOINT_SECRET_PAIRS, change.key)) continue;
      const secretKey = ENDPOINT_SECRET_PAIRS[change.key];
      const stored = await tx.unsafe("SELECT value_encrypted FROM app_settings WHERE key=$1", [change.key]);
      let before: string | undefined;
      try {
        before = stored[0] ? decryptSecret(String(stored[0].value_encrypted)) : undefined;
      } catch {
        before = "\u0000unreadable"; // cannot be compared, so treat it as changed (fail closed)
      }
      const fallback = originalEnv.get(change.key) ?? "";
      if ((before ?? fallback) === (change.value ?? fallback)) continue;
      const tokenRow = await tx.unsafe("SELECT 1 FROM app_settings WHERE key=$1", [secretKey]);
      const hasToken = tokenRow.length > 0 || Boolean(originalEnv.get(secretKey));
      endpointChanged.push({ key: change.key, secretKey, clearedSecret: hasToken && !present.has(secretKey) });
    }
    for (const item of endpointChanged) {
      if (!item.clearedSecret) continue;
      // Where the token also exists in the environment, an empty stored value hides it; otherwise the
      // saved row is simply removed.
      if (originalEnv.get(item.secretKey)) {
        await tx.unsafe(
          "INSERT INTO app_settings (key,value_encrypted,updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value_encrypted=EXCLUDED.value_encrypted,updated_by=EXCLUDED.updated_by,updated_at=now()",
          [item.secretKey, encryptSecret(""), adminId]
        );
      } else {
        await tx.unsafe("DELETE FROM app_settings WHERE key=$1", [item.secretKey]);
      }
    }
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
    for (const item of endpointChanged) {
      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1::uuid,'settings.endpoint-changed','settings',NULL,$2::jsonb)",
        [adminId, JSON.stringify({ key: item.key, secretCleared: item.clearedSecret ? item.secretKey : null })]
      );
    }
    await tx.unsafe(
      "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1::uuid,'settings.changed','settings',NULL,$2::jsonb)",
      [adminId, JSON.stringify({ set: clean.filter((c) => c.value !== null).map((c) => c.key), cleared: clean.filter((c) => c.value === null).map((c) => c.key) })]
    );
  });
  await ensureSettings(true);
  const withdrawnSecrets = endpointChanged.filter((c) => c.clearedSecret).map((c) => c.secretKey);
  return { ok: true, changed: [...clean.map((c) => c.key), ...withdrawnSecrets] };
}
