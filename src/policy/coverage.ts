import { normalizePolicyDefinitions } from "./registry.ts";
import {
  ACTION_BITS,
  type PolicyActionName,
  type PolicyIrDocument,
} from "./types.ts";
import { actionsFromMask, resourceKeys } from "./validate-ir.ts";

export type AthenaPolicyCoverageCellKind =
  | "permissive"
  | "restrictive-only"
  | "permissive+restrictive"
  | "none";

export type AthenaPolicyCoverageCell = {
  action: PolicyActionName;
  cell: AthenaPolicyCoverageCellKind;
  resource: string;
};

export type AthenaPolicyCoverageReport = {
  cells: AthenaPolicyCoverageCell[];
};

const ACTIONS: readonly PolicyActionName[] = [
  "select",
  "insert",
  "update",
  "delete",
];

function asDocument(input: unknown): PolicyIrDocument {
  if (
    input &&
    typeof input === "object" &&
    Array.isArray((input as PolicyIrDocument).policies)
  ) {
    return input as PolicyIrDocument;
  }
  return {
    irVersion: 1,
    policies: normalizePolicyDefinitions(input),
  };
}

function qualify(resource: { schema?: string; table: string }): string {
  return resource.schema
    ? `${resource.schema}.${resource.table}`
    : resource.table;
}

function cellKind(
  permissive: boolean,
  restrictive: boolean
): AthenaPolicyCoverageCellKind {
  if (permissive && restrictive) {
    return "permissive+restrictive";
  }
  if (permissive) {
    return "permissive";
  }
  if (restrictive) {
    return "restrictive-only";
  }
  return "none";
}

/**
 * Coverage **cells** per resource × action — not a binary covered flag.
 */
export function coverageAthenaPolicy(
  document: unknown,
  options?: { resources?: readonly string[] }
): AthenaPolicyCoverageReport {
  const doc = asDocument(document);
  const resources = new Set<string>(options?.resources ?? []);
  for (const policy of doc.policies) {
    resources.add(qualify(policy.resource));
    for (const key of resourceKeys(policy.resource)) {
      resources.add(key);
    }
  }
  if (resources.size === 0) {
    resources.add("invoices");
  }

  const cells: AthenaPolicyCoverageCell[] = [];
  for (const resource of [...resources].sort()) {
    for (const action of ACTIONS) {
      let permissive = false;
      let restrictive = false;
      for (const policy of doc.policies) {
        const keys = resourceKeys(policy.resource);
        const matches =
          keys.includes(resource) ||
          qualify(policy.resource) === resource ||
          policy.resource.table === resource ||
          resource.includes(policy.resource.table);
        if (!matches) {
          continue;
        }
        if (
          (policy.actions & ACTION_BITS[action]) === 0 &&
          !actionsFromMask(policy.actions).includes(action)
        ) {
          continue;
        }
        if ((policy.actions & ACTION_BITS[action]) === 0) {
          continue;
        }
        if (policy.composition === "restrictive") {
          restrictive = true;
        } else {
          permissive = true;
        }
      }
      cells.push({
        action,
        cell: cellKind(permissive, restrictive),
        resource,
      });
    }
  }
  return { cells };
}
