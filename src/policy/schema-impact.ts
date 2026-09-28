import type { SchemaDiffOperation } from "../schema/diff/types.ts";
import { normalizePolicyDefinitions } from "./registry.ts";
import type {
  PolicyDefinition,
  PolicyExpr,
  PolicyIrDocument,
  PolicyOperand,
} from "./types.ts";
import { resourceKeys } from "./validate-ir.ts";

export type AthenaPolicySchemaImpactHit = {
  model: string;
  operations: string[];
  policyId: string;
  resource: string;
  table: string;
};

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

function walkOperands(
  expr: PolicyExpr | undefined,
  visit: (operand: PolicyOperand) => void
): void {
  if (!expr) {
    return;
  }
  switch (expr.op) {
    case "eq":
    case "ne":
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      visit(expr.left);
      visit(expr.right);
      return;
    case "is_null":
    case "is_not_null":
      visit(expr.operand);
      return;
    case "in":
      visit(expr.needle);
      for (const item of expr.haystack) {
        visit(item);
      }
      return;
    case "and":
    case "or":
      for (const child of expr.exprs) {
        walkOperands(child, visit);
      }
      return;
    case "not":
      walkOperands(expr.expr, visit);
  }
}

function columnNames(definition: PolicyDefinition): Set<string> {
  const names = new Set<string>();
  const visit = (operand: PolicyOperand) => {
    if (operand.kind !== "column") {
      return;
    }
    names.add(operand.column.logical);
    if (operand.column.physical) {
      names.add(operand.column.physical);
    }
  };
  walkOperands(definition.visibility, visit);
  walkOperands(definition.check, visit);
  return names;
}

function tableIdentity(op: SchemaDiffOperation): {
  name?: string;
  schema?: string;
} {
  if (
    op.kind === "drop_table" ||
    op.kind === "drop_column" ||
    op.kind === "rename_column" ||
    op.kind === "add_column" ||
    op.kind === "alter_column"
  ) {
    return { name: op.table.name, schema: op.table.schema };
  }
  if (op.kind === "rename_table") {
    return { name: op.from.name, schema: op.from.schema };
  }
  if (op.kind === "create_table") {
    return { name: op.table.name, schema: op.table.schema };
  }
  return {};
}

function policyMatchesTable(
  definition: PolicyDefinition,
  tableName: string | undefined,
  schema?: string
): boolean {
  if (!tableName) {
    return false;
  }
  const keys = resourceKeys(definition.resource);
  if (keys.includes(tableName) || definition.resource.table === tableName) {
    return true;
  }
  if (schema && keys.includes(`${schema}.${tableName}`)) {
    return true;
  }
  return false;
}

function impactKinds(op: SchemaDiffOperation, columns: Set<string>): boolean {
  if (op.kind === "drop_table" || op.kind === "rename_table") {
    return true;
  }
  if (op.kind === "drop_column") {
    return columns.has(op.column.name);
  }
  if (op.kind === "rename_column") {
    return columns.has(op.from) || columns.has(op.to);
  }
  return false;
}

/**
 * Report authored policies impacted by dropped/renamed tables/columns
 * referenced in policy expressions. Analysis only — not a schema engine.
 */
export function reportAthenaPolicySchemaImpact(options: {
  operations: readonly SchemaDiffOperation[];
  policies: unknown;
}): AthenaPolicySchemaImpactHit[] {
  const document = asDocument(options.policies);
  const hits = new Map<string, AthenaPolicySchemaImpactHit>();

  for (const definition of document.policies) {
    const columns = columnNames(definition);
    const operations: string[] = [];
    for (const op of options.operations) {
      const identity = tableIdentity(op);
      if (!policyMatchesTable(definition, identity.name, identity.schema)) {
        continue;
      }
      if (
        !impactKinds(op, columns) &&
        op.kind !== "drop_table" &&
        op.kind !== "rename_table"
      ) {
        continue;
      }
      if (
        op.kind === "drop_table" ||
        op.kind === "rename_table" ||
        impactKinds(op, columns)
      ) {
        operations.push(op.kind);
      }
    }
    if (operations.length === 0) {
      continue;
    }
    const table = definition.resource.table;
    const resource = definition.resource.schema
      ? `${definition.resource.schema}.${table}`
      : table;
    hits.set(definition.id, {
      model: table,
      operations: [...new Set(operations)],
      policyId: definition.id,
      resource,
      table,
    });
  }

  return [...hits.values()];
}
