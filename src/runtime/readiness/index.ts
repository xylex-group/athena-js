import type { AthenaCapabilityEntry } from "../../capabilities/types.ts";

export type AthenaRuntimeSubsystem =
  | "database"
  | "auth"
  | "billing"
  | "storage"
  | "event-ingress";

export type AthenaOperationAuthorization =
  | "allowed"
  | "denied"
  | "not-required"
  | "unknown";
export type AthenaOperationPolicy =
  | "allowed"
  | "denied"
  | "not-applicable"
  | "unknown";

export type AthenaOperationReadinessReason =
  | "capability-unavailable"
  | "capability-unknown"
  | "capability-degraded"
  | "maturity-disabled"
  | "authorization-denied"
  | "authorization-unknown"
  | "policy-denied"
  | "policy-unknown";

export interface AthenaOperationReadiness {
  capability: AthenaCapabilityEntry;
  authorization: AthenaOperationAuthorization;
  policy: AthenaOperationPolicy;
  executable: boolean;
  reasons: readonly AthenaOperationReadinessReason[];
}

export function resolveAthenaOperationReadiness(input: {
  capability: AthenaCapabilityEntry;
  authorization?: AthenaOperationAuthorization;
  policy?: AthenaOperationPolicy;
}): AthenaOperationReadiness {
  const authorization = input.authorization ?? "not-required";
  const policy = input.policy ?? "not-applicable";
  const reasons: AthenaOperationReadinessReason[] = [];
  if (input.capability.status === "unavailable") {
    reasons.push("capability-unavailable");
  } else if (input.capability.status === "unknown") {
    reasons.push("capability-unknown");
  } else if (input.capability.status === "degraded") {
    reasons.push("capability-degraded");
  }
  if (input.capability.maturity === "disabled") {
    reasons.push("maturity-disabled");
  }
  if (authorization === "denied") {
    reasons.push("authorization-denied");
  } else if (authorization === "unknown") {
    reasons.push("authorization-unknown");
  }
  if (policy === "denied") {
    reasons.push("policy-denied");
  } else if (policy === "unknown") {
    reasons.push("policy-unknown");
  }
  return {
    capability: input.capability,
    authorization,
    policy,
    executable: reasons.length === 0,
    reasons,
  };
}

export interface AthenaRuntimeReadiness {
  fail(subsystem: AthenaRuntimeSubsystem, error: unknown): void;
  ready(subsystem: AthenaRuntimeSubsystem): void;
  reset(subsystem: AthenaRuntimeSubsystem): void;
  waitFor(subsystem: AthenaRuntimeSubsystem): Promise<void>;
}

interface DeferredSlot {
  promise: Promise<void>;
  reject: (reason?: unknown) => void;
  resolve: () => void;
  settled: boolean;
}

function createSlot(): DeferredSlot {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => {
      res();
    };
    reject = (reason) => {
      rej(reason);
    };
  });
  promise.catch(() => undefined);
  return { promise, reject, resolve, settled: false };
}

export function createAthenaRuntimeReadiness(): AthenaRuntimeReadiness {
  const slots = new Map<AthenaRuntimeSubsystem, DeferredSlot>();
  const slot = (subsystem: AthenaRuntimeSubsystem): DeferredSlot => {
    const existing = slots.get(subsystem);
    if (existing) {
      return existing;
    }
    const created = createSlot();
    slots.set(subsystem, created);
    return created;
  };
  return {
    fail(subsystem, error) {
      const current = slot(subsystem);
      if (current.settled) {
        return;
      }
      current.settled = true;
      current.reject(error);
    },
    ready(subsystem) {
      const current = slot(subsystem);
      if (current.settled) {
        return;
      }
      current.settled = true;
      current.resolve();
    },
    reset(subsystem) {
      slots.set(subsystem, createSlot());
    },
    waitFor(subsystem) {
      return slot(subsystem).promise;
    },
  };
}
