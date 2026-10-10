/** One-shot role provisioning. Run after migration/seed, never in the online app. */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  const appPassword = process.env.APP_DB_PASSWORD;
  const backupPassword = process.env.BACKUP_DB_PASSWORD;
  if (!url || !appPassword || !backupPassword) throw new Error("Role credentials required");
  if (appPassword === backupPassword || appPassword.length < 24 || backupPassword.length < 24)
    throw new Error("Distinct high-entropy role credentials required");
  const sql = postgres(url, {max:1,prepare:false});
  try {
    const [actor] = await sql.unsafe("SELECT current_user AS name, r.rolsuper AS superuser FROM pg_roles r WHERE r.rolname=current_user");
    if (!actor?.superuser || actor.name !== "strategyos")
      throw new Error("Only designated strategyos database administrator can provision roles");
    for (const [name,password] of [["wealtharr_app",appPassword],["wealtharr_backup",backupPassword]] as const) {
      const [existing] = await sql.unsafe("SELECT rolsuper FROM pg_roles WHERE rolname=$1",[name]);
      if (existing?.rolsuper) throw new Error("Refusing to reuse a superuser role: "+name);
      if (!existing) {
        const [q] = await sql.unsafe("SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', $1::text) AS command",[name]);
        await sql.unsafe(String(q.command));
      }
      // quote password on the PostgreSQL server, never assemble it with JS interpolation or print it.
      const [q] = await sql.unsafe("SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', $1::text,$2::text) AS command",[name,password]);
      await sql.unsafe(String(q.command));
    }
    const [databaseGrant] = await sql.unsafe("SELECT format('GRANT CONNECT ON DATABASE %I TO wealtharr_app,wealtharr_backup',current_database()) AS command");
    await sql.unsafe(String(databaseGrant.command));
    await sql.unsafe("GRANT USAGE ON SCHEMA public TO wealtharr_app, wealtharr_backup");
    await sql.unsafe("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wealtharr_app");
    await sql.unsafe("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wealtharr_app");
    await sql.unsafe("GRANT SELECT ON ALL TABLES IN SCHEMA public TO wealtharr_backup");
    await sql.unsafe("GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO wealtharr_backup");
    await sql.unsafe("ALTER DEFAULT PRIVILEGES FOR ROLE strategyos IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wealtharr_app");
    await sql.unsafe("ALTER DEFAULT PRIVILEGES FOR ROLE strategyos IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO wealtharr_app");
    await sql.unsafe("ALTER DEFAULT PRIVILEGES FOR ROLE strategyos IN SCHEMA public GRANT SELECT ON TABLES TO wealtharr_backup");
    await sql.unsafe("ALTER DEFAULT PRIVILEGES FOR ROLE strategyos IN SCHEMA public GRANT SELECT ON SEQUENCES TO wealtharr_backup");
    console.log("Runtime DML and backup read-only roles provisioned.");
  } finally { await sql.end(); }
}
main().catch(() => { console.error("Role provisioning failed; credentials were not logged."); process.exit(1); });
