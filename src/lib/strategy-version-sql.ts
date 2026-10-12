/**
 * The single definition of "the latest published version that is in its effective window" for a
 * strategy definition: PUBLISHED, started on or before today, not yet ended, newest effective date
 * first and newest publication as the tie-break. Returns a complete `SELECT ... LIMIT 1` for use as a
 * LATERAL subquery. `alias` and `definitionIdExpression` are code constants, never request input.
 */
export function latestPublishedVersionSelect(alias: string, definitionIdExpression: string, columns = "*") {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error("INVALID_SQL_ALIAS");
  return (
    "SELECT " + columns + " FROM strategy_versions " + alias +
    " WHERE " + alias + ".strategy_definition_id=" + definitionIdExpression +
    " AND " + alias + ".lifecycle_status='PUBLISHED'" +
    " AND " + alias + ".effective_from<=current_date" +
    " AND (" + alias + ".effective_to IS NULL OR " + alias + ".effective_to>=current_date)" +
    " ORDER BY " + alias + ".effective_from DESC," + alias + ".published_at DESC NULLS LAST LIMIT 1"
  );
}
