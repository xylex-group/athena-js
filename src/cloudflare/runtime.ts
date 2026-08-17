/**
 * Switchable Athena runtime façades over {@link createClient}.
 *
 * Prefer `createClient({ db: { d1 }, storage: { r2 }, mode, prefer, url, key })` directly.
 * These helpers only map Worker/top-level shapes onto that single constructor.
 *
 * @see docs/cloudflare-edge-local.md
 * @see ADR 0015 / 0016 / 0019
 */

import type { AthenaQueryTraceOptions } from "../client.ts";
import type { AthenaDiagnosticsMode } from "../diagnostics.ts";
import {
	ATHENA_ENV_API_KEY_KEYS,
	ATHENA_ENV_GATEWAY_URL_KEYS,
} from "../env/index.ts";
import type { AthenaGatewayClient } from "../gateway/client.ts";
import type { BackendConfig, BackendType } from "../gateway/types.ts";
import type { AthenaClientModelsInput } from "../schema/types.ts";
import {
	type AthenaAuthConfig,
	type AthenaBillingConfig,
	type AthenaChatConfig,
	type AthenaClient,
	type AthenaClientConfig,
	type AthenaClientWithR2Storage,
	type AthenaDbConfig,
	type AthenaRequestContext,
	type AthenaRequestContextProvider,
	type AthenaStorageConfig,
	createClient,
} from "../v3-client-core.ts";
import {
	ATHENA_EXECUTION_MODE_ENV_KEY,
	ATHENA_EXECUTION_PREFER_ENV_KEY,
	type AthenaExecutionMode,
	type AthenaExecutionPrefer,
	type AthenaResolvedExecutionMode,
	type ResolveAthenaExecutionModeInput,
	resolveAthenaExecutionMode,
} from "./execution-mode.ts";
import type { D1DatabaseLike, R2BucketLike } from "./types.ts";

export {
	ATHENA_EXECUTION_MODE_ENV_KEY,
	ATHENA_EXECUTION_PREFER_ENV_KEY,
	type AthenaExecutionMode,
	type AthenaExecutionPrefer,
	type AthenaResolvedExecutionMode,
	type ResolveAthenaExecutionModeInput,
	resolveAthenaExecutionMode,
};

export interface AthenaRuntimeConfig<
	TModels extends AthenaClientModelsInput | undefined = undefined,
> {
	auth?: AthenaAuthConfig;
	backend?: BackendConfig | BackendType;
	billing?: AthenaBillingConfig;
	chat?: AthenaChatConfig;
	client?: string | null;
	context?: AthenaRequestContext | AthenaRequestContextProvider;

	// --- Edge bindings (aliases for createClient db.d1 / storage.r2) ---
	d1?: D1DatabaseLike | null;
	db?: AthenaDbConfig;
	debugAst?: boolean;
	diagnostics?: AthenaDiagnosticsMode;
	env?: Record<string, string | undefined>;
	findManyAst?: boolean;
	gatewayTransport?: AthenaGatewayClient;
	headers?: Record<string, string>;
	key?: string | null;
	/**
	 * `gateway` — HTTP to athena_rs (server).
	 * `edge` — D1/R2 bindings in-process.
	 * `auto` — edge when `d1` is set, else gateway when `url` / env URL is set.
	 * Default: `auto` (overridable via `ATHENA_EXECUTION_MODE`).
	 */
	mode?: AthenaExecutionMode | string | null;
	models?: TModels;
	/**
	 * When `mode` is `auto` and both D1 and gateway URL are set, which wins.
	 * Default `edge`. Also readable from env `ATHENA_EXECUTION_PREFER`.
	 */
	prefer?: AthenaExecutionPrefer | string | null;
	r2?: R2BucketLike | null;
	retryReads?: boolean;
	sessionMode?: string | null;
	storage?: AthenaStorageConfig;
	storagePrefix?: string;
	traceQueries?: boolean | AthenaQueryTraceOptions;

	// --- Shared createClient fields ---
	url?: string | null;
}

export type AthenaRuntimeClient<
	TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaClient<TModels> | AthenaClientWithR2Storage<TModels>;

export interface AthenaRuntimeResult<
	TModels extends AthenaClientModelsInput | undefined = undefined,
	TClient extends AthenaRuntimeClient<TModels> = AthenaRuntimeClient<TModels>,
> {
	capabilities: TClient["capabilities"];
	client: TClient;
	mode: AthenaResolvedExecutionMode;
}

