/**
 * Node/server Athena client entry.
 *
 * Construction: normalizeUniversalConfig → resolveRuntimePlan →
 * validateRuntimePlan → materializeRuntimePlan → assembleAthenaClient.
 * Node backends live in `src/runtime/materializers/`.
 *
 * Browser-facing entries (`./browser.ts`, `./next/client.ts`,
 * `./react-native/client.ts`, `./tables/catalog.ts`) must import from
 * `./v3-client-core.ts` instead so `pg` / Node built-ins never enter the
 * browser dependency graph.
 */

import { createEmbeddedCapabilitySnapshot } from "./auth/capabilities.ts";
import { resolveAthenaClientCapabilitiesIr } from "./capabilities/assembly.ts";
import { fingerprintAthenaCapabilitiesIr } from "./capabilities/ir/fingerprint.ts";
import {
  D1_QUERY_CAPABILITIES,
  GATEWAY_QUERY_CAPABILITIES,
  POSTGRES_QUERY_CAPABILITIES,
  SQLITE_LOCAL_QUERY_CAPABILITIES,
} from "./query/engine/capabilities.ts";
import {
  type AthenaPasskeyOnboardingOptions,
  athenaAuthConfig,
  isDisabledAthenaAuthConfig,
  isLocalAthenaAuthConfig,
  normalizeAthenaAuthConfig,
} from "./auth/config.ts";
import { assertLocalAuthHooks } from "./auth/hooks/assert-local.ts";
import type { AthenaAuthHooks } from "./auth/hooks/types.ts";
import { createAthenaAuthProxyHandlers } from "./auth/http/proxy.ts";
import { createAuthDatabaseFromRuntime } from "./auth/local/database.ts";
import { createEmbeddedAuthEmailTemplateStore } from "./auth/local/email/template-store.ts";
import { createAthenaAuthRuntime } from "./auth/local/runtime.ts";
import { advertisedSocialProviderIds } from "./auth/local/social/runtime.ts";
import { assertLocalAuthObservability } from "./auth/observability/config.ts";
import { normalizeSocialAuthConfig } from "./auth/social/node/social-config.ts";

import type { AthenaAuthServerBindings } from "./auth/types.ts";
import { resolveBillingWebhookApplicationId } from "./billing/ingestion/application-id.ts";
import { releaseEmbeddedBillingRuntimeOwner } from "./billing/runtime/local/process-ownership.ts";
import type { AthenaRootClient } from "./client-brands.ts";
import type { R2BucketLike } from "./cloudflare/types.ts";
import { createEmailDeliveryPort } from "./email/delivery-port.ts";
import { bindAthenaEmailTemplateStore } from "./email/module.ts";
import type {
  AthenaEmailModule,
} from "./email/types.ts";
import { createPostgresNotificationPreferenceStore } from "./notifications/postgres-store.ts";
import type { AthenaNotificationsModule } from "./notifications/types.ts";
import {
  bindPostgresRuntime,
  createAthenaPostgresRuntime,
  getBoundPostgresRuntime,
} from "./postgres/owned-runtime.ts";
import type { AthenaPostgresPool } from "./postgres/driver.ts";
import {
  attachAthenaClientInternals,
  createRootClientInternals,
  getAthenaClientInternals,
  requireAthenaRootClientInternals,
} from "./runtime/client-internals.ts";
import { rolesIrFromAuthorizationGraph } from "./runtime/authorization/state.ts";
import { normalizeAthenaAuthorizationConfig } from "./runtime/authorization/normalize-config.ts";
import { createAthenaAuthorizationModelIndex } from "./runtime/authorization/model-index.ts";
import { assertDataLifecycleConfig } from "./runtime/data/lifecycle/assert.ts";
import { bootstrapLocalBillingRuntime } from "./runtime/materializers/billing.ts";
import { disposeMaterializedDatabase } from "./runtime/materializers/database.ts";
import {
  createAthenaClientLifecycle,
  recordAuthRuntimeCreated,
} from "./runtime/ownership.ts";
import {
  type AthenaMaterializedRuntime,
  materializeRuntimePlan,
} from "./runtime/plan/materialize.ts";
import { resolveAthenaConstruction } from "./runtime/construction/resolve.ts";
import type { AthenaRuntimeConfigBindings } from "./runtime/construction/types.ts";
import { normalizeUniversalConfig } from "./runtime/plan/normalize.ts";
import { resolveRuntimePlan } from "./runtime/plan/resolve.ts";
import { toResolvedAthenaRuntime } from "./runtime/plan/types.ts";
import { validateRuntimePlan } from "./runtime/plan/validate.ts";
import { inferEmbeddedAuthMode } from "./runtime/resolve.ts";
import type { AthenaClientModelsInput } from "./schema/types.ts";
import {
  createStorageRuntime,
  getStorageProvider,
  getStorageRuntime,
} from "./storage/runtime/index.ts";
import {
  createClientWithNormalizer,
  type AthenaClient,
  type AthenaClientConfig,
  type AthenaClientConfigWithR2,
  type AthenaClientWithR2Storage,
} from "./client/create-client.ts";
import { replaceClientNotificationPreferenceStore } from "./client/compose/notifications.ts";
import { normalizeOptional } from "./client/config/predicates.ts";
import { AthenaConfigurationError } from "./config/errors.ts";

