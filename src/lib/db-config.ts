// Pure configuration for the application's postgres.js client. Kept out of src/lib/db.ts so it can
// be unit-tested without opening a connection and so modules that mock "@/lib/db" are unaffected.
//
// These are code constants, not operator settings: the client is created at import time, before
// the encrypted settings registry in the database can be read, so a registry value cannot apply.
// Migrations, seeding, role provisioning and the restore drill create their own postgres.js
// clients (scripts/*.ts) and are deliberately NOT subject to these timeouts.

/** Maximum connections in the application pool. */
export const DB_POOL_MAX = 10;

/** Seconds to wait for a new connection before failing, so a down database fails fast. */
export const DB_CONNECT_TIMEOUT_SECONDS = 10;

/** Seconds an idle pooled connection is kept before being closed. */
export const DB_IDLE_TIMEOUT_SECONDS = 20;

/**
 * Per-connection server-side limits, in milliseconds (sent as startup parameters).
 *
 * - statement_timeout: no single statement may run longer than this. The cron time budget is 150 s
 *   for a whole run made of many short statements, so 60 s per statement is generous.
 * - lock_timeout: a statement that waits for a row or advisory lock longer than this fails instead
 *   of queueing forever behind a stuck transaction. Longer than any normal calculation.
 * - idle_in_transaction_session_timeout: a transaction that holds a connection while doing nothing
 *   (for example after a crashed or hung request) is terminated, releasing its locks.
 */
export const DB_STATEMENT_TIMEOUT_MS = 60_000;
export const DB_LOCK_TIMEOUT_MS = 30_000;
export const DB_IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;

export const DB_CONNECTION_PARAMETERS = {
  statement_timeout: DB_STATEMENT_TIMEOUT_MS,
  lock_timeout: DB_LOCK_TIMEOUT_MS,
  idle_in_transaction_session_timeout: DB_IDLE_IN_TRANSACTION_TIMEOUT_MS
} as const;

type TypeHandler = (value: unknown) => unknown;
export type TypeHandlerTables = {
  parsers: Record<string, TypeHandler>;
  serializers: Record<string, TypeHandler>;
};

// Postgres type OIDs.
const OID_DATE = 1082;
const OID_TIME = 1083;
const OID_TIMESTAMP = 1114;
const OID_TIMESTAMPTZ = 1184;
const OID_JSON = 114;
const OID_JSONB = 3802;
// date[], timestamp[], timestamptz[], time[]
const TEMPORAL_ARRAY_OIDS = [1182, 1115, 1185, 1183];

const passThrough: TypeHandler = (value) => value;

/** A JS Date bound as a query parameter is sent as ISO text; everything else is passed unchanged. */
export const serializeTemporal: TypeHandler = (value) => (value instanceof Date ? value.toISOString() : value);

/**
 * Configure how the driver reads and writes the types the application treats as plain strings.
 *
 * Reads: date, time, timestamp and timestamptz (and their arrays) come back as the raw Postgres
 * text, never as JS Date objects. Application code relies on this, for example
 * `String(row.date).slice(0, 10)`. Writes: json/jsonb parameters are passed through untouched
 * because callers pass already-stringified JSON next to a `::jsonb` cast (the driver's default
 * serializer would JSON.stringify it a second time and store a JSON string); a Date parameter is
 * serialised to ISO text.
 *
 * Previously this behaviour came as a side effect of constructing a drizzle client in db.ts.
 */
export function configureTypeHandlers(tables: TypeHandlerTables): void {
  for (const oid of [OID_DATE, OID_TIME, OID_TIMESTAMP, OID_TIMESTAMPTZ, ...TEMPORAL_ARRAY_OIDS]) {
    tables.parsers[String(oid)] = passThrough;
    tables.serializers[String(oid)] = passThrough;
  }
  for (const oid of [OID_JSON, OID_JSONB]) tables.serializers[String(oid)] = passThrough;
  for (const oid of [OID_DATE, OID_TIME, OID_TIMESTAMP, OID_TIMESTAMPTZ]) tables.serializers[String(oid)] = serializeTemporal;
}
