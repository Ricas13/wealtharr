import { listSettings } from "@/lib/settings";
import { SETTING_GROUPS } from "@/domain/settings-registry";
import { SettingsEditor } from "@/components/SettingsEditor";
import { EncryptionPanel } from "@/components/EncryptionPanel";
import { keyStatus } from "@/lib/key-rotation";

export const dynamic = "force-dynamic";

// These cannot live in the database they unlock, so they are the only things left to the server's
// environment. The page shows whether each is present (never its value).
const BOOTSTRAP: Array<{ key: string; why: string }> = [
  { key: "DATABASE_URL", why: "Where the database is." },
  { key: "AUTH_SECRET", why: "Signs session cookies." },
  { key: "APP_ENCRYPTION_KEY", why: "Encrypts every value saved on this page." },
  { key: "AUTH_TRUST_HOST", why: "Lets sign-in work behind your proxy (set to true)." },
  { key: "CRON_SECRET", why: "Shared secret used by both the app and the Docker scheduler; set the same value in Docker Compose." },
  { key: "APP_ENCRYPTION_KEY_PREVIOUS", why: "Only while rotating the encryption key (optional)." }
];

export default async function AdminSettingsPage() {
  const settings = await listSettings();
  const encryption = await keyStatus();
  return <>
    <div className="page-title"><div><div className="eyebrow">Admin</div><h1>Settings</h1>
      <p>Manage application integrations, branding and controls here without editing environment files. Values are encrypted in the database and refreshed automatically. Deployment bootstrap secrets are managed in Docker Compose.</p></div></div>
    <SettingsEditor initial={settings} groups={SETTING_GROUPS}/>
    <EncryptionPanel initial={encryption}/>
    <section className="card" style={{ marginTop: 18 }}>
      <h3>Still in the server environment</h3>
      <p className="help">These bootstrap and container credentials must be shared with the relevant Docker services. Changing them here would break authentication, database access, encryption or scheduled jobs.</p>
      {BOOTSTRAP.map((b) => <div className="why-row" key={b.key}><span>{b.key}<br/><small>{b.why}</small></span><b>{process.env[b.key] ? "Present" : "Missing"}</b></div>)}
    </section>
  </>;
}
