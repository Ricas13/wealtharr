import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  configureTypeHandlers,
  DB_CONNECT_TIMEOUT_SECONDS,
  DB_CONNECTION_PARAMETERS,
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DB_LOCK_TIMEOUT_MS,
  DB_POOL_MAX,
  DB_STATEMENT_TIMEOUT_MS,
  serializeTemporal,
  type TypeHandlerTables
} from "../src/lib/db-config";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const between = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  expect(from, "missing " + start).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, "missing " + end).toBeGreaterThan(from);
  return source.slice(from, to);
};

// A transaction holds one pooled connection. Any query inside it that goes to the global pool needs a
// second connection, so N concurrent transactions on a pool of N all wait for each other forever.
describe("action calculation runs on the caller's database handle", () => {
  const service = read("src/lib/action-service.ts");
  const build = between(service, "async function buildActionCalculation(", "export async function previewCashScenario(");

  it("takes a db handle and never touches the global pool", () => {
    expect(build.startsWith('async function buildActionCalculation(db:Pick<Sql,"unsafe">,')).toBe(true);
    expect(build).not.toMatch(/\bsql\./);
    expect(build).not.toMatch(/\bsql\b/);
    expect(build).toContain("db.unsafe(");
  });

  it("hands the same handle to every helper that queries the database", () => {
    expect(build).toMatch(/loadTrustedHistory\([^)]*,db\)/);
    const loader = read("src/lib/trusted-history-loader.ts");
    expect(loader).toContain('db: Pick<Sql, "unsafe"> = sql');
    const body = loader.slice(loader.indexOf("export async function loadTrustedHistory"));
    expect(body).not.toMatch(/\bsql\./);
    expect(body).toContain("db.unsafe(");
  });

  it("calculateAction and executeAction pass their transaction, not the pool", () => {
    const calculate = between(service, "export async function calculateAction(", "export async function recalculateAfterMutation(");
    expect(calculate).toContain("buildActionCalculation(tx,");
    expect(calculate).not.toMatch(/buildActionCalculation\(sql/);
    expect(calculate).not.toMatch(/\bsql\.unsafe/);
    const execute = service.slice(service.indexOf("export async function executeAction("));
    const txScope = execute.slice(0, execute.indexOf("const recalc="));
    expect(txScope).toContain("buildActionCalculation(tx,");
    expect(txScope).not.toMatch(/buildActionCalculation\(sql/);
    expect(txScope).not.toMatch(/\bsql\.unsafe/);
  });

  it("every call site outside a transaction passes the pool explicitly", () => {
    const calls = service.match(/buildActionCalculation\([^,)]+/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(7);
    for (const call of calls) expect(call).toMatch(/\((db:Pick|sql|tx)/);
  });
});

describe("database client configuration", () => {
  it("has bounded timeouts that leave room for the cron budget", () => {
    expect(DB_POOL_MAX).toBe(10);
    expect(DB_CONNECT_TIMEOUT_SECONDS).toBeGreaterThan(0);
    expect(DB_STATEMENT_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    expect(DB_STATEMENT_TIMEOUT_MS).toBeLessThanOrEqual(150_000);
    expect(DB_LOCK_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DB_IDLE_IN_TRANSACTION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DB_CONNECTION_PARAMETERS).toEqual({
      statement_timeout: DB_STATEMENT_TIMEOUT_MS,
      lock_timeout: DB_LOCK_TIMEOUT_MS,
      idle_in_transaction_session_timeout: DB_IDLE_IN_TRANSACTION_TIMEOUT_MS
    });
  });

  it("applies them to the application client only, not to migration or maintenance scripts", () => {
    const db = read("src/lib/db.ts");
    expect(db).toContain("connect_timeout: DB_CONNECT_TIMEOUT_SECONDS");
    expect(db).toContain("connection: { ...DB_CONNECTION_PARAMETERS }");
    expect(db).not.toContain("drizzle");
    for (const script of ["scripts/migrate.ts", "scripts/seed.ts", "scripts/import-instruments.ts", "scripts/provision-db-roles.ts"]) {
      const source = read(script);
      expect(source, script).not.toContain("@/lib/db");
      expect(source, script).not.toContain("statement_timeout");
    }
  });

  it("returns dates, times and timestamps as raw text and leaves JSON strings alone", () => {
    const tables: TypeHandlerTables = { parsers: {}, serializers: {} };
    configureTypeHandlers(tables);
    for (const oid of [1082, 1083, 1114, 1184, 1182, 1115, 1185]) {
      expect(tables.parsers[String(oid)]("2030-01-02"), String(oid)).toBe("2030-01-02");
    }
    const json = '{"a":1}';
    expect(tables.serializers["114"](json)).toBe(json);
    expect(tables.serializers["3802"](json)).toBe(json);
    const at = new Date("2030-01-02T03:04:05.000Z");
    for (const oid of [1082, 1083, 1114, 1184]) {
      expect(tables.serializers[String(oid)](at), String(oid)).toBe("2030-01-02T03:04:05.000Z");
      expect(tables.serializers[String(oid)]("2030-01-02"), String(oid)).toBe("2030-01-02");
    }
    expect(serializeTemporal(null)).toBeNull();
  });
});

describe("account export and first calculation", () => {
  it("export is rate limited, sequential, capped and never cached", () => {
    const source = read("src/app/api/account/export/route.ts");
    expect(source).toContain("consumeRateLimit(");
    expect(source).not.toContain("Promise.all");
    expect(source).toContain("EXPORT_ROWS_PER_TABLE");
    expect(source).toContain('"cache-control": "no-store"');
    expect(source).toContain('"RATE_LIMITED"');
  });

  it("a failed first calculation is recorded instead of swallowed", () => {
    const source = read("src/app/api/strategies/route.ts");
    expect(source).toContain("recalculateAfterMutation(id,");
    expect(source).not.toMatch(/catch\s*\{\s*\}/);
    expect(source).not.toContain("await calculateAction(");
  });
});
