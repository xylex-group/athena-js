import {
	type AthenaModelAuthorizationBinding,
	fingerprintAthenaModelAuthorizationBinding,
} from "./model-binding.ts";
import type { NormalizedAthenaAuthorizationConfig } from "./config.ts";

export const ATHENA_AUTHORIZATION_MODEL_INDEX_KIND =
	"athena.authorization.model-index" as const;
export const ATHENA_AUTHORIZATION_MODEL_INDEX_IR_VERSION = 1 as const;

export interface AthenaAuthorizationModelIndex {
	readonly bindings: readonly AthenaModelAuthorizationBinding[];
	readonly get: (resource: string) => AthenaModelAuthorizationBinding | undefined;
	readonly irVersion: typeof ATHENA_AUTHORIZATION_MODEL_INDEX_IR_VERSION;
	readonly kind: typeof ATHENA_AUTHORIZATION_MODEL_INDEX_KIND;
	readonly registryFingerprint: string;
	readonly rightsFingerprint: string;
}

const MODEL_INDEX = Symbol.for("@xylex-group/athena.authorization.modelIndex");
const MODEL_INDEX_MAP = Symbol.for(
	"@xylex-group/athena.authorization.modelIndexMap",
);

type ModelIndexHolder = typeof globalThis & {
	[MODEL_INDEX_MAP]?: WeakMap<object, AthenaAuthorizationModelIndex>;
};

type IndexedObject = object & {
	[MODEL_INDEX]?: AthenaAuthorizationModelIndex;
};

function modelIndexMap(): WeakMap<object, AthenaAuthorizationModelIndex> {
	const holder = globalThis as ModelIndexHolder;
	holder[MODEL_INDEX_MAP] ??= new WeakMap();
	return holder[MODEL_INDEX_MAP];
}

function createBindingLookup(
	bindings: readonly AthenaModelAuthorizationBinding[],
): Map<string, AthenaModelAuthorizationBinding> {
	const lookup = new Map<string, AthenaModelAuthorizationBinding>();
	for (const binding of bindings) {
		lookup.set(binding.resource.canonicalResource, binding);
		lookup.set(binding.resource.model, binding);
		lookup.set(binding.resource.table, binding);
	}
	return lookup;
}

function fallbackRegistryFingerprint(
	bindings: readonly AthenaModelAuthorizationBinding[],
): string {
	return JSON.stringify(
		bindings.map((binding) => ({
			fingerprint: fingerprintAthenaModelAuthorizationBinding(binding),
			resource: binding.resource.canonicalResource,
		})),
	);
}

export function createAthenaAuthorizationModelIndex(
	config: NormalizedAthenaAuthorizationConfig,
): AthenaAuthorizationModelIndex {
	const bindings = config.bindingRegistry?.bindings ?? Object.freeze([]);
	const lookup = createBindingLookup(bindings);
	const index = {
		bindings,
		get(resource: string) {
			const token = resource.trim();
			if (!token) {
				return;
			}
			return lookup.get(token);
		},
		irVersion: ATHENA_AUTHORIZATION_MODEL_INDEX_IR_VERSION,
		kind: ATHENA_AUTHORIZATION_MODEL_INDEX_KIND,
		registryFingerprint:
			config.registryFingerprint ?? fallbackRegistryFingerprint(bindings),
		rightsFingerprint: config.rightsState.rightsFingerprint,
	};
	return Object.freeze(index);
}

export function attachAthenaAuthorizationModelIndex(
	target: object,
	index: AthenaAuthorizationModelIndex,
): void {
	modelIndexMap().set(target, index);
	try {
		Object.defineProperty(target, MODEL_INDEX, {
			configurable: true,
			enumerable: false,
			value: index,
			writable: false,
		});
	} catch {
		// Frozen views keep the WeakMap entry only.
	}
}

export function getAthenaAuthorizationModelIndex(
	target: object,
): AthenaAuthorizationModelIndex | undefined {
	return modelIndexMap().get(target) ?? (target as IndexedObject)[MODEL_INDEX];
}

export function propagateAthenaAuthorizationModelIndex(
	source: object,
	target: object,
): AthenaAuthorizationModelIndex | undefined {
	const index = getAthenaAuthorizationModelIndex(source);
	if (!index) {
		return;
	}
	attachAthenaAuthorizationModelIndex(target, index);
	return index;
}

export function serializeAthenaAuthorizationModelIndex(
	index: AthenaAuthorizationModelIndex,
): string {
	return JSON.stringify({
		bindings: index.bindings.map((binding) => ({
			fingerprint: fingerprintAthenaModelAuthorizationBinding(binding),
			resource: binding.resource.canonicalResource,
		})),
		irVersion: index.irVersion,
		kind: index.kind,
		registryFingerprint: index.registryFingerprint,
		rightsFingerprint: index.rightsFingerprint,
	});
}