export type {
  AthenaRequestClient,
  AthenaRequestClientBrand,
  AthenaRootClient,
  AthenaRootClientBrand,
} from "./client-brands.ts";
export * from "./v3-client-core.ts";

type EmbeddedAuthRuntimeConfigSlice = {
  hooks?: AthenaAuthHooks;
  passkey?: {
    onboarding?: boolean | AthenaPasskeyOnboardingOptions;
  };
};

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
  for (const key of ["oauth", "social", "socialProviders"] as const) {
    const value = raw[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new AthenaConfigurationError(
        "ATHENA_RUNTIME_CONFIG_INVALID",
        `auth.${key} must be an object provider map, not ${value === true ? "true" : typeof value}.`,
        "auth"
      );
    }
  }
  if (raw.grants) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_FEATURE_UNSUPPORTED",
      "Embedded Athena Auth does not implement grants. Map authorization to athena.policy / athena-rights, or use dedicated Athena Auth (auth.url).",
      "auth"
    );
  }
  const emailBag = raw.email;
  if (emailBag && typeof emailBag === "object" && !Array.isArray(emailBag)) {
    const nested = emailBag as Record<string, unknown>;
    if ("provider" in nested || "smtp" in nested || "resend" in nested) {
      throw new AthenaConfigurationError(
        "ATHENA_AUTH_FEATURE_UNSUPPORTED",
        "Auth does not own email transport. Configure createClient({ email: { provider } }) and inject the root email module into local Auth.",
        "auth"
      );
    }
  }
}

const AUTH_RUNTIME_CACHE = Symbol.for("@xylex-group/athena.authRuntimes");

function authRuntimeCache(): WeakMap<
  object,
  ReturnType<typeof createAthenaAuthRuntime>
> {
  const holder = globalThis as typeof globalThis & {
    [AUTH_RUNTIME_CACHE]?: WeakMap<
      object,
      ReturnType<typeof createAthenaAuthRuntime>
    >;
  };
  holder[AUTH_RUNTIME_CACHE] ??= new WeakMap();
  return holder[AUTH_RUNTIME_CACHE];
}

function attachLocalAuthRuntime<
  TClient extends { auth: unknown; email: AthenaEmailModule },
