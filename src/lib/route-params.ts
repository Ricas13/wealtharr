import { isUuid } from "@/domain/uuid";

/**
 * Path ids that are not UUIDs would reach Postgres as a failed cast and surface as a 500. Handlers
 * call this right after reading their params and return the response when it is not null.
 */
export function invalidPathId(...ids: string[]): Response | null {
  if (ids.every(isUuid)) return null;
  return Response.json({ error: "Not found." }, { status: 404, headers: { "cache-control": "no-store" } });
}
