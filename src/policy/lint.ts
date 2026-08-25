import { normalizePolicyDefinitions } from "./registry.ts";
import {
	ACTION_BITS,
	type PolicyActionName,
	type PolicyDefinition,
	type PolicyExpr,
	type PolicyIrDocument,
	type PolicyOperand,
} from "./types.ts";

export type AthenaPolicyLintSeverity = "error" | "warning" | "info";

export type AthenaPolicyLintFinding = {
	code: string;
	message: string;
	policyId?: string;
	severity: AthenaPolicyLintSeverity;
};

export type AthenaPolicyLintReport = {
	findings: AthenaPolicyLintFinding[];
};

export type AthenaPolicyLintOptions = {
	columnHints?: Record<string, readonly string[]>;
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
	visit: (operand: PolicyOperand) => void,
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

function hasAction(definition: PolicyDefinition, action: PolicyActionName): boolean {
	return (definition.actions & ACTION_BITS[action]) !== 0;
}

function isPublicPrincipal(definition: PolicyDefinition): boolean {
	return definition.principals.some((item) => item.kind === "public");
}

function hintedColumns(
	hints: Record<string, readonly string[]> | undefined,
	table: string,
): Set<string> | undefined {
	if (!hints) {
		return undefined;
	}
	const direct = hints[table];
	if (direct) {
		return new Set(direct);
	}
	for (const [key, columns] of Object.entries(hints)) {
		if (key === table || key.endsWith(`.${table}`) || table.endsWith(`.${key}`)) {
			return new Set(columns);
		}
	}
	return undefined;
}

/**
 * Lint authored Policy IR by inspecting expressions (and optional column
 * hints from config). Does not read IR authoring sugar.
 */
export function lintAthenaPolicy(
	document: unknown,
	options?: AthenaPolicyLintOptions,
): AthenaPolicyLintReport {
	const doc = asDocument(document);
	const findings: AthenaPolicyLintFinding[] = [];

	for (const definition of doc.policies) {
		if (hasAction(definition, "update") && isPublicPrincipal(definition)) {
			const conditional = Boolean(definition.visibility || definition.check);
			if (conditional) {
				findings.push({
					code: "POL-PUBLIC-UPDATE-CONDITIONAL",
					message: `Policy ${definition.id} allows public UPDATE under a row predicate.`,
					policyId: definition.id,
					severity: "warning",
				});
			} else {
				findings.push({
					code: "POL-PUBLIC-UPDATE-UNCONDITIONAL",
					message: `Policy ${definition.id} allows unconditional public UPDATE.`,
					policyId: definition.id,
					severity: "error",
				});
			}
		}

		const columns = hintedColumns(options?.columnHints, definition.resource.table);
		if (columns) {
			const visit = (operand: PolicyOperand) => {
				if (operand.kind !== "column") {
					return;
				}
				const logical = operand.column.logical;
				const physical = operand.column.physical;
				if (columns.has(logical) || (physical && columns.has(physical))) {
					return;
				}
				findings.push({
					code: "POL-COLUMN-HINT-UNKNOWN",
					message: `Policy ${definition.id} references column "${logical}" not listed in column hints.`,
					policyId: definition.id,
					severity: "info",
				});
			};
			walkOperands(definition.visibility, visit);
			walkOperands(definition.check, visit);
		}
	}

	return { findings };
}