>(
  client: TClient,
  config: AthenaClientConfig<AthenaClientModelsInput | undefined>,
  plan = resolveRuntimePlan(config, {
    environment: "node",
    trustedNode: true,
  })
): TClient {
  if (isDisabledAthenaAuthConfig(config.auth)) {
    return client;
  }
  if (!isLocalAthenaAuthConfig(config.auth)) {
    assertLocalAuthHooks(athenaAuthConfig(config.auth));
    assertLocalAuthObservability(athenaAuthConfig(config.auth));
    return attachRemoteAuthHandlers(client, config);
  }
  rejectUnsupportedEmbeddedAuthFeatures(athenaAuthConfig(config.auth));
  const pgUri = normalizeOptional(config.db?.pgUri);
  const postgresRuntime =
    getBoundPostgresRuntime(config.gatewayTransport) ??
    (pgUri
      ? createAthenaPostgresRuntime({ connectionString: pgUri })
      : config.db?.pool
        ? createAthenaPostgresRuntime({
            pool: config.db.pool as AthenaPostgresPool,
          })
      : undefined);
  if (!postgresRuntime) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_LOCAL_DATABASE_REQUIRED",
      'auth.mode "local" requires db.pgUri, databaseUrl, or db.pool.',
      "auth"
    );
  }
  if (config.gatewayTransport) {
    bindPostgresRuntime(config.gatewayTransport, postgresRuntime);
  }
  const normalized = {
    ...normalizeAthenaAuthConfig(config.auth, {
      app: config.app,
      env: config.env,
    }),
    social: normalizeSocialAuthConfig(
      (athenaAuthConfig(config.auth) ?? {}) as Record<string, unknown>
    ),
  };
  const delivery = createEmailDeliveryPort(client.email);
  const rawAuth = athenaAuthConfig(config.auth) as
    | EmbeddedAuthRuntimeConfigSlice
    | undefined;
  const hooks = rawAuth?.hooks;
  const passkeyOnboarding = rawAuth?.passkey?.onboarding;
  const cachedAuth = authRuntimeCache().get(postgresRuntime);
  if (cachedAuth) {
    if (cachedAuth.hooksRef !== hooks) {
      throw new AthenaConfigurationError(
        "ATHENA_AUTH_RUNTIME_CONFIG_CONFLICT",
        "Embedded Auth runtime is already cached for this PostgreSQL connection with a different auth.hooks object. Reuse the same hooks reference, or use a distinct database runtime.",
        "auth"
      );
    }
    cachedAuth.setDelivery(delivery);
  }
  const runtime =
    cachedAuth ??
    createAthenaAuthRuntime({
      autoMigrate: normalized.autoMigrate,
      config: normalized,
      database: createAuthDatabaseFromRuntime(postgresRuntime),
      delivery,
      emailDefaultsFrom: client.email.diagnostics.defaults.from,
      emailDefaultsFromName: client.email.diagnostics.defaults.fromName,
      hooks,
      passkeyOnboarding,
      secret: normalized.secret,
    });
  if (!cachedAuth) {
    authRuntimeCache().set(postgresRuntime, runtime);
    recordAuthRuntimeCreated();
  }
  bindAthenaEmailTemplateStore(
    client.email,
    createEmbeddedAuthEmailTemplateStore(runtime)
  );
  const server: AthenaAuthServerBindings = {
    handle: (request) => runtime.handle(request),
    handlers: runtime.handlers,
    migrate: () => {
      requireAthenaRootClientInternals(client, "auth.server.migrate");
      return runtime.migrate();
    },
  };
  Object.assign(client.auth as object, {
    handlers: runtime.handlers,
    server,
  });
  const capabilities = (
    client.auth as {
      capabilities?: {
        set: (
          next: ReturnType<typeof createEmbeddedCapabilitySnapshot>
        ) => void;
      };
    }
  ).capabilities;
  capabilities?.set(
    createEmbeddedCapabilitySnapshot({
      passkeyEnabled: normalized.passkey.enabled,
      passkeyOnboarding: normalized.passkey.onboardingEnabled,
      socialProviders: advertisedSocialProviderIds(normalized.social),
    })
  );
  attachAthenaClientInternals(
    client,
    createRootClientInternals({
      authRuntime: runtime,
      authorizationConfig: normalizeAthenaAuthorizationConfig(config),
      authorizationModelIndex: createAthenaAuthorizationModelIndex(
        normalizeAthenaAuthorizationConfig(config)
      ),
      config: config as AthenaClientConfig,
      gatewayTransport: config.gatewayTransport,
      getAuthStores: () => runtime.getStores(),
      getRolesIr: async () => {
        const stores = await runtime.getStores();
        const inspectGraph = stores.authorization.inspectGraph;
        if (!inspectGraph) {
          return;
        }
        const current = getAthenaClientInternals(client);
        if (!current?.rightsAuthority) {
          return;
        }
        return rolesIrFromAuthorizationGraph(
          await inspectGraph.call(stores.authorization),
          current.rightsAuthority
        );
      },
      plan: toResolvedAthenaRuntime(plan),
      postgresRuntime,
    })
  );
  return client;
}

