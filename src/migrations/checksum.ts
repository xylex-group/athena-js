import { sha256HexUtf8 } from "../node-crypto.ts";

/**
 * Deterministic SHA-256 checksum of exact UTF-8 migration SQL bytes.
 * No line-ending normalization — file content is hashed as authored.
 * Uses node-crypto helper (no static `node:crypto` import) so DTS stays green
 * without `@types/node` on the type path.
 */
export function checksumMigrationSql(sql: string): string {
  return sha256HexUtf8(sql);
}
