import { sha256HexUtf8 } from "../../../node-crypto.ts";
import type { BillingSchedulerHandle } from "../../reconciliation/scheduler.ts";
import type { AthenaBillingRuntimeDispatch } from "../dispatch.ts";

const OWNERS = Symbol.for("@xylex-group/athena.embeddedBillingRuntimeOwners");
const RECOVERY_ATTEMPTS = Symbol.for(
  "@xylex-group/athena.embeddedBillingRuntimeRecoveryAttempts",
);

export interface EmbeddedBillingRuntimeSurfaces {
  dispatch?: AthenaBillingRuntimeDispatch;
  eventIngress?: unknown;
}

type EmbeddedBillingRuntimeOwnerRecord = {
  dispatch?: AthenaBillingRuntimeDispatch;
  eventIngress?: unknown;
  generation: number;
  mutex: Promise<void>;
  schedulers: BillingSchedulerHandle[];
};

type EmbeddedBillingRuntimeOwnerMap = Map<
  string,
  EmbeddedBillingRuntimeOwnerRecord
>;

type EmbeddedBillingRuntimeRecoveryMap = Map<string, Promise<unknown>>;

function ownerMap(): EmbeddedBillingRuntimeOwnerMap {
  const holder = globalThis as typeof globalThis & {
    [OWNERS]?: EmbeddedBillingRuntimeOwnerMap;
  };
  holder[OWNERS] ??= new Map();
  return holder[OWNERS];
}

function recoveryMap(): EmbeddedBillingRuntimeRecoveryMap {
  const holder = globalThis as typeof globalThis & {
    [RECOVERY_ATTEMPTS]?: EmbeddedBillingRuntimeRecoveryMap;
  };
  holder[RECOVERY_ATTEMPTS] ??= new Map();
  return holder[RECOVERY_ATTEMPTS];
}

export function runEmbeddedBillingRuntimeRecoveryOnce<T>(
  ownerKey: string,
  run: () => Promise<T>,
  projectJoinedResult?: (result: T) => Promise<void> | void,
): Promise<T> {
  const existing = recoveryMap().get(ownerKey);
  if (existing != null) {
    return existing.then(async (result) => {
      await projectJoinedResult?.(result as T);
      return result as T;
    });
  }
  const started = Promise.resolve().then(run);
  const tracked = started.then(
    (result) => {
      recoveryMap().delete(ownerKey);
      return result;
    },
    (error: unknown) => {
      recoveryMap().delete(ownerKey);
      throw error;
    },
  );
  tracked.catch(() => undefined);
  recoveryMap().set(ownerKey, tracked);
  return tracked;
}

export function fingerprintBillingDatabaseIdentity(
  databaseUri: string | undefined
): string {
  const trimmed = databaseUri?.trim();
  if (trimmed == null || trimmed.length === 0) {
    return "memory";
  }
  return sha256HexUtf8(trimmed);
}

export function embeddedBillingRuntimeOwnerKey(input: {
  applicationId?: string | null;
  databaseIdentity?: string;
}): string {
  const applicationId = input.applicationId?.trim();
  return `${applicationId != null && applicationId.length > 0 ? applicationId : "_"}\0${input.databaseIdentity ?? "memory"}`;
}

export function claimEmbeddedBillingRuntimeOwner(key: string): {
  generation: number;
  isCurrent: () => boolean;
} {
  const owners = ownerMap();
  const previous = owners.get(key);
  const toDrain = [...(previous?.schedulers ?? [])];
  for (const handle of toDrain) {
    handle.cancel();
  }
  const generation = (previous?.generation ?? 0) + 1;
  const drained = previous?.mutex ?? Promise.resolve();
  owners.set(key, {
    generation,
    mutex: drained.then(async () => {
      await Promise.all(toDrain.map((handle) => handle.drain()));
    }),
    schedulers: [],
  });
  return {
    generation,
    isCurrent: () => ownerMap().get(key)?.generation === generation,
  };
}

export async function runExclusiveEmbeddedBillingRuntime<T>(
  key: string,
  generation: number,
  work: () => Promise<T>
): Promise<T | undefined> {
  const owners = ownerMap();
  const record = owners.get(key);
  if (record == null || record.generation !== generation) {
    return;
  }
  let result: T | undefined;
  const run = record.mutex.then(async () => {
    if (ownerMap().get(key)?.generation !== generation) {
      return;
    }
    result = await work();
  });
  record.mutex = run.then(
    () => undefined,
    () => undefined
  );
  await run;
  return result;
}

export function retainEmbeddedBillingRuntimeScheduler(
  key: string,
  generation: number,
  handle: BillingSchedulerHandle | null
): void {
  if (handle == null) {
    return;
  }
  const record = ownerMap().get(key);
  if (record == null || record.generation !== generation) {
    handle.cancel();
    return;
  }
  record.schedulers.push(handle);
}

export function bindEmbeddedBillingRuntimeSurfaces(
  key: string,
  generation: number,
  surfaces: EmbeddedBillingRuntimeSurfaces
): void {
  const record = ownerMap().get(key);
  if (record == null || record.generation !== generation) {
    return;
  }
  if (surfaces.dispatch !== undefined) {
    record.dispatch = surfaces.dispatch;
  }
  if (surfaces.eventIngress !== undefined) {
    record.eventIngress = surfaces.eventIngress;
  }
}

export function peekEmbeddedBillingRuntimeSurfaces(
  key: string | undefined
): EmbeddedBillingRuntimeSurfaces | undefined {
  if (key == null || key.length === 0) {
    return;
  }
  const record = ownerMap().get(key);
  if (record == null) {
    return;
  }
  return {
    ...(record.dispatch === undefined ? {} : { dispatch: record.dispatch }),
    ...(record.eventIngress === undefined
      ? {}
      : { eventIngress: record.eventIngress }),
  };
}

export async function releaseEmbeddedBillingRuntimeOwner(
  key: string,
  generation: number
): Promise<void> {
  const owners = ownerMap();
  const record = owners.get(key);
  if (record == null || record.generation !== generation) {
    return;
  }
  for (const handle of record.schedulers) {
    handle.cancel();
  }
  await Promise.all(record.schedulers.map((handle) => handle.drain()));
  if (owners.get(key)?.generation === generation) {
    owners.delete(key);
  }
}

/** Test helper — not a product API. */
export function resetEmbeddedBillingRuntimeOwnersForTests(): void {
  ownerMap().clear();
}
