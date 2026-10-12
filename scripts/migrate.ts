import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { migrationChecksum, migrationChecksumMatches } from "./migration-checksum";

// Serialises concurrent deploys/containers: only one process may apply migrations at a time.
// Session-level advisory lock, released when the connection closes even if the process dies.
const MIGRATION_ADVISORY_LOCK_KEY = "7240381003";
const LOCK_WAIT_MS = 5 * 60 * 1000;
// A migration waiting longer than this for a table lock is aborted (and rolled back) instead of
// queueing behind application traffic and blocking everything behind it.
const MIGRATION_LOCK_TIMEOUT = "30s";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1, prepare: false });
  let locked = false;
  try {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      const got = await sql.unsafe("SELECT pg_try_advisory_lock(" + MIGRATION_ADVISORY_LOCK_KEY + ") AS locked");
      if (got[0]?.locked === true) { locked = true; break; }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for the migration advisory lock; another migration run is in progress");
      console.log("Waiting for another migration run to finish...");
      await sleep(2000);
    }

    await sql.unsafe(
      "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"
    );
    const directory = join(process.cwd(), "db/migrations");
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();

    const recorded = await sql.unsafe("SELECT filename FROM schema_migrations");
    const onDisk = new Set(files);
    for (const row of recorded) {
      const name = String(row.filename);
      if (!onDisk.has(name)) console.warn("WARNING: applied migration is missing from disk: " + name);
    }

    for (const name of files) {
      const migration = await readFile(join(directory, name), "utf8");
      const existing = await sql.unsafe("SELECT checksum FROM schema_migrations WHERE filename=$1 LIMIT 1", [name]);
      if (existing[0]) {
        if (!migrationChecksumMatches(String(existing[0].checksum), migration)) throw new Error("Applied migration changed: " + name);
        console.log("Already applied " + name);
        continue;
      }
      const checksum = migrationChecksum(migration);
      await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL lock_timeout = '" + MIGRATION_LOCK_TIMEOUT + "'");
        await tx.unsafe(migration);
        await tx.unsafe("INSERT INTO schema_migrations (filename,checksum) VALUES ($1,$2)", [name, checksum]);
      });
      console.log("Applied " + name);
    }
    console.log("Database migrations complete");
  } finally {
    if (locked) {
      try { await sql.unsafe("SELECT pg_advisory_unlock(" + MIGRATION_ADVISORY_LOCK_KEY + ")"); } catch { /* connection closing releases it */ }
    }
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
