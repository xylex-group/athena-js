import {
	deepFreezeValue,
	type AthenaDataMutationInput,
} from "./types.ts";

const LEAK_KEYS = [
	"transport",
	"db",
	"pool",
	"policyEngine",
	"policy-engine",
	"request",
] as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

export function sanitizeDataMutationInput(
	input: AthenaDataMutationInput,
): AthenaDataMutationInput {
	const cloned = structuredClone(input) as Record<string, unknown>;
	for (const key of LEAK_KEYS) {
		delete cloned[key];
	}
	const record = asRecord(cloned.record);
	if (record) {
		for (const key of LEAK_KEYS) {
			delete record[key];
		}
		cloned.record = record;
	}
	return cloned as unknown as AthenaDataMutationInput;
}

export function cloneSanitizeAndFreezeMutationInput(
	input: AthenaDataMutationInput,
): AthenaDataMutationInput {
	return deepFreezeValue(sanitizeDataMutationInput(input));
}
