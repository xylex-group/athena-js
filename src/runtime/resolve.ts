/**
 * Internal Athena runtime plan.
 *
 * One pipeline owns environment + bindings + explicit intent + defaults.
 * `createClient` materializes from this plan; the snapshot is not a public
 * config surface.
 */

import { athenaAuthConfig } from "../auth/config.ts";
import { resolveChatMode } from "../chat/config.ts";
import type { AthenaChatConfig } from "../chat/types.ts";
import { AthenaConfigurationError } from "../config/errors.ts";

function normalizeOptional(
  value: string | null | undefined
): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

interface ResolveAuthInput {
  mode?: string;
  url?: string | null;
}

export interface ResolveConfigInput {
  auth?: false | ResolveAuthInput | null;
  billing?: {
    endpoint?: string | null;
    mode?: string | null;
    providers?: Record<string, unknown> | null;
    url?: string | null;
  };
  chat?: boolean | AthenaChatConfig;
  databaseUrl?: string | null;
  db?: {
    d1?: unknown;
    pgUri?: string | null;
    pool?: unknown;
    sqlite?: unknown;
    url?: string | null;
  };
  env?: Record<string, string | undefined>;
  mode?: string | null;
  storage?: {
    bucket?: string | null;
    prefix?: string | null;
    provider?: string | null;
    r2?: unknown;
    root?: string | null;
    s3?: unknown;
    url?: string | null;
  };
  url?: string | null;
}

export type AthenaRuntimeEnvironment =
  | "node"
  | "browser"
  | "react-native"
  | "cloudflare";

export type AthenaDbTransport = "postgres" | "gateway" | "d1" | "sqlite";
export type AthenaAuthRuntime = "embedded" | "remote" | "disabled";
export type AthenaStorageTransport = "http" | "r2" | "local" | "s3" | "none";
export type AthenaChatTransport = "local" | "remote" | "none";

export interface ResolvedAthenaRuntime {
  auth: { runtime: AthenaAuthRuntime };
  chat: { transport: AthenaChatTransport };
  db: { transport: AthenaDbTransport };
  runtime: { environment: AthenaRuntimeEnvironment };
  storage: { transport: AthenaStorageTransport };
}

/** Redacted public snapshot. Not a config surface. */
export interface AthenaRuntimeDiagnostics {
  auth: AthenaAuthRuntime;
  chat: AthenaChatTransport;
  database: "postgres-direct" | "gateway" | "d1" | "sqlite-local";
  runtime: AthenaRuntimeEnvironment;
  storage: AthenaStorageTransport;
}

export function toAthenaRuntimeDiagnostics(
  plan: ResolvedAthenaRuntime
): AthenaRuntimeDiagnostics {
  return {
    auth: plan.auth.runtime,
    chat: plan.chat.transport,
    database:
      plan.db.transport === "postgres"
        ? "postgres-direct"
        : plan.db.transport === "sqlite"
          ? "sqlite-local"
          : plan.db.transport,
    runtime: plan.runtime.environment,
    storage: plan.storage.transport,
  };
}

export interface ResolveAthenaRuntimeOptions {
  environment?: AthenaRuntimeEnvironment;
  trustedNode?: boolean;
}

function hasBinding(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** Same URI inputs as folding: nested pgUri, then databaseUrl, then DATABASE_URL. */
export function resolveDatabaseUri(
  config: ResolveConfigInput
): string | undefined {
  return (
    normalizeOptional(config.db?.pgUri) ??
    normalizeOptional(config.databaseUrl) ??
    normalizeOptional(config.env?.DATABASE_URL)
  );
}

function isExplicitGatewayMode(
  mode: unknown,
  env?: Record<string, string | undefined>
): boolean {
  const raw =
    (typeof mode === "string" ? mode : undefined) ?? env?.ATHENA_EXECUTION_MODE;
  const key = raw?.trim().toLowerCase();
  return (
    key === "gateway" || key === "http" || key === "remote" || key === "server"
  );
}

export function detectAthenaRuntimeEnvironment(): AthenaRuntimeEnvironment {
  const nav = (
    globalThis as { navigator?: { product?: string; userAgent?: string } }
  ).navigator;
  if (nav?.product === "ReactNative") {
    return "react-native";
  }
  if (
    typeof nav?.userAgent === "string" &&
    /Cloudflare-Workers/i.test(nav.userAgent)
  ) {
    return "cloudflare";
  }
  if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
    return "browser";
  }
  return "node";
}

