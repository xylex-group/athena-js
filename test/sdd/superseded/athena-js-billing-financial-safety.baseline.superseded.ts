/**
 * SUPERSEDED by test/sdd/athena-js-billing-financial-safety.target.test.ts
 *
 * Former Wave 1 characterization of CURRENT unsafe billing financial
 * operations (optional refund/link/subscription keys, kind-only
 * `billingRetryDispositionForKind` → `retry: "safe"`, money pass-through,
 * no `src/billing/safety/` or `prepareBillingCommand`).
 *
 * - B-FS-KIND-SAFE: kind-only retry helper, no operation/dispatch state
 * - B-FS-KIND-MOLLIE: createMollieProviderRequestError uses kind-only retry
 * - B-FS-KIND-PROJECTION: Mollie projection paths call billingRetryDispositionForKind
 * - B-FS-OPTIONAL-REFUND-KEY: BillingCreateRefundInput leaves idempotencyKey optional
 * - B-FS-OPTIONAL-LINK-KEY: BillingCreatePaymentLinkInput leaves idempotencyKey optional
 * - B-FS-OPTIONAL-SUB-KEY: BillingCreateSubscriptionInput leaves idempotencyKey optional
 * - B-FS-PROVIDER-OPTIONAL-KEY: provider create ports leave idempotencyKey optional
 * - B-FS-NO-ASSERT-KEY: assertBillingIdempotencyKey does not exist
 * - B-FS-NO-ADAPTER-UUID: Mollie adapter does not generate random idempotency keys
 * - B-FS-MONEY-PASSTHROUGH: projectMoney copies currency/value without canonical parse
 * - B-FS-NO-FLOAT: no parseFloat; still no safety/money.ts SSOT
 * - B-FS-NO-SAFETY-TREE: src/billing/safety/ does not exist
 * - B-FS-NO-RECONCILE-TREE: src/billing/reconciliation/ does not exist
 * - B-FS-NO-PREPARE: prepareBillingCommand does not exist
 * - B-FS-NO-EXEC-FAILURE: BillingExecutionFailure does not exist
 * - B-FS-NO-CERTAINTY: BillingExecutionCertainty does not exist
 * - B-FS-NO-REGISTRY: BILLING_OPERATION_SAFETY does not exist
 * - B-FS-ENV-UNNAMED: no named live-selection invariant type
 * - B-FS-REFUND-PREFLIGHT: GET parent payment is not a concurrency guarantee
 * - B-FS-REMOTE-PASSTHROUGH: remote refunds.create posts without assert/prepare
 *
 * Waves 2–5 inverted those found-case cells on the target file only
 * (ADR 0048). Do not invert titles in place. Target suite is the CI
 * source of truth (21/21 GREEN). Do not invert B-MOLLIE-KIND-SAFE in
 * athena-js-mollie.baseline.
 *
 * Active baseline file moved after implement. Kept as a record only
 * (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
  "test/sdd/athena-js-billing-financial-safety.target.test.ts";

export const SUPERSEDED_IDS = [
  "B-FS-KIND-SAFE: P?: billingRetryDispositionForKind returns safe for network/timeout/provider_unavailable/rate_limited with no operation or dispatch state",
  "B-FS-KIND-MOLLIE: P?: createMollieProviderRequestError uses kind-only retry",
  "B-FS-KIND-PROJECTION: P?: Mollie projection serialization paths use billingRetryDispositionForKind",
  "B-FS-OPTIONAL-REFUND-KEY: P?: BillingCreateRefundInput leaves idempotencyKey optional",
  "B-FS-OPTIONAL-LINK-KEY: P?: BillingCreatePaymentLinkInput leaves idempotencyKey optional",
  "B-FS-OPTIONAL-SUB-KEY: P?: BillingCreateSubscriptionInput leaves idempotencyKey optional",
  "B-FS-PROVIDER-OPTIONAL-KEY: P?: provider refund/link/subscription create ports leave idempotencyKey optional",
  "B-FS-NO-ASSERT-KEY: P?: assertBillingIdempotencyKey does not exist",
  "B-FS-NO-ADAPTER-UUID: P?: Mollie adapter does not generate random idempotency keys",
  "B-FS-MONEY-PASSTHROUGH: P?: projectMoney copies currency/value strings without canonical parse",
  "B-FS-NO-FLOAT: P?: billing money path has no parseFloat today and still no decimal SSOT",
  "B-FS-NO-SAFETY-TREE: P?: src/billing/safety/ does not exist",
  "B-FS-NO-RECONCILE-TREE: P?: src/billing/reconciliation/ does not exist",
  "B-FS-NO-PREPARE: P?: prepareBillingCommand does not exist",
  "B-FS-NO-EXEC-FAILURE: P?: BillingExecutionFailure does not exist",
  "B-FS-NO-CERTAINTY: P?: BillingExecutionCertainty does not exist",
  "B-FS-NO-REGISTRY: P?: BILLING_OPERATION_SAFETY does not exist",
  "B-FS-ENV-UNNAMED: P?: resolveBillingEnvironment defaults testMode true but there is no named live-selection invariant type",
  "B-FS-REFUND-PREFLIGHT: P?: refunds.create GET parent payment is not a concurrency or idempotency guarantee",
  "B-FS-REMOTE-PASSTHROUGH: P?: RemoteBillingRuntime refunds.create posts input without assertBillingIdempotencyKey",
] as const;
