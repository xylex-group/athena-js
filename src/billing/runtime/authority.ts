import type {
	BillingOperationCapability,
	BillingOperationCapabilityReason,
} from "./capabilities.ts";

export type BillingAuthoritySource = "derived" | "declared" | "provider";

export type BillingAuthorityScope =
	| { kind: "organization" }
	| { kind: "profile"; profileId?: string };

export interface BillingCredentialAuthority {
	readonly source: BillingAuthoritySource;
	readonly modes: {
		readonly test: boolean;
		readonly live: boolean;
	};
	readonly scope: BillingAuthorityScope;
	readonly permissions: Readonly<Record<string, boolean>>;
}

export function grantedPermissionsFromAuthority(
	authority: BillingCredentialAuthority,
): ReadonlySet<string> {
	const granted = new Set<string>();
	for (const [permission, allowed] of Object.entries(authority.permissions)) {
		if (allowed) {
			granted.add(permission);
		}
	}
	return granted;
}

export function authorityAllowsMode(
	authority: BillingCredentialAuthority,
	environment: "test" | "live",
): boolean {
	return authority.modes[environment] === true;
}

export function authorityAllowsProfile(
	authority: BillingCredentialAuthority,
	requestedProfileId?: string | null,
): boolean {
	if (authority.scope.kind === "organization") {
		return true;
	}
	const restricted = authority.scope.profileId;
	const requested =
		requestedProfileId != null && requestedProfileId.length > 0
			? requestedProfileId
			: undefined;
	if (restricted == null || restricted.length === 0) {
		return requested == null;
	}
	if (requested == null) {
		return true;
	}
	return requested === restricted;
}

export function evaluateBillingOperationCapability(input: {
	grantedPermissions: ReadonlySet<string>;
	implemented: boolean;
	requiredPermissions: readonly string[];
	scopeAllowed: boolean;
	selectedModeAllowed: boolean;
	anyCredentialConfigured: boolean;
}): BillingOperationCapability {
	if (!input.implemented) {
		return unavailable("unsupported_operation");
	}
	if (!input.anyCredentialConfigured) {
		return unavailable("missing_credential");
	}
	if (!input.selectedModeAllowed) {
		return unavailable("missing_provider_scope");
	}
	if (!input.scopeAllowed) {
		return unavailable("missing_provider_scope");
	}
	for (const permission of input.requiredPermissions) {
		if (!input.grantedPermissions.has(permission)) {
			return unavailable("missing_permission");
		}
	}
	return { available: true };
}

function unavailable(
	reason: BillingOperationCapabilityReason,
): BillingOperationCapability {
	return { available: false, reason };
}
