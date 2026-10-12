import { defineConfig } from "drizzle-kit";

// src/db/schema.ts is a partial, informational schema (it lacks many tables and columns). The
// hand-written db/migrations/*.sql files are the source of truth, so drizzle-kit must never write
// into that directory: `drizzle-kit generate` against this schema would emit a wrong, destructive
// migration. There is intentionally no `db:generate` npm script; output goes to a git-ignored scratch dir.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./.drizzle-scratch",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true
});
