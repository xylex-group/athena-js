import type { AthenaRuntimeDiscoveryDocument } from "../gateway/discovery-types.ts";
import {
	type AthenaPrincipalResolutionFailure,
	normalizeAthenaRuntimeAuth,
	resolveAthenaRuntimePrincipal,
} from "../runtime/authority/index.ts";
import {
	getAthenaClientInternals,
	requireAthenaRootClientInternals,
} from "../runtime/client-internals.ts";
import { isAllowedRequestOrigin } from "../runtime/data/origin.ts";
import type { AthenaRuntimeAuthConfig } from "../runtime/data/principal.ts";
import type { AthenaRuntimeSecurityMode } from "../runtime/data/types.ts";
import {
	decodeAthenaStorageBytes,
	decodeAthenaStorageRequestBody,
	serializeAthenaStorageData,
} from "../storage/runtime/bytes-envelope.ts";
import { storageErrorResult } from "../storage/runtime/errors.ts";
import {
	createStorageRuntime,
	getStorageProvider,
	type StorageObjectOp,
	type StorageObjectRequest,
	type StorageObjectResult,
	type StorageRuntime,
} from "../storage/runtime/index.ts";

export interface AthenaStorageHandlers {
	GET: (request: Request) => Promise<Response>;
	POST: (request: Request) => Promise<Response>;
}

export interface CreateAthenaStorageHandlersOptions {
	auth?: AthenaRuntimeAuthConfig;
	client: object;
	discoveryDocument: AthenaRuntimeDiscoveryDocument;
	security?: { mode?: AthenaRuntimeSecurityMode };
}

export function createAthenaStorageHandlers(
	options: CreateAthenaStorageHandlersOptions,
): AthenaStorageHandlers {
	const internals = requireAthenaRootClientInternals(
		options.client,
		"createAthenaStorageHandlers({ client })",
	);

	const discovery: AthenaRuntimeDiscoveryDocument = {
		...options.discoveryDocument,
		endpoints: {
			data: options.discoveryDocument.endpoints?.data ?? "/api/athena",
			...(options.discoveryDocument.endpoints?.storage
				? { storage: options.discoveryDocument.endpoints.storage }
				: {}),
			...(options.discoveryDocument.endpoints?.billing
				? { billing: options.discoveryDocument.endpoints.billing }
				: {}),
			...(options.discoveryDocument.endpoints?.auth !== undefined
				? { auth: options.discoveryDocument.endpoints.auth }
				: {}),
		},
	};

	const securityMode: AthenaRuntimeSecurityMode =
		options.security?.mode ?? "trusted";
	let auth: AthenaRuntimeAuthConfig | undefined = options.auth;
	if (auth === undefined && internals.getAuthStores) {
		const getStores = internals.getAuthStores;
		auth = {
			mode: "athena-session",
			stores: {
				getSessionByToken: async (token) => {
					const stores = await getStores();
					return stores.getSessionByToken(token);
				},
				getUserById: async (id) => {
					const stores = await getStores();
					return stores.getUserById(id);
				},
			},
		};
	}
	const authMaterial = normalizeAthenaRuntimeAuth(auth, securityMode);

	const resolveRuntime = (): StorageRuntime | undefined => {
		const live = getAthenaClientInternals(options.client);
		if (live?.storageRuntime) {
			return live.storageRuntime;
		}
		const provider = getStorageProvider(internals.config.storage);
		if (!provider) {
			return undefined;
		}
		return createStorageRuntime({
			lifecycle: internals.config.lifecycle?.storage,
			provider,
		});
	};

	async function executeAndRespond(
		request: Request,
		storageRequest: StorageObjectRequest,
		successFormat: "json" | "bytes",
	): Promise<Response> {
		if (
			options.security?.mode !== "trusted" &&
			!isAllowedRequestOrigin(request)
		) {
			return jsonResult(
				storageErrorResult(
					3003,
					"storage_authorization_denied",
					"cross-origin storage request denied",
					403,
				),
			);
		}

		const runtime = resolveRuntime();
		if (!runtime) {
			return jsonResult(
				storageErrorResult(
					3007,
					"storage_unavailable",
					"storage runtime is not configured",
					503,
				),
			);
		}

		const headers: Record<string, string> = {};
		request.headers.forEach((value, name) => {
			headers[name] = value;
		});
		const resolution = await resolveAthenaRuntimePrincipal(
			authMaterial,
			securityMode,
			{ headers, request },
		);
		if (!resolution.ok) {
			return jsonResult(storageResultFromPrincipalFailure(resolution.failure));
		}

		const result = await runtime.execute(
			storageRequest,
			resolution.resolved.principal,
		);
		if (successFormat === "bytes" && result.ok) {
			const bytes = decodeAthenaStorageBytes(result.data);
			if (bytes) {
				return new Response(bytes as unknown as BodyInit, {
					headers: {
						"content-type": "application/octet-stream",
					},
					status: 200,
				});
			}
		}
		return jsonResult(result);
	}

	return {
		async GET(request: Request) {
			const key = new URL(request.url).searchParams.get("key")?.trim();
			if (!key) {
				return Response.json(discovery);
			}
			return executeAndRespond(request, { key, op: "get" }, "bytes");
		},
		async POST(request: Request) {
			let body: unknown;
			try {
				body = await request.json();
			} catch {
				return jsonResult(
					storageErrorResult(
						3000,
						"storage_invalid_request",
						"invalid JSON body",
						400,
					),
				);
			}

			const envelope = asRecord(body);
			const payload = asRecord(envelope.payload);
			const op = envelope.operation;
			if (
				op !== "get" &&
				op !== "put" &&
				op !== "delete" &&
				op !== "list" &&
				op !== "head"
			) {
				return jsonResult(
					storageErrorResult(
						3000,
						"storage_invalid_request",
						"operation is required",
						400,
					),
				);
			}

			return executeAndRespond(
				request,
				{
					body: decodeAthenaStorageRequestBody(payload.body),
					contentType:
						typeof payload.contentType === "string"
							? payload.contentType
							: undefined,
					cursor:
						typeof payload.cursor === "string" ? payload.cursor : undefined,
					key: typeof payload.key === "string" ? payload.key : undefined,
					limit: typeof payload.limit === "number" ? payload.limit : undefined,
					metadata: asStringMap(payload.metadata),
					op: op as StorageObjectOp,
					prefix:
						typeof payload.prefix === "string" ? payload.prefix : undefined,
				},
				"json",
			);
		},
	};
}

function storageResultFromPrincipalFailure(
	failure: AthenaPrincipalResolutionFailure,
) {
	if (failure.code === "ATHENA_AUTH_ORG_NOT_ALLOWED") {
		return storageErrorResult(
			3003,
			"storage_authorization_denied",
			failure.message,
			403,
		);
	}
	return storageErrorResult(
		3003,
		"storage_unauthenticated",
		failure.message,
		failure.status,
	);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function asStringMap(value: unknown): Record<string, string> | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (typeof entry === "string") {
			out[key] = entry;
		}
	}
	return out;
}

function jsonResult(result: StorageObjectResult): Response {
	return Response.json(
		{
			data: serializeAthenaStorageData(result.data),
			error: result.error,
			ok: result.ok,
			status: result.status,
		},
		{ status: result.status },
	);
}
