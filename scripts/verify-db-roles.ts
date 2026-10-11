/** Checks real PostgreSQL privilege boundaries without changing persisted application data. */
import postgres from "postgres";

async function main() {
  const raw = process.env.DATABASE_URL;
  const appPass = process.env.APP_DB_PASSWORD;
  const backupPass = process.env.BACKUP_DB_PASSWORD;
  if (!raw || !appPass || !backupPass) throw new Error("Role verification credentials required");
  const admin = postgres(raw,{max:1,prepare:false});
  const appUrl = new URL(raw); appUrl.username="wealtharr_app"; appUrl.password=appPass;
  const backupUrl = new URL(raw); backupUrl.username="wealtharr_backup"; backupUrl.password=backupPass;
  const app = postgres(appUrl.toString(),{max:1,prepare:false});
  const backup = postgres(backupUrl.toString(),{max:1,prepare:false});
  const denied=async (name:string,task:()=>Promise<unknown>)=>{
    try { await task(); throw new Error("Unexpectedly permitted: "+name); }
    catch (e) {
      if (e instanceof Error && e.message.startsWith("Unexpectedly permitted:")) throw e;
      if (!e || typeof e!=="object" || !("code" in e) || (e as {code:unknown}).code!=="42501")
        throw new Error("Expected permission denied: "+name);
    }
  };
  try {
    const rows = await admin.unsafe("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname IN ('wealtharr_app','wealtharr_backup')");
    if(rows.length!==2 || rows.some(r=>r.rolsuper||r.rolcreatedb||r.rolcreaterole))
      throw new Error("Database roles are too privileged");
    await app.unsafe("SELECT count(*) FROM plans");
    await app.unsafe("UPDATE plans SET sort_order=sort_order WHERE false");
    await denied("app schema DDL",()=>app.unsafe("CREATE TABLE public.wealtharr_privilege_probe (id integer)"));
    await backup.unsafe("SELECT count(*) FROM plans");
    await denied("backup writes",()=>backup.unsafe("UPDATE plans SET sort_order=sort_order WHERE false"));
    await denied("backup schema DDL",()=>backup.unsafe("CREATE TABLE public.wealtharr_privilege_probe (id integer)"));
    console.log("Database isolation verified: app DML, backup SELECT, neither may modify schema.");
  } finally { await Promise.all([admin.end(),app.end(),backup.end()]); }
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Database role check failed");process.exit(1);});