function prepareNodeRuntimePlan<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): {
  config: AthenaClientConfig<TModels>;
  materialized: AthenaMaterializedRuntime<TModels>;
} {
  const next = inferEmbeddedAuthMode(normalizeUniversalConfig(config));
  rejectUnsupportedEmbeddedAuthFeatures(athenaAuthConfig(next.auth));
  assertLocalAuthHooks(athenaAuthConfig(next.auth));
  assertLocalAuthObservability(athenaAuthConfig(next.auth));
  if (
    isLocalAthenaAuthConfig(next.auth) &&
    !normalizeOptional(next.db?.pgUri) && !next.db?.pool
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_LOCAL_DATABASE_REQUIRED",
      'auth.mode "local" requires db.pgUri, databaseUrl, or db.pool. The TypeScript Athena Auth runtime talks to PostgreSQL directly.',
      "auth"
    );
  }
  const plan = resolveRuntimePlan(next, {
    environment: "node",
    trustedNode: true,
  });
  validateRuntimePlan(plan);
  const construction = resolveAthenaConstruction(next, plan);
  const materialized = materializeRuntimePlan(construction);
  return {
    config: applyRuntimeBindings(next, materialized.bindings),
    materialized,
  };
}

function applyRuntimeBindings<
  TModels extends AthenaClientModelsInput | undefined,
>(
  config: AthenaClientConfig<TModels>,
  bindings: AthenaRuntimeConfigBindings<TModels>,
): AthenaClientConfig<TModels> {
  return {
    ...config,
    ...(bindings.capabilities ? { capabilities: bindings.capabilities } : {}),
    ...(bindings.findManyAst === undefined
      ? {}
      : { findManyAst: bindings.findManyAst }),
    ...(bindings.gatewayTransport
      ? { gatewayTransport: bindings.gatewayTransport }
      : {}),
    ...(bindings.key === undefined ? {} : { key: bindings.key }),
    ...(bindings.db
      ? { db: { ...config.db, ...bindings.db } }
      : {}),
    ...(bindings.storage
      ? { storage: { ...config.storage, ...bindings.storage } }
      : {}),
    ...(bindings.chatRuntime
      ? { chatRuntime: bindings.chatRuntime }
      : {}),
  };
}

function attachLocalNotificationsRuntime(client: {
  notifications: AthenaNotificationsModule;
}): void {
  const internals = getAthenaClientInternals(client);
  const postgres = internals?.postgresRuntime;
  if (!postgres) {
    return;
  }
  replaceClientNotificationPreferenceStore(
    client,
    createPostgresNotificationPreferenceStore({
      query: async (text, values) => {
        const result = await postgres.query(text, values);
        return { rows: result.rows as Record<string, unknown>[] };
      },
      transaction: async (fn) =>
        postgres.transaction(async (tx) =>
          fn({
            query: async (text, values) => {
              const result = await tx.query(text, values);
              return { rows: result.rows as Record<string, unknown>[] };
            },
          })
        ),
    })
  );
}

function assembleAthenaClient<
  TModels extends AthenaClientModelsInput | undefined,
