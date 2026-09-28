import type { BillingIngressAdmissionPolicy } from "./types.ts";

export type { BillingIngressAdmissionPolicy } from "./types.ts";

export type BillingIngressAdmissionRejection =
  | "body_too_large"
  | "concurrent_limit"
  | "invalid_auth"
  | "rate_limited";

export const BILLING_INGRESS_ADMISSION_CODES = {
  body_too_large: "ATHENA_HTTP_REQUEST_TOO_LARGE",
  concurrent_limit: "ATHENA_BILLING_INGRESS_CONCURRENT_LIMIT",
  rate_limited: "ATHENA_BILLING_INGRESS_RATE_LIMITED",
} as const;

export interface BillingIngressAdmissionCounters {
  accepted: number;
  duplicate: number;
  invalidAuth: number;
  rateLimited: number;
  received: number;
}

export interface BillingIngressAdmissionDecision {
  accepted: boolean;
  reason?: BillingIngressAdmissionRejection;
  rekey(input: { connectionId: string; provider?: string }): BillingIngressAdmissionDecision;
  release(): void;
}

export interface BillingIngressAdmission {
  admit(input: {
    bodyBytes?: number;
    connectionId?: string;
    ip?: string;
    provider?: string;
    token?: string;
  }): BillingIngressAdmissionDecision;
  counters(): BillingIngressAdmissionCounters;
  policy(): Required<BillingIngressAdmissionPolicy>;
  recordDuplicate(key?: string): void;
  recordInvalidAuth(key?: string): void;
}

const DEFAULT_POLICY: Required<BillingIngressAdmissionPolicy> = {
  burst: 40,
  maxBodyBytes: 1_048_576,
  maxConcurrent: 16,
  ratePerSecond: 20,
  trustProxy: false,
};

const MAX_ADMISSION_BUCKETS = 10_000;

interface TokenBucket {
  lastRefill: number;
  tokens: number;
}

