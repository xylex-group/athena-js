/**
 * Node/server Athena client entry.
 *
 * Re-exports the browser-safe client core (`./v3-client-core.ts`) and adds the
 * Node-only direct PostgreSQL materialization (`db.pgUri` → `pg` transport) on
 * top of the universal normalization pipeline.
 *
 * Browser-facing entries (`./browser.ts`, `./next/client.ts`,
 * `./react-native/client.ts`, `./tables/catalog.ts`) must import from
 * `./v3-client-core.ts` instead so `pg` / Node built-ins never enter the
 * browser dependency graph.
 */

import {
  athenaAuthConfig,
  isDisabledAthenaAuthConfig,
  isLocalAthenaAuthConfig,
  normalizeAthenaAuthConfig,
} from "./auth/config.ts";
import {
  attachAthenaClientInternals,
  getAthenaClientInternals,
} from "./runtime/client-internals.ts";
import { inferEmbeddedAuthMode, resolveAthenaRuntime } from "./runtime/resolve.ts";
import { ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT } from "./auth/capabilities.ts";
import { createAuthDatabaseFromRuntime } from "./auth/local/database.ts";
import { createAthenaAuthRuntime } from "./auth/local/runtime.ts";
import type { AthenaAuthServerBindings } from "./auth/types.ts";
import { createAthenaAuthProxyHandlers } from "./auth/http/proxy.ts";
import { createPostgresDirectCapabilities } from "./cloudflare/capabilities.ts";
import type { R2BucketLike } from "./cloudflare/types.ts";
import {
  ATHENA_PG_DIRECT_API_KEY,
  ATHENA_PG_DIRECT_BASE_URL,
} from "./postgres/constants.ts";
import type { AthenaPostgresPool } from "./postgres/driver.ts";
import {
  bindPostgresRuntime,
  createAthenaPostgresRuntime,
  getBoundPostgresRuntime,
} from "./postgres/owned-runtime.ts";
import {
  createPostgresDirectTransport,
  disposePostgresDirectTransport,
} from "./postgres/transport.ts";
import { catalogFromModels } from "./query/engine/index.ts";
import type { AthenaClientModelsInput } from "./schema/types.ts";
import {
  AthenaConfigurationError,
  type AthenaClient,
  type AthenaClientConfig,
  type AthenaClientConfigWithR2,
  type AthenaClientWithR2Storage,
  createClientWithNormalizer,
  hasRemoteAuthService,
  hasRemoteDbGatewayUrl,
  hasRemoteHttpServices,
  hasRemoteHttpStorage,
  isD1Binding,
  normalizeOptional,
  normalizeUniversalCreateClientConfig,
  resolveUnifiedRemoteRoot,
} from "./v3-client-core.ts";

export * from "./v3-client-core.ts";

/**
 * Wire `db.pgUri` into a direct PostgreSQL AthenaGatewayClient transport.
 * Runs after edge materialize so D1 wins only when selected; d1+pgUri is rejected.
 */
