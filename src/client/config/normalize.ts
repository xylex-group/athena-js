/**
 * Browser-safe universal createClient normalization.
 *
 * This module owns aliases, execution-mode selection, and host-safe binding
 * materialization. Node-only runtime materialization remains in v3-client.ts.
 */

import {
  isLocalAthenaAuthConfig,
} from "../../auth/config.ts";
import {
  createCloudflareEdgeCapabilities,
  createGatewayCapabilities,
} from "../../cloudflare/capabilities.ts";
import { createCloudflareD1GatewayTransport } from "../../cloudflare/d1/transport.ts";
import {
  type AthenaClientConfig,
} from "../contracts.ts";
import {
  CLOUDFLARE_EDGE_API_KEY,
  CLOUDFLARE_EDGE_BASE_URL,
} from "../../cloudflare/types.ts";
import { AthenaConfigurationError } from "../../config/errors.ts";
import {
  ATHENA_ENV_DB_URL_KEYS,
} from "../../env/index.ts";
import { catalogFromModels } from "../../query/engine/index.ts";
import {
  type AthenaExecutionMode,
  resolveAthenaExecutionMode,
} from "../../cloudflare/execution-mode.ts";
import {
  isLocalStorageConfig,
  isS3StorageConfig,
} from "../../storage/runtime.ts";
import type { AthenaClientModelsInput } from "../../schema/types.ts";
import {
  hasRemoteAuthService,
  hasRemoteDbGatewayUrl,
  hasRemoteHttpServices,
  hasRemoteHttpStorage,
  isD1Binding,
  isR2Binding,
  normalizeOptional,
  resolveUnifiedRemoteRoot,
} from "./predicates.ts";
import { materializeSqliteLocal } from "../../sqlite-local/materialize.ts";

function readFirstEnv(
  env: Record<string, string | undefined> | undefined,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = normalizeOptional(env?.[key]);
    if (value) {
      return value;
    }
  }
}

function foldBindingAliases<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
  const d1 = config.db?.d1 ?? config.d1;
  const r2 = config.storage?.r2 ?? config.r2;
  const sessionMode = config.db?.sessionMode ?? config.sessionMode;
  const prefix = config.storage?.prefix ?? config.storagePrefix;
  const aliasPgUri = normalizeOptional(config.databaseUrl);
  const nestedPgUri = normalizeOptional(config.db?.pgUri);
  const envPgUri = config.env
    ? normalizeOptional(config.env.DATABASE_URL)
    : undefined;
  if (aliasPgUri && nestedPgUri && aliasPgUri !== nestedPgUri) {
    throw new AthenaConfigurationError(
      "ATHENA_DATABASE_URL_CONFLICT",
      "databaseUrl and db.pgUri must be the same connection string when both are set.",
      "db",
    );
  }
  const pgUri = nestedPgUri ?? aliasPgUri ?? envPgUri;

  let next: AthenaClientConfig<TModels> = { ...config };
  if (d1 !== undefined || sessionMode !== undefined || pgUri !== undefined) {
    next = {
      ...next,
      db: {
        ...next.db,
        ...(d1 === undefined ? {} : { d1 }),
        ...(sessionMode === undefined ? {} : { sessionMode }),
        ...(pgUri === undefined ? {} : { pgUri }),
      },
    };
  }
  if (r2 !== undefined || prefix !== undefined) {
    next = {
      ...next,
      storage: {
        ...next.storage,
        ...(r2 === undefined ? {} : { r2 }),
        ...(prefix === undefined ? {} : { prefix }),
      },
    };
  }
  const {
    d1: _d1,
    r2: _r2,
    storagePrefix: _storagePrefix,
    sessionMode: _sessionMode,
    databaseUrl: _databaseUrl,
    ...rest
  } = next;
  void _d1;
  void _r2;
  void _storagePrefix;
  void _sessionMode;
  void _databaseUrl;
  return rest;
}

