import { strict as assert } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AthenaBillingCapabilityError,
  AthenaBillingError,
} from "../../src/billing/errors.ts";
import { BillingProviderRegistry } from "../../src/billing/runtime/local/providers/registry.ts";
import type { BillingProviderRuntime } from "../../src/billing/runtime/local/providers/types.ts";
import { advanceSelfSubscriptionEnrollment } from "../../src/billing/runtime/self/advance-enrollment.ts";
import {
  changeSelfSubscription,
  isPlanChangeReplacementCandidate,
} from "../../src/billing/runtime/self/change.ts";
import { createSelfCheckout as createSelfCheckoutImpl } from "../../src/billing/runtime/self/checkout.ts";
import { rejectSelfPayloadSelectors } from "../../src/billing/runtime/self/dispatch.ts";
import {
  enrollSelfSubscription as enrollSelfSubscriptionImpl,
  persistOwnedSubscription,
} from "../../src/billing/runtime/self/enroll.ts";
import {
  checkoutAttemptExpiresAtIso,
  insertCheckoutSession,
  insertCheckoutSessionLines,
  listCheckoutSessionLines,
} from "../../src/billing/runtime/self/enrollment-session.ts";
import { resumeSelfCheckout } from "../../src/billing/runtime/self/resume.ts";
import {
  ATHENA_BILLING_RETURN_QUERY,
  appendBillingReturnToken,
} from "../../src/billing/runtime/self/return-query.ts";
import { createBillingReturnNonce } from "../../src/billing/runtime/self/return-token.ts";
import { executeSelfBillingOperation } from "../../src/billing/runtime/self/runtime.ts";
import {
  ensureActiveProviderCustomer as ensureActiveProviderCustomerImpl,
} from "../../src/billing/subject/ensure-provider-customer.ts";
import { AthenaBillingSubjectError } from "../../src/billing/subject/errors.ts";
import type { BillingSqlExecutor } from "../../src/billing/subject/repository.ts";
import type {
  BillingCatalogRelation,
  BillingPrice,
  BillingSubscription,
} from "../../src/billing/types.ts";
import type { AthenaPrincipal } from "../../src/runtime/data/principal.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");

const ENROLL_SUBJECT_USER_ID = "user_enroll_1";
const BILLING_APPLICATION_ID = "app_self_enroll";

function createSelfCheckout(
  input: Parameters<typeof createSelfCheckoutImpl>[0],
): ReturnType<typeof createSelfCheckoutImpl> {
  return createSelfCheckoutImpl({
    applicationId: BILLING_APPLICATION_ID,
    selfEnrollmentEnabled: true,
    ...input,
  });
}

function enrollSelfSubscription(
  input: Parameters<typeof enrollSelfSubscriptionImpl>[0],
): ReturnType<typeof enrollSelfSubscriptionImpl> {
  return enrollSelfSubscriptionImpl({
    applicationId: BILLING_APPLICATION_ID,
    selfEnrollmentEnabled: true,
    ...input,
  });
}

function ensureActiveProviderCustomer(
  input: Parameters<typeof ensureActiveProviderCustomerImpl>[0],
): ReturnType<typeof ensureActiveProviderCustomerImpl> {
  return ensureActiveProviderCustomerImpl({
    applicationId: BILLING_APPLICATION_ID,
    ...input,
  });
}

function principal(): AthenaPrincipal {
  return {
    authenticated: true,
    grants: [],
    rights: [],
    userId: ENROLL_SUBJECT_USER_ID,
  };
}

function recurringPrice(): BillingPrice {
  return {
    amount: { currency: "EUR", value: "10.00" },
    id: "starter-monthly",
    interval: "month",
    metadata: {},
    productId: "starter",
    raw: {},
  };
}

function oneTimePrice(): BillingPrice {
  return {
    amount: { currency: "EUR", value: "25.00" },
    id: "lifetime",
    metadata: {},
    productId: "lifetime",
    raw: {},
  };
}

function addonPrice(): BillingPrice {
  return {
    amount: { currency: "EUR", value: "15.00" },
    id: "support-once",
    metadata: {},
    productId: "support",
    raw: {},
  };
}

function extraAddonPrice(): BillingPrice {
  return {
    amount: { currency: "EUR", value: "20.00" },
    id: "extra-once",
    metadata: {},
    productId: "extra",
    raw: {},
  };
}

function starterAddonRelation(): BillingCatalogRelation {
  return {
    id: "rel_addon",
    metadata: {},
    raw: {},
    sourceProductId: "starter",
    targetProductId: "support",
    type: "addon",
  };
}

function starterExtraRelation(): BillingCatalogRelation {
  return {
    id: "rel_extra",
    metadata: {},
    raw: {},
    sourceProductId: "starter",
    targetProductId: "extra",
    type: "addon",
  };
}

