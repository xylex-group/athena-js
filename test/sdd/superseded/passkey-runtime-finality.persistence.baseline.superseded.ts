/**
 * SUPERSEDED by test/sdd/passkey-runtime-finality.persistence.target.test.ts
 *
 * Former characterization of CURRENT HEAD missing athena.passkeys.updated_at:
 * - B-PERS-JS-NO-UPDATED: 005 has created_at and no updated_at (stay-true on 005)
 * - B-PERS-JS-GEN-21: ATHENA_AUTH_SCHEMA_GENERATION === 21
 * - B-PERS-JS-NO-022: ledger has no version 22 / 022_add_updated_at_to_passkeys
 * - B-PERS-JS-MANIFEST-V5: expectations v5 = table + idx_passkeys_user_id only
 * - B-PERS-RS-EXPECTED-NO-UPDATED: EXPECTED_COLUMNS_PASSKEYS has no updated_at
 * - B-PERS-RS-META-NO-UPDATED: AuthPasskeyMeta has no col_updated_at
 * - B-PERS-RS-TYPE-NO-UPDATED: struct Passkey has no updated_at
 * - B-PERS-RS-PROVISION-NO-UPDATED: provision CREATE has no updated_at and no ALTER
 * - B-PERS-RS-NO-021-MIG: no services/athena-auth/migrations/021_*.sql
 * - B-PERS-JS-005-UNIQUE: 005 UNIQUE credential_id + both idx_passkeys_* (stay-true)
 * - B-PERS-DOMAIN-UPDATEDAT: AthenaStoredPasskey.updatedAt exists independently of SQL
 *
 * Active baseline deleted after slice 03 implement: missing-column cells inverted
 * (JS gen 22 022_add_updated_at_to_passkeys, Rust 021 + provision ALTER,
 * EXPECTED_COLUMNS_PASSKEYS / AuthPasskeyMeta / Passkey.updated_at). 005 SQL
 * still omits updated_at; UNIQUE + indexes remain. Target suite is CI SSOT.
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
  "test/sdd/passkey-runtime-finality.persistence.target.test.ts";

export const SUPERSEDED_IDS = [
  "B-PERS-JS-NO-UPDATED",
  "B-PERS-JS-GEN-21",
  "B-PERS-JS-NO-022",
  "B-PERS-JS-MANIFEST-V5",
  "B-PERS-RS-EXPECTED-NO-UPDATED",
  "B-PERS-RS-META-NO-UPDATED",
  "B-PERS-RS-TYPE-NO-UPDATED",
  "B-PERS-RS-PROVISION-NO-UPDATED",
  "B-PERS-RS-NO-021-MIG",
  "B-PERS-JS-005-UNIQUE",
  "B-PERS-DOMAIN-UPDATEDAT",
] as const;