>(
  prepared: {
    config: AthenaClientConfig<TModels>;
    materialized: AthenaMaterializedRuntime<TModels>;
  },
):
  | AthenaRootClient<AthenaClient<TModels>>
  | AthenaRootClient<AthenaClientWithR2Storage<TModels>> {
  const { config: resolved, materialized } = prepared;
  // Nuclear casts: see v3-client-core createClient (TS2589).
  const factory = createClientWithNormalizer as unknown as (
    input: unknown,
    normalizer: (c: unknown) => unknown,
    runtimeBindings?: { billing?: unknown; billingRuntime?: unknown }
  ) => unknown;
  const client: unknown = factory(resolved, (next: unknown) => next, {
    billing: materialized.billing.module,
    ...(materialized.billing.kind === "local"
      ? { billingRuntime: materialized.billing.runtime }
      : {}),
  });
  const withAuth = attachLocalAuthRuntime(
    client as AthenaClient<TModels>,
    resolved,
    materialized.plan
  );
  const authorizationConfig = normalizeAthenaAuthorizationConfig(resolved);
  const authorizationModelIndex =
    createAthenaAuthorizationModelIndex(authorizationConfig);
  const existing = getAthenaClientInternals(withAuth);
  const billingProviderRegistry =
    existing?.billingProviderRegistry ??
    (materialized.billing.kind === "local"
      ? materialized.billing.registry
      : undefined);
  const postgresRuntime =
    existing?.postgresRuntime ??
    materialized.database.postgresRuntime ??
    getBoundPostgresRuntime(resolved.gatewayTransport);
  const lifecycle = existing?.lifecycle ?? createAthenaClientLifecycle();
  const provider = getStorageProvider(resolved.storage);
  const storageRuntime =
    existing?.storageRuntime ??
    getStorageRuntime(resolved.storage) ??
    (provider
      ? createStorageRuntime({
          lifecycle: resolved.lifecycle?.storage,
          provider,
        })
      : undefined);
  let capabilityStoreUnsubscribe: (() => void) | undefined;
  const close = async (): Promise<void> => {
    if (lifecycle.closed) {
      return;
    }
    lifecycle.closed = true;
    capabilityStoreUnsubscribe?.();
    const currentInternals = getAthenaClientInternals(withAuth);
    const ownerKey = currentInternals?.billingRuntimeOwnerKey;
    const generation = currentInternals?.billingRuntimeGeneration;
    if (ownerKey != null && generation != null) {
      await releaseEmbeddedBillingRuntimeOwner(ownerKey, generation);
    } else {
      currentInternals?.billingPlanChangeRecoveryScheduler?.cancel();
      await currentInternals?.billingPlanChangeRecoveryScheduler?.drain();
      for (const handle of currentInternals?.billingSchedulerHandles ?? []) {
        handle.cancel();
        await handle.drain();
      }
    }
    await existing?.authRuntime?.close();
    if (resolved.gatewayTransport) {
      await disposeMaterializedDatabase(resolved.gatewayTransport);
    }
    if (
      materialized.plan.db.transport === "sqlite" &&
      materialized.plan.db.ownership === "owned" &&
      materialized.database.sqliteExecutor?.close
    ) {
      await materialized.database.sqliteExecutor.close();
    }
    await postgresRuntime?.close();
  };
  attachAthenaClientInternals(
    withAuth,
    createRootClientInternals({
      authRuntime: existing?.authRuntime,
      authorizationConfig,
      authorizationModelIndex,
      billingProviderRegistry,
      close,
      config: resolved as AthenaClientConfig,
      gatewayTransport: resolved.gatewayTransport,
      getAuthStores: existing?.getAuthStores,
      getRolesIr: existing?.getRolesIr,
      lifecycle,
      plan: toResolvedAthenaRuntime(materialized.plan),
      postgresRuntime,
      rightsFingerprint: existing?.rightsFingerprint,
      rightsIr: existing?.rightsIr,
      rolesFingerprint: existing?.rolesFingerprint,
      rolesIr: existing?.rolesIr,
      runtimeOwnership:
        postgresRuntime?.ownership === "borrowed" ? "borrowed" : "owned",
      storageRuntime,
    })
  );
  if (materialized.billing.kind === "local") {
    bootstrapLocalBillingRuntime(withAuth, {
      applicationId: resolveBillingWebhookApplicationId({
        app: resolved.app,
        client: resolved.client,
      }),
      appUrl: resolved.app?.url,
      catalog: resolved.billing?.catalog,
      configuredProviders: resolved.billing?.providers,
      customerImport: resolved.billing?.import,
      ingestion: resolved.billing?.ingestion,
      mode: resolved.billing?.mode,
      observability: resolved.billing?.observability,
      registry: billingProviderRegistry,
      selfEnrollment: resolved.billing?.selfEnrollment,
      testMode: resolved.billing?.testMode,
      binding: materialized.billing,
    });
  }
  attachLocalNotificationsRuntime(withAuth);
  const assembledInternals = getAthenaClientInternals(withAuth);
  if (assembledInternals) {
    const query =
      materialized.plan.db.transport === "d1"
        ? D1_QUERY_CAPABILITIES
        : materialized.plan.db.transport === "postgres"
          ? POSTGRES_QUERY_CAPABILITIES
          : materialized.plan.db.transport === "sqlite"
            ? SQLITE_LOCAL_QUERY_CAPABILITIES
            : GATEWAY_QUERY_CAPABILITIES;
    const refreshCapabilities = (): void => {
      const authCapabilitiesAvailable =
        Boolean(existing?.authRuntime) ||
        Boolean(
          normalizeOptional(athenaAuthConfig(resolved.auth)?.url) ||
            athenaAuthConfig(resolved.auth)?.routing === "same-origin"
        );
      const capabilitiesIr = resolveAthenaClientCapabilitiesIr({
        base: withAuth.capabilities,
        query,
        auth:
          resolved.auth === undefined ||
          isDisabledAthenaAuthConfig(resolved.auth) ||
          materialized.plan.auth.runtime === "disabled" ||
          !authCapabilitiesAvailable
            ? undefined
            : withAuth.auth.capabilities.getSnapshot(),
        billingProvider: resolved.billing?.providers
          ? Object.keys(resolved.billing.providers)[0] ?? "configured"
          : undefined,
        chat:
          materialized.plan.chat.transport === "none"
            ? undefined
            : withAuth.chat.capabilities,
        storage: {
          backups: withAuth.capabilities.storage.backups,
          catalogs: withAuth.capabilities.storage.catalogs,
          objects:
            Boolean(storageRuntime) || withAuth.capabilities.storage.objects,
          source: materialized.plan.storage.transport,
        },
      });
      assembledInternals.capabilitiesIr = capabilitiesIr;
      assembledInternals.capabilitiesFingerprint =
        fingerprintAthenaCapabilitiesIr(capabilitiesIr);
    };
    refreshCapabilities();
    if (
      resolved.auth !== undefined &&
      !isDisabledAthenaAuthConfig(resolved.auth) &&
      materialized.plan.auth.runtime !== "disabled" &&
      (Boolean(existing?.authRuntime) ||
        Boolean(
          normalizeOptional(athenaAuthConfig(resolved.auth)?.url) ||
            athenaAuthConfig(resolved.auth)?.routing === "same-origin"
        ))
    ) {
      capabilityStoreUnsubscribe =
        withAuth.auth.capabilities.subscribe(refreshCapabilities);
    }
  }
  return withAuth as
    | AthenaRootClient<AthenaClient<TModels>>
    | AthenaRootClient<AthenaClientWithR2Storage<TModels>>;
}

