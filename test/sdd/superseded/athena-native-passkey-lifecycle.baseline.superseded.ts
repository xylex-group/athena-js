/**
 * SUPERSEDED by test/sdd/athena-native-passkey-lifecycle.target.test.ts
 *
 * Former characterization of pin acb0f21c (PR #696) before Wave 1 slices 01–02:
 * - B-NPK-UPD-RESERVED: passkey.update is reserved
 * - B-NPK-DEL-RESERVED: passkey.delete is reserved
 * - B-NPK-NO-DEF-UPD: passkey.update absent from ATHENA_AUTH_EVENT_DEFINITIONS
 * - B-NPK-NO-DEF-DEL: passkey.delete absent from ATHENA_AUTH_EVENT_DEFINITIONS
 * - B-NPK-MANAGE-NO-MUTATE: update/delete routes bypass executeAuthMutation
 * - B-NPK-MANAGE-CTX-STORES: update and delete use request ctx.stores
 * - B-NPK-REG-MUTATE: passkey.register already goes through the nucleus
 * - B-NPK-NO-CLIENT: createPasskeyClient absent from public auth assembly
 * - B-NPK-PAYLOADS: hook payloads define passkey.register only
 * - B-NPK-COMPANION: implemented-event scan omits manage-passkeys.ts
 * - B-NPK-SCHEMA-24: Wave 1 has no embedded-auth ledger generation bump
 *
 * Active baseline deleted after implement: reserved / no-definition /
 * no-mutate / ctx.stores / register-only payload / companion-omit cells
 * inverted. Stay-true cells (register nucleus, no second client, schema
 * generation 24) live in the target suite. Target is CI SSOT.
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
  "test/sdd/athena-native-passkey-lifecycle.target.test.ts";

export const SUPERSEDED_IDS = [
  "B-NPK-UPD-RESERVED",
  "B-NPK-DEL-RESERVED",
  "B-NPK-NO-DEF-UPD",
  "B-NPK-NO-DEF-DEL",
  "B-NPK-MANAGE-NO-MUTATE",
  "B-NPK-MANAGE-CTX-STORES",
  "B-NPK-REG-MUTATE",
  "B-NPK-NO-CLIENT",
  "B-NPK-PAYLOADS",
  "B-NPK-COMPANION",
  "B-NPK-SCHEMA-24",
] as const;
