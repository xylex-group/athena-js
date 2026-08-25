import {
	type AthenaAuthCapabilitiesResult,
	isCapabilityEnabled,
} from "../capabilities.ts";
import type {
	AthenaAuthCallOptions,
	AthenaAuthEndpointPath,
	AthenaAuthFetchCompatibleInput,
	AthenaAuthMethod,
	AthenaAuthQueryPrimitive,
	AthenaAuthQueryValue,
	AthenaAuthResult,
	AthenaAuthSessionResponse,
	AthenaPasskeyOptionsResponse,
	AthenaPasskeyRecord,
	AthenaPasskeyRegisterRequest,
	AthenaPasskeySignInRequest,
	AthenaPasskeyVerifyAuthenticationResponse,
} from "../types.ts";
import {
	createPasskeyCredential,
	creationOptionsFromWire,
	getPasskeyCredential,
	noAssertionDiagnostic,
	requestOptionsFromWire,
	serializeAssertedPasskey,
	serializeCreatedPasskey,
} from "./browser/ceremony.ts";
import type {
	AthenaPasskeyBindings,
	CreatePasskeyModuleDeps,
	PasskeyModuleCapabilities,
} from "./contract.ts";
import {
	extractPasskeyFetchOptions,
	extractPasskeyQuery,
	mergePasskeyCallOptions,
	normalizePasskeyRecord,
	normalizePasskeyResult,
} from "./normalize.ts";
import { PASSKEY_REQUESTS } from "./requests.ts";

function resolveCapabilitiesSnapshot(
	capabilities: PasskeyModuleCapabilities,
): AthenaAuthCapabilitiesResult {
	if ("getSnapshot" in capabilities) {
		return capabilities.getSnapshot();
	}
	return capabilities;
}

function capabilityDisabled(
	feature: string,
	endpoint: AthenaAuthEndpointPath,
	method: AthenaAuthMethod = "POST",
): AthenaAuthResult<never> {
	return {
		data: null,
		error: `${feature} is not enabled on this Athena Auth runtime`,
		errorDetails: {
			code: "ATHENA_AUTH_CAPABILITY_DISABLED",
			endpoint,
			hint: feature,
			message: `${feature} is not enabled on this Athena Auth runtime`,
			method,
			status: 501,
		},
		ok: false,
		raw: {
			error: {
				code: "ATHENA_AUTH_CAPABILITY_DISABLED",
				feature,
				status: 501,
			},
		},
		status: 501,
	};
}

function denyPasskeys(
	capabilities: PasskeyModuleCapabilities,
	endpoint: AthenaAuthEndpointPath,
	method: AthenaAuthMethod = "POST",
): AthenaAuthResult<never> | null {
	const snap = resolveCapabilitiesSnapshot(capabilities);
	if (snap.status !== "known" || isCapabilityEnabled(snap, "passkeys")) {
		return null;
	}
	return capabilityDisabled("passkeys", endpoint, method);
}

function gateCapability<T>(
	denied: AthenaAuthResult<never> | null,
	run: () => Promise<AthenaAuthResult<T>>,
): Promise<AthenaAuthResult<T>> {
	return denied ? Promise.resolve(denied as AthenaAuthResult<T>) : run();
}

function asSessionResponse(value: unknown): AthenaAuthSessionResponse | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	const session = record.session;
	const user = record.user;
	if (
		!(
			session &&
			typeof session === "object" &&
			typeof (session as { id?: unknown }).id === "string" &&
			user &&
			typeof user === "object" &&
			typeof (user as { id?: unknown }).id === "string"
		)
	) {
		return null;
	}
	return {
		session: session as AthenaAuthSessionResponse["session"],
		user: user as AthenaAuthSessionResponse["user"],
	};
}

