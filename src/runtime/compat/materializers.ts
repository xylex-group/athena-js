/**
 * Legacy config-shaped materializer adapters.
 *
 * New runtime construction must use the plan/resource materializers directly.
 * These adapters remain only for older internal consumers while they migrate.
 */

import type { AthenaClientConfig } from "../../client/contracts.ts";
import { resolveAthenaConstruction } from "../construction/resolve.ts";
import type {
  AthenaStorageRuntimeResources,
  ResolvedAthenaConstruction,
} from "../construction/types.ts";
import {
  getStorageProvider,
  getStorageRuntime,
} from "../../storage/runtime/index.ts";
import {
  getLocalObjectStore as getLocalObjectStoreMarker,
  isS3StorageConfig,
} from "../../storage/runtime.ts";
import { isAthenaS3ObjectClient } from "../../storage/runtime/providers/s3-provider.ts";
import {
  materializeBillingPlan,
  type AthenaMaterializedBilling,
} from "../materializers/billing.ts";
import { materializeStoragePlan } from "../materializers/storage.ts";
import type { AthenaRuntimePlan } from "../plan/types.ts";
import { getBoundPostgresRuntime } from "../../postgres/owned-runtime.ts";

type LegacyStorageConfig = {
  lifecycle?: { storage?: AthenaStorageRuntimeResources["lifecycle"] };
  storage?: {
    bucket?: string | null;
    prefix?: string | null;
    provider?: string | null;
    r2?: AthenaStorageRuntimeResources["r2"];
    root?: string | null;
    s3?: AthenaStorageRuntimeResources["s3"];
  };
};

function materializeLegacyStorage(
  config: LegacyStorageConfig,
  plan: AthenaRuntimePlan,
): { storage: object } {
  const storage = config.storage;
  const resources: AthenaStorageRuntimeResources = {
    existingLocalStore: getLocalObjectStoreMarker(storage),
    existingProvider: getStorageProvider(storage),
    existingRuntime: getStorageRuntime(storage),
    lifecycle: config.lifecycle?.storage,
    r2: storage?.r2,
    s3:
      isS3StorageConfig(storage) && isAthenaS3ObjectClient(storage.s3)
        ? storage.s3
        : undefined,
  };
  const result = materializeStoragePlan(
    {
      ...plan,
      storage: {
        ...plan.storage,
        bucket: storage?.bucket ?? undefined,
        prefix: storage?.prefix ?? undefined,
        root: storage?.root ?? undefined,
      },
    },
    resources,
  );
  return {
    storage: {
      ...(storage ?? {}),
      ...(result.bindings.storage ?? {}),
    },
  };
}

export function materializeStorageCompat(
  config: unknown,
): { storage: object };
export function materializeStorageCompat(
  config: unknown,
  plan: AthenaRuntimePlan,
): { storage: object };
export function materializeStorageCompat(
  config: unknown,
  suppliedPlan?: AthenaRuntimePlan,
): { storage: object } {
  const input = config as LegacyStorageConfig;
  const storage = input.storage;
  const plan =
    suppliedPlan ??
    ({
      storage: {
        transport:
          storage?.provider === "local"
            ? "local"
            : storage?.provider === "s3"
              ? "s3"
              : storage?.r2
                ? "r2"
                : "none",
      },
    } as AthenaRuntimePlan);
  return materializeLegacyStorage(input, plan);
}

export function materializeBillingCompat(
  config: unknown,
  plan: AthenaRuntimePlan,
): AthenaMaterializedBilling {
  const construction = resolveAthenaConstruction(
    config as AthenaClientConfig<undefined>,
    plan,
  ) as ResolvedAthenaConstruction<undefined>;
  return materializeBillingPlan(
    construction.plan,
    getBoundPostgresRuntime(construction.resources.db.gatewayTransport),
  );
}
