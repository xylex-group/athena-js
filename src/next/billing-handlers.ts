import type { AthenaRuntimeDiscoveryDocument } from "../gateway/discovery-types.ts";
import {
	isAthenaBillingAuthorizationError,
	isAthenaBillingCapabilityError,
} from "../billing/errors.ts";
import type { BillingRuntimeDispatchOperation } from "../billing/runtime/dispatch.ts";
import {
	normalizeAthenaRuntimeAuth,
	resolveAthenaRuntimePrincipal,
	type AthenaPrincipalResolutionFailure,
} from "../runtime/authority/index.ts";
import {
	getAthenaClientInternals,
	requireAthenaRootClientInternals,
} from "../runtime/client-internals.ts";
import { isAllowedRequestOrigin } from "../runtime/data/origin.ts";
import type { AthenaRuntimeAuthConfig } from "../runtime/data/principal.ts";
import type { AthenaRuntimeSecurityMode } from "../runtime/data/types.ts";

export interface AthenaBillingHandlers {
	GET: (request: Request) => Promise<Response>;
	POST: (request: Request) => Promise<Response>;
}

export interface CreateAthenaBillingHandlersOptions {
	auth?: AthenaRuntimeAuthConfig;
	client: object;
	discoveryDocument: AthenaRuntimeDiscoveryDocument;
	security?: { mode?: AthenaRuntimeSecurityMode };
}

const BILLING_OPERATIONS = new Set<BillingRuntimeDispatchOperation>([
	"payments.list",
	"payments.create",
	"payments.get",
	"payments.cancel",
	"customers.list",
	"customers.create",
	"customers.get",
	"customers.update",
	"customers.delete",
	"refunds.list",
	"refunds.create",
	"refunds.get",
	"refunds.cancel",
	"paymentLinks.list",
	"paymentLinks.create",
	"paymentLinks.get",
	"paymentLinks.update",
	"paymentLinks.delete",
	"subscriptions.list",
	"subscriptions.create",
	"subscriptions.get",
	"subscriptions.update",
	"subscriptions.cancel",
	"invoices.list",
	"invoices.get",
	"webhooks.list",
	"webhooks.create",
	"webhooks.get",
	"webhooks.update",
	"webhooks.delete",
	"webhooks.test",
	"getCapabilities",
]);

export function createAthenaBillingHandlers(
	options: CreateAthenaBillingHandlersOptions,
): AthenaBillingHandlers {
	const internals = requireAthenaRootClientInternals(
		options.client,
		"createAthenaBillingHandlers({ client })",
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

	return {
		async GET() {
			return Response.json(discovery);
		},
		async POST(request: Request) {
			if (
				options.security?.mode !== "trusted" &&
				!isAllowedRequestOrigin(request)
			) {
				return jsonError(
					{
						code: "ATHENA_BILLING_AUTHORIZATION_DENIED",
						message: "cross-origin billing request denied",
					},
					403,
				);
			}

			const live = getAthenaClientInternals(options.client);
			const runtime = live?.billingRuntime ?? internals.billingRuntime;
			if (!runtime) {
				return jsonError(
					{
						code: "ATHENA_BILLING_OPERATION_UNAVAILABLE",
						message: "billing runtime is not configured",
					},
					503,
				);
			}

			let body: unknown;
			try {
				body = await request.json();
			} catch {
				return jsonError(
					{
						code: "ATHENA_BILLING_INVALID_REQUEST",
						message: "invalid JSON body",
					},
					400,
				);
			}

			const envelope = asRecord(body);
			const operation = envelope.operation;
			if (
				typeof operation !== "string" ||
				!BILLING_OPERATIONS.has(operation as BillingRuntimeDispatchOperation)
			) {
				return jsonError(
					{
						code: "ATHENA_BILLING_INVALID_REQUEST",
						message: "operation is required",
					},
					400,
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
				return jsonError(
					principalFailure(resolution.failure),
					resolution.failure.status,
				);
			}

			try {
				const data = await runtime.execute(
					operation as BillingRuntimeDispatchOperation,
					envelope.payload,
					resolution.resolved.principal,
				);
				return Response.json({ data, ok: true, status: 200 });
			} catch (error) {
				return encodeBillingError(error);
			}
		},
	};
}

function principalFailure(failure: AthenaPrincipalResolutionFailure): {
	code: string;
	message: string;
} {
	if (failure.code === "ATHENA_AUTH_ORG_NOT_ALLOWED") {
		return {
			code: "ATHENA_BILLING_AUTHORIZATION_DENIED",
			message: failure.message,
		};
	}
	return {
		code: "ATHENA_BILLING_UNAUTHENTICATED",
		message: failure.message,
	};
}

function encodeBillingError(error: unknown): Response {
	if (isAthenaBillingAuthorizationError(error)) {
		return jsonError(
			{
				code: error.code,
				message: error.message,
				missing: error.missing,
			},
			error.status,
		);
	}
	if (isAthenaBillingCapabilityError(error)) {
		return jsonError(
			{
				code: error.code,
				message: error.message,
				reason: error.reason,
			},
			error.reason === "unsupported_operation" ? 400 : 503,
		);
	}
	const message = error instanceof Error ? error.message : String(error);
	const money = /ATHENA_BILLING_MONEY_|ATHENA_BILLING_IDEMPOTENCY/.test(
		message,
	);
	return jsonError(
		{
			code: money ? "ATHENA_BILLING_INVALID_REQUEST" : "ATHENA_BILLING_INTERNAL",
			message,
		},
		money ? 400 : 500,
	);
}

function jsonError(
	error: { code: string; message: string; missing?: readonly string[]; reason?: string },
	status: number,
): Response {
	return Response.json({ error, ok: false, status }, { status });
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}
