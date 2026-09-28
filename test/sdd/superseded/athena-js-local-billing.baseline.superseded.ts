/**
 * SUPERSEDED by test/sdd/athena-js-local-billing.target.test.ts
 *
 * Inverted after PR 1 / Waves 1–2 landed runtime contracts:
 * - B-BIL-NO-RUNTIME: src/billing/runtime/types.ts now exists
 * - B-BIL-NO-CAPABILITIES: src/billing/runtime/capabilities.ts now exists
 * - B-BIL-NO-PAGE: BillingPage is the list contract
 *
 * HTTP keep-green remains in test/billing-client.test.ts and
 * B-BIL-HTTP-MODULE / B-BIL-FLAT-MODULE in the live baseline
 * until PR 2–3 extract RemoteBillingRuntime and cut the façade.
 */
export const SUPERSEDED_BY = "test/sdd/athena-js-local-billing.target.test.ts";

export const SUPERSEDED_IDS = [
  "B-BIL-NO-RUNTIME: P?: billing has no AthenaBillingRuntime port file",
  "B-BIL-NO-CAPABILITIES: P?: billing has no BillingCapabilities file",
  "B-BIL-NO-PAGE: P?: billing has no BillingPage list contract",
];