interface AdmissionReservation {
  key: string;
  released: boolean;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function normalizePolicy(
  input: BillingIngressAdmissionPolicy | undefined
): Required<BillingIngressAdmissionPolicy> {
  const ratePerSecond = positiveNumber(
    input?.ratePerSecond,
    DEFAULT_POLICY.ratePerSecond
  );
  return {
    burst: positiveInteger(input?.burst, Math.ceil(ratePerSecond * 2)),
    maxBodyBytes: positiveInteger(
      input?.maxBodyBytes,
      DEFAULT_POLICY.maxBodyBytes
    ),
    maxConcurrent: positiveInteger(
      input?.maxConcurrent,
      DEFAULT_POLICY.maxConcurrent
    ),
    ratePerSecond,
    trustProxy: input?.trustProxy === true,
  };
}

function admissionKey(input: {
  connectionId?: string;
  ip?: string;
  provider?: string;
  token?: string;
}): string {
  const provider = input.provider?.trim().toLowerCase() || "unknown";
  const identity =
    input.connectionId?.trim() ||
    input.ip?.trim() ||
    "anonymous";
  return `${provider}|${identity}`;
}

export function createBillingIngressAdmission(
  input: BillingIngressAdmissionPolicy & {
    now?: () => number;
    policy?: BillingIngressAdmissionPolicy;
  } = {}
): BillingIngressAdmission {
  const admissionPolicy = normalizePolicy(input.policy ?? input);
  const clock = input.now ?? Date.now;
  const buckets = new Map<string, TokenBucket>();
  const counts: BillingIngressAdmissionCounters = {
    accepted: 0,
    duplicate: 0,
    invalidAuth: 0,
    rateLimited: 0,
    received: 0,
  };
  const concurrentByKey = new Map<string, number>();

  const reject = (
    reason: BillingIngressAdmissionRejection,
    release: () => void = () => {}
  ): BillingIngressAdmissionDecision => {
    const decision: BillingIngressAdmissionDecision = {
      accepted: false,
      reason,
      rekey: () => decision,
      release,
    };
    return decision;
  };

  const releaseReservation = (reservation: AdmissionReservation): void => {
    if (reservation.released) {
      return;
    }
    reservation.released = true;
    const current = concurrentByKey.get(reservation.key) ?? 0;
    if (current <= 1) {
      concurrentByKey.delete(reservation.key);
    } else {
      concurrentByKey.set(reservation.key, current - 1);
    }
  };

  const refillBucket = (bucket: TokenBucket, now: number): void => {
    const elapsedSeconds = Math.max(0, now - bucket.lastRefill) / 1_000;
    bucket.tokens = Math.min(
      admissionPolicy.burst,
      bucket.tokens + elapsedSeconds * admissionPolicy.ratePerSecond
    );
    bucket.lastRefill = now;
  };

  const admit = (request: Parameters<BillingIngressAdmission["admit"]>[0]) => {
    counts.received += 1;
    const key = admissionKey(request);
    if (!buckets.has(key) && buckets.size >= MAX_ADMISSION_BUCKETS) {
      const oldestKey = buckets.keys().next().value;
      if (typeof oldestKey === "string") {
        buckets.delete(oldestKey);
      }
    }
    if (
      request.bodyBytes != null &&
      request.bodyBytes > admissionPolicy.maxBodyBytes
    ) {
      return reject("body_too_large");
    }
    if (
      (concurrentByKey.get(key) ?? 0) >= admissionPolicy.maxConcurrent
    ) {
      counts.rateLimited += 1;
      return reject("concurrent_limit");
    }
    const now = clock();
    const bucket = buckets.get(key) ?? {
      lastRefill: now,
      tokens: admissionPolicy.burst,
    };
    refillBucket(bucket, now);
    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      counts.rateLimited += 1;
      return reject("rate_limited");
    }
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    concurrentByKey.set(key, (concurrentByKey.get(key) ?? 0) + 1);
    counts.accepted += 1;
    const reservation: AdmissionReservation = { key, released: false };
    const decision: BillingIngressAdmissionDecision = {
      accepted: true,
      rekey(input) {
        const nextKey = admissionKey({
          connectionId: input.connectionId,
          provider: input.provider,
        });
        if (nextKey === reservation.key) {
          return decision;
        }
        if (
          (concurrentByKey.get(nextKey) ?? 0) >= admissionPolicy.maxConcurrent
        ) {
          counts.rateLimited += 1;
          releaseReservation(reservation);
          return reject("concurrent_limit");
        }
        const nextNow = clock();
        const nextBucket = buckets.get(nextKey) ?? {
          lastRefill: nextNow,
          tokens: admissionPolicy.burst,
        };
        refillBucket(nextBucket, nextNow);
        if (nextBucket.tokens < 1) {
          buckets.set(nextKey, nextBucket);
          counts.rateLimited += 1;
          releaseReservation(reservation);
          return reject("rate_limited");
        }
        nextBucket.tokens -= 1;
        buckets.set(nextKey, nextBucket);
        const previousBucket = buckets.get(reservation.key);
        if (previousBucket) {
          refillBucket(previousBucket, nextNow);
          previousBucket.tokens = Math.min(
            admissionPolicy.burst,
            previousBucket.tokens + 1
          );
          buckets.set(reservation.key, previousBucket);
        }
        const previousKey = reservation.key;
        const previousConcurrent = concurrentByKey.get(previousKey) ?? 0;
        if (previousConcurrent <= 1) {
          concurrentByKey.delete(previousKey);
        } else {
          concurrentByKey.set(previousKey, previousConcurrent - 1);
        }
        concurrentByKey.set(
          nextKey,
          (concurrentByKey.get(nextKey) ?? 0) + 1
        );
        reservation.key = nextKey;
        return decision;
      },
      release() {
        releaseReservation(reservation);
      },
    };
    return decision;
  };

  return {
    admit,
    counters: () => ({ ...counts }),
    policy: () => ({ ...admissionPolicy }),
    recordDuplicate() {
      counts.duplicate += 1;
    },
    recordInvalidAuth() {
      counts.invalidAuth += 1;
    },
  };
}
