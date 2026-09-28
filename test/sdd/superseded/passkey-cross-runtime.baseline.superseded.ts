/**
 * SUPERSEDED by test/sdd/passkey-cross-runtime.target.test.ts
 *
 * Former characterization of freeze f6bd10055 (pre-extract HEAD):
 * - B2-SURFACE: eight canonical athena.auth.passkey methods
 * - B2-NO-NS: no createPasskeyModule / second WebAuthn client
 * - B2-EMB-CAP: embedded snapshot passkeys === false
 * - B2-EMB-MISSING: KNOWN_MISSING_IN_LOCAL lists seven /passkey/* routes
 * - B2-DENY: known-false gated methods → ATHENA_AUTH_CAPABILITY_DISABLED
 * - B2-CONSTRUCT: auth.passkeys / auth.webauthn throws FEATURE_UNSUPPORTED
 * - B2-MAPPER: mapper implemented inline at local/passkey-authenticator-metadata.ts
 * - B2-NO-TREE: src/auth/passkey/ directory absent; bindings inline in client.ts
 * - B2-NO-RPID: AthenaPasskeyOptionsResponse has no top-level rpId
 * - B2-RPID-UI: RP-ID forwarding only in Auth UI; no athena-js browser adapter
 *
 * Active baseline file deleted after slice-2 extract: B2-NO-NS, B2-DENY,
 * B2-MAPPER, B2-NO-TREE, and B2-RPID-UI inverted (createPasskeyModule,
 * src/auth/passkey/ tree, mapper re-export, browser adapter). Target suite
 * is the CI source of truth.
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY = "test/sdd/passkey-cross-runtime.target.test.ts";

export const SUPERSEDED_IDS = [
  "B2-SURFACE",
  "B2-NO-NS",
  "B2-EMB-CAP",
  "B2-EMB-MISSING",
  "B2-DENY",
  "B2-CONSTRUCT",
  "B2-MAPPER",
  "B2-NO-TREE",
  "B2-NO-RPID",
  "B2-RPID-UI",
] as const;