async function seedUsableMandate(sql: BillingSqlExecutor): Promise<void> {
  await sql.query(
    `INSERT INTO billing.billing_checkout_sessions (
			id, idempotency_key, subject_kind, subject_id, price_id, provider,
			provider_customer_id, provider_payment_id, provider_subscription_id,
			status, checkout_url, metadata
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      randomUUID(),
      "prior-mandate",
      "user",
      ENROLL_SUBJECT_USER_ID,
      "starter-monthly",
      "mollie",
      "cst_enroll",
      "tr_old",
      "sub_old",
      "enrolled",
      null,
      "{}",
    ],
  );
}

function configuredProviders() {
  return {
    mollie: {
      sdk: FetchMollieSdk,
      testKey: "test_athena_self_enroll",
    },
  };
}

function memorySql() {
  const sessions: Record<string, unknown>[] = [];
  const sessionLines: Record<string, unknown>[] = [];
  const subscriptions: Record<string, unknown>[] = [];
  const bindings: Record<string, unknown>[] = [];
  const enrollments: Record<string, unknown>[] = [];
  const planChanges: Record<string, unknown>[] = [];
  const providerEffects: Record<string, unknown>[] = [];
  const defaultConnectionId = "11111111-1111-4111-8111-111111111111";
  const sql: BillingSqlExecutor = {
    async query(text, params = []) {
      const compact = text.replace(/\s+/g, " ");
      if (compact.includes("FROM billing.billing_provider_connections")) {
        return {
          rows: [
            {
              credential_reference: "providers.mollie",
              environment: "test",
              id: defaultConnectionId,
              owner_id: BILLING_APPLICATION_ID,
              owner_kind: "tenant",
              provider: "mollie",
              status: "active",
            },
          ],
        };
      }
      if (
        compact.includes("UPDATE billing.billing_subscription_enrollments") &&
        compact.includes("state = 'expired'")
      ) {
        for (const row of enrollments) {
          if (
            row.subject_kind === params[0] &&
            row.subject_id === params[1] &&
            row.state === "reserved" &&
            row.lease_expires_at != null &&
            new Date(String(row.lease_expires_at)).getTime() < Date.now()
          ) {
            row.state = "expired";
          }
        }
        return { rows: [] };
      }
      if (
        compact.includes("FROM billing.billing_subscription_enrollments") &&
        compact.includes("WHERE id =")
      ) {
        const row = enrollments.find((entry) => entry.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (
        compact.includes("FROM billing.billing_subscription_enrollments") &&
        compact.includes("state IN")
      ) {
        const live = enrollments.find(
          (entry) =>
            entry.subject_kind === params[0] &&
            entry.subject_id === params[1] &&
            [
              "reserved",
              "first_payment_pending",
              "advancing",
              "active",
            ].includes(String(entry.state)),
        );
        return { rows: live ? [live] : [] };
      }
      if (
        compact.includes("INSERT INTO billing.billing_subscription_enrollments")
      ) {
        const live = enrollments.find(
          (entry) =>
            entry.subject_kind === params[2] &&
            entry.subject_id === params[3] &&
            [
              "reserved",
              "first_payment_pending",
              "advancing",
              "active",
            ].includes(String(entry.state)),
        );
        if (live) {
          const error = new Error("unique_violation") as Error & {
            code: string;
          };
          error.code = "23505";
          throw error;
        }
        const row = {
          attempt_count: 0,
          connection_id: params[1],
          fencing_epoch: 0,
          id: params[0],
          idempotency_key: params[5],
          journal_intent: null,
          last_error: null,
          lease_expires_at: null,
          lease_token: null,
          price_id: params[4],
          provider_idempotency_key: params[0],
          provider_payment_id: null,
          provider_subscription_id: params[6] ?? null,
          state: compact.includes("'active'") ? "active" : "reserved",
          subject_id: params[3],
          subject_kind: params[2],
        };
        enrollments.push(row);
        return { rows: [row] };
      }
      if (
        compact.includes("INSERT INTO billing.billing_plan_change_operations")
      ) {
        const existing = planChanges.find(
          (entry) =>
            entry.subject_kind === params[2] &&
            entry.subject_id === params[3] &&
            entry.idempotency_key === params[6],
        );
        if (existing) {
          return { rows: [] };
        }
        const row = {
          connection_id: params[1],
          enrollment_id: params[5],
          expected_row_version: params[7],
          fencing_epoch: 0,
          id: params[0],
          idempotency_key: params[6],
          last_error: null,
          lease_expires_at: null,
          lease_token: null,
          owned_subscription_id: params[4],
          price_id: params[8],
          replacement_provider_subscription_id: null,
          state: "requested",
          subject_id: params[3],
          subject_kind: params[2],
        };
        planChanges.push(row);
        return { rows: [row] };
      }
      if (compact.includes("INSERT INTO billing.billing_provider_effects")) {
        const existing = providerEffects.find(
          (entry) =>
            entry.operation_id === params[1] && entry.effect_type === params[2],
        );
        if (existing) {
          return { rows: [] };
        }
        const row = {
          attempts: 0,
          connection_id: params[4],
          effect_type: params[2],
          fencing_epoch: 0,
          id: params[0],
          idempotency_key: params[5],
          lease_expires_at: null,
          lease_token: null,
          last_error: null,
          operation_id: params[1],
          provider: params[3],
          provider_resource_id: null,
          request_fingerprint: params[6],
          state: "pending",
        };
        providerEffects.push(row);
        return { rows: [row] };
      }
      if (
        compact.includes("FROM billing.billing_provider_effects") &&
        compact.includes("ORDER BY created_at")
      ) {
        return {
          rows: providerEffects.filter(
            (entry) => entry.operation_id === params[0],
          ),
        };
      }
      if (
        compact.includes("FROM billing.billing_provider_effects") &&
        compact.includes("operation_id =")
      ) {
        const row = providerEffects.find(
          (entry) =>
            entry.operation_id === params[0] && entry.effect_type === params[1],
        );
        return { rows: row ? [row] : [] };
      }
      if (compact.includes("FROM billing.billing_plan_change_operations")) {
        const row = compact.includes("WHERE id =")
          ? planChanges.find((entry) => entry.id === params[0])
          : planChanges.find(
            (entry) =>
              entry.subject_kind === params[0] &&
              entry.subject_id === params[1] &&
              entry.idempotency_key === params[2],
          );
        return { rows: row ? [row] : [] };
      }
      if (
        compact.includes("UPDATE billing.billing_provider_effects") &&
        compact.includes("SET state = 'claimed'")
      ) {
        const row = providerEffects.find(
          (entry) =>
            entry.id === params[0] &&
            Number(entry.fencing_epoch) === Number(params[2]) &&
            (entry.state === "pending" || entry.state === "claimed"),
        );
        if (!row) {
          return { rows: [] };
        }
        row.state = "claimed";
        row.lease_token = params[1];
        row.fencing_epoch = Number(row.fencing_epoch) + 1;
        row.attempts = Number(row.attempts) + 1;
        return { rows: [row] };
      }
      if (
        compact.includes("UPDATE billing.billing_provider_effects") &&
        compact.includes("state = 'applied'")
      ) {
        const row = providerEffects.find(
          (entry) =>
            entry.id === params[0] &&
            entry.lease_token === params[1] &&
            Number(entry.fencing_epoch) === Number(params[2]),
        );
        if (!row) {
          return { rows: [] };
        }
        row.state = "applied";
        row.provider_resource_id = params[3];
        row.observed_result = JSON.parse(String(params[4]));
        row.observed_evidence = JSON.parse(String(params[5]));
        row.lease_token = null;
        row.fencing_epoch = Number(row.fencing_epoch) + 1;
        return { rows: [row] };
      }
      if (
        compact.includes("UPDATE billing.billing_provider_effects") &&
        compact.includes("state = 'unknown'")
      ) {
        const row = providerEffects.find(
          (entry) =>
            entry.id === params[0] &&
            entry.lease_token === params[1] &&
            Number(entry.fencing_epoch) === Number(params[2]),
        );
        if (!row) {
          return { rows: [] };
        }
        row.state = "unknown";
        row.last_error = params[3];
        row.observed_evidence = JSON.parse(String(params[4]));
        row.lease_token = null;
        row.fencing_epoch = Number(row.fencing_epoch) + 1;
        return { rows: [row] };
      }
      if (
        compact.includes("UPDATE billing.billing_provider_effects") &&
        compact.includes("state = 'failed'")
      ) {
        const row = providerEffects.find(
          (entry) =>
            entry.id === params[0] &&
            entry.lease_token === params[1] &&
            Number(entry.fencing_epoch) === Number(params[2]),
        );
        if (!row) {
          return { rows: [] };
        }
        row.state = "failed";
        row.last_error = params[3];
        row.lease_token = null;
        row.fencing_epoch = Number(row.fencing_epoch) + 1;
        return { rows: [row] };
      }
      if (
        compact.includes("UPDATE billing.billing_plan_change_operations") &&
        compact.includes("SET state = CASE")
      ) {
        const row = planChanges.find(
          (entry) =>
            entry.id === params[0] &&
            Number(entry.fencing_epoch) === Number(params[2]) &&
            (params[3] == null || entry.state === params[3]),
        );
        if (!row) {
          return { rows: [] };
        }
        row.state = row.state === "requested" ? "claimed" : row.state;
        row.lease_token = params[1];
        row.fencing_epoch = Number(row.fencing_epoch) + 1;
        return { rows: [row] };
      }
      if (
        compact.includes("UPDATE billing.billing_plan_change_operations") &&
        compact.includes("state = 'completed'")
      ) {
        const row = planChanges.find(
          (entry) =>
            entry.id === params[0] &&
            entry.lease_token === params[1] &&
            Number(entry.fencing_epoch) === Number(params[2]) &&
            entry.state === params[3],
        );
        if (row) {
          row.state = "completed";
          row.lease_token = null;
          row.fencing_epoch = Number(row.fencing_epoch) + 1;
        }
        return { rows: row ? [row] : [] };
      }
      if (
        compact.includes("UPDATE billing.billing_plan_change_operations") &&
        compact.includes("state = 'failed'")
      ) {
        const row = planChanges.find(
          (entry) => entry.id === params[0] && entry.lease_token === params[2],
        );
        if (row) {
          row.state = "failed";
          row.last_error = params[1];
          row.lease_token = null;
        }
        return { rows: row ? [row] : [] };
      }
      if (compact.includes("UPDATE billing.billing_plan_change_operations")) {
        const row = planChanges.find(
          (entry) =>
            entry.id === params[0] &&
            entry.state === params[4] &&
            entry.lease_token === params[5] &&
            Number(entry.fencing_epoch) === Number(params[6]),
        );
        if (!row) {
          return { rows: [] };
        }
        row.state = params[1];
        if (params[2] != null) {
          row.replacement_provider_subscription_id = params[2];
        }
        if (params[3] != null) {
          row.last_error = params[3];
        }
        row.fencing_epoch = Number(row.fencing_epoch) + 1;
        return { rows: [row] };
      }
      if (
        compact.includes("UPDATE billing.billing_subscription_enrollments") &&
        compact.includes("SET state = 'advancing'")
      ) {
        const row = enrollments.find((entry) => {
          if (entry.id !== params[0]) {
            return false;
          }
          const state = String(entry.state);
          if (["reserved", "first_payment_pending"].includes(state)) {
            return true;
          }
          if (state === "advancing") {
            const expires = entry.lease_expires_at;
            return (
              expires != null &&
              new Date(String(expires)).getTime() < Date.now()
            );
          }
          return false;
        });
        if (!row) {
          return { rows: [] };
        }
        row.state = "advancing";
        row.lease_token = params[1];
        row.lease_expires_at = new Date(Date.now() + 30_000).toISOString();
        row.fencing_epoch = Number(row.fencing_epoch ?? 0) + 1;
        row.attempt_count = Number(row.attempt_count ?? 0) + 1;
        return { rows: [row] };
      }
      if (
        compact.includes("UPDATE billing.billing_subscription_enrollments") &&
        compact.includes("state = 'active'")
      ) {
        const row = enrollments.find((entry) => {
          if (entry.id !== params[0]) {
            return false;
          }
          if (
            !["reserved", "first_payment_pending", "advancing"].includes(
              String(entry.state)
            )
          ) {
            return false;
          }
          if (
            params[2] != null &&
            Number(entry.fencing_epoch) !== Number(params[2])
          ) {
            return false;
          }
          if (params[3] != null && entry.lease_token !== params[3]) {
            return false;
          }
          if (String(entry.state) === "advancing") {
            const expires = entry.lease_expires_at;
            if (
              expires != null &&
              new Date(String(expires)).getTime() < Date.now()
            ) {
              return false;
            }
          }
          return true;
        });
        if (!row) {
          return { rows: [] };
        }
        row.state = "active";
        row.provider_subscription_id = params[1];
        row.journal_intent = "subscription_persisted";
        row.lease_token = null;
        return { rows: [row] };
      }
      if (
        compact.includes("UPDATE billing.billing_subscription_enrollments") &&
        compact.includes("lease_expires_at = now() + interval '30 seconds'") &&
        compact.includes("state = 'advancing'")
      ) {
        const row = enrollments.find(
          (entry) =>
            entry.id === params[0] &&
            entry.lease_token === params[1] &&
            entry.state === "advancing",
        );
        if (row) {
          row.lease_expires_at = new Date(Date.now() + 30_000).toISOString();
        }
        return { rows: row ? [row] : [] };
      }
      if (
        compact.includes("UPDATE billing.billing_subscription_enrollments") &&
        compact.includes("journal_intent = $2")
      ) {
        const row = enrollments.find((entry) => entry.id === params[0]);
        if (row) {
          row.journal_intent = params[1];
        }
        return { rows: row ? [row] : [] };
      }
      if (
        compact.includes("UPDATE billing.billing_subscription_enrollments") &&
        compact.includes("last_error = $2")
      ) {
        const row = enrollments.find((entry) => entry.id === params[0]);
        if (row) {
          row.last_error = params[1];
        }
        return { rows: row ? [row] : [] };
      }
      if (compact.includes("UPDATE billing.billing_subscription_enrollments")) {
        const row = enrollments.find((entry) => entry.id === params[0]);
        if (!row) {
          return { rows: [] };
        }
        if (params[1] != null) {
          row.state = params[1];
        }
        if (params[2] != null) {
          row.provider_payment_id = params[2];
        }
        if (params[3] != null) {
          row.provider_subscription_id = params[3];
        }
        if (params[4] != null) {
          row.journal_intent = params[4];
        }
        if (params[5] != null) {
          row.last_error = params[5];
        }
        return { rows: [row] };
      }
      if (
        compact.includes("FROM billing.billing_subject_bindings") &&
        compact.includes("status <> 'revoked'")
      ) {
        return {
          rows: bindings.filter(
            (entry) =>
              entry.connection_id === params[0] &&
              entry.subject_kind === params[1] &&
              entry.subject_id === params[2] &&
              entry.status !== "revoked",
          ),
        };
      }
      if (
        compact.includes("FROM billing.billing_subject_bindings") &&
        compact.includes("WHERE id =")
      ) {
        const row = bindings.find((entry) => entry.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (compact.includes("INSERT INTO billing.billing_subject_bindings")) {
        const row = {
          connection_id: params[0],
          email_snapshot: null,
          id: randomUUID(),
          is_primary: false,
          provider_subject_id: params[4],
          provider_subject_kind: params[3],
          source: params[5],
          status: "pending",
          subject_id: params[2],
          subject_kind: params[1],
        };
        bindings.push(row);
        return { rows: [row] };
      }
      if (compact.includes("UPDATE billing.billing_subject_bindings")) {
        const row = bindings.find((entry) => entry.id === params[1]);
        if (!row) {
          return { rows: [] };
        }
        row.provider_subject_id = params[0];
        row.status = "active";
        row.is_primary = true;
        return { rows: [row] };
      }
      if (
        compact.includes("FROM billing.billing_checkout_sessions") &&
        compact.includes("return_nonce_hash")
      ) {
        const row = sessions.find(
          (entry) =>
            entry.return_nonce_hash === params[0] &&
            entry.subject_kind === params[1] &&
            entry.subject_id === params[2],
        );
        return { rows: row ? [row] : [] };
      }
      if (
        compact.includes("FROM billing.billing_checkout_sessions") &&
        compact.includes("idempotency_key")
      ) {
        const row = sessions.find(
          (entry) =>
            entry.subject_kind === params[0] &&
            entry.subject_id === params[1] &&
            entry.idempotency_key === params[2],
        );
        return { rows: row ? [row] : [] };
      }
      if (
        compact.includes("FROM billing.billing_checkout_sessions") &&
        compact.includes("provider_payment_id")
      ) {
        const row = sessions.find(
          (entry) =>
            entry.provider === params[0] &&
            entry.provider_payment_id === params[1],
        );
        return { rows: row ? [row] : [] };
      }
      if (compact.includes("status IN ('enrolled', 'first_payment_paid')")) {
        return {
          rows: sessions.filter(
            (entry) =>
              entry.subject_kind === params[0] &&
              entry.subject_id === params[1] &&
              entry.provider_customer_id === params[2] &&
              (entry.status === "enrolled" ||
                entry.status === "first_payment_paid"),
          ),
        };
      }
      if (compact.includes("INSERT INTO billing.billing_checkout_sessions")) {
        const existing = sessions.find(
          (entry) =>
            entry.subject_kind === params[2] &&
            entry.subject_id === params[3] &&
            entry.idempotency_key === params[1],
        );
        if (existing) {
          return { rows: [existing] };
        }
        const row = {
          checkout_url: params[10],
          connection_id: params[13] ?? null,
          created_at: new Date().toISOString(),
          enrollment_id: params[16] ?? null,
          expires_at: params[15] ?? null,
          id: params[0] ?? randomUUID(),
          idempotency_key: params[1],
          kind: params[12] ?? "subscription_enrollment",
          metadata: JSON.parse(String(params[11] ?? "{}")),
          price_id: params[4],
          provider: params[5],
          provider_customer_id: params[6],
          provider_payment_id: params[7],
          provider_subscription_id: params[8],
          return_nonce_hash: params[14] ?? null,
          status: params[9],
          subject_id: params[3],
          subject_kind: params[2],
        };
        sessions.push(row);
        return { rows: [row] };
      }
      if (
        compact.includes("UPDATE billing.billing_checkout_sessions") &&
        compact.includes("provider_subscription_id IS NULL")
      ) {
        const row = sessions.find(
          (entry) =>
            entry.id === params[0] &&
            entry.provider_subscription_id == null &&
            (entry.status === "first_payment_required" ||
              entry.status === "first_payment_paid"),
        );
        if (!row) {
          return { rows: [] };
        }
        if (row.status === "first_payment_required") {
          row.status = "first_payment_paid";
        }
        row.provider_subscription_id = params[1];
        return { rows: [row] };
      }
      if (compact.includes("UPDATE billing.billing_checkout_sessions")) {
        const row = sessions.find((entry) => entry.id === params[0]);
        if (!row) {
          return { rows: [] };
        }
        row.status = params[1];
        if (params[2] != null) {
          row.checkout_url = params[2];
        }
        if (params[3] != null) {
          row.provider_customer_id = params[3];
        }
        if (params[4] != null) {
          row.provider_payment_id = params[4];
        }
        if (params[5] != null) {
          row.provider_subscription_id = params[5];
        }
        if (params[6] != null) {
          row.return_nonce_hash = params[6];
        }
        if (params[7] != null) {
          row.expires_at = params[7];
        }
        if (params[8] != null) {
          row.enrollment_id = params[8];
        }
        if (params[9] != null) {
          const patch =
            typeof params[9] === "string"
              ? (JSON.parse(params[9]) as Record<string, unknown>)
              : (params[9] as Record<string, unknown>);
          row.metadata = {
            ...(row.metadata as Record<string, unknown>),
            ...patch,
          };
        }
        return { rows: [row] };
      }
      if (
        compact.includes("FROM billing.billing_subscriptions") &&
        compact.includes("ownership_status = 'resolved'")
      ) {
        const wantedId = params[0];
        return {
          rows: subscriptions
            .filter((entry) => {
              if (
                entry.subject_kind != null &&
                entry.subject_kind !== params[1]
              ) {
                return false;
              }
              if (entry.subject_id !== params[2]) {
                return false;
              }
              if (entry.ownership_status !== "resolved") {
                return false;
              }
              if (wantedId != null && entry.id !== wantedId) {
                return false;
              }
              return true;
            })
            .slice(0, 1),
        };
      }
      if (
        compact.includes("UPDATE billing.billing_subscriptions") &&
        compact.includes("amount_currency")
      ) {
        const row = subscriptions.find(
          (entry) =>
            entry.id === params[0] &&
            entry.subject_kind === params[1] &&
            entry.subject_id === params[2],
        );
        if (!row) {
          return { rows: [] };
        }
        row.amount_currency = params[3];
        row.amount_value = params[4];
        row.interval = params[5];
        row.description = params[6];
        row.row_version = Number(row.row_version ?? 1) + 1;
        return { rows: [row] };
      }
      if (
        compact.includes("UPDATE billing.billing_subscriptions") &&
        compact.includes("status = 'canceled'")
      ) {
        const row = subscriptions.find(
          (entry) => entry.id === params[0] && entry.subject_id === params[1],
        );
        if (row) {
          row.status = "canceled";
        }
        return { rows: row ? [row] : [] };
      }
      if (
        compact.includes("FROM billing.billing_subscriptions") &&
        compact.includes("lower(status)")
      ) {
        return {
          rows: subscriptions
            .filter((entry) => {
              const status = String(entry.status ?? "").toLowerCase();
              return (
                entry.subject_id === params[1] &&
                entry.ownership_status === "resolved" &&
                status !== "canceled" &&
                status !== "cancelled" &&
                status !== "expired" &&
                status !== "completed"
              );
            })
            .slice(0, 1),
        };
      }
      if (compact.includes("FROM billing.billing_checkout_session_lines")) {
        return {
          rows: sessionLines
            .filter((entry) => entry.checkout_session_id === params[0])
            .sort(
              (left, right) => Number(left.ordinal) - Number(right.ordinal),
            ),
        };
      }
      if (
        compact.includes("INSERT INTO billing.billing_checkout_session_lines")
      ) {
        const lineWidth = 8;
        const inserted: Record<string, unknown>[] = [];
        for (
          let offset = 1;
          offset < params.length;
          offset += lineWidth
        ) {
          const ordinal = params[offset];
          const existing = sessionLines.find(
            (entry) =>
              entry.checkout_session_id === params[0] &&
              Number(entry.ordinal) === Number(ordinal),
          );
          if (existing) {
            continue;
          }
          const row = {
            amount_currency: params[offset + 3],
            amount_value: params[offset + 4],
            checkout_session_id: params[0],
            id: randomUUID(),
            interval: params[offset + 5],
            ordinal,
            price_id: params[offset + 2],
            product_id: params[offset + 1],
            quantity: params[offset + 6],
            relation_id: params[offset + 7],
          };
          sessionLines.push(row);
          inserted.push(row);
        }
        return { rows: inserted };
      }
      if (compact.includes("INSERT INTO billing.billing_subscriptions")) {
        const existing = subscriptions.find(
          (entry) =>
            entry.connection_id === params[0] &&
            entry.provider === params[1] &&
            entry.provider_subscription_id === params[2],
        );
        if (existing) {
          const sameSubject = existing.subject_id === params[11];
          const unresolved = existing.ownership_status !== "resolved";
          if (sameSubject || unresolved) {
            existing.status = params[4];
            existing.subject_id = params[11];
            existing.ownership_status = "resolved";
            return { rows: [existing] };
          }
          return { rows: [] };
        }
        const row = {
          connection_id: params[0],
          id: randomUUID(),
          ownership_status: "resolved",
          provider: params[1],
          provider_customer_id: params[3],
          provider_subscription_id: params[2],
          row_version: 1,
          status: params[4],
          subject_id: params[11],
        };
        subscriptions.push(row);
        return { rows: [row] };
      }
      if (compact.includes("INSERT INTO billing.billing_payments")) {
        const metadata =
          typeof params[8] === "string" ? JSON.parse(String(params[8])) : {};
        const row = {
          amount_currency: params[5],
          amount_value: params[6],
          created_at: params[11] ?? new Date().toISOString(),
          description: params[7],
          id: randomUUID(),
          ingested_at: new Date().toISOString(),
          metadata,
          ownership_status: "resolved",
          paid_at: params[10],
          provider: params[1],
          provider_customer_id: params[3],
          provider_payment_id: params[2],
          raw:
            typeof params[9] === "string" ? JSON.parse(String(params[9])) : {},
          status: params[4],
          subject_id: params[12],
          subject_kind: "user",
        };
        return { rows: [row] };
      }
      return { rows: [] };
    },
    async transaction<T>(fn: (transaction: BillingSqlExecutor) => Promise<T>) {
      return fn(sql);
    },
  };
  return {
    enrollments,
    planChanges,
    providerEffects,
    sessions,
    sql,
    subscriptions,
  };
}

function stubRuntime(input: {
  extraPrices?: BillingPrice[];
  failPaymentCreate?: boolean | (() => boolean);
  payments: unknown[];
  price: BillingPrice;
  relations?: BillingCatalogRelation[];
  subscriptions: unknown[];
}): Omit<BillingProviderRuntime, "customers" | "subscriptions"> & {
  customers: NonNullable<BillingProviderRuntime["customers"]>;
  subscriptions: NonNullable<BillingProviderRuntime["subscriptions"]>;
} {
  const hasRelations = (input.relations?.length ?? 0) > 0;
  const portsTrue = {
    checkout: false,
    customers: true,
    invoices: false,
    paymentLinks: false,
    payments: true,
    prices: true,
    products: true,
    refunds: false,
    relations: hasRelations,
    subscriptions: true,
    webhooks: false,
  };
  return {
    customers: {
      create: async () => ({
        metadata: {},
        provider: "mollie",
        providerCustomerId: "cst_enroll",
        raw: { id: "cst_enroll" },
      }),
      delete: async () => undefined,
      get: async () => ({
        metadata: {},
        provider: "mollie",
        providerCustomerId: "cst_enroll",
        raw: { id: "cst_enroll" },
      }),
      kind: "customers",
      list: async () => ({ items: [], nextCursor: null }),
      update: async () => ({
        metadata: {},
        provider: "mollie",
        providerCustomerId: "cst_enroll",
        raw: { id: "cst_enroll" },
      }),
    },
    async getCapabilities() {
      return {
        operations: {
          "customers.create": true,
          "payments.create": true,
          "payments.get": true,
          "prices.list": true,
          "products.list": true,
          ...(hasRelations ? { "relations.list": true } : {}),
          "subscriptions.cancel": true,
          "subscriptions.create": true,
          "subscriptions.update": true,
        },
        ports: portsTrue,
      };
    },
    payments: {
      cancel: async () => {
        throw new Error("unused");
      },
      create: async (_context, payload) => {
        input.payments.push(payload);
        const shouldFail =
          typeof input.failPaymentCreate === "function"
            ? input.failPaymentCreate()
            : input.failPaymentCreate === true;
        if (shouldFail) {
          throw new Error("payment_create_timeout");
        }
        return {
          amount: payload.amount,
          metadata: payload.metadata ?? {},
          provider: "mollie",
          providerCustomerId: payload.customerId,
          providerPaymentId: `tr_${input.payments.length}`,
          raw: {
            _links: {
              checkout: {
                href: "https://www.mollie.com/checkout/select-method/enroll",
              },
            },
          },
          status: "pending",
        };
      },
      get: async (_context, payload) => ({
        amount: { currency: "EUR", value: "15.00" },
        metadata: { priceId: "support-once" },
        provider: "mollie",
        providerCustomerId: "cst_enroll",
        providerPaymentId: payload.id,
        raw: {},
        status: "paid",
      }),
      list: async () => ({ items: [], nextCursor: null }),
    },
    prices: {
      kind: "prices",
      list: async () => ({
        items: [input.price, ...(input.extraPrices ?? [])],
        nextCursor: null,
      }),
    },
    products: {
      kind: "products",
      list: async () => ({
        items: [input.price, ...(input.extraPrices ?? [])].map((price) => ({
          id: price.productId,
          metadata: {},
          name:
            price.productId === "starter"
              ? "Starter"
              : price.productId === "support"
                ? "Priority support"
                : price.productId,
          raw: {},
        })),
        nextCursor: null,
      }),
    },
    ...(hasRelations
      ? {
        relations: {
          kind: "relations" as const,
          list: async () => ({
            items: input.relations ?? [],
            nextCursor: null,
          }),
        },
      }
      : {}),
    provider: "mollie",
    subscriptions: {
      cancel: async () => {
        throw new Error("unused");
      },
      create: async (_context, payload) => {
        const existing = input.subscriptions.find(
          (entry) =>
            entry != null &&
            typeof entry === "object" &&
            "idempotencyKey" in entry &&
            (entry as { idempotencyKey?: string }).idempotencyKey ===
            payload.idempotencyKey
        );
        if (
          existing != null &&
          typeof existing === "object" &&
          "providerSubscriptionId" in existing &&
          "providerCustomerId" in existing
        ) {
          const replay = existing as BillingSubscription;
          return {
            metadata: replay.metadata,
            provider: "mollie",
            providerCustomerId: replay.providerCustomerId,
            providerSubscriptionId: replay.providerSubscriptionId,
            raw: replay.raw,
            status: "active",
          };
        }
        const created: BillingSubscription & { idempotencyKey?: string } = {
          idempotencyKey: payload.idempotencyKey,
          metadata: payload.metadata ?? {},
          provider: "mollie",
          providerCustomerId: payload.customerId,
          providerSubscriptionId: `sub_${input.subscriptions.length + 1}`,
          raw: {},
          status: "active",
        };
        input.subscriptions.push(created);
        return created;
      },
      get: async () => {
        throw new Error("unused");
      },
      kind: "subscriptions",
      list: async () => ({ items: [], nextCursor: null }),
      update: async (_context, payload) => {
        input.subscriptions.push({ kind: "update", ...payload });
        return {
          description: payload.description,
          metadata: payload.metadata ?? {},
          provider: "mollie",
          providerCustomerId: payload.customerId,
          providerSubscriptionId: payload.subscriptionId,
          raw: {},
          status: "active",
        };
      },
    },
  };
}

test("T-ENROLL-001: self.subscription.enroll is wired through the billing surface", () => {
  const capabilities = readFileSync(
    join(srcRoot, "billing/runtime/capabilities.ts"),
    "utf8",
  );
  const dispatch = readFileSync(
    join(srcRoot, "billing/runtime/self/dispatch.ts"),
    "utf8",
  );
  const handlers = readFileSync(
    join(srcRoot, "next/billing-handlers.ts"),
    "utf8",
  );
  assert.match(capabilities, /self\.subscription\.enroll/);
  assert.match(dispatch, /self\.subscription\.enroll/);
  assert.match(handlers, /self\.subscription\.enroll/);
  assert.match(handlers, /self\.subscription\.change/);
  const enroll = readFileSync(
    join(srcRoot, "billing/runtime/self/enroll.ts"),
    "utf8",
  );
  assert.match(enroll, /LIVE_SELF_SUBSCRIPTION_SQL/);
  assert.match(enroll, /billingSubscriptionAlreadyActive/);
  assert.match(enroll, /self_enrollment_disabled/);
  assert.match(enroll, /reserveSubjectEnrollment/);
});

test("T-ENROLL-002: browser payloads cannot select customerId", () => {
  assert.throws(
    () =>
      rejectSelfPayloadSelectors({
        customerId: "cst_hostile",
        idempotencyKey: "idem-1",
        priceId: "starter-monthly",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingError);
      assert.equal(error.code, "ATHENA_BILLING_INVALID_REQUEST");
      return true;
    },
  );
});

test("T-ENROLL-002b: checkout redirect URLs must match the app origin allowlist", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: oneTimePrice(), subscriptions }),
  ]);
  await assert.rejects(
    () =>
      createSelfCheckout({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "chk-phish",
        priceId: "lifetime",
        principal: principal(),
        registry,
        sql: memorySql().sql,
        successUrl: "https://evil.example/phish",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingError);
      assert.equal(error.code, "ATHENA_BILLING_INVALID_REQUEST");
      return true;
    },
  );
  assert.equal(payments.length, 0);
});

test("T-ENROLL-002c: relative checkout return paths rewrite onto the app origin", async () => {
  const payments: Array<{ redirectUrl?: string }> = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: oneTimePrice(), subscriptions }),
  ]);
  await createSelfCheckout({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "chk-relative",
    priceId: "lifetime",
    principal: principal(),
    registry,
    sql: memorySql().sql,
    successUrl: "/settings/billing",
  });
  assert.equal(payments.length, 1);
  assert.match(
    payments[0]?.redirectUrl ?? "",
    /^https:\/\/app\.example\/settings\/billing\?athena_billing_return=/,
  );
});

test("T-ENROLL-002d: protocol-relative checkout redirects are rejected", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: oneTimePrice(), subscriptions }),
  ]);
  await assert.rejects(
    () =>
      createSelfCheckout({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "chk-proto",
        priceId: "lifetime",
        principal: principal(),
        registry,
        sql: memorySql().sql,
        successUrl: "//evil.example/phish",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingError);
      assert.equal(error.code, "ATHENA_BILLING_INVALID_REQUEST");
      return true;
    },
  );
  assert.equal(payments.length, 0);
});

test("T-ENROLL-002e: javascript data and non-loopback http redirects are rejected", async () => {
  const { resolveAllowedBillingRedirectUrl } = await import(
    "../../src/billing/runtime/self/redirect-url.ts"
  );
  const allowed = ["https://app.example"];
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,phish",
    "http://app.example/settings/billing",
    "https://app.example@evil.example/",
    "/\\evil.example/phish",
  ]) {
    assert.throws(
      () =>
        resolveAllowedBillingRedirectUrl({
          allowedOrigins: allowed,
          field: "successUrl",
          url,
        }),
      (error: unknown) => {
        assert.ok(error instanceof AthenaBillingError);
        assert.equal(error.code, "ATHENA_BILLING_INVALID_REQUEST");
        return true;
      },
      url,
    );
  }
  assert.equal(
    resolveAllowedBillingRedirectUrl({
      allowedOrigins: ["http://127.0.0.1:3010"],
      field: "successUrl",
      url: "http://127.0.0.1:3010/settings/billing",
    }),
    "http://127.0.0.1:3010/settings/billing",
  );
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: recurringPrice(), subscriptions }),
  ]);
  await assert.rejects(
    () =>
      enrollSelfSubscription({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "enroll-phish",
        priceId: "starter-monthly",
        principal: principal(),
        registry,
        sql: memorySql().sql,
        successUrl: "javascript:alert(1)",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingError);
      assert.equal(error.code, "ATHENA_BILLING_INVALID_REQUEST");
      return true;
    },
  );
  assert.equal(payments.length, 0);
});

test("T-ENROLL-003: recurring catalog price still fails closed on self.checkout.create", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: recurringPrice(), subscriptions }),
  ]);
  await assert.rejects(
    () =>
      createSelfCheckout({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "chk-1",
        priceId: "starter-monthly",
        principal: principal(),
        registry,
        sql: memorySql().sql,
        successUrl: "https://app.example/settings/billing",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingCapabilityError);
      assert.match(String(error), /Recurring catalog prices/);
      return true;
    },
  );
  assert.equal(payments.length, 0);
});

test("T-ENROLL-004: one-time prices cannot enroll", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: oneTimePrice(), subscriptions }),
  ]);
  await assert.rejects(
    () =>
      enrollSelfSubscription({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "enroll-one",
        priceId: "lifetime",
        principal: principal(),
        registry,
        sql: memorySql().sql,
        successUrl: "https://app.example/settings/billing",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingCapabilityError);
      assert.match(String(error), /One-time catalog prices/);
      return true;
    },
  );
  assert.equal(payments.length, 0);
  assert.equal(subscriptions.length, 0);
});

test("T-ENROLL-005: missing mandate enters first-payment with sequenceType first", async () => {
  const payments: Array<{
    cancelUrl?: string | null;
    customerId?: string | null;
    description?: string;
    metadata?: { priceIds?: string[] };
    redirectUrl?: string | null;
    sequenceType?: string;
  }> = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: recurringPrice(), subscriptions }),
  ]);
  const result = await enrollSelfSubscription({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "enroll-first",
    priceId: "starter-monthly",
    principal: principal(),
    registry,
    sql: memorySql().sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(result.status, "first_payment_required");
  assert.equal(
    result.checkoutUrl,
    "https://www.mollie.com/checkout/select-method/enroll",
  );
  assert.equal(payments.length, 1);
  assert.equal(payments[0]?.sequenceType, "first");
  assert.equal(payments[0]?.customerId, "cst_enroll");
  assert.equal(payments[0]?.description, "Athena first payment Starter");
  assert.deepEqual(payments[0]?.metadata?.priceIds, ["starter-monthly"]);
  assert.match(
    payments[0]?.redirectUrl ?? "",
    /^https:\/\/app\.example\/settings\/billing\?athena_billing_return=/,
  );
  assert.equal(payments[0]?.cancelUrl, payments[0]?.redirectUrl);
  assert.equal(subscriptions.length, 0);
});

test("T-ENROLL-006: duplicate idempotency key does not create two first payments", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: recurringPrice(), subscriptions }),
  ]);
  const { sql } = memorySql();
  const first = await enrollSelfSubscription({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "enroll-dup",
    priceId: "starter-monthly",
    principal: principal(),
    registry,
    sql,
    successUrl: "https://app.example/settings/billing",
  });
  const second = await enrollSelfSubscription({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "enroll-dup",
    priceId: "starter-monthly",
    principal: principal(),
    registry,
    sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(first.enrollmentId, second.enrollmentId);
  assert.equal(payments.length, 1);
  assert.equal(subscriptions.length, 0);
});

test("T-ENROLL-006c: different idempotency keys cannot enroll the same subject twice", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: recurringPrice(), subscriptions }),
  ]);
  const { sql } = memorySql();
  await enrollSelfSubscription({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "enroll-a",
    priceId: "starter-monthly",
    principal: principal(),
    registry,
    sql,
    successUrl: "https://app.example/settings/billing",
  });
  await assert.rejects(
    () =>
      enrollSelfSubscription({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "enroll-b",
        priceId: "starter-monthly",
        principal: principal(),
        registry,
        sql,
        successUrl: "https://app.example/settings/billing",
      }),
    (error: unknown) =>
      error instanceof AthenaBillingSubjectError &&
      error.conflict === "subscription_already_active",
  );
  assert.equal(payments.length, 1);
});

test("T-CHANGE-001: self.subscription.change updates the live subscription in place", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({
      payments,
      price: {
        amount: { currency: "EUR", value: "20.00" },
        id: "pro-monthly",
        interval: "month",
        metadata: {},
        productId: "pro",
        raw: {},
      },
      subscriptions,
    }),
  ]);
  const store = memorySql();
  const { sql, subscriptions: owned } = store;
  owned.push({
    connection_id: "11111111-1111-4111-8111-111111111111",
    description: "Starter",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ownership_status: "resolved",
    provider: "mollie",
    provider_customer_id: "cst_enroll",
    provider_subscription_id: "sub_live",
    row_version: 1,
    status: "active",
    subject_id: ENROLL_SUBJECT_USER_ID,
    subject_kind: "user",
  });
  const result = await changeSelfSubscription({
    configuredProviders: configuredProviders(),
    idempotencyKey: "change-1",
    planChangeEnabled: { planChange: true },
    priceId: "pro-monthly",
    principal: principal(),
    registry,
    sql,
  });
  if ("operationId" in result) {
    throw new Error("Expected completed plan-change subscription.");
  }
  assert.equal(result.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(result.amount?.value, "20.00");
  assert.equal(subscriptions.length, 1);
  assert.equal(
    (subscriptions[0] as { subscriptionId?: string }).subscriptionId,
    "sub_live",
  );
  assert.equal(store.planChanges[0]?.state, "completed");
  assert.deepEqual(
    store.providerEffects.map((effect) => ({
      effect_type: effect.effect_type,
      state: effect.state,
    })),
    [{ effect_type: "subscription.update", state: "applied" }],
  );
  const repeated = await changeSelfSubscription({
    configuredProviders: configuredProviders(),
    idempotencyKey: "change-1",
    planChangeEnabled: { planChange: true },
    priceId: "pro-monthly",
    principal: principal(),
    registry,
    sql,
  });
  if ("operationId" in repeated) {
    throw new Error("Expected repeated plan-change subscription.");
  }
  assert.equal(repeated.providerSubscriptionId, "sub_live");
  assert.equal(subscriptions.length, 1);
});

test("T-ENROLL-006b: expired first-payment session cannot be resumed", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: recurringPrice(), subscriptions }),
  ]);
  const sql: BillingSqlExecutor = {
    async query() {
      return {
        rows: [
          {
            checkout_url: "https://www.mollie.com/checkout/select-method/old",
            created_at: new Date(
              Date.now() - 48 * 60 * 60 * 1000,
            ).toISOString(),
            id: randomUUID(),
            idempotency_key: "enroll-expired",
            metadata: {},
            price_id: "starter-monthly",
            provider: "mollie",
            provider_customer_id: "cst_enroll",
            provider_payment_id: "tr_old",
            provider_subscription_id: null,
            status: "first_payment_required",
            subject_id: ENROLL_SUBJECT_USER_ID,
            subject_kind: "user",
          },
        ],
      };
    },
  };
  await assert.rejects(
    () =>
      enrollSelfSubscription({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "enroll-expired",
        priceId: "starter-monthly",
        principal: principal(),
        registry,
        sql,
        successUrl: "https://app.example/settings/billing",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingError);
      assert.equal(error.code, "ATHENA_BILLING_INVALID_REQUEST");
      assert.match(error.message, /expired/i);
      return true;
    },
  );
  assert.equal(payments.length, 0);
});

test("T-ENROLL-007: existing mandate proceeds to subscription create", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: recurringPrice(), subscriptions }),
  ]);
  const store = memorySql();
  await store.sql.query(
    `INSERT INTO billing.billing_checkout_sessions (
			id, idempotency_key, subject_kind, subject_id, price_id, provider,
			provider_customer_id, provider_payment_id, provider_subscription_id,
			status, checkout_url, metadata
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      randomUUID(),
      "prior-mandate",
      "user",
      ENROLL_SUBJECT_USER_ID,
      "starter-monthly",
      "mollie",
      "cst_enroll",
      "tr_old",
      "sub_old",
      "enrolled",
      null,
      "{}",
    ],
  );
  const result = await enrollSelfSubscription({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "enroll-mandate",
    priceId: "starter-monthly",
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(result.status, "enrolled");
  assert.equal(payments.length, 0);
  assert.equal(subscriptions.length, 1);
});

test("T-ENROLL-012: existing live subscription cannot enroll a second provider subscription", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: recurringPrice(), subscriptions }),
  ]);
  const store = memorySql();
  await store.sql.query(
    `INSERT INTO billing.billing_checkout_sessions (
			id, idempotency_key, subject_kind, subject_id, price_id, provider,
			provider_customer_id, provider_payment_id, provider_subscription_id,
			status, checkout_url, metadata
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      randomUUID(),
      "prior-mandate",
      "user",
      ENROLL_SUBJECT_USER_ID,
      "starter-monthly",
      "mollie",
      "cst_enroll",
      "tr_old",
      "sub_old",
      "enrolled",
      null,
      "{}",
    ],
  );
  await enrollSelfSubscription({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "enroll-first-live",
    priceId: "starter-monthly",
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(subscriptions.length, 1);
  await assert.rejects(
    () =>
      enrollSelfSubscription({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "enroll-second-live",
        priceId: "starter-monthly",
        principal: principal(),
        registry,
        sql: store.sql,
        successUrl: "https://app.example/settings/billing",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingSubjectError);
      assert.equal(error.code, "ATHENA_BILLING_SUBJECT_CONFLICT");
      assert.equal(error.conflict, "subscription_already_active");
      assert.match(error.message, /active subscription already exists/i);
      return true;
    },
  );
  assert.equal(subscriptions.length, 1);
  assert.equal(payments.length, 0);
});

test("T-ENROLL-008: paid first-payment webhook creates the subscription", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: recurringPrice(), subscriptions }),
  ]);
  const store = memorySql();
  const enrolled = await enrollSelfSubscription({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "enroll-hook",
    priceId: "starter-monthly",
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(enrolled.status, "first_payment_required");
  await advanceSelfSubscriptionEnrollment({
    configuredProviders: configuredProviders(),
    document: {
      amount: { currency: "EUR", value: "10.00" },
      kind: "payment",
      metadata: {},
      provider: "mollie",
      providerCustomerId: "cst_enroll",
      providerPaymentId: "tr_1",
      raw: {},
      status: "paid",
    },
    registry,
    sql: store.sql,
  });
  assert.equal(subscriptions.length, 1);
  assert.equal(store.sessions[0]?.status, "enrolled");
});

test("T-COMPOSE-001: mixed checkout with a mandate does not create a subscription before payment", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({
      extraPrices: [addonPrice()],
      failPaymentCreate: true,
      payments,
      price: recurringPrice(),
      relations: [starterAddonRelation()],
      subscriptions,
    }),
  ]);
  const store = memorySql();
  await seedUsableMandate(store.sql);
  await assert.rejects(
    () =>
      createSelfCheckout({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "chk-composed-timeout",
        lines: [
          { priceId: "starter-monthly", quantity: 1 },
          { priceId: "support-once", quantity: 1 },
        ],
        principal: principal(),
        registry,
        sql: store.sql,
        successUrl: "https://app.example/settings/billing",
      }),
    (error: unknown) =>
      error instanceof Error && error.message === "payment_create_timeout",
  );
  assert.equal(subscriptions.length, 0);
  assert.equal(payments.length, 1);
  const composed = store.sessions.find(
    (session) => session.idempotency_key === "chk-composed-timeout",
  );
  assert.equal(composed?.status, "first_payment_required");
  assert.equal(composed?.provider_subscription_id, null);
  assert.equal(composed?.kind, "subscription_enrollment");
  assert.equal(
    (composed?.metadata as { athenaCheckoutWorkflow?: string } | undefined)
      ?.athenaCheckoutWorkflow,
    "composed",
  );
  assert.equal(composed?.price_id, "starter-monthly");
  assert.equal(composed?.enrollment_id != null, true);
  assert.equal(store.enrollments[0]?.state, "reserved");
  assert.equal(store.enrollments[0]?.provider_subscription_id, null);
});

test("T-COMPOSE-002: mixed checkout enrolls only after the composed payment is paid", async () => {
  const payments: Array<{
    amount?: { value?: string };
    cancelUrl?: string | null;
    description?: string;
    metadata?: { priceIds?: string[] };
    redirectUrl?: string | null;
    sequenceType?: string;
  }> = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({
      extraPrices: [addonPrice()],
      payments,
      price: recurringPrice(),
      relations: [starterAddonRelation()],
      subscriptions,
    }),
  ]);
  const store = memorySql();
  await seedUsableMandate(store.sql);
  const checkout = await createSelfCheckout({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "chk-composed-paid",
    lines: [
      { priceId: "starter-monthly", quantity: 1 },
      { priceId: "support-once", quantity: 1 },
    ],
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(subscriptions.length, 0);
  assert.equal(payments.length, 1);
  assert.equal(payments[0]?.amount?.value, "15.00");
  assert.notEqual(payments[0]?.amount?.value, "25.00");
  assert.equal(payments[0]?.sequenceType, undefined);
  const composedPending = store.sessions.find(
    (session) => session.idempotency_key === "chk-composed-paid"
  );
  assert.equal(
    (
      composedPending?.metadata as
      | { checkoutSettlement?: string }
      | undefined
    )?.checkoutSettlement,
    "setup_addons_only"
  );
  assert.equal(store.enrollments[0]?.state, "first_payment_pending");
  await advanceSelfSubscriptionEnrollment({
    configuredProviders: configuredProviders(),
    document: {
      amount: { currency: "EUR", value: "15.00" },
      kind: "payment",
      metadata: {},
      provider: "mollie",
      providerCustomerId: "cst_enroll",
      providerPaymentId: String(checkout.providerCheckoutId),
      raw: {},
      status: "paid",
    },
    registry,
    sql: store.sql,
  });
  assert.equal(subscriptions.length, 1);
  const composed = store.sessions.find(
    (session) => session.idempotency_key === "chk-composed-paid"
  );
  assert.equal(composed?.status, "enrolled");
});

test("T-COMPOSE-007: mixed checkout without a mandate still charges add-ons only", async () => {
  const payments: Array<{
    amount?: { value?: string };
    cancelUrl?: string | null;
    description?: string;
    metadata?: { priceIds?: string[] };
    redirectUrl?: string | null;
    sequenceType?: string;
  }> = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({
      extraPrices: [addonPrice()],
      payments,
      price: recurringPrice(),
      relations: [starterAddonRelation()],
      subscriptions,
    }),
  ]);
  const store = memorySql();
  await createSelfCheckout({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "chk-composed-setup",
    lines: [
      { priceId: "starter-monthly", quantity: 1 },
      { priceId: "support-once", quantity: 1 },
    ],
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(payments.length, 1);
  assert.equal(payments[0]?.amount?.value, "15.00");
  assert.equal(payments[0]?.sequenceType, "first");
  assert.equal(
    payments[0]?.description,
    "Athena checkout Priority support + Starter",
  );
  assert.deepEqual(payments[0]?.metadata?.priceIds, ["support-once"]);
  assert.match(
    payments[0]?.redirectUrl ?? "",
    /^https:\/\/app\.example\/settings\/billing\?athena_billing_return=/,
  );
  assert.equal(payments[0]?.cancelUrl, payments[0]?.redirectUrl);
  assert.equal(subscriptions.length, 0);
});

test("T-COMPOSE-003: browser resume advances composed checkout even if kind is one_off", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({
      extraPrices: [addonPrice()],
      payments,
      price: recurringPrice(),
      relations: [starterAddonRelation()],
      subscriptions,
    }),
  ]);
  const store = memorySql();
  await seedUsableMandate(store.sql);
  await createSelfCheckout({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "chk-composed-resume",
    lines: [
      { priceId: "starter-monthly", quantity: 1 },
      { priceId: "support-once", quantity: 1 },
    ],
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(subscriptions.length, 0);
  const composed = store.sessions.find(
    (session) => session.idempotency_key === "chk-composed-resume",
  );
  assert.ok(composed);
  const nonce = createBillingReturnNonce();
  composed.kind = "one_off";
  composed.return_nonce_hash = nonce.hash;
  await resumeSelfCheckout({
    configuredProviders: configuredProviders(),
    principal: principal(),
    registry,
    returnToken: nonce.token,
    sql: store.sql,
  });
  assert.equal(subscriptions.length, 1);
  assert.equal(composed.status, "enrolled");
});

test("T-COMPOSE-004: payment recovery uses the checkout line snapshot not the live catalog", async () => {
  const payments: Array<{ amount?: { value?: string } }> = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({
      extraPrices: [
        {
          amount: { currency: "EUR", value: "1.00" },
          id: "support-once",
          metadata: {},
          productId: "support",
          raw: {},
        },
      ],
      payments,
      price: {
        amount: { currency: "EUR", value: "1.00" },
        id: "starter-once",
        metadata: {},
        productId: "starter",
        raw: {},
      },
      subscriptions,
    }),
  ]);
  const store = memorySql();
  const nonce = createBillingReturnNonce();
  const sessionId = randomUUID();
  await insertCheckoutSession({
    checkoutUrl: null,
    connectionId: "11111111-1111-4111-8111-111111111111",
    enrollmentId: null,
    expiresAt: checkoutAttemptExpiresAtIso(),
    id: sessionId,
    idempotencyKey: "chk-composed-recover",
    kind: "one_off",
    metadata: {
      paymentIdempotencyKey: "chk-composed-recover",
      successUrl: "https://app.example/settings/billing",
    },
    priceId: "starter-once",
    provider: "mollie",
    providerCustomerId: "cst_enroll",
    providerPaymentId: null,
    providerSubscriptionId: null,
    returnNonceHash: nonce.hash,
    sql: store.sql,
    status: "first_payment_required",
    subjectId: ENROLL_SUBJECT_USER_ID,
    subjectKind: "user",
  });
  await insertCheckoutSessionLines({
    checkoutSessionId: sessionId,
    lines: [
      {
        amountCurrency: "EUR",
        amountValue: "99.00",
        ordinal: 0,
        priceId: "starter-once",
        productId: "starter",
        quantity: 1,
      },
      {
        amountCurrency: "EUR",
        amountValue: "15.00",
        ordinal: 1,
        priceId: "support-once",
        productId: "support",
        quantity: 1,
        relationId: "rel_addon",
      },
    ],
    sql: store.sql,
  });
  await resumeSelfCheckout({
    configuredProviders: configuredProviders(),
    principal: principal(),
    registry,
    returnToken: nonce.token,
    sql: store.sql,
  });
  assert.equal(payments.length, 1);
  assert.equal(payments[0]?.amount?.value, "114.00");
});

test("T-COMPOSE-005: same idempotency key cannot describe a different purchase", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({
      extraPrices: [addonPrice(), extraAddonPrice()],
      failPaymentCreate: true,
      payments,
      price: recurringPrice(),
      relations: [starterAddonRelation(), starterExtraRelation()],
      subscriptions,
    }),
  ]);
  const store = memorySql();
  await seedUsableMandate(store.sql);
  await assert.rejects(
    () =>
      createSelfCheckout({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "chk-intent-abc",
        lines: [
          { priceId: "starter-monthly", quantity: 1 },
          { priceId: "support-once", quantity: 1 },
        ],
        principal: principal(),
        registry,
        sql: store.sql,
        successUrl: "https://app.example/settings/billing",
      }),
    (error: unknown) =>
      error instanceof Error && error.message === "payment_create_timeout",
  );
  await assert.rejects(
    () =>
      createSelfCheckout({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "chk-intent-abc",
        lines: [
          { priceId: "starter-monthly", quantity: 1 },
          { priceId: "extra-once", quantity: 1 },
        ],
        principal: principal(),
        registry,
        sql: store.sql,
        successUrl: "https://app.example/settings/billing",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingError);
      assert.equal(error.code, "ATHENA_BILLING_IDEMPOTENCY_CONFLICT");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(payments.length, 1);
  assert.equal(subscriptions.length, 0);
});

test("T-COMPOSE-006: same idempotency key with the same intent resumes after crash", async () => {
  const payments: Array<{ amount?: { value?: string } }> = [];
  const subscriptions: unknown[] = [];
  let attempts = 0;
  const registry = new BillingProviderRegistry([
    stubRuntime({
      extraPrices: [addonPrice()],
      failPaymentCreate: () => {
        attempts += 1;
        return attempts === 1;
      },
      payments,
      price: recurringPrice(),
      relations: [starterAddonRelation()],
      subscriptions,
    }),
  ]);
  const store = memorySql();
  await seedUsableMandate(store.sql);
  const lines = [
    { priceId: "starter-monthly", quantity: 1 },
    { priceId: "support-once", quantity: 1 },
  ];
  await assert.rejects(
    () =>
      createSelfCheckout({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "chk-intent-resume",
        lines,
        principal: principal(),
        registry,
        sql: store.sql,
        successUrl: "https://app.example/settings/billing",
      }),
    (error: unknown) =>
      error instanceof Error && error.message === "payment_create_timeout",
  );
  const checkout = await createSelfCheckout({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "chk-intent-resume",
    lines,
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(payments.length, 2);
  assert.equal(payments[0]?.amount?.value, "15.00");
  assert.equal(payments[1]?.amount?.value, "15.00");
  assert.ok(checkout.providerCheckoutId);
  assert.equal(subscriptions.length, 0);
});

test("T-COMPOSE-011: same-intent retry keeps the original return token", async () => {
  const payments: Array<{ amount?: { value?: string } }> = [];
  const subscriptions: unknown[] = [];
  let attempts = 0;
  const registry = new BillingProviderRegistry([
    stubRuntime({
      extraPrices: [addonPrice()],
      failPaymentCreate: () => {
        attempts += 1;
        return attempts === 1;
      },
      payments,
      price: recurringPrice(),
      relations: [starterAddonRelation()],
      subscriptions,
    }),
  ]);
  const store = memorySql();
  await seedUsableMandate(store.sql);
  const lines = [
    { priceId: "starter-monthly", quantity: 1 },
    { priceId: "support-once", quantity: 1 },
  ];
  await assert.rejects(
    () =>
      createSelfCheckout({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "chk-return-token",
        lines,
        principal: principal(),
        registry,
        sql: store.sql,
        successUrl: "https://app.example/settings/billing",
      }),
    (error: unknown) =>
      error instanceof Error && error.message === "payment_create_timeout"
  );
  const pending = store.sessions.find(
    (session) => session.idempotency_key === "chk-return-token"
  );
  const successUrl = (pending?.metadata as { successUrl?: string } | undefined)
    ?.successUrl;
  assert.ok(typeof successUrl === "string");
  const originalHash = pending?.return_nonce_hash;
  const returnToken = new URL(successUrl).searchParams.get(
    ATHENA_BILLING_RETURN_QUERY
  );
  assert.ok(returnToken);
  await createSelfCheckout({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "chk-return-token",
    lines,
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(pending?.return_nonce_hash, originalHash);
  const resumed = await resumeSelfCheckout({
    configuredProviders: configuredProviders(),
    principal: principal(),
    registry,
    returnToken,
    sql: store.sql,
  });
  assert.equal(resumed.payment?.status, "paid");
  assert.equal(subscriptions.length, 1);
});

test("T-COMPOSE-012: legacy session without lines keeps the original return token", async () => {
  const payments: Array<{ amount?: { value?: string } }> = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({
      extraPrices: [addonPrice()],
      payments,
      price: recurringPrice(),
      relations: [starterAddonRelation()],
      subscriptions,
    }),
  ]);
  const store = memorySql();
  await seedUsableMandate(store.sql);
  const nonce = createBillingReturnNonce();
  const sessionId = randomUUID();
  const successUrl = appendBillingReturnToken(
    "https://app.example/settings/billing",
    nonce.token
  );
  await insertCheckoutSession({
    checkoutUrl: null,
    connectionId: "11111111-1111-4111-8111-111111111111",
    enrollmentId: null,
    expiresAt: checkoutAttemptExpiresAtIso(),
    id: sessionId,
    idempotencyKey: "chk-legacy-lines",
    kind: "subscription_enrollment",
    metadata: {
      athenaCheckoutWorkflow: "composed",
      paymentIdempotencyKey: "chk-legacy-lines",
      successUrl,
    },
    priceId: "starter-monthly",
    provider: "mollie",
    providerCustomerId: "cst_enroll",
    providerPaymentId: null,
    providerSubscriptionId: null,
    returnNonceHash: nonce.hash,
    sql: store.sql,
    status: "first_payment_required",
    subjectId: ENROLL_SUBJECT_USER_ID,
    subjectKind: "user",
  });
  await createSelfCheckout({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "chk-legacy-lines",
    lines: [
      { priceId: "starter-monthly", quantity: 1 },
      { priceId: "support-once", quantity: 1 },
    ],
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  const legacy = store.sessions.find((session) => session.id === sessionId);
  assert.equal(legacy?.return_nonce_hash, nonce.hash);
  assert.equal(
    (legacy?.metadata as { successUrl?: string } | undefined)?.successUrl,
    successUrl
  );
  const reconstructed = await listCheckoutSessionLines({
    checkoutSessionId: sessionId,
    sql: store.sql,
  });
  assert.equal(reconstructed.length, 2);
  const resumed = await resumeSelfCheckout({
    configuredProviders: configuredProviders(),
    principal: principal(),
    registry,
    returnToken: nonce.token,
    sql: store.sql,
  });
  assert.equal(resumed.payment?.status, "paid");
  assert.equal(subscriptions.length, 1);
});

test("T-COMPOSE-008: resume and webhook race creates exactly one subscription", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const runtime = stubRuntime({
    extraPrices: [addonPrice()],
    payments,
    price: recurringPrice(),
    relations: [starterAddonRelation()],
    subscriptions,
  });
  const registry = new BillingProviderRegistry([runtime]);
  const store = memorySql();
  await seedUsableMandate(store.sql);
  await createSelfCheckout({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "chk-compose-race",
    lines: [
      { priceId: "starter-monthly", quantity: 1 },
      { priceId: "support-once", quantity: 1 },
    ],
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  const composed = store.sessions.find(
    (session) => session.idempotency_key === "chk-compose-race"
  );
  assert.ok(composed);
  const nonce = createBillingReturnNonce();
  composed.return_nonce_hash = nonce.hash;
  const document = {
    amount: { currency: "EUR", value: "15.00" },
    kind: "payment" as const,
    metadata: {},
    provider: "mollie" as const,
    providerCustomerId: "cst_enroll",
    providerPaymentId: String(composed.provider_payment_id),
    raw: {},
    status: "paid" as const,
  };
  await Promise.all([
    resumeSelfCheckout({
      configuredProviders: configuredProviders(),
      principal: principal(),
      registry,
      returnToken: nonce.token,
      sql: store.sql,
    }),
    advanceSelfSubscriptionEnrollment({
      configuredProviders: configuredProviders(),
      document,
      registry,
      sql: store.sql,
    }),
  ]);
  assert.equal(subscriptions.length, 1);
});

test("T-COMPOSE-009: catalog mutation after snapshot cannot change retry payment", async () => {
  const payments: Array<{ amount?: { value?: string } }> = [];
  const subscriptions: unknown[] = [];
  const extraPrices = [addonPrice()];
  const registry = new BillingProviderRegistry([
    stubRuntime({
      extraPrices,
      failPaymentCreate: () => payments.length === 1,
      payments,
      price: recurringPrice(),
      relations: [starterAddonRelation()],
      subscriptions,
    }),
  ]);
  const store = memorySql();
  await seedUsableMandate(store.sql);
  const lines = [
    { priceId: "starter-monthly", quantity: 1 },
    { priceId: "support-once", quantity: 1 },
  ];
  await assert.rejects(
    () =>
      createSelfCheckout({
        allowedRedirectOrigins: ["https://app.example"],
        configuredProviders: configuredProviders(),
        idempotencyKey: "chk-snapshot-catalog",
        lines,
        principal: principal(),
        registry,
        sql: store.sql,
        successUrl: "https://app.example/settings/billing",
      }),
    (error: unknown) =>
      error instanceof Error && error.message === "payment_create_timeout"
  );
  extraPrices[0] = {
    amount: { currency: "EUR", value: "99.00" },
    id: "support-once",
    metadata: {},
    productId: "support",
    raw: {},
  };
  await createSelfCheckout({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "chk-snapshot-catalog",
    lines,
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(payments.length, 2);
  assert.equal(payments[0]?.amount?.value, "15.00");
  assert.equal(payments[1]?.amount?.value, "15.00");
});

test("T-COMPOSE-010: expired enrollment lease recaptures the same provider effect", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const store = memorySql();
  const runtime = stubRuntime({
    extraPrices: [addonPrice()],
    payments,
    price: recurringPrice(),
    relations: [starterAddonRelation()],
    subscriptions,
  });
  const originalCreate = runtime.subscriptions.create;
  let expireOnce = true;
  runtime.subscriptions.create = async (context, payload) => {
    const created = await originalCreate(context, payload);
    if (expireOnce) {
      expireOnce = false;
      for (const row of store.enrollments) {
        row.lease_expires_at = new Date(Date.now() - 1_000).toISOString();
      }
    }
    return created;
  };
  const registry = new BillingProviderRegistry([runtime]);
  await seedUsableMandate(store.sql);
  await createSelfCheckout({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "chk-lease-recapture",
    lines: [
      { priceId: "starter-monthly", quantity: 1 },
      { priceId: "support-once", quantity: 1 },
    ],
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  const composed = store.sessions.find(
    (session) => session.idempotency_key === "chk-lease-recapture"
  );
  const document = {
    amount: { currency: "EUR", value: "15.00" },
    kind: "payment" as const,
    metadata: {},
    provider: "mollie" as const,
    providerCustomerId: "cst_enroll",
    providerPaymentId: String(composed?.provider_payment_id),
    raw: {},
    status: "paid" as const,
  };
  await advanceSelfSubscriptionEnrollment({
    configuredProviders: configuredProviders(),
    document,
    registry,
    sql: store.sql,
  });
  assert.equal(store.enrollments[0]?.state, "advancing");
  await advanceSelfSubscriptionEnrollment({
    configuredProviders: configuredProviders(),
    document,
    registry,
    sql: store.sql,
  });
  assert.equal(subscriptions.length, 1);
  assert.equal(store.enrollments[0]?.state, "active");
});

test("T-ENROLL-009: failed first payment leaves no subscription", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: recurringPrice(), subscriptions }),
  ]);
  const store = memorySql();
  await enrollSelfSubscription({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "enroll-fail",
    priceId: "starter-monthly",
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  await advanceSelfSubscriptionEnrollment({
    configuredProviders: configuredProviders(),
    document: {
      amount: { currency: "EUR", value: "10.00" },
      kind: "payment",
      metadata: {},
      provider: "mollie",
      providerCustomerId: "cst_enroll",
      providerPaymentId: "tr_1",
      raw: {},
      status: "failed",
    },
    registry,
    sql: store.sql,
  });
  assert.equal(subscriptions.length, 0);
  assert.equal(store.sessions[0]?.status, "first_payment_failed");
});

test("T-ENROLL-010: executeSelfBillingOperation rejects customerId on enroll", async () => {
  await assert.rejects(
    () =>
      executeSelfBillingOperation({
        operation: "self.subscription.enroll",
        payload: {
          customerId: "cst_browser",
          idempotencyKey: "k",
          priceId: "starter-monthly",
        },
        principal: principal(),
        sql: memorySql().sql,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingError);
      assert.equal(error.code, "ATHENA_BILLING_INVALID_REQUEST");
      return true;
    },
  );
});

test("T-ENROLL-CONNECTION-OUTAGE: provider-connection lookup failures do not skip binding", async () => {
  const registry = new BillingProviderRegistry([
    stubRuntime({
      payments: [],
      price: recurringPrice(),
      subscriptions: [],
    }),
  ]);
  await assert.rejects(
    () =>
      ensureActiveProviderCustomer({
        configuredProviders: configuredProviders(),
        idempotencyKey: "outage-1",
        principal: principal(),
        registry,
        sql: {
          async query() {
            throw new Error("ECONNREFUSED");
          },
        },
      }),
    (error: unknown) =>
      error instanceof Error && error.message === "ECONNREFUSED",
  );
});

test("T-ENROLL-CONNECTION-NONE: does not create a provider customer without a connection", async () => {
  let created = 0;
  const runtime = stubRuntime({
    payments: [],
    price: recurringPrice(),
    subscriptions: [],
  });
  runtime.customers.create = async () => {
    created += 1;
    return {
      metadata: {},
      provider: "mollie",
      providerCustomerId: "cst_none",
      raw: {},
    };
  };
  const registry = new BillingProviderRegistry([runtime]);
  await assert.rejects(
    () =>
      ensureActiveProviderCustomer({
        configuredProviders: configuredProviders(),
        idempotencyKey: "none-1",
        principal: principal(),
        registry,
        sql: {
          async query() {
            return { rows: [] };
          },
        },
      }),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.reason === "provider_connection_missing",
  );
  assert.equal(created, 0);
});

test("T-ENROLL-CONNECTION-AMBIGUOUS: does not create a provider customer", async () => {
  let created = 0;
  const runtime = stubRuntime({
    payments: [],
    price: recurringPrice(),
    subscriptions: [],
  });
  runtime.customers.create = async () => {
    created += 1;
    return {
      metadata: {},
      provider: "mollie",
      providerCustomerId: "cst_amb",
      raw: {},
    };
  };
  const registry = new BillingProviderRegistry([runtime]);
  await assert.rejects(
    () =>
      ensureActiveProviderCustomer({
        configuredProviders: configuredProviders(),
        idempotencyKey: "amb-1",
        principal: principal(),
        registry,
        sql: {
          async query() {
            return {
              rows: [
                {
                  credential_reference: "providers.mollie",
                  environment: "test",
                  id: "c1",
                  provider: "mollie",
                  status: "active",
                },
                {
                  credential_reference: "providers.mollie",
                  environment: "test",
                  id: "c2",
                  provider: "mollie",
                  status: "active",
                },
              ],
            };
          },
        },
      }),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.reason === "provider_connection_ambiguous",
  );
  assert.equal(created, 0);
});

test("T-ENROLL-011: persistOwnedSubscription does not rebind a resolved subject", async () => {
  const enrollSrc = readFileSync(
    join(srcRoot, "billing", "runtime", "self", "enroll.ts"),
    "utf8",
  );
  assert.match(enrollSrc, /ownership_status IS DISTINCT FROM 'resolved'/);
  assert.match(
    enrollSrc,
    /ON CONFLICT \(connection_id, provider_subscription_id\) WHERE connection_id IS NOT NULL/,
  );
  assert.equal(
    enrollSrc.includes("ON CONFLICT (provider, provider_subscription_id)"),
    false,
  );
  const store = memorySql();
  const owned = {
    amount: { currency: "EUR" as const, value: "10.00" },
    description: "Starter",
    id: "sub_row",
    interval: "1 month",
    metadata: {},
    provider: "mollie" as const,
    providerCustomerId: "cst_enroll",
    providerSubscriptionId: "sub_owned",
    raw: {},
    status: "active" as const,
  };
  const connectionId = "11111111-1111-4111-8111-111111111111";
  await persistOwnedSubscription({
    connectionId,
    interval: "month",
    principal: principal(),
    sql: store.sql,
    subscription: owned,
  });
  await persistOwnedSubscription({
    connectionId,
    interval: "month",
    principal: principal(),
    sql: store.sql,
    subscription: owned,
  });
  await assert.rejects(
    () =>
      persistOwnedSubscription({
        connectionId,
        interval: "month",
        principal: { ...principal(), userId: "user_enroll_2" },
        sql: store.sql,
        subscription: owned,
      }),
    (error: unknown) =>
      error instanceof AthenaBillingSubjectError &&
      error.code === "ATHENA_BILLING_SUBJECT_CONFLICT",
  );
  assert.equal(store.subscriptions[0]?.subject_id, "user_enroll_1");
});

test("T-ENROLL-LATE-PAY: paid session advances only its enrollment_id", async () => {
  const payments: unknown[] = [];
  const subscriptions: unknown[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({ payments, price: recurringPrice(), subscriptions }),
  ]);
  const store = memorySql();
  await enrollSelfSubscription({
    allowedRedirectOrigins: ["https://app.example"],
    configuredProviders: configuredProviders(),
    idempotencyKey: "enroll-late",
    priceId: "starter-monthly",
    principal: principal(),
    registry,
    sql: store.sql,
    successUrl: "https://app.example/settings/billing",
  });
  const original = store.enrollments[0];
  assert.ok(original);
  original.state = "expired";
  store.enrollments.push({
    attempt_count: 0,
    connection_id: original.connection_id,
    fencing_epoch: 0,
    id: randomUUID(),
    idempotency_key: "enroll-newer",
    journal_intent: null,
    last_error: null,
    lease_expires_at: null,
    lease_token: null,
    price_id: "starter-monthly",
    provider_idempotency_key: "newer",
    provider_payment_id: null,
    provider_subscription_id: "sub_newer",
    state: "active",
    subject_id: ENROLL_SUBJECT_USER_ID,
    subject_kind: "user",
  });
  await advanceSelfSubscriptionEnrollment({
    configuredProviders: configuredProviders(),
    document: {
      amount: { currency: "EUR", value: "10.00" },
      kind: "payment",
      metadata: {},
      provider: "mollie",
      providerCustomerId: "cst_enroll",
      providerPaymentId: "tr_1",
      raw: {},
      status: "paid",
    },
    registry,
    sql: store.sql,
  });
  assert.equal(subscriptions.length, 0);
  assert.equal(store.sessions[0]?.status, "refund_required");
  assert.equal(store.enrollments[1]?.state, "active");
});

test("T-CHANGE-COMPENSATE: replacement is cancelled when old cancel fails", async () => {
  const payments: unknown[] = [];
  const created: unknown[] = [];
  const cancelled: string[] = [];
  const registry = new BillingProviderRegistry([
    stubRuntime({
      payments,
      price: {
        amount: { currency: "EUR", value: "20.00" },
        id: "pro-monthly",
        interval: "month",
        metadata: {},
        productId: "pro",
        raw: {},
      },
      subscriptions: created,
    }),
  ]);
  const runtime = registry.get("mollie");
  if (runtime?.subscriptions) {
    runtime.subscriptions.update = async () => {
      throw new AthenaBillingCapabilityError({
        operation: "subscriptions.update",
        reason: "provider_operation_unsupported",
      });
    };
    runtime.subscriptions.cancel = async (_context, payload) => {
      cancelled.push(payload.subscriptionId);
      if (payload.subscriptionId === "sub_live") {
        throw new Error("old_cancel_failed");
      }
      return {
        metadata: {},
        provider: "mollie",
        providerCustomerId: payload.customerId,
        providerSubscriptionId: payload.subscriptionId,
        raw: {},
        status: "canceled",
      };
    };
  }
  const store = memorySql();
  const { sql, subscriptions: owned } = store;
  owned.push({
    connection_id: "11111111-1111-4111-8111-111111111111",
    description: "Starter",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ownership_status: "resolved",
    provider: "mollie",
    provider_customer_id: "cst_enroll",
    provider_subscription_id: "sub_live",
    row_version: 1,
    status: "active",
    subject_id: ENROLL_SUBJECT_USER_ID,
    subject_kind: "user",
  });
  const result = await changeSelfSubscription({
    configuredProviders: configuredProviders(),
    idempotencyKey: "change-compensate",
    planChangeEnabled: { planChange: true },
    priceId: "pro-monthly",
    principal: principal(),
    registry,
    sql,
  });
  assert.equal("operationId" in result, true);
  if ("operationId" in result) {
    assert.equal(result.status, "failed");
    assert.equal(result.error, "old_cancel_failed");
  }
  assert.equal(created.length, 1);
  assert.equal(cancelled.includes("sub_live"), true);
  assert.equal(cancelled.includes("sub_1"), true);
  assert.equal(store.planChanges[0]?.state, "failed");
  assert.deepEqual(
    store.providerEffects.map((effect) => ({
      effect_type: effect.effect_type,
      state: effect.state,
    })),
    [
      { effect_type: "subscription.update", state: "failed" },
      { effect_type: "subscription.create.replacement", state: "applied" },
      { effect_type: "subscription.cancel.old", state: "failed" },
      { effect_type: "subscription.cancel.replacement", state: "applied" },
    ],
  );
});

test("T-CHANGE-RECOVERY-MARKER: same-price subscriptions need the operation marker", () => {
  const candidate = {
    amount: { currency: "EUR", value: "20.00" },
    metadata: {
      athenaPlanChange: true,
      newPriceId: "pro-monthly",
    },
    provider: "mollie",
    providerCustomerId: "cst_enroll",
    providerSubscriptionId: "sub-older-same-price",
    raw: {},
    status: "active",
  } satisfies BillingSubscription;
  const matching = {
    ...candidate,
    metadata: {
      athenaPlanChange: true,
      athenaPlanChangeOperationId: "plan-op-recovery",
      newPriceId: "pro-monthly",
    },
    providerSubscriptionId: "sub-operation",
  } satisfies BillingSubscription;

  assert.equal(
    isPlanChangeReplacementCandidate({
      candidate,
      operationId: "plan-op-recovery",
      priceId: "pro-monthly",
    }),
    false,
  );
  assert.equal(
    isPlanChangeReplacementCandidate({
      candidate: matching,
      operationId: "plan-op-recovery",
      priceId: "pro-monthly",
    }),
    true,
  );
});

test("T-CHANGE-RECOVERY-METADATA: replacement requests omit volatile metadata", () => {
  const source = readFileSync(
    join(srcRoot, "billing", "runtime", "self", "change.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /effectiveAt/);
});

test("T-ENROLL-kill-switch: selfEnrollment.enabled false rejects enroll", async () => {
  const store = memorySql();
  await assert.rejects(
    () =>
      enrollSelfSubscription({
        idempotencyKey: "enroll-killed",
        priceId: "starter-monthly",
        principal: principal(),
        selfEnrollmentEnabled: false,
        sql: store.sql,
      }),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.reason === "self_enrollment_disabled",
  );
});
