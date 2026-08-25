/**
 * SUPERSEDED by test/sdd/passkey-runtime-finality.server-contract.target.test.ts
 *
 * Former characterization of CURRENT HEAD 3ed6b2e723 (pre-slice-01):
 * - B-SRV-SURFACE: eight CANONICAL_PASSKEY_METHODS on auth.passkey
 * - B-SRV-NO-NS: no createPasskeyClient / createWebAuthnClient / athena.webauthn
 * - B-SRV-FAIL-CLOSED: passkeys===false; construct throws; AUTH-PARITY FAIL-CLOSED
 * - B-SRV-MISSING-ROUTES: seven /passkey/* in KNOWN_MISSING_IN_LOCAL
 * - B-SRV-NO-TREE: src/auth/passkey/server/ absent
 * - B-SRV-HTTP-DENY: createPasskeyModule is HTTP + denyPasskeys
 *
 * Active baseline deleted after slice 01 ports/domain: B-SRV-NO-TREE inverted
 * (`src/auth/passkey/server/` now exists). Target suite is the CI source of truth.
 *
 * Do not supersede T2-FAIL-CLOSED (program fail-closed until later slices).
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
  "test/sdd/passkey-runtime-finality.server-contract.target.test.ts";

export const SUPERSEDED_IDS = [
  "B-SRV-SURFACE",
  "B-SRV-NO-NS",
  "B-SRV-FAIL-CLOSED",
  "B-SRV-MISSING-ROUTES",
  "B-SRV-NO-TREE",
  "B-SRV-HTTP-DENY",
] as const;
