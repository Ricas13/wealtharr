import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import crypto from "node:crypto";
import {
  migrationChecksum,
  migrationChecksumMatches,
  normaliseMigrationText,
  rawMigrationChecksum
} from "../scripts/migration-checksum";

const lf = "CREATE TABLE a (id int);\nALTER TABLE a ADD COLUMN b int;\n";
const crlf = lf.replace(/\n/g, "\r\n");

describe("migration checksums", () => {
  it("hash CRLF and LF checkouts of the same file identically", () => {
    expect(normaliseMigrationText(crlf)).toBe(lf);
    expect(migrationChecksum(crlf)).toBe(migrationChecksum(lf));
  });

  it("keep the raw-bytes hash distinct so legacy recordings can be recognised", () => {
    expect(rawMigrationChecksum(crlf)).not.toBe(rawMigrationChecksum(lf));
    expect(rawMigrationChecksum(lf)).toBe(crypto.createHash("sha256").update(lf).digest("hex"));
  });

  it("accept a checksum recorded before normalisation existed (raw CRLF bytes)", () => {
    const legacy = crypto.createHash("sha256").update(crlf).digest("hex");
    expect(migrationChecksumMatches(legacy, crlf)).toBe(true);
    // The same legacy recording must still verify once the file is checked out with LF endings.
    expect(migrationChecksumMatches(migrationChecksum(crlf), lf)).toBe(true);
  });

  it("accept the normalised checksum recorded going forward", () => {
    expect(migrationChecksumMatches(migrationChecksum(lf), crlf)).toBe(true);
    expect(migrationChecksumMatches(migrationChecksum(lf), lf)).toBe(true);
  });

  it("still reject a migration whose content actually changed", () => {
    const recorded = migrationChecksum(lf);
    expect(migrationChecksumMatches(recorded, lf + "DROP TABLE a;\n")).toBe(false);
    expect(migrationChecksumMatches("0".repeat(64), lf)).toBe(false);
  });
});

describe("migration runner and schema tooling", () => {
  const runner = readFileSync("scripts/migrate.ts", "utf8");

  it("takes a session advisory lock around the whole run and releases it", () => {
    expect(runner).toContain("pg_try_advisory_lock");
    expect(runner).toContain("pg_advisory_unlock");
    expect(runner.indexOf("pg_try_advisory_lock")).toBeLessThan(runner.indexOf("CREATE TABLE IF NOT EXISTS schema_migrations"));
  });

  it("verifies through the normalising checksum helper and bounds lock waits per migration", () => {
    expect(runner).toContain("migrationChecksumMatches");
    expect(runner).toContain("SET LOCAL lock_timeout");
  });

  it("warns when an applied migration file is missing from disk", () => {
    expect(runner).toMatch(/missing from disk/);
  });

  it("keeps migration files LF on every platform", () => {
    expect(readFileSync(".gitattributes", "utf8")).toMatch(/^\*\.sql\s+text\s+eol=lf/m);
  });

  it("offers no schema-generation script that could write a destructive migration", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
    expect(scripts["db:generate"]).toBeUndefined();
    expect(Object.values(scripts).some((command) => command.includes("drizzle-kit generate"))).toBe(false);
    const config = readFileSync("drizzle.config.ts", "utf8");
    expect(config).not.toMatch(/out:\s*["']\.\/db\/migrations/);
    expect(readFileSync("src/db/schema.ts", "utf8")).toMatch(/PARTIAL, INFORMATIONAL schema/);
  });

  it("never reuses a migration number", () => {
    const names = readdirSync("db/migrations").filter((name) => name.endsWith(".sql")).sort();
    const prefixes = names.map((name) => name.slice(0, 4));
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
