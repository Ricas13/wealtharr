/**
 * A value that is safe to store or show for a failure: the application's own error codes
 * (UPPER_SNAKE_CASE) pass through, anything else (driver, network or provider text, which can carry
 * hosts, queries or identifiers) is reduced to the error class name.
 */
export function safeErrorCode(error: unknown) {
  if (error instanceof Error) {
    if (/^[A-Z][A-Z0-9_]{2,60}(:[A-Za-z0-9_]{1,64})?$/.test(error.message)) return error.message;
    return /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(error.name) ? error.name : "Error";
  }
  return "UNKNOWN";
}
