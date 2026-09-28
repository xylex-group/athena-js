import { resolveBillingWebhookApplicationId } from "../../billing/ingestion/application-id.ts";
import type { AthenaBillingConfig } from "../../billing/create-client-config.ts";
import type { AthenaClientConfig } from "../../client/contracts.ts";
import {
  hasRemoteAuthService,
  hasRemoteDbGatewayUrl,
  hasRemoteHttpServices,
  hasRemoteHttpStorage,
  normalizeOptional,
  resolveUnifiedRemoteRoot,
} from "../../client/config/predicates.ts";
import {
  ATHENA_ENV_API_KEY_KEYS,
} from "../../env/index.ts";
import type { AthenaClientModelsInput } from "../../schema/types.ts";
import {
  getStorageProvider,
  getStorageRuntime,
} from "../../storage/runtime/index.ts";
import {
  getLocalObjectStore as getLocalObjectStoreMarker,
  isS3StorageConfig,
} from "../../storage/runtime.ts";
import { isAthenaS3ObjectClient } from "../../storage/runtime/providers/s3-provider.ts";
import type { AthenaRuntimePlan } from "../plan/types.ts";
import type {
  AthenaRuntimeResources,
  ResolvedAthenaConstruction,
} from "./types.ts";
import { AthenaConfigurationError } from "../../config/errors.ts";

function firstEnv(
  env: Record<string, string | undefined> | undefined,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = normalizeOptional(env?.[key]);
    if (value) {
      return value;
    }
  }
  return;
}

function modeIsGateway<TModels extends AthenaClientModelsInput | undefined>(
  config: AthenaClientConfig<TModels>,
): boolean {
  const mode = normalizeOptional(
    typeof config.mode === "string" ? config.mode : undefined,
  )?.toLowerCase();
  return (
    mode === "gateway" ||
    mode === "http" ||
    mode === "remote" ||
    mode === "server"
  );
}

function billingApiKey<TModels extends AthenaClientModelsInput | undefined>(
  config: AthenaClientConfig<TModels>,
): string {
  return (
    normalizeOptional(config.key) ??
    firstEnv(config.env, ATHENA_ENV_API_KEY_KEYS) ??
    ""
  );
}

export function resolveAthenaConstruction<
  TModels extends AthenaClientModelsInput | undefined,
>(
  config: AthenaClientConfig<TModels>,
  plan: AthenaRuntimePlan,
): ResolvedAthenaConstruction<TModels> {
  const storage = config.storage;
  const chat =
    config.chat && typeof config.chat === "object" ? config.chat : undefined;
  const billing = config.billing as AthenaBillingConfig | undefined;
  const db = config.db;
  if (plan.db.transport === "sqlite") {
    const candidate = db?.sqlite?.executor;
    const capabilities = candidate?.capabilities;
    if (
      !candidate ||
      typeof candidate.execute !== "function" ||
      typeof candidate.transaction !== "function" ||
      !capabilities ||
      typeof capabilities.interrupt !== "boolean" ||
      typeof capabilities.returning !== "boolean" ||
      typeof capabilities.savepoints !== "boolean" ||
      !["none", "batch", "interactive"].includes(capabilities.transactions)
    ) {
      throw new AthenaConfigurationError(
        "ATHENA_RUNTIME_CONFIG_INVALID",
        "db.sqlite.executor must provide execute(), transaction(), and explicit capability metadata.",
        "db",
      );
    }
  }
  const gatewayTransport = config.gatewayTransport;
  const remoteRoot = resolveUnifiedRemoteRoot(config);
  const pgUri = plan.db.pgUri;
  const resolvedPlan: ResolvedAthenaConstruction<TModels>["plan"] = {
    ...plan,
    auth: { ...plan.auth, config: config.auth },
    billing: {
      ...plan.billing,
      apiKey: billingApiKey(config),
      applicationId: resolveBillingWebhookApplicationId({
        app: config.app,
        client: config.client,
      }),
      appUrl: normalizeOptional(config.app?.url),
      catalog: billing?.catalog,
      client: config.client,
      providers: billing?.providers,
      customerImport: billing?.import,
      headers: {
        ...(config.headers ?? {}),
        ...(billing?.headers ?? {}),
      },
      ingestion: billing?.ingestion,
      mode: billing?.mode,
      observability: billing?.observability,
      selfEnrollment: billing?.selfEnrollment,
      testMode: billing?.testMode,
    },
    chat: {
      ...plan.chat,
      auth: config.auth,
      callOptions: chat,
      clusterUrl: normalizeOptional(config.url),
      context: config.context,
      databaseUrl: pgUri,
    },
    db: {
      ...plan.db,
      capabilities: config.capabilities,
      findManyAst: config.findManyAst,
      hasRemoteAuth: hasRemoteAuthService<TModels>(config),
      hasRemoteDbGateway: hasRemoteDbGatewayUrl<TModels>(config),
      hasRemoteServices: hasRemoteHttpServices<TModels>(config),
      hasRemoteStorage: hasRemoteHttpStorage<TModels>(config),
      modeIsGateway: modeIsGateway(config),
      models: config.models,
      remoteRoot,
      requestedKey: normalizeOptional(config.key),
    },
    storage: {
      ...plan.storage,
      bucket: normalizeOptional(storage?.bucket),
      prefix: normalizeOptional(storage?.prefix),
      root: normalizeOptional(storage?.root),
    },
  };
  const resources: AthenaRuntimeResources = {
    auth: {},
    billing: {},
    chat: {
      existingRuntime: config.chatRuntime,
    },
    db: {
      gatewayTransport,
      pool: db?.pool as AthenaRuntimeResources["db"]["pool"],
      sqliteExecutor: db?.sqlite?.executor,
      sqliteCompiler: db?.sqlite?.compiler,
    },
    storage: {
      existingLocalStore: getLocalObjectStoreMarker(storage),
      existingProvider: getStorageProvider(storage),
      existingRuntime: getStorageRuntime(storage),
      lifecycle: config.lifecycle?.storage,
      r2: storage?.r2,
      s3:
        isS3StorageConfig(storage) && isAthenaS3ObjectClient(storage.s3)
          ? storage.s3
          : undefined,
    },
  };
  return { plan: resolvedPlan, resources };
}
