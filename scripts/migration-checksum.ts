import crypto from "node:crypto";

/**
 * Line endings must not change a migration's identity: the same file checked out on Windows (CRLF)
 * and Linux (LF) is the same migration. New checksums are therefore computed over LF-normalised text.
 */
export function normaliseMigrationText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/** Hash of the exact bytes on disk. This is what deployments before the normalisation recorded. */
export function rawMigrationChecksum(text: string): string {
  return sha256(text);
}

/** Hash recorded for newly applied migrations (CRLF and LF checkouts are identical). */
export function migrationChecksum(text: string): string {
  return sha256(normaliseMigrationText(text));
}

/**
 * An applied migration is unchanged when the recorded checksum equals either the normalised hash
 * (current scheme) or the raw-bytes hash (legacy scheme). Anything else means the file was edited.
 */
export function migrationChecksumMatches(recorded: string, text: string): boolean {
  return recorded === migrationChecksum(text) || recorded === rawMigrationChecksum(text);
}