/**
 * Materialize an Athena client (single public constructor).
 *
 * Node/server runtime: in addition to the universal pipeline, `db.pgUri`
 * selects the direct PostgreSQL transport backed by `pg`.
 *
 * @docsCanonical
 * @docsRuntime node
 * @docsRole root-client-constructor
 * @docsRelated createAthenaNextHandlers
 * @since 5.0.0
 */
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
  config:
    | (AthenaClientConfig<TModels> & { r2: R2BucketLike })
    | AthenaClientConfigWithR2<TModels>
): AthenaRootClient<AthenaClientWithR2Storage<TModels>>;
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaClientConfig<TModels>): AthenaRootClient<AthenaClient<TModels>>;
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
  config: AthenaClientConfig<TModels>
):
  | AthenaRootClient<AthenaClient<TModels>>
  | AthenaRootClient<AthenaClientWithR2Storage<TModels>> {
  assertDataLifecycleConfig(config);
  // Nuclear casts: assembleAthenaClient generics overflow TS depth during dts emit (TS2589).
  const prepare = prepareNodeRuntimePlan as (c: unknown) => unknown;
  const assemble = assembleAthenaClient as (c: unknown) => unknown;
  return assemble(prepare(config)) as AthenaRootClient<AthenaClient<TModels>>;
}
