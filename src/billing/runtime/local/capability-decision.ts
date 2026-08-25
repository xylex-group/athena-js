import {
	authorityAllowsMode,
	authorityAllowsProfile,
	evaluateBillingOperationCapability,
	grantedPermissionsFromAuthority,
	type BillingCredentialAuthority,
} from "../authority.ts";
import type {
	BillingOperation,
	BillingOperationCapability,
} from "../capabilities.ts";
import { requiredMolliePermissionsFor } from "./providers/operation-authority.ts";

function mollieCreateHasProfileSelector(input: {
	configuredProfileId?: string | null;
	credentialKind?: string | null;
	requestedProfileId?: string | null;
}): boolean {
	if (input.credentialKind == null || input.credentialKind === "api_key") {
		return true;
	}
	const requested = input.requestedProfileId;
	if (requested != null && requested.length > 0) {
		return true;
	}
	const configured = input.configuredProfileId;
	return configured != null && configured.length > 0;
}

export function requiredPermissionsFor(
	provider: string,
	operation: BillingOperation,
): readonly string[] {
	return provider === "mollie" ? requiredMolliePermissionsFor(operation) : [];
}

export function scopeAllowedForOperation(input: {
	authority?: BillingCredentialAuthority;
	operation: BillingOperation;
	provider: string;
	providerConfig: Readonly<Record<string, unknown>>;
	requestedProfileId?: string | null;
}): boolean {
	const authorityAllows =
		input.authority == null
			? true
			: authorityAllowsProfile(input.authority, input.requestedProfileId);
	if (!authorityAllows) {
		return false;
	}
	if (input.provider !== "mollie" || input.operation !== "payments.create") {
		return true;
	}
	const credentialKind = input.providerConfig.credentialKind;
	const configuredProfileId = input.providerConfig.profileId;
	return mollieCreateHasProfileSelector({
		configuredProfileId:
			typeof configuredProfileId === "string" || configuredProfileId === null
				? configuredProfileId
				: undefined,
		credentialKind:
			typeof credentialKind === "string" ? credentialKind : undefined,
		requestedProfileId: input.requestedProfileId,
	});
}

export function decideLocalBillingOperationCapability(input: {
	anyCredentialConfigured: boolean;
	authority?: BillingCredentialAuthority;
	operation: BillingOperation;
	portAvailable: boolean;
	provider: string;
	providerConfig: Readonly<Record<string, unknown>>;
	providerOperationEnabled: boolean;
	requestedProfileId?: string | null;
	selectedModeAllowed: boolean;
}): BillingOperationCapability {
	const implemented =
		input.portAvailable && input.providerOperationEnabled;
	const requiredPermissions = requiredPermissionsFor(
		input.provider,
		input.operation,
	);
	return evaluateBillingOperationCapability({
		anyCredentialConfigured: input.anyCredentialConfigured,
		grantedPermissions: input.authority
			? grantedPermissionsFromAuthority(input.authority)
			: implemented
				? new Set(requiredPermissions)
				: new Set(),
		implemented,
		requiredPermissions,
		scopeAllowed: scopeAllowedForOperation({
			authority: input.authority,
			operation: input.operation,
			provider: input.provider,
			providerConfig: input.providerConfig,
			requestedProfileId: input.requestedProfileId,
		}),
		selectedModeAllowed: input.selectedModeAllowed,
	});
}

export function selectedModeAllowedForCapability(input: {
	authority?: BillingCredentialAuthority;
	selectedCredentialConfigured: boolean;
	selectedEnvironment: "test" | "live";
}): boolean {
	return input.authority == null
		? input.selectedCredentialConfigured
		: authorityAllowsMode(input.authority, input.selectedEnvironment);
}
