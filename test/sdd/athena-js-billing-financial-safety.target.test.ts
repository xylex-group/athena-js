/**
 * Target — financial-operation safety (source of truth; 21/21 GREEN).
 * Former characterization baseline retired to
 * test/sdd/superseded/athena-js-billing-financial-safety.baseline.superseded.ts.
 *
 * See docs/sdd/xylex/athena-js-billing-financial-safety/SPEC.md
 * and dual-suite/dual-suite-spec.md (FS-001…FS-020, FS-ARCH-001).
 */

import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const billingRoot = join(srcRoot, "billing");
const safetyDir = join(billingRoot, "safety");
const reconciliationDir = join(billingRoot, "reconciliation");

type BillingRetryDispositionInput = {
  operation: string;
  kind: string;
  idempotencyKeyPresent: boolean;
  requestDispatchState: string;
};

type BillingOperationSafetyProfileRow = {
  mutationClass: string;
  idempotency: string;
  replayGuarantee: string;
  money: string;
  authorityMode: string;
  preflightIsConcurrencyGuarantee?: boolean;
};

function readRel(rel: string): string {
  return readFileSync(join(pkgRoot, rel), "utf8");
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function billingSources(): string {
  return collectTsFiles(billingRoot)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function interfaceBlock(src: string, name: string): string {
  const marker = `export interface ${name}`;
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `${name} must exist`);
  const brace = src.indexOf("{", start);
  assert.ok(brace >= 0, `${name} must have a body`);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return src.slice(start, i + 1);
      }
    }
  }
  assert.fail(`${name} must have a closing brace`);
}

function quotedOperations(src: string, marker: string, stop: string): string[] {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `${marker} must exist`);
  const end = src.indexOf(stop, start + marker.length);
  assert.ok(end > start, `${stop} must follow ${marker}`);
  return [...src.slice(start, end).matchAll(/"([^"]+)"/g)].map(
    (item) => item[1]
  );
}

function billingOperationsFromCapabilities(): string[] {
  const src = readRel("src/billing/runtime/capabilities.ts");
  const admin = quotedOperations(
    src,
    "export type BillingAdminOperation",
    "export type BillingOperation"
  );
  const ops = quotedOperations(
    src,
    "export type BillingOperation",
    "export type BillingOperationCapabilityReason"
  );
  assert.ok(admin.length > 0, "BillingAdminOperation union must exist");
  assert.ok(ops.length > 0, "BillingOperation union must exist");
  return [...new Set([...ops, ...admin])];
}

function requiredIdempotencyKey(block: string, name: string): void {
  assert.match(
    block,
    /idempotencyKey: string;/,
    `${name} must require idempotencyKey`
  );
  assert.doesNotMatch(
    block,
    /idempotencyKey\?: string;/,
    `${name} must not leave idempotencyKey optional`
  );
}

async function importSafety(rel: string): Promise<Record<string, unknown>> {
  const path = join(safetyDir, rel);
  assert.equal(existsSync(path), true, `src/billing/safety/${rel} must exist`);
  return (await import(pathToFileURL(path).href)) as Record<string, unknown>;
}

async function loadRegistry(): Promise<
  Record<string, BillingOperationSafetyProfileRow>
> {
  const registry = await importSafety("registry.ts");
  const table = registry.BILLING_OPERATION_SAFETY;
  assert.equal(table != null && typeof table === "object", true);
  return table as Record<string, BillingOperationSafetyProfileRow>;
}

test("FS-001: P?: BILLING_OPERATION_SAFETY has a BillingOperationSafetyProfile for every BillingOperation", async () => {
  const table = await loadRegistry();
  const ops = billingOperationsFromCapabilities();
  assert.ok(ops.length > 0);
  assert.deepEqual(Object.keys(table).sort(), [...ops].sort());
});

