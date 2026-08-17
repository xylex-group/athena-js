/**
 * Edge-only client façade over {@link createClient}.
 * Prefer `createClient({ db: { d1 }, storage: { r2 } })` for new code (ADR 0001).
 * This helper maps the historical top-level `d1` / `r2` shape onto that spine.
 */

import type { AthenaClientModelsInput } from "../schema/types.ts";
import {
	type AthenaAuthConfig,
	type AthenaClient,
	type AthenaRequestContext,
	type AthenaRequestContextProvider,
	createClient,
} from "../v3-client-core.ts";
import type { CloudflareR2StorageModule } from "./r2/storage.ts";
import type {
	AthenaClientCapabilities,
	D1DatabaseLike,
	R2BucketLike,
} from "./types.ts";

export interface CloudflareAthenaClientConfig<
	TModels extends AthenaClientModelsInput | undefined = undefined,
> {
	auth?: AthenaAuthConfig;
	client?: string | null;
	context?: AthenaRequestContext | AthenaRequestContextProvider;
	/** D1 database binding (e.g. env.DB). */
	d1: D1DatabaseLike;
	debugAst?: boolean;
	env?: Record<string, string | undefined>;
	findManyAst?: boolean;
	headers?: Record<string, string>;
	/**
	 * API key for remote hybrid services.
	 * Pure edge-local mode gets a local sentinel via {@link createClient} when omitted.
	 * Hybrid configs (`url` set) must not pre-fill that sentinel — leave unset so
	 * `createClient` / resolveCore can read `ATHENA_API_KEY` (etc.) from `env`.
	 */
	key?: string | null;
	models?: TModels;
	/** Optional R2 bucket binding for L3a object I/O. */
	r2?: R2BucketLike;
	retryReads?: boolean;
	/** Default D1 session mode (`first-unconstrained`, `first-primary`, …). */
	sessionMode?: string | null;
	/** Object key prefix for R2. */
	storagePrefix?: string;
	traceQueries?: boolean;
	/**
	 * Optional unified / remote Athena URL for hybrid services (auth, billing).
	 * Not required for pure D1/R2 local mode.
	 */
	url?: string | null;
}

export type CloudflareAthenaClientConfigWithR2<
	TModels extends AthenaClientModelsInput | undefined = undefined,
> = CloudflareAthenaClientConfig<TModels> & {
	r2: R2BucketLike;
};

export type CloudflareAthenaClient<
	TModels extends AthenaClientModelsInput | undefined = undefined,
> = AthenaClient<TModels> & {
	readonly capabilities: AthenaClientCapabilities;
};

/** Edge client with L3a R2 object methods typed on `storage`. */
export type CloudflareAthenaClientWithR2<
	TModels extends AthenaClientModelsInput | undefined = undefined,
> = Omit<CloudflareAthenaClient<TModels>, "storage" | "withContext"> & {
	readonly storage: CloudflareR2StorageModule;
	withContext: (
		context: AthenaRequestContext,
	) => CloudflareAthenaClientWithR2<TModels>;
};

/**
 * Create an Athena client that executes DB operations against a D1 binding
 * (and optional R2 for object storage) inside a Cloudflare Worker.
 *
 * Thin façade over {@link createClient}:
 * ```ts
 * createClient({
 *   db: { d1: env.DB, sessionMode },
 *   storage: { r2: env.FILES, prefix: storagePrefix },
 *   url, key, ...
 * })
 * ```
 *
 * To switch between edge and gateway at runtime, prefer {@link createAthenaRuntime}.
 */
export function createCloudflareClient<
	const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
	config: CloudflareAthenaClientConfigWithR2<TModels>,
): CloudflareAthenaClientWithR2<TModels>;
export function createCloudflareClient<
	const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
	config: CloudflareAthenaClientConfig<TModels>,
): CloudflareAthenaClient<TModels>;
export function createCloudflareClient<
	const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
	config: CloudflareAthenaClientConfig<TModels>,
): CloudflareAthenaClient<TModels> | CloudflareAthenaClientWithR2<TModels> {
	if (!config.d1 || typeof config.d1.prepare !== "function") {
		throw new Error(
			"createCloudflareClient requires a D1 binding with prepare()",
		);
	}

	// Do not default `key` to the edge sentinel here. Pure edge-local still gets a
	// placeholder inside createClient materialization; hybrid (url present) must keep
	// key unset so resolveCore can use ATHENA_API_KEY / ATHENA_GATEWAY_API_KEY from env.
	const client = (createClient as (c: unknown) => unknown)({
		...(config.key !== undefined && config.key !== null
			? { key: config.key }
			: {}),
		client: config.client,
		context: config.context,
		db: {
			d1: config.d1,
			sessionMode: config.sessionMode,
		},
		debugAst: config.debugAst,
		env: config.env,
		findManyAst: config.findManyAst,
		headers: config.headers,
		models: config.models,
		retryReads: config.retryReads,
		traceQueries: config.traceQueries,
		...(config.r2
			? {
					storage: {
						prefix: config.storagePrefix,
						r2: config.r2,
					},
				}
			: {}),
		...(config.url ? { url: config.url } : {}),
		...(config.auth ? { auth: config.auth } : {}),
	});

	return client as
		| CloudflareAthenaClient<TModels>
		| CloudflareAthenaClientWithR2<TModels>;
}
