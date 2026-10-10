"use client";
import { useMemo, useState } from "react";
import type { SettingView } from "@/lib/settings";

type Edits = Record<string, string | null>;

const SOURCE_LABEL: Record<SettingView["source"], string> = { database: "Saved here", environment: "From environment file", unset: "Not set" };

function randomAdminSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

export function SettingsEditor({ initial, groups }: { initial: SettingView[]; groups: readonly string[] }) {
  const [settings, setSettings] = useState(initial);
  const [edits, setEdits] = useState<Edits>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = useMemo(() => Object.keys(edits).length, [edits]);

  const edit = (key: string, value: string | null) => setEdits((e) => ({ ...e, [key]: value }));
  const undo = (key: string) => setEdits((e) => { const { [key]: _drop, ...rest } = e; void _drop; return rest; });

  async function save() {
    setBusy(true); setMessage(""); setErrors({});
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ changes: Object.entries(edits).map(([key, value]) => ({ key, value })) })
      });
      const body = await response.json().catch(() => ({} as { error?: string; errors?: Record<string, string>; settings?: SettingView[] }));
      if (!response.ok) { setErrors(body.errors ?? {}); setMessage(body.error ?? "Could not save."); return; }
      setSettings(body.settings ?? settings); setEdits({}); setMessage("Saved. Changes apply within a few seconds, no restart needed.");
    } catch { setMessage("Could not reach the server. Please try again."); }
    finally { setBusy(false); }
  }

  function field(s: SettingView) {
    const id = "setting-" + s.key;
    const edited = Object.prototype.hasOwnProperty.call(edits, s.key);
    const value = edited ? edits[s.key] : s.value;
    const secret = s.kind === "secret" || s.kind === "multiline-secret";
    if (s.kind === "boolean") {
      const shown = edited ? (value === null ? "" : value) : (s.value ?? "");
      return <select id={id} value={shown} onChange={(e) => edit(s.key, e.target.value === "" ? null : e.target.value)}>
        <option value="">Off (not set)</option><option value="true">On</option><option value="false">Off (explicit)</option>
      </select>;
    }
    if (s.kind === "select") {
      return <select id={id} value={value ?? ""} onChange={(e) => edit(s.key, e.target.value === "" ? null : e.target.value)}>
        <option value="">Not set</option>{s.options?.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>;
    }
    if (secret) {
      const pending = edited && value !== null;
      const clearing = edited && value === null;
      return <div className="stack">
        {s.kind === "multiline-secret"
          ? <textarea id={id} rows={4} placeholder={s.source === "unset" ? "Not set" : "Saved — paste a new value to replace it"} value={pending ? value ?? "" : ""} onChange={(e) => e.target.value ? edit(s.key, e.target.value) : undo(s.key)} autoComplete="off" spellCheck={false}/>
          : <input id={id} type="password" placeholder={s.source === "unset" ? "Not set" : "•••••••• saved — type a new value to replace it"} value={pending ? value ?? "" : ""} onChange={(e) => e.target.value ? edit(s.key, e.target.value) : undo(s.key)} autoComplete="new-password"/>}
        <div className="inline">
          {s.key==="TELEGRAM_WEBHOOK_SECRET"&&<button type="button" className="button" onClick={()=>edit(s.key,randomAdminSecret())}>Generate secure secret</button>}
          {s.source === "database" && !clearing && <button type="button" className="button" onClick={() => edit(s.key, null)}>Remove saved value</button>}
          {clearing && <><span className="pill">Will be removed</span><button type="button" className="button" onClick={() => undo(s.key)}>Undo</button></>}
        </div>
      </div>;
    }
    return <div className="inline">
      <input id={id} value={value ?? ""} inputMode={s.kind === "number" ? "decimal" : undefined} autoComplete="off" onChange={(e) => e.target.value === "" ? (s.source === "database" ? edit(s.key, null) : undo(s.key)) : edit(s.key, e.target.value)}/>
    </div>;
  }

  return <div className="stack">
    {groups.map((group) => {
      const rows = settings.filter((s) => s.group === group);
      if (!rows.length) return null;
      return <section className="glass form-card" id={"settings-"+group.toLowerCase().replace(/[^a-z0-9]+/g,"-")} key={group}>
        <h3>{group}</h3>
        <div className="stack">
          {rows.map((s) => <div className="field" key={s.key}>
            <label htmlFor={"setting-" + s.key}>{s.label} <span className="pill">{Object.prototype.hasOwnProperty.call(edits, s.key) ? "Unsaved change" : SOURCE_LABEL[s.source]}</span></label>
            {field(s)}
            <div className="help">{s.help}</div>
            {errors[s.key] && <div className="error" role="alert">{errors[s.key]}</div>}
          </div>)}
        </div>
      </section>;
    })}
    <div className="inline">
      <button className="button primary" disabled={busy || dirty === 0} onClick={save}>{busy ? "Saving…" : dirty ? `Save ${dirty} change${dirty === 1 ? "" : "s"}` : "No changes"}</button>
      {dirty > 0 && <button className="button" disabled={busy} onClick={() => { setEdits({}); setErrors({}); }}>Discard</button>}
    </div>
    {message && <div className={message.startsWith("Saved") ? "success" : "error"} role="status">{message}</div>}
  </div>;
}
