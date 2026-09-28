/**
 * SUPERSEDED by test/sdd/passkey-runtime-finality.repository.target.test.ts
 *
 * Former characterization of CURRENT HEAD before slice 04 adapter:
 * - B-REPO-PORT: PasskeyRepository port exists; SQL adapters "later slices"
 * - B-REPO-NO-ADAPTER: src/auth/local/passkey/repository.ts absent; index has
 *   no Memory/Postgres repository factory
 * - B-REPO-NO-MEMORY-MAP: MemoryAuthStores has no passkeys map
 * - B-REPO-NO-PG-CRUD: no athena.passkeys INSERT/UPDATE/DELETE in stores.ts
 *   or challenge-store
 * - B-REPO-NO-ROW-TYPE: no AuthPasskeyRow in src/auth/local/models.ts
 * - B-REPO-FAIL-CLOSED: passkeys:false; seven missing routes; construct throw
 * - B-REPO-005-CHECKSUM: manifest 005 checksum + UNIQUE credential_id stay
 * - B-REPO-CHALLENGE-UNCHANGED: consume is identifier+value DELETE (ADR 0033)
 *
 * Active baseline deleted after slice 04 implement: B-REPO-NO-ADAPTER,
 * B-REPO-NO-MEMORY-MAP, B-REPO-NO-ROW-TYPE, and B-REPO-PORT comment inverted
 * (`repository.ts`, Memory passkeys map, AuthPasskeyRow, adapters exist).
 * Stay-true cells (fail-closed, 005 UNIQUE, challenge-store consume DELETE)
 * live in the target suite. Target is CI SSOT.
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
  "test/sdd/passkey-runtime-finality.repository.target.test.ts";

export const SUPERSEDED_IDS = [
  "B-REPO-PORT",
  "B-REPO-NO-ADAPTER",
  "B-REPO-NO-MEMORY-MAP",
  "B-REPO-NO-PG-CRUD",
  "B-REPO-NO-ROW-TYPE",
  "B-REPO-FAIL-CLOSED",
  "B-REPO-005-CHECKSUM",
  "B-REPO-CHALLENGE-UNCHANGED",
] as const;
