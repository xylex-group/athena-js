import { AthenaConfigurationError } from "../../config/errors.ts";
import type { AthenaRightContribution } from "../../rights/contribution.ts";
import { resolveAthenaRightsIr } from "../../rights/resolver.ts";
import type { AthenaRightDefinition } from "../../rights/types.ts";
import {
	type AthenaApplicationRightInput,
	toAthenaApplicationRightContributions,
} from "./application-rights.ts";
import { createAthenaModelAuthorizationBindingRegistry } from "./binding-registry.ts";
import {
	ATHENA_AUTHORIZATION_CLIENT_CONFIG_IR_VERSION,
	ATHENA_AUTHORIZATION_CLIENT_CONFIG_KIND,
	ATHENA_AUTHORIZATION_SERVER_AUTHORITY_REQUIRED,
	ATHENA_AUTHORIZATION_UNSUPPORTED_SUBJECT,
	type AthenaAuthorizationRuntimeConfigInput,
	type AthenaAuthorizationTrustedSubject,
	type AthenaAuthorizationUnmatchedResourceMode,
	type AthenaClientAuthorizationConfigInput,
	type NormalizedAthenaAuthorizationConfig,
} from "./config.ts";
import { getAthenaAuthorizationRightsIr } from "./catalog.ts";
import type {
	AthenaModelAuthorizationBinding,
	AthenaModelAuthorizationBindingInput,
} from "./model-binding.ts";
import { resolveAthenaAuthorizationIrState } from "./state.ts";

type AthenaScopeKind = "organization" | "tenant" | "user";

const SUBJECT_BY_SCOPE: Readonly<Record<AthenaScopeKind, AthenaAuthorizationTrustedSubject>> =
	Object.freeze({
		organization: "organizationId",
		tenant: "tenantId",
		user: "userId",
	});

function configError(message: string): never {
	throw new AthenaConfigurationError(
		"ATHENA_RUNTIME_CONFIG_INVALID",
		message,
		"db",
	);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
}

function normalizeOptional(value: string | null | undefined): string | undefined {
	const token = value?.trim();
	return token ? token : undefined;
}

function assertArray(field: string, value: unknown): readonly unknown[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		configError(`${field} must be an array when provided`);
	}
	return value;
}

function normalizeRightsInput(
	value: AthenaClientAuthorizationConfigInput["rights"],
): readonly AthenaApplicationRightInput[] {
	if (value === undefined) {
		return [];
	}
	return assertArray("authorization.rights", value) as readonly AthenaApplicationRightInput[];
}

function normalizeBindingInput(
	value: AthenaClientAuthorizationConfigInput["data"],
): readonly (AthenaModelAuthorizationBinding | AthenaModelAuthorizationBindingInput)[] {
	if (value === undefined) {
		return [];
	}
	return assertArray("authorization.data", value) as readonly (
		| AthenaModelAuthorizationBinding
		| AthenaModelAuthorizationBindingInput
	)[];
}

function normalizeUnmatchedResources(
	value: AthenaClientAuthorizationConfigInput["unmatchedResources"],
): AthenaAuthorizationUnmatchedResourceMode {
	if (value === undefined) {
		return "allow";
	}
	if (value !== "allow" && value !== "deny") {
		configError(
			"authorization.unmatchedResources must be allow or deny when provided",
		);
	}
	return value;
}

function normalizeAuthorizationBag(
	authorization: AthenaAuthorizationRuntimeConfigInput["authorization"],
): AthenaClientAuthorizationConfigInput {
	if (authorization == null) {
		return {};
	}
	if (!asRecord(authorization)) {
		configError("authorization must be an object when provided");
	}
	return authorization;
}

function hasServerAuthority(input: AthenaAuthorizationRuntimeConfigInput): boolean {
	if (input.gatewayTransport) {
		return true;
	}
	if (input.d1 !== undefined && input.d1 !== null) {
		return true;
	}
	if (input.db?.d1 !== undefined && input.db.d1 !== null) {
		return true;
	}
	if (input.db?.pool) {
		return true;
	}
	if (normalizeOptional(input.databaseUrl)) {
		return true;
	}
	if (normalizeOptional(input.db?.pgUri)) {
		return true;
	}
	return false;
}

