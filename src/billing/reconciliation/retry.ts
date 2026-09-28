import {
  isAthenaBillingCredentialError,
  isAthenaBillingProviderRequestError,
} from "../errors.ts";
import {
  ATHENA_BILLING_IMPORT_CURSOR_INVALID,
  AthenaBillingImportError,
} from "../import/errors.ts";
import type {
  BillingBackoffDecision,
  BillingReconciliationFailureKind,
} from "./types.ts";

export class AthenaBillingReconciliationError extends Error {
  readonly kind: BillingReconciliationFailureKind;
  readonly retryAfterMs?: number;

  constructor(input: {
    kind: BillingReconciliationFailureKind;
    message: string;
    retryAfterMs?: number;
  }) {
    super(input.message);
    this.name = "AthenaBillingReconciliationError";
    this.kind = input.kind;
    this.retryAfterMs = input.retryAfterMs;
  }
}

const MAX_DELAY_MS = 60 * 60 * 1000;
const BASE_DELAY_MS = 60_000;

export function classifyBillingReconciliationFailure(
  error: unknown
): BillingReconciliationFailureKind {
  if (error instanceof AthenaBillingReconciliationError) {
    return error.kind;
  }
  if (error instanceof AthenaBillingImportError) {
    if (error.code === ATHENA_BILLING_IMPORT_CURSOR_INVALID) {
      return "cursor_invalid";
    }
    return "provider_unavailable";
  }
  if (isAthenaBillingCredentialError(error)) {
    return "provider_auth_failed";
  }
  if (isAthenaBillingProviderRequestError(error)) {
    if (error.status === 401 || error.status === 403) {
      return "provider_auth_failed";
    }
    if (error.status === 429 || error.kind === "rate_limited") {
      return "provider_rate_limited";
    }
    if (
      error.kind === "network" ||
      error.kind === "timeout" ||
      error.kind === "provider_unavailable" ||
      (typeof error.status === "number" && error.status >= 500)
    ) {
      return "provider_unavailable";
    }
    if (error.kind === "authentication" || error.kind === "authorization") {
      return "provider_auth_failed";
    }
  }
  if (error instanceof Error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "ENOTFOUND" ||
      code === "ETIMEDOUT" ||
      code === "EPIPE"
    ) {
      return "database_unavailable";
    }
  }
  return "internal";
}

export function isTransientBillingReconciliationFailure(
  kind: BillingReconciliationFailureKind
): boolean {
  return (
    kind === "provider_rate_limited" ||
    kind === "provider_unavailable" ||
    kind === "database_unavailable"
  );
}

export function billingReconciliationBackoff(input: {
  attempt: number;
  error: unknown;
  kind?: BillingReconciliationFailureKind;
}): BillingBackoffDecision {
  const kind = input.kind ?? classifyBillingReconciliationFailure(input.error);
  const retry = isTransientBillingReconciliationFailure(kind);
  if (!retry) {
    return { delayMs: 0, kind, retry: false };
  }
  const retryAfter =
    input.error instanceof AthenaBillingReconciliationError
      ? input.error.retryAfterMs
      : undefined;
  const headerMs = readRetryAfterMs(input.error);
  const exp = Math.min(
    MAX_DELAY_MS,
    BASE_DELAY_MS * 2 ** Math.max(0, input.attempt)
  );
  const jitter = Math.floor(Math.random() * Math.max(1000, exp * 0.2));
  return {
    delayMs: retryAfter ?? headerMs ?? Math.min(MAX_DELAY_MS, exp + jitter),
    kind,
    retry: true,
  };
}

function readRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return;
  }
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== "object") {
    return;
  }
  const retryAfter = (details as { retryAfter?: unknown }).retryAfter;
  if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) {
    return Math.max(0, retryAfter * 1000);
  }
  if (typeof retryAfter === "string") {
    const parsed = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed * 1000);
    }
  }
}
