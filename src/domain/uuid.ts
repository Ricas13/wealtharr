const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True only for the canonical 8-4-4-4-12 hexadecimal form Postgres would accept as a uuid. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
