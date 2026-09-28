import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { buildAthenaRuntimeModelIndex } from "../data/model-registry.ts";
import { canonicalAthenaResource, parseAthenaResourceRef } from "../../schema/resource.ts";
import {
	authorizationBindingError,
} from "./binding-errors.ts";
import {
	type AthenaModelAuthorizationBinding,
	type AthenaModelAuthorizationBindingInput,
	authorizeModel,
	fingerprintAthenaModelAuthorizationBinding,
	serializeAthenaModelAuthorizationBinding,
} from "./model-binding.ts";

export const ATHENA_MODEL_AUTHORIZATION_BINDING_REGISTRY_KIND =
	"athena.authorization.model-binding-registry" as const;
export const ATHENA_MODEL_AUTHORIZATION_BINDING_REGISTRY_IR_VERSION = 1 as const;

interface ModelDescriptorLike {
	canonicalResource: string;
	columnIdentities?: ReadonlyMap<string, { logical: string; physical: string }>;
	columns: ReadonlySet<string>;
	model?: string;
}

export interface AthenaModelAuthorizationBindingRegistry {
	bindings: readonly AthenaModelAuthorizationBinding[];
	fingerprint: string;
	get(resource: string): AthenaModelAuthorizationBinding | undefined;
	irVersion: typeof ATHENA_MODEL_AUTHORIZATION_BINDING_REGISTRY_IR_VERSION;
	kind: typeof ATHENA_MODEL_AUTHORIZATION_BINDING_REGISTRY_KIND;
}

