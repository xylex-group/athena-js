import type { AthenaRuntimeModelIndex } from "../runtime/data/model-registry.ts";
import { fingerprintDocument } from "./fingerprint.ts";
import type { AthenaPolicyMode } from "./decision.ts";
import {
  actionsFromMask,
  AthenaPolicyConfigError,
  resourceKeys,
  validatePolicyDefinition,
} from "./validate-ir.ts";
import type {
  PolicyActionName,
  PolicyDefinition,
  PolicyIrDocument,
} from "./types.ts";

export interface CreatePolicyRegistryOptions {
  definitions: unknown;
  mode: AthenaPolicyMode;
  modelIndex?: AthenaRuntimeModelIndex;
}

export interface AthenaPolicyRegistry {
  readonly mode: AthenaPolicyMode;
  readonly revision: string;
  get(resource: string, action: PolicyActionName): readonly PolicyDefinition[];
}

function isPolicyDocument(value: unknown): value is PolicyIrDocument {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as PolicyIrDocument).policies)
  );
}

function isAuthored(value: unknown): value is { definitions: PolicyDefinition[] } {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as { definitions?: unknown }).definitions)
  );
}

export function normalizePolicyDefinitions(input: unknown): PolicyDefinition[] {
  if (input == null) {
    return [];
  }
  if (Array.isArray(input)) {
    const out: PolicyDefinition[] = [];
    for (const item of input) {
      if (isAuthored(item) && !("resource" in item)) {
        out.push(...item.definitions);
      } else {
        out.push(item as PolicyDefinition);
      }
    }
    return out;
  }
  if (isPolicyDocument(input)) {
    return input.policies;
  }
  if (isAuthored(input)) {
    return input.definitions;
  }
  throw new AthenaPolicyConfigError("policies.definitions must be an array or Policy IR document");
}

function lookupKeys(resource: string): string[] {
  const trimmed = resource.trim();
  if (!trimmed) {
    return [];
  }
  const keys = [trimmed];
  if (!trimmed.includes(".")) {
    keys.push(`public.${trimmed}`);
  } else {
    const table = trimmed.split(".").pop();
    if (table) {
      keys.push(table);
    }
  }
  return keys;
}

export function createPolicyRegistry(
  options: CreatePolicyRegistryOptions
): AthenaPolicyRegistry {
  const definitions = normalizePolicyDefinitions(options.definitions);
  if (options.mode === "enforce") {
    for (const definition of definitions) {
      validatePolicyDefinition(definition);
    }
  } else {
    for (const definition of definitions) {
      try {
        validatePolicyDefinition(definition);
      } catch {
        throw new AthenaPolicyConfigError(
          `invalid policy in ${options.mode} mode: ${definition?.id ?? "<missing id>"}`
        );
      }
    }
  }

  if (options.mode === "enforce" && options.modelIndex) {
    for (const definition of definitions) {
      const found = resourceKeys(definition.resource).some((key) =>
        options.modelIndex?.get(key)
      );
      if (!found) {
        throw new AthenaPolicyConfigError(
          `policy ${definition.id} references unknown resource ${definition.resource.schema ? `${definition.resource.schema}.` : ""}${definition.resource.table}`
        );
      }
    }
  }

  const seen = new Set<string>();
  for (const definition of definitions) {
    if (seen.has(definition.id)) {
      throw new AthenaPolicyConfigError(`duplicate policy id ${definition.id}`);
    }
    seen.add(definition.id);
  }

  const index = new Map<string, Map<PolicyActionName, PolicyDefinition[]>>();
  for (const definition of definitions) {
    for (const action of actionsFromMask(definition.actions)) {
      for (const key of resourceKeys(definition.resource)) {
        let byAction = index.get(key);
        if (!byAction) {
          byAction = new Map();
          index.set(key, byAction);
        }
        const list = byAction.get(action) ?? [];
        list.push(definition);
        byAction.set(action, list);
      }
    }
  }

  const frozen = new Map<string, Map<PolicyActionName, readonly PolicyDefinition[]>>();
  for (const [resource, byAction] of index) {
    const frozenActions = new Map<PolicyActionName, readonly PolicyDefinition[]>();
    for (const [action, list] of byAction) {
      frozenActions.set(action, Object.freeze([...list]));
    }
    frozen.set(resource, frozenActions);
  }

  const revision = fingerprintDocument({
    irVersion: 1,
    policies: definitions,
  });

  return {
    mode: options.mode,
    revision,
    get(resource, action) {
      for (const key of lookupKeys(resource)) {
        const list = frozen.get(key)?.get(action);
        if (list) {
          return list;
        }
      }
      return Object.freeze([]);
    },
  };
}
