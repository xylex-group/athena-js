/**
 * SUPERSEDED by test/sdd/passkey-runtime-finality.register-options.target.test.ts
 *
 * Former characterization of CURRENT HEAD before Track A P5 local GET
 * /passkey/generate-register-options:
 * - B-REG-FAIL-CLOSED: passkeys false; construct throw; denyPasskeys; method names
 * - B-REG-MISSING-ROUTE: GET generate-register-options in KNOWN_MISSING_IN_LOCAL
 * - B-REG-NO-HANDLER: no local GET handler; authenticated GET 404s
 * - B-REG-SIX-STAY: the other six /passkey/* routes remain missing
 * - B-REG-ENGINE-NOT-WIRED: startRegistration throws AthenaPasskeyServerNotWiredError
 * - B-REG-NO-HOST: RP snapshot factory and runtime take no request Host for rpId
 *
 * Active baseline deleted after the local GET handler landed:
 * B-REG-MISSING-ROUTE / B-REG-NO-HANDLER inverted. Stay-true fail-closed,
 * six remaining missing routes, engine NotWired, and no-Host RP live in
 * the target suite. Target is CI SSOT.
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
  "test/sdd/passkey-runtime-finality.register-options.target.test.ts";

export const SUPERSEDED_IDS = [
  "B-REG-FAIL-CLOSED",
  "B-REG-MISSING-ROUTE",
  "B-REG-NO-HANDLER",
  "B-REG-SIX-STAY",
  "B-REG-ENGINE-NOT-WIRED",
  "B-REG-NO-HOST",
] as const;
