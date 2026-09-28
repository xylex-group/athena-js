import { isAthenaBillingProviderRequestError } from "../../billing/errors.ts";
import {
  ATHENA_EVENT_INGRESS_FAILED,
  AthenaEventIngressError,
  isAthenaEventIngressError,
} from "./errors.ts";
import type { AthenaIngressStatus } from "./ir.ts";

export const INGRESS_PROCESSING_LEASE_MS = 5 * 60 * 1000;
export const INGRESS_MAX_ATTEMPTS = 8;
export const INGRESS_MAX_BACKOFF_MS = 60 * 60 * 1000;

export type IngressFailureStage =
  | "parse"
  | "verify"
  | "refetch"
  | "project"
  | "persist"
  | "unknown";

export interface IngressFailureRecord {
  attemptCount: number;
  code: string;
  firstFailedAt: string;
  lastFailedAt: string;
  nextAttemptAt?: string;
  retryable: boolean;
  stage: IngressFailureStage;
}

export interface ClassifiedIngressFailure {
  code: string;
  error: IngressFailureRecord;
  nextAttemptAt?: Date;
  retryable: boolean;
  stage: IngressFailureStage;
  status: Extract<
    AthenaIngressStatus,
    "retryable_failure" | "terminal_failure"
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function pgCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return;
  }
  if (typeof error.code === "string") {
    return error.code;
  }
  const cause = error.cause;
  if (isRecord(cause) && typeof cause.code === "string") {
    return cause.code;
  }
}

function isTransientDatabaseFailure(error: unknown): boolean {
  const code = pgCode(error);
  if (
    code === "40001" ||
    code === "40P01" ||
    code === "55P03" ||
    code === "57P01" ||
    code === "08006" ||
    code === "08001" ||
    code === "57P03"
  ) {
    return true;
  }
  if (!isRecord(error)) {
    return false;
  }
  const message = typeof error.message === "string" ? error.message : "";
  return (
    error.name === "AthenaBillingCapabilityError" ||
    /timeout|ECONNRESET|ECONNREFUSED|connection terminated/i.test(message)
  );
}

function isProjectionInvariantFailure(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  const name = typeof error.name === "string" ? error.name : "";
  const code = typeof error.code === "string" ? error.code : "";
  return (
    name === "AthenaBillingIllegalTransitionError" ||
    name === "AthenaBillingRevisionStaleError" ||
    code === "ATHENA_BILLING_ILLEGAL_TRANSITION" ||
    code === "ATHENA_BILLING_REVISION_STALE"
  );
}

export function backoffAfterAttempt(attemptCount: number): Date {
  const exponent = Math.max(0, attemptCount - 1);
  const delay = Math.min(INGRESS_MAX_BACKOFF_MS, 1000 * 2 ** exponent);
  return new Date(Date.now() + delay);
}

function isProviderIngressRetryable(error: { retry: string }): boolean {
  return error.retry === "safe" || error.retry === "reconcile_first";
}

export function wrapIngressProcessingError(input: {
  connectionId?: string;
  error: unknown;
  stage: IngressFailureStage;
}): unknown {
  if (isAthenaEventIngressError(input.error)) {
    return input.error;
  }
  if (isAthenaBillingProviderRequestError(input.error)) {
    const stage = input.stage === "unknown" ? "refetch" : input.stage;
    return new AthenaEventIngressError({
      code: ATHENA_EVENT_INGRESS_FAILED,
      domain: "billing",
      diagnostics: {
        ...(input.connectionId ? { connectionId: input.connectionId } : {}),
        ...(input.error.operation ? { operation: input.error.operation } : {}),
        ...(input.error.status != null
          ? { providerStatus: input.error.status }
          : {}),
        retryable: isProviderIngressRetryable(input.error),
        stage,
      },
      message: "Billing webhook provider request failed during ingress.",
      provider: input.error.provider,
      retryable: isProviderIngressRetryable(input.error),
    });
  }
  return input.error;
}

export function classifyIngressFailure(input: {
  attemptCount: number;
  error: unknown;
  firstFailedAt?: Date;
  stage: IngressFailureStage;
}): ClassifiedIngressFailure {
  const now = new Date();
  const firstFailedAt = input.firstFailedAt ?? now;
  let code = "ATHENA_EVENT_INGRESS_FAILED";
  let retryable = false;
  if (isAthenaEventIngressError(input.error)) {
    code = input.error.code;
    retryable = input.error.retryable;
  } else if (isAthenaBillingProviderRequestError(input.error)) {
    retryable = isProviderIngressRetryable(input.error);
  } else if (isProjectionInvariantFailure(input.error)) {
    code =
      isRecord(input.error) && typeof input.error.code === "string"
        ? input.error.code
        : "ATHENA_BILLING_ILLEGAL_TRANSITION";
    retryable = false;
  } else if (isTransientDatabaseFailure(input.error)) {
    code = pgCode(input.error) ?? "ATHENA_EVENT_INGRESS_FAILED";
    retryable = true;
  } else if (input.stage === "refetch" || input.stage === "persist") {
    retryable = true;
  }
  if (input.attemptCount >= INGRESS_MAX_ATTEMPTS) {
    retryable = false;
  }
  const status = retryable ? "retryable_failure" : "terminal_failure";
  const nextAttemptAt = retryable
    ? backoffAfterAttempt(input.attemptCount)
    : undefined;
  const record: IngressFailureRecord = {
    attemptCount: input.attemptCount,
    code,
    firstFailedAt: firstFailedAt.toISOString(),
    lastFailedAt: now.toISOString(),
    retryable,
    stage: input.stage,
    ...(nextAttemptAt ? { nextAttemptAt: nextAttemptAt.toISOString() } : {}),
  };
  return {
    code,
    error: record,
    retryable,
    stage: input.stage,
    status,
    ...(nextAttemptAt ? { nextAttemptAt } : {}),
  };
}

export function redactedIngressFailure(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "ingress failed";
}