export type AthenaRuntimeConfigWithR2<
	TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaRuntimeConfig<TModels> & { r2: R2BucketLike };

/**
 * Canonical Worker / Pages `env` bindings recognized by {@link createAthenaFromWorkerEnv}.
 * Gateway URL keys align with {@link resolveAthenaExecutionMode} / createClient env resolution.
 */
export interface AthenaWorkerEnv {
	ATHENA_API_KEY?: string;
	ATHENA_AUTH_URL?: string;
	ATHENA_CLIENT?: string;
	/** Alias for gateway/DB HTTP base (same keys as createClient env). */
	ATHENA_DB_URL?: string;
	ATHENA_EXECUTION_MODE?: string;
	ATHENA_EXECUTION_PREFER?: string;
	ATHENA_GATEWAY_API_KEY?: string;
	ATHENA_GATEWAY_URL?: string;
	ATHENA_URL?: string;
	DB?: D1DatabaseLike | null;
	FILES?: R2BucketLike | null;
	/** Same aliases as createClient — see {@link ATHENA_ENV_API_KEY_KEYS}. */
	NEXT_PUBLIC_ATHENA_API_KEY?: string;
	NEXT_PUBLIC_ATHENA_DB_API_URL?: string;
	NEXT_PUBLIC_ATHENA_URL?: string;
	X_API_KEY?: string;
	[key: string]: unknown;
}

function normalizeOptional(
	value: string | null | undefined,
): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Map runtime/Worker shape → {@link AthenaClientConfig} (single constructor input). */
export function toCreateClientConfig<
	TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaRuntimeConfig<TModels>): AthenaClientConfig<TModels> {
	const env = config.env ?? {};
	return {
		auth:
			config.auth ??
			(normalizeOptional(env.ATHENA_AUTH_URL)
				? { url: env.ATHENA_AUTH_URL }
				: undefined),
		backend: config.backend,
		billing: config.billing,
		chat: config.chat,
		client: config.client ?? normalizeOptional(env.ATHENA_CLIENT),
		context: config.context,
		d1: config.d1,
		db: config.db,
		debugAst: config.debugAst,
		diagnostics: config.diagnostics,
		env,
		findManyAst: config.findManyAst,
		gatewayTransport: config.gatewayTransport,
		headers: config.headers,
		key: config.key ?? normalizeOptional(env.ATHENA_API_KEY),
		mode: config.mode,
		models: config.models,
		prefer: config.prefer,
		r2: config.r2,
		retryReads: config.retryReads,
		sessionMode: config.sessionMode,
		storage: config.storage,
		storagePrefix: config.storagePrefix,
		traceQueries: config.traceQueries,
		url: config.url,
	};
}

function resolveModeLabel(
	config: AthenaRuntimeConfig,
	client: AthenaClient,
): AthenaResolvedExecutionMode {
	if (client.capabilities.mode === "cloudflare-edge") {
		return "edge";
	}
	// Prefer explicit resolution for gateway when bindings were intentionally ignored.
	try {
		return resolveAthenaExecutionMode({
			d1: config.d1 ?? config.db?.d1,
			env: config.env,
			mode: config.mode,
			prefer: config.prefer,
			url: config.url ?? config.db?.url,
		});
	} catch {
		return "gateway";
	}
}

/**
 * Create an Athena client for either gateway or edge execution.
 * Thin façade: always materializes via {@link createClient}.
 */
export function createAthenaRuntime<
	const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
	config: AthenaRuntimeConfigWithR2<TModels> & {
		mode?: "edge" | "auto" | string | null;
	},
): AthenaRuntimeResult<TModels, AthenaClientWithR2Storage<TModels>>;
export function createAthenaRuntime<
	const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaRuntimeConfig<TModels>): AthenaRuntimeResult<TModels>;
export function createAthenaRuntime<
	const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaRuntimeConfig<TModels>): AthenaRuntimeResult<TModels> {
	const clientConfig = toCreateClientConfig(config);
	// Fill url from env when omitted so mode resolution + gateway path work.
	if (!normalizeOptional(clientConfig.url as string | null | undefined)) {
		clientConfig.url =
			normalizeOptional(config.env?.ATHENA_URL) ??
			normalizeOptional(config.env?.NEXT_PUBLIC_ATHENA_URL);
	}
	if (!normalizeOptional(clientConfig.key as string | null | undefined)) {
		clientConfig.key = normalizeOptional(config.env?.ATHENA_API_KEY);
	}

	// Façade boundary: materialize through createClient without re-expanding
	// deep model generics during dts emit (TS2589).
	const client = (createClient as (c: unknown) => unknown)(
		clientConfig,
	) as AthenaRuntimeClient<TModels>;
	const mode = resolveModeLabel(
		config as AthenaRuntimeConfig,
		client as unknown as AthenaClient,
	);
	return {
		capabilities: client.capabilities,
		client,
		mode,
	};
}

