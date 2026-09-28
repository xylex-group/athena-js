/**
 * SUPERSEDED by test/sdd/passkey-runtime-finality.verify-registration.target.test.ts
 *
 * Former characterization of CURRENT HEAD before Track A P6 local POST
 * /passkey/verify-registration:
 * - B-VREG-FAIL-CLOSED: passkeys false; construct throw; denyPasskeys; method names
 * - B-VREG-MISSING-ROUTE: POST verify-registration in KNOWN_MISSING_IN_LOCAL
 * - B-VREG-NO-HANDLER: no local POST handler; authenticated POST 404s
 * - B-VREG-FIVE-STAY: five other /passkey/* routes remain missing
 * - B-VREG-SOCIAL-STAY: four social routes remain missing
 * - B-VREG-ENGINE-NOT-WIRED: start/finish throw AthenaPasskeyServerNotWiredError
 * - B-VREG-NO-HOST: RP snapshot factory and runtime take no request Host for rpId
 * - B-VREG-INVENTORY-10: KNOWN_MISSING_IN_LOCAL is 10 = 6 passkey + 4 social
 * - B-VREG-SESSION / SUCCESS / WRAP / CLIENT-DATA / ATTESTATION / CHALLENGE /
 *   ORIGIN / RP / EXPIRED / REPLAY / DUPLICATE / BE-BS / TRANSPORTS: all 404
 *
 * Active baseline deleted after the local POST handler landed:
 * inverted missing-route / no-handler / inventory-10 / ceremony-404 cells.
 * Stay-true fail-closed, five remaining missing routes, engine NotWired,
 * and no-Host RP live in the target suite. Target is CI SSOT.
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
  "test/sdd/passkey-runtime-finality.verify-registration.target.test.ts";

export const SUPERSEDED_IDS = [
  "B-VREG-FAIL-CLOSED",
  "B-VREG-MISSING-ROUTE",
  "B-VREG-NO-HANDLER",
  "B-VREG-FIVE-STAY",
  "B-VREG-SOCIAL-STAY",
  "B-VREG-ENGINE-NOT-WIRED",
  "B-VREG-NO-HOST",
  "B-VREG-INVENTORY-10",
  "B-VREG-SESSION",
  "B-VREG-SUCCESS",
  "B-VREG-WRAP",
  "B-VREG-CLIENT-DATA",
  "B-VREG-ATTESTATION",
  "B-VREG-CHALLENGE",
  "B-VREG-ORIGIN",
  "B-VREG-RP",
  "B-VREG-EXPIRED",
  "B-VREG-REPLAY",
  "B-VREG-DUPLICATE",
  "B-VREG-BE-BS",
  "B-VREG-TRANSPORTS",
] as const;
