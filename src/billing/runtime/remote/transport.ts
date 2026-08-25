import { normalizeAthenaGatewayBaseUrl } from "../../../gateway/url.ts";
import { buildSdkHeaderValue } from "../../../sdk-version.ts";
import {
	buildAthenaRequestHeaders,
	hasHeaderIgnoreCase,
} from "../../../utils/athena-request-headers.ts";
import { AthenaBillingError } from "../../errors.ts";

const SDK_NAME = "xylex-group/athena-billing";
const SDK_HEADER_VALUE = buildSdkHeaderValue(SDK_NAME);

export type AthenaBillingHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type AthenaBillingJson =
	| null
	| boolean
	| number
	| string
	| AthenaBillingJson[]
	| { [key: string]: AthenaBillingJson };

export interface AthenaBillingCallOptions {
	apiKey?: string | null;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

export interface AthenaBillingClientConfig {
	apiKey: string;
	baseUrl: string;
	client?: string | null;
	fetchImpl?: typeof fetch;
	headers?: Record<string, string>;
}

export interface AthenaBillingEnvelope<T = unknown> {
	data: T;
	message?: string;
	status?: string;
}

export function withPathParam(
	path: string,
	name: string,
	value: string,
): string {
	return path.replace(`{${name}}`, encodeURIComponent(value));
}

export function appendQuery(
	path: string,
	query?: Record<string, string | number | boolean | null | undefined>,
): string {
	if (!query) {
		return path;
	}
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null) {
			continue;
		}
		params.set(key, String(value));
	}
	const serialized = params.toString();
	return serialized ? `${path}?${serialized}` : path;
}

export function parseEnvelopeData<T>(body: unknown): T {
	if (body && typeof body === "object" && "data" in body) {
		return (body as AthenaBillingEnvelope<T>).data;
	}
	return body as T;
}

export interface BillingHttpTransport {
	call<T>(
		method: AthenaBillingHttpMethod,
		path: string,
		body?: unknown,
		options?: AthenaBillingCallOptions,
		responseType?: "json" | "text",
	): Promise<T>;
}

export function createBillingHttpTransport(
	config: AthenaBillingClientConfig,
): BillingHttpTransport {
	const baseUrl = normalizeAthenaGatewayBaseUrl(config.baseUrl, {
		label: "Athena billing base URL",
	});
	const fetchImpl =
		config.fetchImpl ??
		((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
			globalThis.fetch(input, init));

	async function call<T>(
		method: AthenaBillingHttpMethod,
		path: string,
		body?: unknown,
		options?: AthenaBillingCallOptions,
		responseType: "json" | "text" = "json",
	): Promise<T> {
		const headers = buildAthenaRequestHeaders({
			apiKey: options?.apiKey ?? config.apiKey,
			callHeaders: options?.headers,
			client: config.client,
			configHeaders: {
				...(config.headers ?? {}),
			},
			contentType: "application/json",
			profile: "gateway",
			sdkHeaderValue: SDK_HEADER_VALUE,
		});

		let requestBody: BodyInit | undefined;
		if (body !== undefined && body !== null) {
			if (
				typeof body === "string" ||
				body instanceof Blob ||
				body instanceof ArrayBuffer ||
				ArrayBuffer.isView(body) ||
				body instanceof FormData ||
				body instanceof URLSearchParams
			) {
				requestBody = body as BodyInit;
			} else {
				requestBody = JSON.stringify(body);
				if (!hasHeaderIgnoreCase(headers, "Content-Type")) {
					headers["Content-Type"] = "application/json";
				}
			}
		}

		const targetUrl = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
		const response = await fetchImpl(targetUrl, {
			body: requestBody,
			headers,
			method,
			signal: options?.signal,
		});

		if (responseType === "text") {
			const text = await response.text();
			if (!response.ok) {
				throw new AthenaBillingError({
					body: text,
					endpoint: path,
					message: `Billing request failed (${response.status})`,
					method,
					status: response.status,
				});
			}
			return text as T;
		}

		const rawText = await response.text();
		let parsed: unknown = rawText;
		if (rawText) {
			try {
				parsed = JSON.parse(rawText);
			} catch {
				parsed = rawText;
			}
		} else {
			parsed = null;
		}

		if (!response.ok) {
			const message =
				parsed &&
				typeof parsed === "object" &&
				"message" in parsed &&
				typeof (parsed as { message: unknown }).message === "string"
					? (parsed as { message: string }).message
					: `Billing request failed (${response.status})`;
			throw new AthenaBillingError({
				body: parsed,
				endpoint: path,
				message,
				method,
				status: response.status,
			});
		}

		return parseEnvelopeData<T>(parsed);
	}

	return { call };
}
