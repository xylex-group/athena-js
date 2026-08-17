import type { AuthoredPolicy } from "./policy.ts";
import {
  POLICY_IR_VERSION,
  type PolicyDefinition,
  type PolicyIrDocument,
} from "./types.ts";

export type PolicyRegistryInput =
  | AuthoredPolicy
  | AuthoredPolicy[]
  | Record<string, AuthoredPolicy>;

/**
 * Collect authored policies into a versioned Policy IR document for tooling.
 *
 * Accepts an array or a named record (record keys become ids when the policy
 * has a generated id and a single definition).
 */
function isAuthoredPolicy(value: unknown): value is AuthoredPolicy {
  return (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    (value as AuthoredPolicy).kind === "athena.policy" &&
    Array.isArray((value as AuthoredPolicy).definitions)
  );
}

export function definePolicies(input: PolicyRegistryInput): PolicyIrDocument {
  const policies: PolicyDefinition[] = [];

  if (Array.isArray(input)) {
    for (const item of input) {
      policies.push(...item.definitions);
    }
  } else if (isAuthoredPolicy(input)) {
    policies.push(...input.definitions);
  } else if (input && typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      if (!isAuthoredPolicy(value)) {
        throw new Error(`definePolicies() invalid entry: ${key}`);
      }
      for (const def of value.definitions) {
        // Prefer explicit id; otherwise use registry key for single-def policies.
        if (value.definitions.length === 1 && def.id.includes(":")) {
          policies.push({ ...def, id: key });
        } else {
          policies.push(def);
        }
      }
    }
  } else {
    throw new Error("definePolicies() expected an array or record of policy() results");
  }

  return {
    irVersion: POLICY_IR_VERSION,
    policies,
  };
}

/** Serialize a Policy IR document to stable JSON text. */
export function serializePolicyIr(doc: PolicyIrDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
