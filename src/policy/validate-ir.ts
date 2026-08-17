import { ACTION_BITS, type PolicyActionName, type PolicyDefinition, type PolicyExpr, type PolicyOperand, type PolicyPrincipal } from "./types.ts";
import { isKnownPolicyPrincipalKind } from "./match-principal.ts";

const EXPR_OPS = new Set([
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "is_null",
  "is_not_null",
  "in",
  "and",
  "or",
  "not",
]);

const OPERAND_KINDS = new Set(["column", "subject", "literal"]);

export class AthenaPolicyConfigError extends Error {
  readonly code = "ATHENA_POLICY_INVALID";

  constructor(message: string) {
    super(`ATHENA_POLICY_INVALID: ${message}`);
    this.name = "AthenaPolicyConfigError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateOperand(operand: PolicyOperand, path: string): void {
  if (!isRecord(operand) || typeof operand.kind !== "string") {
    throw new AthenaPolicyConfigError(`malformed operand at ${path}`);
  }
  if (!OPERAND_KINDS.has(operand.kind)) {
    throw new AthenaPolicyConfigError(
      `unsupported operand kind "${operand.kind}" at ${path}`
    );
  }
  if (operand.kind === "column" && !operand.column?.logical) {
    throw new AthenaPolicyConfigError(`column operand missing logical name at ${path}`);
  }
  if (operand.kind === "subject" && !operand.subject?.slot) {
    throw new AthenaPolicyConfigError(`subject operand missing slot at ${path}`);
  }
}

export function validatePolicyExpr(expr: PolicyExpr, path = "expr"): void {
  if (!isRecord(expr) || typeof expr.op !== "string") {
    throw new AthenaPolicyConfigError(`malformed PolicyExpr at ${path}`);
  }
  if (!EXPR_OPS.has(expr.op)) {
    throw new AthenaPolicyConfigError(
      `unsupported operator "${expr.op}" at ${path}`
    );
  }
  switch (expr.op) {
    case "eq":
    case "ne":
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      validateOperand(expr.left, `${path}.left`);
      validateOperand(expr.right, `${path}.right`);
      return;
    case "is_null":
    case "is_not_null":
      validateOperand(expr.operand, `${path}.operand`);
      return;
    case "in":
      validateOperand(expr.needle, `${path}.needle`);
      if (!Array.isArray(expr.haystack)) {
        throw new AthenaPolicyConfigError(`malformed in.haystack at ${path}`);
      }
      expr.haystack.forEach((item, index) => {
        validateOperand(item, `${path}.haystack[${index}]`);
      });
      return;
    case "and":
    case "or":
      if (!Array.isArray(expr.exprs) || expr.exprs.length === 0) {
        throw new AthenaPolicyConfigError(`malformed ${expr.op}.exprs at ${path}`);
      }
      expr.exprs.forEach((item, index) => {
        validatePolicyExpr(item, `${path}.exprs[${index}]`);
      });
      return;
    case "not":
      validatePolicyExpr(expr.expr, `${path}.expr`);
  }
}

function validatePrincipal(principal: PolicyPrincipal, path: string): void {
  if (!isRecord(principal) || typeof principal.kind !== "string") {
    throw new AthenaPolicyConfigError(`malformed principal at ${path}`);
  }
  if (!isKnownPolicyPrincipalKind(principal.kind)) {
    throw new AthenaPolicyConfigError(
      `unknown principal kind "${principal.kind}" at ${path}`
    );
  }
  if (
    (principal.kind === "role" ||
      principal.kind === "permission" ||
      principal.kind === "service") &&
    !principal.name?.trim()
  ) {
    throw new AthenaPolicyConfigError(`${principal.kind} principal missing name at ${path}`);
  }
}

export function validatePolicyDefinition(definition: PolicyDefinition): void {
  if (!definition?.id?.trim()) {
    throw new AthenaPolicyConfigError("policy id is required");
  }
  if (!definition.resource?.table?.trim()) {
    throw new AthenaPolicyConfigError(`policy ${definition.id} missing resource.table`);
  }
  if (
    typeof definition.actions !== "number" ||
    definition.actions <= 0 ||
    (definition.actions & ~(ACTION_BITS.select | ACTION_BITS.insert | ACTION_BITS.update | ACTION_BITS.delete)) !==
      0
  ) {
    throw new AthenaPolicyConfigError(`policy ${definition.id} has invalid actions`);
  }
  if (
    definition.composition !== "permissive" &&
    definition.composition !== "restrictive"
  ) {
    throw new AthenaPolicyConfigError(
      `policy ${definition.id} has unknown composition`
    );
  }
  if (!Array.isArray(definition.principals)) {
    throw new AthenaPolicyConfigError(`policy ${definition.id} principals must be an array`);
  }
  definition.principals.forEach((item, index) => {
    validatePrincipal(item, `${definition.id}.principals[${index}]`);
  });
  if (definition.visibility) {
    validatePolicyExpr(definition.visibility, `${definition.id}.visibility`);
  }
  if (definition.check) {
    validatePolicyExpr(definition.check, `${definition.id}.check`);
  }
}

export function actionsFromMask(mask: number): PolicyActionName[] {
  const actions: PolicyActionName[] = [];
  if (mask & ACTION_BITS.select) {
    actions.push("select");
  }
  if (mask & ACTION_BITS.insert) {
    actions.push("insert");
  }
  if (mask & ACTION_BITS.update) {
    actions.push("update");
  }
  if (mask & ACTION_BITS.delete) {
    actions.push("delete");
  }
  return actions;
}

export function resourceKeys(resource: {
  database?: string;
  schema?: string;
  table: string;
}): string[] {
  const table = resource.table.trim();
  const schema = resource.schema?.trim();
  const database = resource.database?.trim();
  const keys = new Set<string>([table]);
  if (schema) {
    keys.add(`${schema}.${table}`);
  }
  if (database && schema) {
    keys.add(`${database}.${schema}.${table}`);
  }
  return [...keys];
}