function materializePostgresBinding<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
  const pgUri = normalizeOptional(config.db?.pgUri);
  const borrowedPool = config.db?.pool;
  if (!(pgUri || borrowedPool)) {
    return config;
  }

  if (isD1Binding(config.db?.d1)) {
    throw new AthenaConfigurationError(
      "ATHENA_NO_SERVICE_CONFIGURED",
      "Athena cannot use db.d1 and db.pgUri together. Configure exactly one local DB binding, or set mode/prefer to select a single execution backend.",
      "db"
    );
  }

  // Explicit gateway mode keeps historical header-only pgUri routing on HTTP.
  const modeRaw =
    normalizeOptional(
      typeof config.mode === "string" ? config.mode : undefined
    ) ?? normalizeOptional(config.env?.ATHENA_EXECUTION_MODE);
  if (modeRaw) {
    const modeKey = modeRaw.trim().toLowerCase();
    if (
      modeKey === "gateway" ||
      modeKey === "http" ||
      modeKey === "remote" ||
      modeKey === "server"
    ) {
      return config;
    }
  }

  if (config.gatewayTransport) {
    return config;
  }

  const remoteRoot = resolveUnifiedRemoteRoot(config);
  const remoteServices = hasRemoteHttpServices(config);
  const remoteStorage = hasRemoteHttpStorage(config);
  const remoteAuth = hasRemoteAuthService(config);
  const postgresRuntime = createAthenaPostgresRuntime(
    borrowedPool
      ? { pool: borrowedPool as AthenaPostgresPool }
      : { connectionString: pgUri as string }
  );
  const gatewayTransport = createPostgresDirectTransport({
    relationCatalog: catalogFromModels(config.models),
    runtime: postgresRuntime,
  });
  bindPostgresRuntime(gatewayTransport, postgresRuntime);
  const next: AthenaClientConfig<TModels> = {
    ...config,
    gatewayTransport,
  };

  const explicitDbUrl = normalizeOptional(config.db?.url);
  const remoteDbGateway = hasRemoteDbGatewayUrl(config);
  next.db = {
    ...config.db,
    pgUri,
    // Prefer sentinel for pure local DB so resolveCore has urls.db without
    // implying a real HTTP gateway. Keep explicit/remote db.url when present.
    url:
      explicitDbUrl ??
      (remoteDbGateway ? undefined : ATHENA_PG_DIRECT_BASE_URL),
  };

  const explicitKey = normalizeOptional(config.key);
  if (explicitKey) {
    next.key = explicitKey;
  } else if (remoteServices) {
    next.key = undefined;
  } else {
    next.key = ATHENA_PG_DIRECT_API_KEY;
  }

  if (remoteRoot) {
    next.billing = {
      ...(config.billing ?? {}),
      url: normalizeOptional(config.billing?.url) ?? remoteRoot,
    };
  }

  if (!config.capabilities) {
    next.capabilities = createPostgresDirectCapabilities({
      authRemote: remoteAuth,
      findManyAst: true,
      flatCrud: true,
      query: true,
      relations: true,
      rpc: true,
      storageConfigured: remoteStorage,
    });
  }
  next.findManyAst = config.findManyAst ?? true;

  return next;
}

/**
 * Node/server normalization pipeline: universal pipeline + direct PostgreSQL
 * materialization. Only this entry (and modules importing it) may reach
 * `./postgres/transport.ts`.
 */
function normalizeNodeCreateClientConfig<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
  const next = inferEmbeddedAuthMode(
    normalizeUniversalCreateClientConfig(config)
  );
  if (
    isLocalAthenaAuthConfig(next.auth) &&
    !normalizeOptional(next.db?.pgUri)
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_LOCAL_DATABASE_REQUIRED",
      'auth.mode "local" requires db.pgUri (DATABASE_URL). The TypeScript Athena Auth runtime talks to PostgreSQL directly.',
      "auth"
    );
  }
  return materializePostgresBinding(next);
}

function attachRemoteAuthHandlers<TClient extends { auth: unknown }>(
  client: TClient,
  config: AthenaClientConfig<AthenaClientModelsInput | undefined>
): TClient {
  if (
    isDisabledAthenaAuthConfig(config.auth) ||
    isLocalAthenaAuthConfig(config.auth)
  ) {
    return client;
  }
  const authObject = athenaAuthConfig(config.auth);
  const authUrl = normalizeOptional(authObject?.url);
  if (!(authUrl || authObject?.routing === "same-origin")) {
    return client;
  }
  const auth = client.auth as object;
  if (Object.hasOwn(auth, "handlers")) {
    return client;
  }
  Object.assign(auth, {
    handlers: createAthenaAuthProxyHandlers(() => ({ client })),
  });
  return client;
}

function rejectUnsupportedEmbeddedAuthFeatures(auth: unknown): void {
  if (!auth || typeof auth !== "object") {
    return;
  }
  const raw = auth as Record<string, unknown>;
  if (raw.passkeys || raw.webauthn) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_FEATURE_UNSUPPORTED",
      "Embedded Athena Auth does not implement WebAuthn/passkeys. Use dedicated Athena Auth (auth.url) or omit the option.",
      "auth"
    );
  }
  if (raw.oauth || raw.social || raw.socialProviders) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_FEATURE_UNSUPPORTED",
      "Embedded Athena Auth does not implement OAuth/social. Use dedicated Athena Auth (auth.url) — no JS-only OAuth stack.",
      "auth"
    );
  }
  if (raw.grants) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_FEATURE_UNSUPPORTED",
      "Embedded Athena Auth does not implement grants. Map authorization to athena.policy / athena-rights, or use dedicated Athena Auth (auth.url).",
      "auth"
    );
  }
}