export interface AthenaModelAuthorizationBindingRegistryOptions {
	models?: unknown;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function semanticKey(binding: AthenaModelAuthorizationBinding): string {
	return serializeAthenaModelAuthorizationBinding(binding);
}

function resolveCanonicalResource(resource: string): string {
	return canonicalAthenaResource(parseAthenaResourceRef(resource));
}

function findDescriptor(
	binding: AthenaModelAuthorizationBinding,
	descriptors: readonly ModelDescriptorLike[],
): ModelDescriptorLike | undefined {
	const byModel = descriptors.filter(
		(entry) => entry.model === binding.resource.model,
	);
	if (byModel.length === 0) {
		return;
	}
	return (
		byModel.find(
		(entry) =>
			entry.canonicalResource === binding.resource.canonicalResource,
		) ?? byModel[0]
	);
}

function validateBindingAgainstModels(
	binding: AthenaModelAuthorizationBinding,
	descriptors: readonly ModelDescriptorLike[],
): void {
	const descriptor = findDescriptor(binding, descriptors);
	if (!descriptor) {
		authorizationBindingError(
			"ATHENA_AUTHORIZATION_BINDING_UNKNOWN_MODEL",
			`Unknown model "${binding.resource.model}"`,
			{
				model: binding.resource.model,
				resource: binding.resource.canonicalResource,
			},
		);
	}
	if (descriptor.canonicalResource !== binding.resource.canonicalResource) {
		authorizationBindingError(
			"ATHENA_AUTHORIZATION_BINDING_CONFLICTING_RESOURCE",
			`Model "${binding.resource.model}" is declared on "${binding.resource.canonicalResource}" but metadata points to "${descriptor.canonicalResource}"`,
			{
				model: binding.resource.model,
				resource: binding.resource.canonicalResource,
				resolvedResource: descriptor.canonicalResource,
			},
		);
	}
	const columns = descriptor.columns;
	if (binding.identity && !columns.has(binding.identity.column)) {
		authorizationBindingError(
			"ATHENA_AUTHORIZATION_BINDING_UNKNOWN_COLUMN",
			`identity.column "${binding.identity.column}" is not defined on model "${binding.resource.model}"`,
			{
				column: binding.identity.column,
				model: binding.resource.model,
			},
		);
	}
	if (
		binding.scope &&
		!columns.has(binding.scope.column.logical) &&
		!columns.has(binding.scope.column.physical)
	) {
		authorizationBindingError(
			"ATHENA_AUTHORIZATION_BINDING_UNKNOWN_COLUMN",
			`scope.column "${binding.scope.column.logical}" is not defined on model "${binding.resource.model}"`,
			{
				column: binding.scope.column.logical,
				model: binding.resource.model,
			},
		);
	}
}

function resolveBindingColumns(
	binding: AthenaModelAuthorizationBinding,
	descriptors: readonly ModelDescriptorLike[],
): AthenaModelAuthorizationBinding {
	if (!binding.scope) {
		return binding;
	}
	const descriptor = findDescriptor(binding, descriptors);
	const identities = descriptor?.columnIdentities;
	const resolved =
		identities?.get(binding.scope.column.logical) ??
		identities?.get(binding.scope.column.physical);
	if (!resolved) {
		return binding;
	}
	return Object.freeze({
		...binding,
		scope: Object.freeze({
			...binding.scope,
			column: Object.freeze({
				logical: resolved.logical,
				physical: resolved.physical,
			}),
		}),
	});
}

function registryFingerprint(
	bindings: readonly AthenaModelAuthorizationBinding[],
): string {
	return bytesToHex(
		sha256(
			utf8ToBytes(
				JSON.stringify({
					bindings: bindings.map((binding) => ({
						fingerprint: fingerprintAthenaModelAuthorizationBinding(binding),
						resource: binding.resource.canonicalResource,
					})),
					irVersion: ATHENA_MODEL_AUTHORIZATION_BINDING_REGISTRY_IR_VERSION,
					kind: ATHENA_MODEL_AUTHORIZATION_BINDING_REGISTRY_KIND,
				}),
			),
		),
	);
}

function freezeBindings(
	bindings: readonly AthenaModelAuthorizationBinding[],
): readonly AthenaModelAuthorizationBinding[] {
	return Object.freeze(bindings.map((binding) => Object.freeze(binding)));
}

export function createAthenaModelAuthorizationBindingRegistry(
	bindings: readonly (
		| AthenaModelAuthorizationBinding
		| AthenaModelAuthorizationBindingInput
	)[],
	options: AthenaModelAuthorizationBindingRegistryOptions = {},
): AthenaModelAuthorizationBindingRegistry {
	const descriptors =
		options.models === undefined
			? []
			: buildAthenaRuntimeModelIndex(options.models, "strict").descriptors.map(
					(descriptor) => ({
						canonicalResource: descriptor.canonicalResource,
						columnIdentities: descriptor.columnIdentities,
						columns: descriptor.columns,
						model: descriptor.model,
					}),
				);
	const canonicalBindings = bindings.map((binding) => {
		const canonical = authorizeModel(binding);
		return resolveBindingColumns(canonical, descriptors);
	});
	const sortedBindings = [...canonicalBindings].sort((left, right) => {
		const byResource = compareStrings(
			left.resource.canonicalResource,
			right.resource.canonicalResource,
		);
		if (byResource !== 0) {
			return byResource;
		}
		return compareStrings(semanticKey(left), semanticKey(right));
	});

	const byResource = new Map<string, AthenaModelAuthorizationBinding>();
	for (const binding of sortedBindings) {
		const existing = byResource.get(binding.resource.canonicalResource);
		if (!existing) {
			byResource.set(binding.resource.canonicalResource, binding);
			continue;
		}
		if (semanticKey(existing) === semanticKey(binding)) {
			authorizationBindingError(
				"ATHENA_AUTHORIZATION_BINDING_DUPLICATE_RESOURCE",
				`Duplicate authorization binding for resource "${binding.resource.canonicalResource}"`,
				{ resource: binding.resource.canonicalResource },
			);
		}
		authorizationBindingError(
			"ATHENA_AUTHORIZATION_BINDING_CONFLICTING_RESOURCE",
			`Conflicting authorization bindings for resource "${binding.resource.canonicalResource}"`,
			{ resource: binding.resource.canonicalResource },
		);
	}

	if (descriptors.length > 0) {
		for (const binding of sortedBindings) {
			validateBindingAgainstModels(binding, descriptors);
		}
	}

	const frozenBindings = freezeBindings(sortedBindings);
	const lookup = new Map<string, AthenaModelAuthorizationBinding>();
	for (const binding of frozenBindings) {
		const canonical = binding.resource.canonicalResource;
		lookup.set(canonical, binding);
		lookup.set(binding.resource.table, binding);
		lookup.set(binding.resource.model, binding);
		lookup.set(resolveCanonicalResource(canonical), binding);
	}
	const registry = {
		bindings: frozenBindings,
		fingerprint: registryFingerprint(frozenBindings),
		get(resource: string) {
			const token = resource.trim();
			if (!token) {
				return;
			}
			return lookup.get(token) ?? lookup.get(resolveCanonicalResource(token));
		},
		irVersion: ATHENA_MODEL_AUTHORIZATION_BINDING_REGISTRY_IR_VERSION,
		kind: ATHENA_MODEL_AUTHORIZATION_BINDING_REGISTRY_KIND,
	};
	return Object.freeze(registry);
}
