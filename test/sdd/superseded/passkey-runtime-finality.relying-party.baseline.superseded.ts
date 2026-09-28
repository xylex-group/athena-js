/**
 * SUPERSEDED by test/sdd/passkey-runtime-finality.relying-party.target.test.ts
 *
 * Former characterization of CURRENT HEAD before Track A P4 snapshot:
 * - B-RP-PORT: PasskeyRelyingPartyResolver.resolve() returns domain RP; no Request
 * - B-RP-NO-SNAPSHOT: relying-party.ts has no snapshot factory / Object.freeze
 * - B-RP-NO-CONFIG: AthenaAuthLocalConfig has no passkey / AthenaAuthPasskeyOptions
 * - B-RP-NO-NORMALIZED: NormalizedAthenaAuthConfig has no passkey; normalize ignores rpId
 * - B-RP-NO-RUNTIME-FREEZE: createAthenaAuthRuntime does not freeze a passkey RP
 * - B-RP-ENGINE-OMIT: AthenaPasskeyServerEnginePorts has no resolver field
 * - B-RP-FAIL-CLOSED: passkeys false; seven missing routes; construct throw; engine unwired
 *
 * Active baseline deleted after snapshot factory + AthenaAuthPasskeyOptions +
 * runtime freeze: B-RP-NO-SNAPSHOT / B-RP-NO-CONFIG / B-RP-NO-NORMALIZED /
 * B-RP-NO-RUNTIME-FREEZE inverted. Stay-true cells (port, engine omit,
 * fail-closed) live in the target suite. Target is CI SSOT.
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
  "test/sdd/passkey-runtime-finality.relying-party.target.test.ts";

export const SUPERSEDED_IDS = [
  "B-RP-PORT",
  "B-RP-NO-SNAPSHOT",
  "B-RP-NO-CONFIG",
  "B-RP-NO-NORMALIZED",
  "B-RP-NO-RUNTIME-FREEZE",
  "B-RP-ENGINE-OMIT",
  "B-RP-FAIL-CLOSED",
] as const;