function attachLocalAuthRuntime<TClient extends { auth: unknown }>(
  client: TClient,
  config: AthenaClientConfig<AthenaClientModelsInput | undefined>
): TClient {
  if (isDisabledAthenaAuthConfig(config.auth)) {
    return client;
  }
  if (!isLocalAthenaAuthConfig(config.auth)) {
    return attachRemoteAuthHandlers(client, config);
  }
  rejectUnsupportedEmbeddedAuthFeatures(athenaAuthConfig(config.auth));
  const pgUri = normalizeOptional(config.db?.pgUri);
  const postgresRuntime =
    getBoundPostgresRuntime(config.gatewayTransport) ??
    (pgUri
      ? createAthenaPostgresRuntime({ connectionString: pgUri })
      : undefined);
  if (!postgresRuntime) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_LOCAL_DATABASE_REQUIRED",
      'auth.mode "local" requires db.pgUri (DATABASE_URL).',
      "auth"
    );
  }
  if (config.gatewayTransport) {
    bindPostgresRuntime(config.gatewayTransport, postgresRuntime);
  }
  const normalized = normalizeAthenaAuthConfig(config.auth);
  const runtime = createAthenaAuthRuntime({
    autoMigrate: normalized.autoMigrate,
    config: normalized,
    database: createAuthDatabaseFromRuntime(postgresRuntime),
    secret: normalized.secret,
  });
  const server: AthenaAuthServerBindings = {
    handle: (request) => runtime.handle(request),
    handlers: runtime.handlers,
    migrate: () => runtime.migrate(),
  };
  Object.assign(client.auth as object, {
    handlers: runtime.handlers,
    server,
  });
  const capabilities = (
    client.auth as {
      capabilities?: {
        set: (next: typeof ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT) => void;
      };
    }
  ).capabilities;
  capabilities?.set(ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT);
  attachAthenaClientInternals(client, {
    authRuntime: runtime,
    config: config as AthenaClientConfig,
    gatewayTransport: config.gatewayTransport,
    getAuthStores: () => runtime.getStores(),
    plan: resolveAthenaRuntime(config, {
      environment: "node",
      trustedNode: true,
    }),
    postgresRuntime,
    source: "root",
  });
  return client;
}

/**
 * Materialize an Athena client (single public constructor).
 *
 * Node/server runtime: in addition to the universal pipeline, `db.pgUri`
 * selects the direct PostgreSQL transport backed by `pg`.
 */
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
  config:
    | (AthenaClientConfig<TModels> & { r2: R2BucketLike })
    | AthenaClientConfigWithR2<TModels>
): AthenaClientWithR2Storage<TModels>;
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaClientConfig<TModels>): AthenaClient<TModels>;
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
  config: AthenaClientConfig<TModels>
): AthenaClient<TModels> | AthenaClientWithR2Storage<TModels> {
  // Nuclear casts: see v3-client-core createClient (TS2589).
  const factory = createClientWithNormalizer as unknown as (
    input: unknown,
    normalizer: (c: unknown) => unknown
  ) => unknown;
  const resolved = normalizeNodeCreateClientConfig(config);
  const client: unknown = factory(resolved, (next: unknown) => next);
  const withAuth = attachLocalAuthRuntime(
    client as AthenaClient<TModels>,
    resolved
  );
  const existing = getAthenaClientInternals(withAuth);
  const postgresRuntime =
    existing?.postgresRuntime ??
    getBoundPostgresRuntime(resolved.gatewayTransport);
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await existing?.authRuntime?.close();
    if (resolved.gatewayTransport) {
      await disposePostgresDirectTransport(resolved.gatewayTransport);
    }
    await postgresRuntime?.close();
  };
  attachAthenaClientInternals(withAuth, {
    authRuntime: existing?.authRuntime,
    close,
    config: resolved as AthenaClientConfig,
    gatewayTransport: resolved.gatewayTransport,
    getAuthStores: existing?.getAuthStores,
    plan: resolveAthenaRuntime(resolved, {
      environment: "node",
      trustedNode: true,
    }),
    postgresRuntime,
    source: "root",
  });
  return withAuth as AthenaClient<TModels> | AthenaClientWithR2Storage<TModels>;
}