function applyExecutionMode<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
  const d1 = config.db?.d1;
  const hasD1 = isD1Binding(d1);
  const hasUrl = Boolean(
    normalizeOptional(config.url) ??
      normalizeOptional(config.db?.url) ??
      (config.env
        ? (normalizeOptional(config.env.ATHENA_URL) ??
          normalizeOptional(config.env.NEXT_PUBLIC_ATHENA_URL))
        : undefined),
  );
  const hasModeHint =
    config.mode != null ||
    config.prefer != null ||
    Boolean(config.env?.ATHENA_EXECUTION_MODE) ||
    Boolean(config.env?.ATHENA_EXECUTION_PREFER);

  if (!(hasD1 || hasModeHint)) {
    return config;
  }
  if (hasD1 && !hasUrl && !hasModeHint) {
    return config;
  }

  let resolved: AthenaExecutionMode | "edge" | "gateway";
  try {
    resolved = resolveAthenaExecutionMode({
      d1: hasD1 ? d1 : null,
      env: config.env,
      mode: config.mode,
      prefer: config.prefer,
      url: config.url ?? config.db?.url,
    });
  } catch (error) {
    if (!hasModeHint) {
      return config;
    }
    const pgUri = normalizeOptional(config.db?.pgUri);
    if (pgUri && !hasD1) {
      const modeRaw =
        normalizeOptional(
          typeof config.mode === "string" ? config.mode : undefined,
        ) ?? normalizeOptional(config.env?.ATHENA_EXECUTION_MODE);
      const modeKey = modeRaw?.trim().toLowerCase();
      if (!modeKey || modeKey === "auto") {
        return config;
      }
    }
    throw error;
  }

  if (resolved === "gateway" && hasD1) {
    const hasOtherLocalDbAuthority =
      (config.db?.sqlite !== undefined && config.db?.sqlite !== null) ||
      normalizeOptional(config.db?.pgUri) !== undefined ||
      (config.db?.pool !== undefined && config.db?.pool !== null);
    if (hasOtherLocalDbAuthority) {
      throw new AthenaConfigurationError(
        "ATHENA_NO_SERVICE_CONFIGURED",
        "Athena cannot combine D1 with SQLite or PostgreSQL direct execution. Configure exactly one local database backend.",
        "db",
      );
    }
    const { d1: _drop, sessionMode: _sm, ...dbRest } = config.db ?? {};
    void _drop;
    void _sm;
    return {
      ...config,
      db: Object.keys(dbRest).length > 0 ? dbRest : undefined,
      gatewayTransport: undefined,
    };
  }
  return config;
}

function materializeEdgeBindings<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
  const d1 = config.db?.d1;
  const r2 = config.storage?.r2;
  const hasD1 = isD1Binding(d1);
  const hasR2 = isR2Binding(r2);
  if (!(hasD1 || hasR2)) {
    return config;
  }

  if (hasD1 && d1 && typeof d1.prepare !== "function") {
    throw new AthenaConfigurationError(
      "ATHENA_NO_SERVICE_CONFIGURED",
      "db.d1 must be a D1 binding with prepare().",
      "db",
    );
  }

  const remoteRoot = resolveUnifiedRemoteRoot(config);
  const remoteServices = hasRemoteHttpServices(config);
  const remoteStorage = hasRemoteHttpStorage(config);
  const remoteAuth = hasRemoteAuthService(config);
  const next: AthenaClientConfig<TModels> = { ...config };

  if (hasD1 && d1) {
    if (!config.gatewayTransport) {
      next.gatewayTransport = createCloudflareD1GatewayTransport({
        d1,
        defaultSessionMode: config.db?.sessionMode,
        relationCatalog: catalogFromModels(config.models),
      });
    }
    const explicitDbUrl = normalizeOptional(config.db?.url);
    const remoteDbGateway = hasRemoteDbGatewayUrl(config);
    next.db = {
      ...config.db,
      d1,
      url:
        explicitDbUrl ??
        (remoteDbGateway ? undefined : CLOUDFLARE_EDGE_BASE_URL),
    };
    const explicitKey = normalizeOptional(config.key);
    if (explicitKey) {
      next.key = explicitKey;
    } else if (remoteServices) {
      next.key = undefined;
    } else {
      next.key = CLOUDFLARE_EDGE_API_KEY;
    }
    if (remoteRoot) {
      next.billing = {
        ...(config.billing ?? {}),
        url: normalizeOptional(config.billing?.url) ?? remoteRoot,
      };
    }
    if (!config.capabilities) {
      next.capabilities = createCloudflareEdgeCapabilities({
        authRemote: remoteAuth,
        findManyAst: true,
        flatCrud: true,
        hasR2,
        hasRemoteStorage: remoteStorage,
        query: true,
        relations: true,
        rpc: false,
      });
    }
  } else if (hasR2 && r2) {
    if (
      !(
        remoteRoot ||
        normalizeOptional(config.db?.url) ||
        normalizeOptional(config.storage?.url) ||
        readFirstEnv(config.env, [
          "ATHENA_STORAGE_URL",
          "NEXT_PUBLIC_ATHENA_STORAGE_URL",
        ])
      )
    ) {
      next.storage = {
        ...config.storage,
        r2,
        url: CLOUDFLARE_EDGE_BASE_URL,
      };
      if (!remoteServices) {
        next.key = normalizeOptional(config.key) ?? CLOUDFLARE_EDGE_API_KEY;
      } else if (normalizeOptional(config.key)) {
        next.key = normalizeOptional(config.key);
      } else {
        next.key = undefined;
      }
    }
    if (!config.capabilities) {
      if (
        remoteRoot ||
        normalizeOptional(config.db?.url) ||
        readFirstEnv(config.env, ATHENA_ENV_DB_URL_KEYS)
      ) {
        const base = createGatewayCapabilities({
          authRemote: remoteAuth,
          storageBackups: remoteStorage,
          storageCatalogs: remoteStorage,
          storageConfigured: remoteStorage || hasR2,
        });
        next.capabilities = {
          ...base,
          storage: {
            ...base.storage,
            local: true,
            objects: true,
          },
        };
      } else {
        next.capabilities = {
          auth: { remote: remoteAuth },
          db: {
            engine: "unknown",
            layers: {
              findManyAst: false,
              flatCrud: false,
              query: false,
              relations: false,
              rpc: false,
            },
            local: false,
            transactions: {
              atomic: false,
              backend: "unsupported",
              deferrable: false,
              interactive: false,
              isolationLevels: [],
              readOnly: false,
              savepoints: false,
            },
          },
          mode: "cloudflare-edge",
          storage: {
            backups: remoteStorage,
            catalogs: remoteStorage,
            local: true,
            objects: true,
          },
        };
      }
    }
  }
  return next;
}