test("FS-002: P?: each safety profile declares mutationClass, idempotency, replayGuarantee, money, authorityMode", async () => {
  const table = await loadRegistry();
  const refund = table["refunds.create"];
  assert.ok(refund);
  assert.equal(refund.mutationClass, "financial_create");
  assert.equal(refund.idempotency, "required_caller_owned");
  assert.equal(refund.replayGuarantee, "provider_same_key");
  assert.equal(refund.money, "required");
  assert.equal(refund.authorityMode, "declared-required");
  assert.equal(table["payments.create"]?.mutationClass, "financial_create");
  assert.equal(
    table["paymentLinks.create"]?.idempotency,
    "required_caller_owned"
  );
  assert.equal(table["subscriptions.create"]?.money, "required");
  assert.equal(table["customers.create"]?.idempotency, "required_caller_owned");
  assert.equal(table["payments.get"]?.mutationClass, "read");
  assert.equal(table["payments.get"]?.idempotency, "not_applicable");
  for (const profile of Object.values(table)) {
    assert.ok(typeof profile.mutationClass === "string");
    assert.ok(typeof profile.idempotency === "string");
    assert.ok(typeof profile.replayGuarantee === "string");
    assert.ok(typeof profile.money === "string");
    assert.ok(typeof profile.authorityMode === "string");
  }
});