function ceremonyFailed(
	message: string,
	endpoint: AthenaAuthEndpointPath,
	method: AthenaAuthMethod = "POST",
): AthenaAuthResult<never> {
	return {
		data: null,
		error: message,
		errorDetails: {
			code: "UNKNOWN_ERROR",
			endpoint,
			message,
			method,
			status: 400,
		},
		ok: false,
		raw: { error: { message, status: 400 } },
		status: 400,
	};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

function trimmedField(
	record: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = record?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isQueryPrimitive(value: unknown): value is AthenaAuthQueryPrimitive {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

function asQueryRecord(value: unknown): Record<string, AthenaAuthQueryValue> {
	const record = asRecord(value);
	if (!record) {
		return {};
	}
	const query: Record<string, AthenaAuthQueryValue> = {};
	for (const [key, entry] of Object.entries(record)) {
		if (entry === null || entry === undefined) {
			query[key] = entry;
			continue;
		}
		if (isQueryPrimitive(entry)) {
			query[key] = entry;
			continue;
		}
		if (Array.isArray(entry) && entry.every(isQueryPrimitive)) {
			query[key] = entry;
		}
	}
	return query;
}

/**
 * Internal passkey bindings (eight HTTP methods + register/signIn ceremony).
 * Successful `verifyAuthentication` accepts into the canonical session store.
 */
export function createPasskeyModule(
	deps: CreatePasskeyModuleDeps,
): AthenaPasskeyBindings {
	const { capabilities, request, sessionController } = deps;

	const getPasskey = <T>(
		path: AthenaAuthEndpointPath,
		input?: AthenaAuthFetchCompatibleInput,
		options?: AthenaAuthCallOptions,
	) => {
		const { fetchOptions } = extractPasskeyFetchOptions(input);
		return request<T>(
			{
				endpoint: path,
				fetchOptions,
				method: "GET",
				query: extractPasskeyQuery(input),
			},
			options,
		).then(normalizePasskeyResult);
	};

	const postPasskey = <T>(
		path: AthenaAuthEndpointPath,
		input?: AthenaAuthFetchCompatibleInput & {
			autoFill?: unknown;
			email?: unknown;
			name?: unknown;
			query?: unknown;
			response?: unknown;
			userId?: unknown;
		},
		options?: AthenaAuthCallOptions,
	) => {
		const { payload, fetchOptions } = extractPasskeyFetchOptions(input);
		return request<T>(
			{
				body: payload ?? {},
				endpoint: path,
				fetchOptions,
				method: "POST",
			},
			mergePasskeyCallOptions(undefined, options),
		).then(normalizePasskeyResult);
	};

	const registerPasskey = async (
		input?: AthenaPasskeyRegisterRequest & AthenaAuthFetchCompatibleInput,
		options?: AthenaAuthCallOptions,
	): Promise<AthenaAuthResult<AthenaPasskeyRecord>> => {
		const denied = denyPasskeys(
			capabilities,
			PASSKEY_REQUESTS.generateRegisterOptions.path,
			PASSKEY_REQUESTS.generateRegisterOptions.method,
		);
		if (denied) {
			return denied as AthenaAuthResult<AthenaPasskeyRecord>;
		}
		const { payload, fetchOptions } = extractPasskeyFetchOptions(input);
		const record = asRecord(payload);
		const email = trimmedField(record, "email");
		const name = trimmedField(record, "name");
		const query: Record<string, AthenaAuthQueryValue> = asQueryRecord(
			record?.query,
		);
		if (email) {
			query.email = email;
		}
		if (name) {
			query.name = name;
		}
		const optionsResult = await getPasskey<AthenaPasskeyOptionsResponse>(
			PASSKEY_REQUESTS.generateRegisterOptions.path,
			{
				...(fetchOptions ? { fetchOptions } : {}),
				...(Object.keys(query).length > 0 ? { query } : {}),
			},
			options,
		);
		if (!optionsResult.ok || !optionsResult.data) {
			return optionsResult as AthenaAuthResult<AthenaPasskeyRecord>;
		}
		let credential: Credential | null;
		try {
			const publicKey = creationOptionsFromWire(optionsResult.data, record);
			credential = await createPasskeyCredential(
				publicKey,
				fetchOptions?.signal,
			);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "browser returned no assertion";
			return ceremonyFailed(
				message,
				PASSKEY_REQUESTS.verifyRegistration.path,
			) as AthenaAuthResult<AthenaPasskeyRecord>;
		}
		if (!credential) {
			return ceremonyFailed(
				"browser returned no assertion",
				PASSKEY_REQUESTS.verifyRegistration.path,
			) as AthenaAuthResult<AthenaPasskeyRecord>;
		}
		return postPasskey<AthenaPasskeyRecord>(
			PASSKEY_REQUESTS.verifyRegistration.path,
			{
				...(email ? { email } : {}),
				...(fetchOptions ? { fetchOptions } : {}),
				...(name ? { name } : {}),
				response: serializeCreatedPasskey(credential),
			},
			options,
		);
	};

	const signInPasskey = async (
		input?: AthenaPasskeySignInRequest & AthenaAuthFetchCompatibleInput,
		options?: AthenaAuthCallOptions,
	): Promise<AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>> => {
		const denied = denyPasskeys(
			capabilities,
			PASSKEY_REQUESTS.generateAuthenticateOptions.path,
			PASSKEY_REQUESTS.generateAuthenticateOptions.method,
		);
		if (denied) {
			return denied as AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>;
		}
		const { payload, fetchOptions } = extractPasskeyFetchOptions(input);
		const record = asRecord(payload);
		const email = trimmedField(record, "email");
		const userId = trimmedField(record, "userId");
		const autoFill = record?.autoFill === true;
		const optionsResult = await postPasskey<AthenaPasskeyOptionsResponse>(
			PASSKEY_REQUESTS.generateAuthenticateOptions.path,
			{
				...(email ? { email } : {}),
				...(fetchOptions ? { fetchOptions } : {}),
				...(userId ? { userId } : {}),
			},
			options,
		);
		if (!optionsResult.ok || !optionsResult.data) {
			return optionsResult as AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>;
		}
		const allowCredentials = optionsResult.data.allowCredentials ?? [];
		let credential: Credential | null;
		try {
			credential = await getPasskeyCredential(
				requestOptionsFromWire(optionsResult.data),
				autoFill ? "conditional" : "optional",
				fetchOptions?.signal,
			);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: noAssertionDiagnostic({
							allowCredentialsCount: allowCredentials.length,
							residentKey: null,
						});
			return ceremonyFailed(
				message,
				PASSKEY_REQUESTS.verifyAuthentication.path,
			) as AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>;
		}
		if (!credential) {
			return ceremonyFailed(
				noAssertionDiagnostic({
					allowCredentialsCount: allowCredentials.length,
					residentKey: null,
				}),
				PASSKEY_REQUESTS.verifyAuthentication.path,
			) as AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>;
		}
		const result = await postPasskey<AthenaPasskeyVerifyAuthenticationResponse>(
			PASSKEY_REQUESTS.verifyAuthentication.path,
			{
				...(fetchOptions ? { fetchOptions } : {}),
				response: serializeAssertedPasskey(credential),
			},
			options,
		);
		if (result.ok) {
			const session = asSessionResponse(result.data);
			if (session) {
				sessionController.accept(session);
			}
		}
		return result;
	};

	return {
		deletePasskey: (input, options) =>
			gateCapability(
				denyPasskeys(
					capabilities,
					PASSKEY_REQUESTS.deletePasskey.path,
					PASSKEY_REQUESTS.deletePasskey.method,
				),
				() => postPasskey(PASSKEY_REQUESTS.deletePasskey.path, input, options),
			),
		generateAuthenticateOptions: (input, options) =>
			gateCapability(
				denyPasskeys(
					capabilities,
					PASSKEY_REQUESTS.generateAuthenticateOptions.path,
					PASSKEY_REQUESTS.generateAuthenticateOptions.method,
				),
				() =>
					postPasskey(
						PASSKEY_REQUESTS.generateAuthenticateOptions.path,
						input,
						options,
					),
			),
		generateRegisterOptions: (input, options) =>
			gateCapability(
				denyPasskeys(
					capabilities,
					PASSKEY_REQUESTS.generateRegisterOptions.path,
					PASSKEY_REQUESTS.generateRegisterOptions.method,
				),
				() =>
					getPasskey(
						PASSKEY_REQUESTS.generateRegisterOptions.path,
						input,
						options,
					),
			),
		getRelatedOrigins: (input, options) =>
			getPasskey(PASSKEY_REQUESTS.getRelatedOrigins.path, input, options),
		register: (input, options) => registerPasskey(input, options),
		signIn: (input, options) => signInPasskey(input, options),
		listUserPasskeys: (input, options) =>
			gateCapability(
				denyPasskeys(
					capabilities,
					PASSKEY_REQUESTS.listUserPasskeys.path,
					PASSKEY_REQUESTS.listUserPasskeys.method,
				),
				() =>
					getPasskey<AthenaPasskeyRecord[]>(
						PASSKEY_REQUESTS.listUserPasskeys.path,
						input,
						options,
					).then((result) => {
						if (result.ok && Array.isArray(result.data)) {
							return {
								...result,
								data: result.data.map((row) =>
									normalizePasskeyRecord(row as AthenaPasskeyRecord),
								),
							};
						}
						return result;
					}),
			),
		updatePasskey: (input, options) =>
			gateCapability(
				denyPasskeys(
					capabilities,
					PASSKEY_REQUESTS.updatePasskey.path,
					PASSKEY_REQUESTS.updatePasskey.method,
				),
				() => postPasskey(PASSKEY_REQUESTS.updatePasskey.path, input, options),
			),
		verifyAuthentication: (input, options) =>
			gateCapability(
				denyPasskeys(
					capabilities,
					PASSKEY_REQUESTS.verifyAuthentication.path,
					PASSKEY_REQUESTS.verifyAuthentication.method,
				),
				async () => {
					const result =
						await postPasskey<AthenaPasskeyVerifyAuthenticationResponse>(
							PASSKEY_REQUESTS.verifyAuthentication.path,
							input,
							options,
						);
					if (result.ok) {
						const session = asSessionResponse(result.data);
						if (session) {
							sessionController.accept(session);
						}
					}
					return result;
				},
			),
		verifyRegistration: (input, options) =>
			gateCapability(
				denyPasskeys(
					capabilities,
					PASSKEY_REQUESTS.verifyRegistration.path,
					PASSKEY_REQUESTS.verifyRegistration.method,
				),
				() =>
					postPasskey(PASSKEY_REQUESTS.verifyRegistration.path, input, options),
			),
	};
}