/**
 * Trusted Node/server only: omitted auth.mode + database input (`db.pgUri`,
 * `databaseUrl`, `env.DATABASE_URL`, or `db.pool`) + no auth.url means
 * embedded Auth. Explicit mode and auth.url always win. `auth: false` stays
 * disabled.
 */
export function inferEmbeddedAuthMode<T extends ResolveConfigInput>(
  config: T
): T {
  if (config.auth === false) {
    return { ...config, auth: false };
  }
  const authObject = athenaAuthConfig(
    config.auth as false | Record<string, unknown> | null | undefined
  );
  const explicit = authObject?.mode;
  if (explicit === "local" || explicit === "remote") {
    return config;
  }
  if (normalizeOptional(authObject?.url as string | null | undefined)) {
    return config;
  }
  if (!resolveDatabaseUri(config) && !hasBinding(config.db?.pool)) {
    return config;
  }
  return {
    ...config,
    auth: {
      ...authObject,
      mode: "local",
    },
  };
}

export function resolveAthenaRuntime(
  config: ResolveConfigInput,
  options: ResolveAthenaRuntimeOptions = {}
): ResolvedAthenaRuntime {
  const environment = options.environment ?? detectAthenaRuntimeEnvironment();
  const trustedNode = options.trustedNode ?? environment === "node";
  const pgUri = resolveDatabaseUri(config);
  const hasPool = hasBinding(config.db?.pool);
  const chatMode = resolveChatMode({
    chat: config.chat,
    clusterUrl: config.url,
    databaseUrl: pgUri,
  });
  const hasD1 = hasBinding(config.db?.d1);
  const hasSqlite = hasBinding(config.db?.sqlite);
  const hasR2 = hasBinding(config.storage?.r2);
  const hasStorageUrl = Boolean(normalizeOptional(config.storage?.url));
  const gatewayForced = isExplicitGatewayMode(config.mode, config.env);

  let dbTransport: AthenaDbTransport = "gateway";
  if (hasD1 && !gatewayForced) {
    dbTransport = "d1";
  } else if (hasSqlite && !gatewayForced) {
    dbTransport = "sqlite";
  } else if ((pgUri || hasPool) && trustedNode && !gatewayForced) {
    dbTransport = "postgres";
  }

  let authRuntime: AthenaAuthRuntime = "remote";
  if (config.auth === false) {
    authRuntime = "disabled";
  } else {
    const authObject = athenaAuthConfig(
      config.auth as false | Record<string, unknown> | null | undefined
    );
    const explicit = authObject?.mode;
    const authUrl =
      typeof authObject?.url === "string" ? authObject.url : undefined;
    if (explicit === "local") {
      if (!trustedNode) {
        throw new AthenaConfigurationError(
          "ATHENA_AUTH_LOCAL_NODE_REQUIRED",
          'auth.mode "local" requires a Node.js server runtime. Import createClient from @xylex-group/athena in a server module, or use auth.mode "remote".',
          "auth"
        );
      }
      authRuntime = "embedded";
    } else if (explicit === "remote" || normalizeOptional(authUrl)) {
      authRuntime = "remote";
    } else if ((pgUri || hasPool) && trustedNode) {
      authRuntime = "embedded";
    }
  }

  const wantsLocalStorage = config.storage?.provider === "local";
  if (wantsLocalStorage && !trustedNode) {
    throw new AthenaConfigurationError(
      "ATHENA_STORAGE_LOCAL_NODE_REQUIRED",
      'storage.provider "local" requires a Node.js server runtime. Import createClient from @xylex-group/athena in a server module.',
      "storage"
    );
  }
  const wantsS3Storage = config.storage?.provider === "s3";
  if (wantsS3Storage && !trustedNode) {
    throw new AthenaConfigurationError(
      "ATHENA_STORAGE_S3_NODE_REQUIRED",
      'storage.provider "s3" requires a Node.js server runtime. Import createClient from @xylex-group/athena in a server module.',
      "storage"
    );
  }

  let storageTransport: AthenaStorageTransport = "none";
  if (wantsLocalStorage) {
    storageTransport = "local";
  } else if (hasR2) {
    storageTransport = "r2";
  } else if (wantsS3Storage) {
    storageTransport = "s3";
  } else if (hasStorageUrl) {
    storageTransport = "http";
  }

  return {
    auth: { runtime: authRuntime },
    chat: {
      transport: chatMode === "disabled" ? "none" : chatMode,
    },
    db: { transport: dbTransport },
    runtime: { environment },
    storage: { transport: storageTransport },
  };
}