function isHostedRuntime(input: AthenaAuthorizationRuntimeConfigInput): boolean {
	return Boolean(normalizeOptional(input.url) ?? normalizeOptional(input.db?.url));
}

function normalizeBuiltInSource(definition: AthenaRightDefinition): string {
	switch (definition.domain) {
		case "billing":
			return "billing";
		case "storage":
			return "storage";
		default:
			return "authorization";
	}
}

function baseCatalogContributions(): readonly AthenaRightContribution[] {
	const builtIn = getAthenaAuthorizationRightsIr();
	return builtIn.rights.map((definition) => ({
		definition,
		source: normalizeBuiltInSource(definition),
	}));
}

function asScopeKind(value: unknown): AthenaScopeKind | undefined {
	switch (value) {
		case "organization":
		case "tenant":
		case "user":
			return value;
		default:
			return;
	}
}

function assertSupportedScopeSubjects(
	bindings: readonly unknown[],
): void {
	for (const [index, entry] of bindings.entries()) {
		const input = asRecord(entry);
		if (!input) {
			continue;
		}
		const scope = asRecord(input.scope);
		if (!scope || !Object.hasOwn(scope, "subject")) {
			continue;
		}
		const subject = scope.subject;
		if (subject !== "organizationId" && subject !== "tenantId" && subject !== "userId") {
			configError(
				`${ATHENA_AUTHORIZATION_UNSUPPORTED_SUBJECT}: authorization.data[${String(index)}].scope.subject "${String(subject)}" is not supported`,
			);
		}
		const scopeKind = asScopeKind(scope.kind);
		if (!scopeKind) {
			configError(
				`${ATHENA_AUTHORIZATION_UNSUPPORTED_SUBJECT}: authorization.data[${String(index)}].scope.kind must be organization|tenant|user when scope.subject is provided`,
			);
		}
		const expected = SUBJECT_BY_SCOPE[scopeKind];
		if (subject !== expected) {
			configError(
				`${ATHENA_AUTHORIZATION_UNSUPPORTED_SUBJECT}: authorization.data[${String(index)}].scope.subject "${String(subject)}" does not match scope.kind "${scopeKind}"`,
			);
		}
	}
}

/**
 * Normalize additive root `createClient({ authorization: { rights, data } })`.
 * INT wires this into constructor and request-view propagation.
 */
export function normalizeAthenaAuthorizationConfig(
	input: AthenaAuthorizationRuntimeConfigInput,
): NormalizedAthenaAuthorizationConfig {
	const authorization = normalizeAuthorizationBag(input.authorization);
	const rightsInputs = normalizeRightsInput(authorization.rights);
	const bindingInputs = normalizeBindingInput(authorization.data);
	const unmatchedResources = normalizeUnmatchedResources(
		authorization.unmatchedResources,
	);

	assertSupportedScopeSubjects(bindingInputs);

	if (
		bindingInputs.length > 0 &&
		isHostedRuntime(input) &&
		!hasServerAuthority(input)
	) {
		configError(
			`${ATHENA_AUTHORIZATION_SERVER_AUTHORITY_REQUIRED}: authorization.data requires server authority in hosted mode`,
		);
	}

	const rights = resolveAthenaRightsIr(
		[
			...baseCatalogContributions(),
			...toAthenaApplicationRightContributions(
				rightsInputs,
				"authorization.rights",
			),
		],
		{ provenance: ["authorization"] },
	);
	const rightsState = resolveAthenaAuthorizationIrState({ rightsIr: rights });

	const bindingRegistry =
		bindingInputs.length > 0
			? createAthenaModelAuthorizationBindingRegistry(
					bindingInputs,
					{ models: input.models },
				)
			: undefined;

	return Object.freeze({
		...(bindingRegistry
			? {
					bindingRegistry,
					registryFingerprint: bindingRegistry.fingerprint,
				}
			: {}),
		hasDataBindings: bindingRegistry !== undefined,
		irVersion: ATHENA_AUTHORIZATION_CLIENT_CONFIG_IR_VERSION,
		kind: ATHENA_AUTHORIZATION_CLIENT_CONFIG_KIND,
		rightsState,
		unmatchedResources,
	});
}
