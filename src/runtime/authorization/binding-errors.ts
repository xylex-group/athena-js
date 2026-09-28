import { AthenaConfigurationError } from "../../config/errors.ts";

export type AthenaAuthorizationBindingErrorCode =
	| "ATHENA_AUTHORIZATION_BINDING_INVALID_RESOURCE"
	| "ATHENA_AUTHORIZATION_BINDING_INVALID_SCOPE"
	| "ATHENA_AUTHORIZATION_BINDING_UNKNOWN_MODEL"
	| "ATHENA_AUTHORIZATION_BINDING_UNKNOWN_COLUMN"
	| "ATHENA_AUTHORIZATION_BINDING_DUPLICATE_RESOURCE"
	| "ATHENA_AUTHORIZATION_BINDING_CONFLICTING_RESOURCE";

export class AthenaAuthorizationBindingError extends AthenaConfigurationError {
	readonly bindingCode: AthenaAuthorizationBindingErrorCode;
	readonly details?: Readonly<Record<string, string>>;

	constructor(
		bindingCode: AthenaAuthorizationBindingErrorCode,
		message: string,
		details?: Readonly<Record<string, string>>,
		options?: { cause?: unknown },
	) {
		super(
			"ATHENA_RUNTIME_CONFIG_INVALID",
			`${bindingCode}: ${message}`,
			"db",
			options,
		);
		this.name = "AthenaAuthorizationBindingError";
		this.bindingCode = bindingCode;
		this.details = details;
	}
}

export function authorizationBindingError(
	bindingCode: AthenaAuthorizationBindingErrorCode,
	message: string,
	details?: Readonly<Record<string, string>>,
	options?: { cause?: unknown },
): never {
	throw new AthenaAuthorizationBindingError(
		bindingCode,
		message,
		details,
		options,
	);
}
