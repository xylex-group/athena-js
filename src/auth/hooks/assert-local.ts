import { AthenaConfigurationError } from "../../config/errors.ts";
import {
	isDisabledAthenaAuthConfig,
	isLocalAthenaAuthConfig,
} from "../config.ts";

export function assertLocalAuthHooks(auth: unknown): void {
	if (!auth || typeof auth !== "object") {
		return;
	}
	const raw = auth as Record<string, unknown>;
	if (!("hooks" in raw) || raw.hooks === undefined) {
		return;
	}
	if (isDisabledAthenaAuthConfig(auth) || !isLocalAthenaAuthConfig(auth)) {
		throw new AthenaConfigurationError(
			"ATHENA_AUTH_HOOKS_REQUIRE_LOCAL_RUNTIME",
			'auth.hooks is an embedded-auth capability. Set auth.mode to "local" or omit hooks for remote Auth.',
			"auth",
		);
	}
}