test("FS-003: P?: billingRetryDisposition requires operation, kind, idempotencyKeyPresent, requestDispatchState", async () => {
  const retryMod = await importSafety("retry.ts");
  const fn = retryMod.billingRetryDisposition;
  assert.equal(typeof fn, "function");
  assert.doesNotMatch(billingSources(), /\bbillingRetryDispositionForKind\b/);
  const src = readRel("src/billing/safety/retry.ts");
  assert.match(src, /operation/);
  assert.match(src, /idempotencyKeyPresent/);
  assert.match(src, /requestDispatchState/);
  assert.match(
    src,
    /export function billingRetryDisposition\(\s*(input|options|args)\s*:/
  );
});

test("FS-004: P?: ambiguous financial write without replay guarantee is never retry safe", async () => {
  const retryMod = await importSafety("retry.ts");
  const fn = retryMod.billingRetryDisposition as (
    input: BillingRetryDispositionInput
  ) => string;
  const missingKey = fn({
    idempotencyKeyPresent: false,
    kind: "timeout",
    operation: "refunds.create",
    requestDispatchState: "dispatched",
  });
  assert.notEqual(missingKey, "safe");
  assert.equal(missingKey, "reconcile_first");
  const unknownDispatch = fn({
    idempotencyKeyPresent: false,
    kind: "network",
    operation: "payments.create",
    requestDispatchState: "unknown",
  });
  assert.notEqual(unknownDispatch, "safe");
  const replayAllowed = fn({
    idempotencyKeyPresent: true,
    kind: "timeout",
    operation: "refunds.create",
    requestDispatchState: "dispatched",
  });
  assert.equal(replayAllowed, "safe");
  const notDispatched = fn({
    idempotencyKeyPresent: false,
    kind: "network",
    operation: "refunds.create",
    requestDispatchState: "not_dispatched",
  });
  assert.equal(notDispatched, "safe");
});

test("FS-005: P?: BillingExecutionCertainty is definitely_not_executed, definitely_executed, or outcome_unknown", async () => {
  assert.match(billingSources(), /\bBillingExecutionCertainty\b/);
  const types = await importSafety("types.ts");
  const src = readFileSync(join(safetyDir, "types.ts"), "utf8");
  assert.match(src, /definitely_not_executed/);
  assert.match(src, /definitely_executed/);
  assert.match(src, /outcome_unknown/);
  assert.match(src, /export type BillingExecutionCertainty/);
  assert.match(src, /not_dispatched/);
  assert.match(src, /dispatched/);
  assert.equal(types != null, true);
});

test("FS-006: P?: refunds.create requires caller-owned idempotencyKey at the type", () => {
  requiredIdempotencyKey(
    interfaceBlock(readRel("src/billing/types.ts"), "BillingCreateRefundInput"),
    "BillingCreateRefundInput"
  );
  requiredIdempotencyKey(
    interfaceBlock(
      readRel("src/billing/runtime/local/providers/types.ts"),
      "BillingProviderCreateRefundInput"
    ),
    "BillingProviderCreateRefundInput"
  );
});

test("FS-007: P?: paymentLinks.create and subscriptions.create require caller-owned idempotencyKey at the type", () => {
  const types = readRel("src/billing/types.ts");
  const ports = readRel("src/billing/runtime/local/providers/types.ts");
  for (const [src, name] of [
    [types, "BillingCreatePaymentLinkInput"],
    [types, "BillingCreateSubscriptionInput"],
    [ports, "BillingProviderCreatePaymentLinkInput"],
    [ports, "BillingProviderCreateSubscriptionInput"],
  ] as const) {
    requiredIdempotencyKey(interfaceBlock(src, name), name);
  }
});

test("FS-008: P?: assertBillingIdempotencyKey fail-closes missing or empty keys at runtime", async () => {
  const idem = await importSafety("idempotency.ts");
  const assertKey = idem.assertBillingIdempotencyKey as (key: unknown) => void;
  assert.equal(typeof assertKey, "function");
  assert.throws(() => assertKey(undefined));
  assert.throws(() => assertKey(""));
  assert.throws(() => assertKey("   "));
  assert.throws(() => assertKey(null));
  assert.doesNotThrow(() => assertKey("idem-refund-1"));
  assert.throws(() => assertKey("bad\nkey"));
  assert.throws(() => assertKey("x".repeat(65)));
  const executeRefunds = readRel("src/billing/runtime/local/execute/invoke.ts");
  const remote = readRel("src/billing/runtime/remote/runtime.ts");
  assert.match(
    executeRefunds,
    /\bassertBillingIdempotencyKey\b|\bprepareBillingCommand\b/
  );
  assert.match(
    remote,
    /\bassertBillingIdempotencyKey\b|\bprepareBillingCommand\b/
  );
});

test("FS-009: P?: Mollie dialect create adapters never generate random idempotency keys", () => {
  for (const rel of [
    "src/billing/runtime/local/providers/mollie/dialect/refunds.ts",
    "src/billing/runtime/local/providers/mollie/dialect/payment-links.ts",
    "src/billing/runtime/local/providers/mollie/dialect/subscriptions.ts",
    "src/billing/runtime/local/providers/mollie/dialect/payments.ts",
    "src/billing/runtime/local/providers/mollie/dialect/customers.ts",
  ]) {
    const dialect = readRel(rel);
    assert.doesNotMatch(dialect, /\brandomUUID\b/);
    assert.doesNotMatch(dialect, /crypto\.randomUUID/);
    if (
      rel.endsWith("refunds.ts") ||
      rel.endsWith("payment-links.ts") ||
      rel.endsWith("subscriptions.ts")
    ) {
      assert.match(dialect, /idempotencyKey: input\.idempotencyKey/);
      assert.match(
        dialect,
        /idempotencyKey: string/,
        `${rel} must require a caller-owned idempotencyKey string (not optional)`
      );
      assert.doesNotMatch(
        dialect,
        /idempotencyKey\?: string/,
        `${rel} must not accept a missing idempotency key`
      );
    }
  }
});

test("FS-010: P?: canonical money parse/assert/normalize without JS floats", async () => {
  const moneyPath = join(safetyDir, "money.ts");
  assert.equal(existsSync(moneyPath), true);
  const moneySrc = readFileSync(moneyPath, "utf8");
  assert.doesNotMatch(moneySrc, /\bparseFloat\b/);
  assert.doesNotMatch(moneySrc, /\bNumber\(/);
  assert.doesNotMatch(moneySrc, /\b\+[A-Za-z]/);
  assert.doesNotMatch(billingSources(), /\bparseFloat\b/);
  const money = await importSafety("money.ts");
  const parse = money.parseBillingMoney as (value: unknown) => {
    currency: string;
    value: string;
  };
  const assertMoney = money.assertBillingMoney as (value: unknown) => void;
  const normalize = money.normalizeBillingMoney as (value: unknown) => {
    currency: string;
    value: string;
  };
  assert.equal(typeof parse, "function");
  assert.equal(typeof assertMoney, "function");
  assert.equal(typeof normalize, "function");
  assert.deepEqual(normalize({ currency: "eur", value: "1.5" }), {
    currency: "EUR",
    value: "1.50",
  });
  assert.throws(() => parse({ currency: "EUR", value: 1.1 }));
  assert.throws(() => parse({ currency: "EUR", value: "not-money" }));
  assert.throws(() => assertMoney({ currency: "EUR", value: "0.00" }));
  const projection = readRel(
    "src/billing/runtime/local/providers/mollie/projection.ts"
  );
  assert.match(
    projection,
    /parseBillingMoney|normalizeBillingMoney|assertBillingMoney/
  );
});

test("FS-011: P?: operation-specific validators run in prepareBillingCommand", async () => {
  const prepare = await importSafety("prepare.ts");
  const fn = prepare.prepareBillingCommand as (input: unknown) => unknown;
  assert.equal(typeof fn, "function");
  assert.throws(() =>
    fn({
      operation: "refunds.create",
      payload: {
        amount: { currency: "EUR", value: "1.00" },
        idempotencyKey: "idem-1",
      },
    })
  );
  assert.throws(() =>
    fn({
      operation: "paymentLinks.create",
      payload: {
        amount: { currency: "EUR", value: "2.00" },
        description: "",
        idempotencyKey: "idem-link-1",
      },
    })
  );
  assert.throws(() =>
    fn({
      operation: "subscriptions.create",
      payload: {
        amount: { currency: "EUR", value: "3.00" },
        customerId: "cst_1",
        description: "sub",
        idempotencyKey: "idem-sub-1",
      },
    })
  );
  const prepared = fn({
    operation: "refunds.create",
    payload: {
      amount: { currency: "EUR", value: "1.00" },
      idempotencyKey: "idem-refund-ok",
      paymentId: "tr_ok",
    },
  });
  assert.equal(typeof prepared, "object");
  assert.equal(Object.isFrozen(prepared), true);
});

test("FS-012: P?: prepareBillingCommand preflight sits above providers", () => {
  const remote = readRel("src/billing/runtime/remote/runtime.ts");
  const invoke = readRel("src/billing/runtime/local/execute/invoke.ts");
  const local = readRel("src/billing/runtime/local/runtime.ts");
  assert.match(local, /execute\/invoke/);
  assert.match(remote, /prepareBillingCommand/);
  assert.match(invoke, /prepareBillingCommand/);
  assert.match(invoke, /finalizeBillingCommand/);
  assert.match(invoke, /idempotency: deferSafety \? "defer" : "enforce"/);
  const prepareIdx = invoke.indexOf("prepareBillingCommand({");
  const resolveIdx = invoke.indexOf("prepareLocalBillingInvocation({");
  const finalizeIdx = invoke.indexOf("finalizeBillingCommand({");
  assert.ok(prepareIdx >= 0 && resolveIdx > prepareIdx);
  assert.ok(finalizeIdx > resolveIdx);
});

test("FS-013: P?: BillingExecutionFailure separates transport, certainty, retry, and reconciliation", async () => {
  assert.equal(existsSync(join(safetyDir, "failure.ts")), true);
  const failure = await importSafety("failure.ts");
  const src = readFileSync(join(safetyDir, "failure.ts"), "utf8");
  assert.match(src, /export (?:type|interface) BillingExecutionFailure/);
  assert.match(src, /transport/);
  assert.match(src, /certainty/);
  assert.match(src, /retry/);
  assert.match(src, /reconciliation/);
  const factory =
    (failure.createBillingExecutionFailure as
      | ((input: Record<string, unknown>) => Record<string, unknown>)
      | undefined) ??
    (failure.BillingExecutionFailure as unknown as {
      new (input: Record<string, unknown>): Record<string, unknown>;
    });
  assert.ok(factory, "BillingExecutionFailure factory or class must exist");
  const sample =
    typeof factory === "function" && factory.prototype == null
      ? (
          factory as (input: Record<string, unknown>) => Record<string, unknown>
        )({
          certainty: "outcome_unknown",
          reconciliation: {
            kind: "list_children",
            operation: "refunds.create",
            parentId: "tr_1",
          },
          retry: "reconcile_first",
          transport: {
            kind: "timeout",
            operation: "refunds.create",
            provider: "mollie",
          },
        })
      : new (
          factory as {
            new (input: Record<string, unknown>): Record<string, unknown>;
          }
        )({
          certainty: "outcome_unknown",
          reconciliation: {
            kind: "list_children",
            operation: "refunds.create",
            parentId: "tr_1",
          },
          retry: "reconcile_first",
          transport: {
            kind: "timeout",
            operation: "refunds.create",
            provider: "mollie",
          },
        });
  assert.ok("transport" in sample);
  assert.ok("certainty" in sample);
  assert.ok("retry" in sample);
  assert.ok("reconciliation" in sample);
});

test("FS-014: P?: reconciliation hints primitive exists under billing/reconciliation", () => {
  assert.equal(existsSync(reconciliationDir), true);
  assert.equal(existsSync(join(reconciliationDir, "hints.ts")), true);
  const src = readFileSync(join(reconciliationDir, "hints.ts"), "utf8");
  assert.match(src, /\bBillingReconciliationHint\b/);
  assert.match(src, /get_parent/);
  assert.match(src, /list_children/);
  assert.match(src, /get_self/);
});

test("FS-015: P?: authorityMode provider-trust vs declared-required is linked to the safety registry", async () => {
  const table = await loadRegistry();
  assert.equal(table["payments.create"]?.authorityMode, "declared-required");
  assert.equal(table["refunds.create"]?.authorityMode, "declared-required");
  assert.equal(
    table["paymentLinks.create"]?.authorityMode,
    "declared-required"
  );
  assert.equal(
    table["subscriptions.create"]?.authorityMode,
    "declared-required"
  );
  assert.equal(table["payments.cancel"]?.authorityMode, "declared-required");
  assert.equal(table["payments.get"]?.authorityMode, "provider-trust");
  assert.equal(table["refunds.list"]?.authorityMode, "provider-trust");
  assert.equal(table["invoices.get"]?.authorityMode, "provider-trust");
});

test("FS-016: P?: named live/test invariant — live credentials are never selected implicitly", async () => {
  const env = await importSafety("environment.ts");
  const src = billingSources();
  assert.match(
    src,
    /\bBillingLiveCredentialSelection\b|\bassertBillingLiveCredentialSelection\b|\bBillingLiveSelectionInvariant\b/
  );
  const resolve =
    env.resolveBillingEnvironment ??
    env.assertBillingLiveCredentialSelection ??
    env.resolveBillingLiveSelection;
  assert.equal(typeof resolve, "function");
  const omitted = (
    resolve as (input?: { testMode?: boolean }) => {
      testMode: boolean;
      name: string;
    }
  )();
  assert.equal(omitted.testMode, true);
  assert.equal(omitted.name, "test");
  const livePresentDoesNotPromote = (
    resolve as (input?: {
      credentials?: { live?: unknown; test?: unknown };
      testMode?: boolean;
    }) => { testMode: boolean; name: string }
  )({
    credentials: { live: { kind: "api_key" } },
  });
  assert.equal(livePresentDoesNotPromote.testMode, true);
  assert.equal(livePresentDoesNotPromote.name, "test");
});

test("FS-017: P?: MOLLIE_OPERATION_SEMANTICS classifies operations; official SDK remains transport", async () => {
  const semantics = await importSafety("mollie-semantics.ts");
  assert.ok(semantics.MOLLIE_OPERATION_SEMANTICS);
  const table = semantics.MOLLIE_OPERATION_SEMANTICS as Record<string, unknown>;
  assert.ok("refunds.create" in table);
  assert.ok("payments.create" in table);
  assert.doesNotMatch(
    readRel(
      "src/billing/runtime/local/providers/mollie/sdk/official-adapter.ts"
    ),
    /class FetchMollie/
  );
  const mollieDir = join(
    billingRoot,
    "runtime",
    "local",
    "providers",
    "mollie"
  );
  assert.equal(existsSync(join(mollieDir, "http-client.ts")), false);
  assert.equal(existsSync(join(mollieDir, "transport.ts")), false);
  assert.doesNotMatch(billingSources(), /createCustomMollieHttpClient/);
});

test("FS-018: P?: refund GET preflight is not a concurrency or idempotency guarantee", async () => {
  const src = readRel("src/billing/runtime/local/providers/mollie/refunds.ts");
  assert.match(src, /assertParentPaymentProfile/);
  assert.match(src, /resource: "payments"/);
  assert.match(src, /operation: "refunds.create"/);
  assert.doesNotMatch(src, /lock|mutex|concurrency guarantee/i);
  const table = await loadRegistry();
  assert.equal(
    table["refunds.create"]?.preflightIsConcurrencyGuarantee,
    false,
    "refund parent GET preflight must be declared as not a concurrency guarantee"
  );
  const safetySrc = collectTsFiles(safetyDir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.match(
    safetySrc,
    /preflightIsConcurrencyGuarantee/,
    "safety layer must name that preflight is not a concurrency guarantee"
  );
});

test("FS-019: P?: observability hashes idempotency keys and never logs secrets", async () => {
  const corr = await importSafety("correlation.ts");
  const hash =
    (corr.hashBillingIdempotencyKey as ((key: string) => string) | undefined) ??
    (corr.hashIdempotencyKey as ((key: string) => string) | undefined);
  assert.equal(typeof hash, "function");
  const hashed = hash("idem-refund-secret-key");
  assert.equal(typeof hashed, "string");
  assert.notEqual(hashed, "idem-refund-secret-key");
  assert.doesNotMatch(hashed, /idem-refund-secret-key/);
  assert.match(hashed, /^[a-f0-9]{64}$/i);
  const src = readFileSync(join(safetyDir, "correlation.ts"), "utf8");
  assert.match(src, /hash|createHash|sha256/i);
  assert.doesNotMatch(src, /console\.log\([^)]*idempotencyKey/);
  assert.doesNotMatch(billingSources(), /console\.log\([^)]*idempotencyKey/);
});

test("FS-020: P?: LocalBillingRuntime and RemoteBillingRuntime share the same safety layer", () => {
  const local = readRel("src/billing/runtime/local/runtime.ts");
  const remote = readRel("src/billing/runtime/remote/runtime.ts");
  assert.match(local, /billing\/safety/);
  assert.match(remote, /billing\/safety/);
  assert.match(local, /prepareBillingCommand/);
  assert.match(remote, /prepareBillingCommand/);
  assert.doesNotMatch(
    remote,
    /call\("POST", "\/billing\/v1\/refunds", input\)/
  );
});

test("FS-ARCH-001: P?: billingRetryDispositionForKind cannot be reintroduced without operation context", () => {
  assert.doesNotMatch(billingSources(), /\bbillingRetryDispositionForKind\b/);
  assert.equal(existsSync(join(safetyDir, "retry.ts")), true);
  const retrySrc = readFileSync(join(safetyDir, "retry.ts"), "utf8");
  assert.match(retrySrc, /billingRetryDisposition\s*\(\s*(input|options|args)/);
  assert.match(retrySrc, /operation/);
  assert.match(retrySrc, /idempotencyKeyPresent/);
  assert.match(retrySrc, /requestDispatchState/);
});

test("FS-021: P?: deferred idempotency finalizes after capability and authorization", async () => {
  const { AthenaBillingAuthorizationError, AthenaBillingCapabilityError } =
    await import("../../src/billing/errors.ts");
  const { PROCESS_BILLING_INVOCATION, SESSION_BILLING_INVOCATION } =
    await import("../../src/billing/runtime/invocation-authority.ts");
  const { executeLocalBillingRefundCreate } = await import(
    "../../src/billing/runtime/local/execute/refunds.ts"
  );
  const { BillingProviderRegistry } = await import(
    "../../src/billing/runtime/local/providers/registry.ts"
  );
  const { PROCESS_OWNED_BILLING_PRINCIPAL } = await import(
    "../../src/billing/runtime/rights.ts"
  );
  const { parseAthenaRightKey } = await import("../../src/rights/key.ts");
  const { FetchMollieSdk } = await import("../helpers/fetch-mollie-sdk.ts");

  const created: unknown[] = [];
  function stub(available: boolean) {
    const portsTrue = {
      checkout: false,
      customers: false,
      invoices: false,
      paymentLinks: false,
      payments: false,
      prices: false,
      products: false,
      relations: false,
      refunds: true,
      subscriptions: false,
      webhooks: false,
    };
    return {
      async getCapabilities() {
        return {
          operations: { "refunds.create": available },
          ports: portsTrue,
        };
      },
      provider: "mollie" as const,
      refunds: {
        async create(_context: unknown, input: unknown) {
          created.push(input);
          return {
            amount: { currency: "EUR", value: "1.00" },
            id: "re_1",
            kind: "refund",
            metadata: {},
            provider: "mollie",
            providerPaymentId: "tr_1",
            providerRefundId: "re_1",
            raw: {},
            status: "pending",
          };
        },
      },
    };
  }

  const payload = {
    amount: { currency: "EUR", value: "1.00" },
    paymentId: "tr_1",
  };
  const providers = {
    mollie: { sdk: FetchMollieSdk, testKey: "test_fs_defer" },
  };

  await assert.rejects(
    () =>
      executeLocalBillingRefundCreate({
        authority: SESSION_BILLING_INVOCATION,
        configuredProviders: providers,
        payload: payload as never,
        principal: {
          authenticated: true,
          grants: [],
          rights: [],
          userId: "user_defer",
        },
        registry: new BillingProviderRegistry([stub(true)]),
      }),
    (error: unknown) => error instanceof AthenaBillingAuthorizationError
  );
  assert.equal(created.length, 0);

  await assert.rejects(
    () =>
      executeLocalBillingRefundCreate({
        authority: SESSION_BILLING_INVOCATION,
        configuredProviders: providers,
        payload: payload as never,
        principal: {
          authenticated: true,
          grants: [],
          rights: [parseAthenaRightKey("billing.refunds.write")],
          userId: "user_defer",
        },
        registry: new BillingProviderRegistry([stub(false)]),
      }),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.reason === "unsupported_operation"
  );
  assert.equal(created.length, 0);

  await assert.rejects(
    () =>
      executeLocalBillingRefundCreate({
        authority: PROCESS_BILLING_INVOCATION,
        configuredProviders: providers,
        payload: payload as never,
        principal: PROCESS_OWNED_BILLING_PRINCIPAL,
        registry: new BillingProviderRegistry([stub(true)]),
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "ATHENA_BILLING_IDEMPOTENCY_KEY_REQUIRED"
  );
  assert.equal(created.length, 0);

  await executeLocalBillingRefundCreate({
    authority: PROCESS_BILLING_INVOCATION,
    configuredProviders: providers,
    payload: {
      ...payload,
      idempotencyKey: "idem-refund-ok",
    },
    principal: PROCESS_OWNED_BILLING_PRINCIPAL,
    registry: new BillingProviderRegistry([stub(true)]),
  });
  assert.equal(created.length, 1);
});
