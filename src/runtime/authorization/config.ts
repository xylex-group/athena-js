import type {
	AthenaModelAuthorizationBinding,
	AthenaModelAuthorizationBindingInput,
} from "./model-binding.ts";
import type { AthenaApplicationRightInput } from "./application-rights.ts";
import type { AthenaModelAuthorizationBindingRegistry } from "./binding-registry.ts";
import type { AthenaAuthorizationIrState } from "./state.ts";

export const ATHENA_AUTHORIZATION_CLIENT_CONFIG_KIND =
	"athena.authorization.client-config" as const;
export const ATHENA_AUTHORIZATION_CLIENT_CONFIG_IR_VERSION = 1 as const;

export const ATHENA_AUTHORIZATION_UNSUPPORTED_SUBJECT =
	"ATHENA_AUTHORIZATION_UNSUPPORTED_SUBJECT" as const;
export const ATHENA_AUTHORIZATION_SERVER_AUTHORITY_REQUIRED =
	"ATHENA_AUTHORIZATION_SERVER_AUTHORITY_REQUIRED" as const;
export type AthenaAuthorizationUnmatchedResourceMode = "allow" | "deny";

export type AthenaAuthorizationTrustedSubject =
	| "organizationId"
	| "tenantId"
	| "userId";

export interface AthenaClientAuthorizationConfigInput {
	data?: readonly (
		| AthenaModelAuthorizationBinding
		| AthenaModelAuthorizationBindingInput
	)[];
	rights?: readonly AthenaApplicationRightInput[];
	unmatchedResources?: AthenaAuthorizationUnmatchedResourceMode;
}

export interface AthenaAuthorizationRuntimeConfigInput {
	auth?: unknown;
	authorization?: AthenaClientAuthorizationConfigInput | null;
	d1?: unknown;
	databaseUrl?: string | null;
	db?: {
		d1?: unknown;
		pgUri?: string | null;
		pool?: unknown;
		url?: string | null;
	};
	gatewayTransport?: unknown;
	models?: unknown;
	url?: string | null;
}

export interface NormalizedAthenaAuthorizationConfig {
	readonly bindingRegistry?: AthenaModelAuthorizationBindingRegistry;
	readonly hasDataBindings: boolean;
	readonly irVersion: typeof ATHENA_AUTHORIZATION_CLIENT_CONFIG_IR_VERSION;
	readonly kind: typeof ATHENA_AUTHORIZATION_CLIENT_CONFIG_KIND;
	readonly registryFingerprint?: string;
	readonly rightsState: AthenaAuthorizationIrState;
	readonly unmatchedResources: AthenaAuthorizationUnmatchedResourceMode;
}
