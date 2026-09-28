import type { AthenaGatewayClient } from "../../gateway/client.ts";
import type { AthenaPostgresPool } from "../../postgres/driver.ts";
import type { AthenaPostgresRuntime } from "../../postgres/owned-runtime.ts";
import type { AthenaClientModelsInput } from "../../schema/types.ts";
import type { AthenaClientCapabilities } from "../../cloudflare/types.ts";
import type { AthenaStorageConfig } from "../../client/contracts.ts";
import type {
  AthenaStorageLifecycleHooks,
  StorageObjectProvider,
  StorageRuntime,
} from "../../storage/runtime/types.ts";
import { ATHENA_STORAGE_PROVIDER, ATHENA_STORAGE_RUNTIME } from "../../storage/runtime/types.ts";
import { ATHENA_LOCAL_OBJECT_STORE } from "../../storage/runtime.ts";
import type { AthenaStorageModule } from "../../storage/module.ts";
import type { AthenaS3ObjectClient } from "../../storage/runtime/providers/s3-provider.ts";
import type { AthenaRuntimePlan } from "../plan/types.ts";
import type { AthenaSqliteExecutor } from "../../sqlite-local/contracts.ts";
import type { AthenaCanonicalQueryCompiler } from "../../sqlite-local/compiler.ts";

export interface AthenaDatabaseRuntimeResources {
  readonly gatewayTransport?: AthenaGatewayClient;
  readonly pool?: AthenaPostgresPool;
  readonly sqliteExecutor?: AthenaSqliteExecutor;
  readonly sqliteCompiler?: AthenaCanonicalQueryCompiler;
}

export interface AthenaStorageRuntimeResources {
  readonly existingLocalStore?: AthenaStorageModule;
  readonly existingProvider?: StorageObjectProvider;
  readonly existingRuntime?: StorageRuntime;
  readonly lifecycle?: AthenaStorageLifecycleHooks;
  readonly r2?: AthenaStorageConfig["r2"];
  readonly s3?: AthenaS3ObjectClient;
}

export interface AthenaChatRuntimeResources {
  readonly existingRuntime?: import("../../chat/runtime.ts").AthenaChatRuntime;
}

export interface AthenaRuntimeResources {
  readonly auth: Record<never, never>;
  readonly billing: Record<never, never>;
  readonly chat: AthenaChatRuntimeResources;
  readonly db: AthenaDatabaseRuntimeResources;
  readonly storage: AthenaStorageRuntimeResources;
}

export interface ResolvedAthenaConstruction<
  TModels extends AthenaClientModelsInput | undefined,
> {
  readonly plan: AthenaRuntimePlan & {
    readonly db: AthenaRuntimePlan["db"] & { readonly models?: TModels };
  };
  readonly resources: AthenaRuntimeResources;
}

export interface AthenaStorageBindingPatch {
  readonly [ATHENA_LOCAL_OBJECT_STORE]?: AthenaStorageModule;
  readonly [ATHENA_STORAGE_PROVIDER]?: StorageObjectProvider;
  readonly [ATHENA_STORAGE_RUNTIME]?: StorageRuntime;
}

export interface AthenaRuntimeConfigBindings<TModels extends AthenaClientModelsInput | undefined> {
  readonly capabilities?: AthenaClientCapabilities;
  readonly chatRuntime?: import("../../chat/runtime.ts").AthenaChatRuntime;
  readonly db?: {
    readonly pgUri?: string;
    readonly url?: string;
  };
  readonly findManyAst?: boolean;
  readonly gatewayTransport?: AthenaGatewayClient;
  readonly key?: string;
  readonly storage?: AthenaStorageBindingPatch;
  readonly postgresRuntime?: AthenaPostgresRuntime;
  readonly models?: TModels;
}
