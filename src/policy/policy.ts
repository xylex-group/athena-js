import type { AnyModelDef } from "../schema/types.ts";
import {
  auth,
  stripExpr,
  type PolicyExprNode,
} from "./expr-builders.ts";
import { buildRowProxy, resourceFromModel, type PolicyRowProxy } from "./row.ts";
import {
  ACTION_BITS,
  type PolicyActionName,
  type PolicyCompositionName,
  type PolicyDefinition,
  type PolicyPrincipal,
} from "./types.ts";

export type PolicyPrincipalInput =
  | PolicyPrincipal
  | "public"
  | "anonymous"
  | "authenticated"
  | "admin"
  | `role:${string}`
  | `permission:${string}`
  | `service:${string}`;

export interface PolicyActionConfig<TModel extends AnyModelDef> {
  to?: PolicyPrincipalInput | PolicyPrincipalInput[];
  composition?: PolicyCompositionName;
  /**
   * Visibility predicate (Postgres USING).
   * Prefer returning a DSL expression node from row/auth operators.
   */
  allow?: (ctx: {
    row: PolicyRowProxy<TModel>;
    auth: typeof auth;
  }) => PolicyExprNode | boolean;
  /**
   * Write check predicate (Postgres WITH CHECK).
   */
  check?: (ctx: {
    row: PolicyRowProxy<TModel>;
    auth: typeof auth;
  }) => PolicyExprNode | boolean;
}

export type PolicyConfig<TModel extends AnyModelDef> = {
  id?: string;
  name?: string;
  composition?: PolicyCompositionName;
} & {
  [K in PolicyActionName]?: PolicyActionConfig<TModel>;
};

export interface AuthoredPolicy {
  readonly kind: "athena.policy";
  readonly definitions: PolicyDefinition[];
}

function normalizePrincipals(
  input: PolicyPrincipalInput | PolicyPrincipalInput[] | undefined
): PolicyPrincipal[] {
  if (input === undefined) {
    return [{ kind: "authenticated" }];
  }
  const list = Array.isArray(input) ? input : [input];
  return list.map((item) => {
    if (typeof item !== "string") {
      return item;
    }
    if (item === "public" || item === "anonymous" || item === "authenticated" || item === "admin") {
      return { kind: item };
    }
    if (item.startsWith("role:")) {
      return { kind: "role", name: item.slice("role:".length) };
    }
    if (item.startsWith("permission:")) {
      return { kind: "permission", name: item.slice("permission:".length) };
    }
    if (item.startsWith("service:")) {
      return { kind: "service", name: item.slice("service:".length) };
    }
    throw new Error(`Unknown policy principal: ${item}`);
  });
}

function defaultPolicyId(model: AnyModelDef, action: PolicyActionName): string {
  const resource = resourceFromModel(model);
  const qual = resource.schema
    ? `${resource.schema}.${resource.table}`
    : resource.table;
  return `${qual}:${action}`;
}

/**
 * Author one or more action policies against an AthenaModels table definition.
 *
 * Option A (frozen for Phase 1):
 * ```ts
 * policy(invoices, {
 *   select: {
 *     to: ["authenticated"],
 *     allow: ({ row, auth }) => row.userId.eq(auth.userId),
 *   },
 * })
 * ```
 */
export function policy<TModel extends AnyModelDef>(
  model: TModel,
  config: PolicyConfig<TModel>
): AuthoredPolicy {
  const row = buildRowProxy(model);
  const resource = resourceFromModel(model);
  const definitions: PolicyDefinition[] = [];
  const defaultComposition = config.composition ?? "permissive";

  const actions = ["select", "insert", "update", "delete"] as const;
  for (const action of actions) {
    const actionConfig = config[action];
    if (!actionConfig) {
      continue;
    }

    const ctx = { row, auth };
    const allowResult = actionConfig.allow?.(ctx);
    const checkResult = actionConfig.check?.(ctx);

    let visibility: PolicyDefinition["visibility"];
    if (allowResult === true) {
      visibility = undefined;
    } else if (allowResult === false) {
      visibility = {
        op: "eq",
        left: { kind: "literal", value: { type: "bool", value: true } },
        right: { kind: "literal", value: { type: "bool", value: false } },
      };
    } else if (allowResult) {
      visibility = stripExpr(allowResult);
    }

    let check: PolicyDefinition["check"];
    if (checkResult === true) {
      check = undefined;
    } else if (checkResult === false) {
      check = {
        op: "eq",
        left: { kind: "literal", value: { type: "bool", value: true } },
        right: { kind: "literal", value: { type: "bool", value: false } },
      };
    } else if (checkResult) {
      check = stripExpr(checkResult);
    }

    const definition: PolicyDefinition = {
      id: config.id ?? defaultPolicyId(model, action),
      resource: {
        ...(resource.database ? { database: resource.database } : {}),
        ...(resource.schema ? { schema: resource.schema } : {}),
        table: resource.table,
      },
      actions: ACTION_BITS[action],
      composition: actionConfig.composition ?? defaultComposition,
      principals: normalizePrincipals(actionConfig.to),
    };
    if (config.name !== undefined) {
      definition.name = config.name;
    }
    if (visibility !== undefined) {
      definition.visibility = visibility;
    }
    if (check !== undefined) {
      definition.check = check;
    }
    definitions.push(definition);
  }

  if (definitions.length === 0) {
    throw new Error("policy() requires at least one action config (select|insert|update|delete)");
  }

  return {
    kind: "athena.policy",
    definitions,
  };
}