function isExplicitGatewayMode<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): boolean {
  const raw =
    (typeof config.mode === "string" ? config.mode : undefined) ??
    config.env?.ATHENA_EXECUTION_MODE;
  const mode = raw?.trim().toLowerCase();
  return (
    mode === "gateway" ||
    mode === "http" ||
    mode === "remote" ||
    mode === "server"
  );
}

/**
 * Universal createClient normalization pipeline: aliases → mode → edge.
 */
export function normalizeUniversalCreateClientConfig<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
  const next = materializeEdgeBindings(
    applyExecutionMode(foldBindingAliases(config)),
  );
  if (
    next.db?.sqlite &&
    !next.db.d1 &&
    !next.gatewayTransport &&
    !isExplicitGatewayMode(next)
  ) {
    const sqlite = materializeSqliteLocal(next.db.sqlite);
    return {
      ...next,
      capabilities: next.capabilities ?? sqlite.capabilities,
      gatewayTransport: sqlite.gatewayTransport,
      key: normalizeOptional(next.key) ?? sqlite.key,
      ...(sqlite.close ? { ownedResourceClose: sqlite.close } : {}),
    } as AthenaClientConfig<TModels>;
  }
  return next;
}

export const normalizeUniversalConfig = normalizeUniversalCreateClientConfig;

export function assertDirectPostgresRequiresNodeRuntime<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): void {
  if (
    normalizeOptional(config.db?.pgUri) ||
    normalizeOptional(config.databaseUrl) ||
    normalizeOptional(config.env?.DATABASE_URL) ||
    config.db?.pool
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_POSTGRES_DIRECT_NODE_REQUIRED",
      "databaseUrl / db.pgUri / db.pool direct PostgreSQL execution is not available in browser runtimes. Use an Athena HTTP gateway from the browser, or construct this client in a Node.js/server runtime.",
      "db",
    );
  }
}

export function assertLocalAuthRequiresNodeRuntime<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): void {
  if (isLocalAthenaAuthConfig(config.auth)) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_LOCAL_NODE_REQUIRED",
      'auth.mode "local" requires a Node.js server runtime. Import createClient from @xylex-group/athena in a server module, or use auth.mode "remote".',
      "auth",
    );
  }
}

export function assertLocalStorageRequiresNodeRuntime<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): void {
  if (isLocalStorageConfig(config.storage)) {
    throw new AthenaConfigurationError(
      "ATHENA_STORAGE_LOCAL_NODE_REQUIRED",
      'storage.provider "local" requires a Node.js server runtime. Import createClient from @xylex-group/athena in a server module.',
      "storage",
    );
  }
}

export function assertS3StorageRequiresNodeRuntime<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): void {
  if (isS3StorageConfig(config.storage)) {
    throw new AthenaConfigurationError(
      "ATHENA_STORAGE_S3_NODE_REQUIRED",
      'storage.provider "s3" requires a Node.js server runtime. Import createClient from @xylex-group/athena in a server module.',
      "storage",
    );
  }
}

export function assertLocalChatRequiresNodeRuntime<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): void {
  const chat = config.chat;
  const wantsLocal =
    chat === true ||
    (typeof chat === "object" && chat !== null && chat.mode === "local");
  if (wantsLocal || config.chatRuntime) {
    throw new AthenaConfigurationError(
      "ATHENA_CHAT_LOCAL_NODE_REQUIRED",
      'Local Chat requires a Node.js server runtime. Import createClient from @xylex-group/athena in a server module, or use chat.mode "remote".',
      "chat",
    );
  }
}
