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
import { createAthenaAuthRuntime } from "./auth/local/runtime.ts";
import { advertisedSocialProviderIds } from "./auth/local/social/runtime.ts";
import { assertLocalAuthObservability } from "./auth/observability/config.ts";
import { normalizeSocialAuthConfig } from "./auth/social/server/social-config.ts";
import type { AthenaAuthServerBindings } from "./auth/types.ts";
import type { AthenaRootClient } from "./client-brands.ts";
import type { R2BucketLike } from "./cloudflare/types.ts";
import { createEmailDeliveryPort } from "./email/delivery-port.ts";
import type { AthenaEmailModule } from "./email/types.ts";
import { createPostgresNotificationPreferenceStore } from "./notifications/postgres-store.ts";
import type { AthenaNotificationsModule } from "./notifications/types.ts";
import {
	bindPostgresRuntime,
	createAthenaPostgresRuntime,
	getBoundPostgresRuntime,
} from "./postgres/owned-runtime.ts";
import {
	attachAthenaClientInternals,
	createRootClientInternals,
	getAthenaClientInternals,
	requireAthenaRootClientInternals,
} from "./runtime/client-internals.ts";
import { assertDataLifecycleConfig } from "./runtime/data/lifecycle/assert.ts";
import { attachLocalBillingRuntime } from "./runtime/materializers/billing.ts";
import { disposeMaterializedDatabase } from "./runtime/materializers/database.ts";
import {
	createAthenaClientLifecycle,
	recordAuthRuntimeCreated,
} from "./runtime/ownership.ts";
import {
	type AthenaMaterializedRuntime,
	materializeRuntimePlan,
} from "./runtime/plan/materialize.ts";
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
	type AthenaClient,
	type AthenaClientConfig,
	type AthenaClientConfigWithR2,
	type AthenaClientWithR2Storage,
	AthenaConfigurationError,
	createClientWithNormalizer,
	normalizeOptional,
	replaceClientNotificationPreferenceStore,
} from "./v3-client-core.ts";

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
	config: AthenaClientConfig<AthenaClientModelsInput | undefined>,
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
			"auth",
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
				"auth",
			);
		}
	}
	if (raw.grants) {
		throw new AthenaConfigurationError(
			"ATHENA_AUTH_FEATURE_UNSUPPORTED",
			"Embedded Athena Auth does not implement grants. Map authorization to athena.policy / athena-rights, or use dedicated Athena Auth (auth.url).",
			"auth",
		);
	}
	const emailBag = raw.email;
	if (emailBag && typeof emailBag === "object" && !Array.isArray(emailBag)) {
		const nested = emailBag as Record<string, unknown>;
		if ("provider" in nested || "smtp" in nested || "resend" in nested) {
			throw new AthenaConfigurationError(
				"ATHENA_AUTH_FEATURE_UNSUPPORTED",
				"Auth does not own email transport. Configure createClient({ email: { provider } }) and inject the root email module into local Auth.",
				"auth",
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
	}),
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
			: undefined);
	if (!postgresRuntime) {
		throw new AthenaConfigurationError(
			"ATHENA_AUTH_LOCAL_DATABASE_REQUIRED",
			'auth.mode "local" requires db.pgUri (DATABASE_URL).',
			"auth",
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
			(athenaAuthConfig(config.auth) ?? {}) as Record<string, unknown>,
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
				"auth",
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
			hooks,
			passkeyOnboarding,
			secret: normalized.secret,
		});
	if (!cachedAuth) {
		authRuntimeCache().set(postgresRuntime, runtime);
		recordAuthRuntimeCreated();
	}
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
					next: ReturnType<typeof createEmbeddedCapabilitySnapshot>,
				) => void;
			};
		}
	).capabilities;
	capabilities?.set(
		createEmbeddedCapabilitySnapshot({
			passkeyEnabled: normalized.passkey.enabled,
			passkeyOnboarding: normalized.passkey.onboardingEnabled,
			socialProviders: advertisedSocialProviderIds(normalized.social),
		}),
	);
	attachAthenaClientInternals(
		client,
		createRootClientInternals({
			authRuntime: runtime,
			config: config as AthenaClientConfig,
			gatewayTransport: config.gatewayTransport,
			getAuthStores: () => runtime.getStores(),
			plan: toResolvedAthenaRuntime(plan),
			postgresRuntime,
		}),
	);
	return client;
}