export function createAthenaRuntimeClient<
	const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
	config: AthenaRuntimeConfigWithR2<TModels> & {
		mode?: "edge" | "auto" | string | null;
	},
): AthenaClientWithR2Storage<TModels>;
export function createAthenaRuntimeClient<
	const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaRuntimeConfig<TModels>): AthenaRuntimeClient<TModels>;
export function createAthenaRuntimeClient<
	const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaRuntimeConfig<TModels>): AthenaRuntimeClient<TModels> {
	return createAthenaRuntime(config).client;
}

export type CreateAthenaFromWorkerEnvOptions<
	TModels extends AthenaClientModelsInput | undefined = undefined,
> = Omit<
	AthenaRuntimeConfig<TModels>,
	"d1" | "r2" | "url" | "key" | "env" | "auth" | "client"
> & {
	d1Binding?: string;
	r2Binding?: string;
	storagePrefix?: string;
	auth?: AthenaAuthConfig;
	client?: string | null;
	models?: TModels;
};

/**
 * One-call Worker setup: map standard `env` bindings, then {@link createClient}.
 */
export function createAthenaFromWorkerEnv<
	const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
	workerEnv: AthenaWorkerEnv,
	options: CreateAthenaFromWorkerEnvOptions<TModels> = {},
): AthenaRuntimeResult<TModels> {
	const {
		d1Binding = "DB",
		r2Binding = "FILES",
		storagePrefix = options.storagePrefix,
		...rest
	} = options;

	const d1 = workerEnv[d1Binding] as D1DatabaseLike | null | undefined;
	const r2 = workerEnv[r2Binding] as R2BucketLike | null | undefined;

	const stringEnv: Record<string, string | undefined> = {
		ATHENA_AUTH_URL: asString(workerEnv.ATHENA_AUTH_URL),
		ATHENA_CLIENT: asString(workerEnv.ATHENA_CLIENT),
		[ATHENA_EXECUTION_MODE_ENV_KEY]: asString(workerEnv.ATHENA_EXECUTION_MODE),
		[ATHENA_EXECUTION_PREFER_ENV_KEY]: asString(
			workerEnv.ATHENA_EXECUTION_PREFER,
		),
	};
	// SSOT: ATHENA_ENV_GATEWAY_URL_KEYS / ATHENA_ENV_API_KEY_KEYS from env module
	for (const key of ATHENA_ENV_GATEWAY_URL_KEYS) {
		stringEnv[key] = asString(workerEnv[key]);
	}
	for (const key of ATHENA_ENV_API_KEY_KEYS) {
		stringEnv[key] = asString(workerEnv[key]);
	}

	// Prefer explicit ATHENA_URL, then other supported gateway/DB URL env keys.
	let resolvedUrl: string | undefined;
	for (const key of ATHENA_ENV_GATEWAY_URL_KEYS) {
		resolvedUrl = asString(workerEnv[key]);
		if (resolvedUrl) {
			break;
		}
	}

	// Prefer ATHENA_API_KEY, then the same aliases resolveCore accepts.
	let resolvedKey: string | undefined;
	for (const key of ATHENA_ENV_API_KEY_KEYS) {
		resolvedKey = asString(workerEnv[key]);
		if (resolvedKey) {
			break;
		}
	}

	// Avoid naming AthenaRuntimeResult/AthenaClient generics in the cast body.
	const result = (createAthenaRuntime as (c: unknown) => unknown)({
		...rest,
		d1,
		mode: rest.mode ?? asString(workerEnv.ATHENA_EXECUTION_MODE) ?? "auto",
		prefer: rest.prefer ?? asString(workerEnv.ATHENA_EXECUTION_PREFER),
		...(r2 ? { r2 } : {}),
		auth:
			options.auth ??
			(asString(workerEnv.ATHENA_AUTH_URL)
				? { url: asString(workerEnv.ATHENA_AUTH_URL) }
				: undefined),
		client: rest.client ?? asString(workerEnv.ATHENA_CLIENT),
		env: stringEnv,
		key: resolvedKey,
		storagePrefix,
		url: resolvedUrl,
	});
	return result as AthenaRuntimeResult<TModels>;
}
