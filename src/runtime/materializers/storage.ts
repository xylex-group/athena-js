/**
 * Node storage materializer — plan-selected provider plus opaque handles.
 */

import { createLocalStorageModule } from "../../storage/local.ts";
import { createStorageRuntime } from "../../storage/runtime/index.ts";
import { createLocalStorageProvider } from "../../storage/runtime/providers/local-provider.ts";
import { createR2StorageProvider } from "../../storage/runtime/providers/r2-provider.ts";
import {
  createS3StorageProvider,
  isAthenaS3ObjectClient,
} from "../../storage/runtime/providers/s3-provider.ts";
import { ATHENA_LOCAL_OBJECT_STORE } from "../../storage/runtime.ts";
import {
  ATHENA_STORAGE_PROVIDER,
  ATHENA_STORAGE_RUNTIME,
} from "../../storage/runtime/types.ts";
import { AthenaConfigurationError } from "../../config/errors.ts";
import type { AthenaRuntimePlan } from "../plan/types.ts";
import type {
  AthenaRuntimeConfigBindings,
  AthenaStorageRuntimeResources,
} from "../construction/types.ts";

export interface AthenaMaterializedStorage {
  readonly bindings: Pick<AthenaRuntimeConfigBindings<never>, "storage">;
}

function bindingFor(
  provider: NonNullable<AthenaStorageRuntimeResources["existingProvider"]>,
  resources: AthenaStorageRuntimeResources,
): AthenaMaterializedStorage {
  const runtime =
    resources.existingRuntime ??
    createStorageRuntime({
      lifecycle: resources.lifecycle,
      provider,
    });
  return {
    bindings: {
      storage: {
        ...(resources.existingLocalStore
          ? { [ATHENA_LOCAL_OBJECT_STORE]: resources.existingLocalStore }
          : {}),
        [ATHENA_STORAGE_PROVIDER]: provider,
        [ATHENA_STORAGE_RUNTIME]: runtime,
      },
    },
  };
}

function materializeStorageBinding(
  plan: AthenaRuntimePlan,
  resources: AthenaStorageRuntimeResources,
): AthenaMaterializedStorage {
  if (plan.storage.transport === "local") {
    if (!plan.storage.root) {
      throw new AthenaConfigurationError(
        "ATHENA_RUNTIME_CONFIG_INVALID",
        'storage.provider "local" requires a filesystem root.',
        "storage",
      );
    }
    const store =
      resources.existingLocalStore ??
      createLocalStorageModule({
        prefix: plan.storage.prefix,
        root: plan.storage.root,
      });
    const provider =
      resources.existingProvider ?? createLocalStorageProvider(store);
    return bindingFor(provider, { ...resources, existingLocalStore: store });
  }

  if (plan.storage.transport === "r2") {
    if (!resources.r2) {
      throw new AthenaConfigurationError(
        "ATHENA_RUNTIME_CONFIG_INVALID",
        'storage provider "r2" requires an injected R2 binding.',
        "storage",
      );
    }
    const provider =
      resources.existingProvider ??
      createR2StorageProvider(resources.r2, plan.storage.prefix);
    return bindingFor(provider, resources);
  }

  if (plan.storage.transport === "s3") {
    if (
      !plan.storage.bucket ||
      !resources.s3 ||
      !isAthenaS3ObjectClient(resources.s3)
    ) {
      throw new AthenaConfigurationError(
        "ATHENA_RUNTIME_CONFIG_INVALID",
        'storage.provider "s3" requires a bucket and an injected S3 object client (getObject/putObject/headObject/deleteObject/listObjectsV2).',
        "storage",
      );
    }
    const provider =
      resources.existingProvider ??
      createS3StorageProvider({
        bucket: plan.storage.bucket,
        prefix: plan.storage.prefix,
        s3: resources.s3,
      });
    return bindingFor(provider, resources);
  }

  return { bindings: {} };
}

export function materializeStoragePlan(
  plan: AthenaRuntimePlan,
  resources: AthenaStorageRuntimeResources,
): AthenaMaterializedStorage {
  return materializeStorageBinding(plan, resources);
}

export { materializeStorageCompat as materializeStorage } from "../compat/materializers.ts";