function prepareNodeRuntimePlan<
	TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>) {
	const next = inferEmbeddedAuthMode(normalizeUniversalConfig(config));
	rejectUnsupportedEmbeddedAuthFeatures(athenaAuthConfig(next.auth));
	assertLocalAuthHooks(athenaAuthConfig(next.auth));
	assertLocalAuthObservability(athenaAuthConfig(next.auth));
	if (
		isLocalAthenaAuthConfig(next.auth) &&
		!normalizeOptional(next.db?.pgUri)
	) {
		throw new AthenaConfigurationError(
			"ATHENA_AUTH_LOCAL_DATABASE_REQUIRED",
			'auth.mode "local" requires db.pgUri (DATABASE_URL). The TypeScript Athena Auth runtime talks to PostgreSQL directly.',
			"auth",
		);
	}
	const plan = resolveRuntimePlan(next, {
		environment: "node",
		trustedNode: true,
	});
	validateRuntimePlan(plan);
	return materializeRuntimePlan(plan);
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
				const pool = (await postgres.getPool()) as {
					query: (
						sql: string,
						params?: unknown[],
					) => Promise<{ rows: Record<string, unknown>[] }>;
				};
				return pool.query(text, values);
			},
		}),
	);
}

function assembleAthenaClient<
	TModels extends AthenaClientModelsInput | undefined,
>(
	materialized: AthenaMaterializedRuntime,
):
	| AthenaRootClient<AthenaClient<TModels>>
	| AthenaRootClient<AthenaClientWithR2Storage<TModels>> {
	const resolved = materialized.config as AthenaClientConfig<TModels>;
	// Nuclear casts: see v3-client-core createClient (TS2589).
	const factory = createClientWithNormalizer as unknown as (
		input: unknown,
		normalizer: (c: unknown) => unknown,
	) => unknown;
	const client: unknown = factory(resolved, (next: unknown) => next);
	const withAuth = attachLocalAuthRuntime(
		client as AthenaClient<TModels>,
		resolved,
		materialized.plan,
	);
	const existing = getAthenaClientInternals(withAuth);
	const billingProviderRegistry =
		existing?.billingProviderRegistry ?? materialized.billingProviderRegistry;
	const postgresRuntime =
		existing?.postgresRuntime ??
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
	const close = async (): Promise<void> => {
		if (lifecycle.closed) {
			return;
		}
		lifecycle.closed = true;
		await existing?.authRuntime?.close();
		if (resolved.gatewayTransport) {
			await disposeMaterializedDatabase(resolved.gatewayTransport);
		}
		await postgresRuntime?.close();
	};
	attachAthenaClientInternals(
		withAuth,
		createRootClientInternals({
			authRuntime: existing?.authRuntime,
			billingProviderRegistry,
			close,
			config: resolved as AthenaClientConfig,
			gatewayTransport: resolved.gatewayTransport,
			getAuthStores: existing?.getAuthStores,
			lifecycle,
			plan: toResolvedAthenaRuntime(materialized.plan),
			postgresRuntime,
			runtimeOwnership:
				postgresRuntime?.ownership === "borrowed" ? "borrowed" : "owned",
			storageRuntime,
		}),
	);
	attachLocalBillingRuntime(withAuth, {
		configuredProviders: resolved.billing?.providers,
		mode: resolved.billing?.mode,
		registry: billingProviderRegistry,
		testMode: resolved.billing?.testMode,
	});
	attachLocalNotificationsRuntime(withAuth);
	return withAuth as
		| AthenaRootClient<AthenaClient<TModels>>
		| AthenaRootClient<AthenaClientWithR2Storage<TModels>>;
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
		| AthenaClientConfigWithR2<TModels>,
): AthenaRootClient<AthenaClientWithR2Storage<TModels>>;
export function createClient<
	const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaClientConfig<TModels>): AthenaRootClient<AthenaClient<TModels>>;
export function createClient<
	const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
	config: AthenaClientConfig<TModels>,
):
	| AthenaRootClient<AthenaClient<TModels>>
	| AthenaRootClient<AthenaClientWithR2Storage<TModels>> {
	assertDataLifecycleConfig(config);
	// Nuclear casts: assembleAthenaClient generics overflow TS depth during dts emit (TS2589).
	const prepare = prepareNodeRuntimePlan as (c: unknown) => unknown;
	const assemble = assembleAthenaClient as (c: unknown) => unknown;
	return assemble(prepare(config)) as AthenaRootClient<AthenaClient<TModels>>;
}
