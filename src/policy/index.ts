/**
 * Athena Policy authoring surface (`@xylex-group/athena/policy`).
 *
 * Browser-safe: expression builders + IR types only.
 * Node-only import/compiler tooling must not be re-exported here (ACT-POL-07).
 */

export type {
	DecisionOutcome,
	DecisionReasonKind,
	PrincipalKind,
	PublicAuthorizationMessage,
} from "../authorization/types.ts";
export { publicAuthorizationMessage } from "../authorization/types.ts";
export { applyAthenaPolicyDecision } from "./apply.ts";
export { bindPolicyExpr } from "./bind.ts";
export { coverageAthenaPolicy } from "./coverage.ts";
export type {
	AthenaPolicyCoverageCell,
	AthenaPolicyCoverageCellKind,
	AthenaPolicyCoverageReport,
} from "./coverage.ts";
export { decideAthenaPolicy } from "./decide.ts";
export { explainAthenaPolicy, simulateAthenaPolicy } from "./explain.ts";
export type {
	AthenaPolicyExplainInput,
	AthenaPolicyExplainResult,
	AthenaPolicySimulateInput,
	AthenaPolicySimulateResult,
} from "./explain.ts";
export type {
	AthenaPolicyDecision,
	AthenaPolicyDecisionReason,
	AthenaPolicyMode,
} from "./decision.ts";
export { actionFromRuntimeOperation } from "./decision.ts";
export { definePolicies, serializePolicyIr } from "./define-policies.ts";
export { evaluatePolicyExpr } from "./eval-expr.ts";
export type {
	PolicyExprNode,
	PolicyOperandInput,
	PolicyOperandNode,
} from "./expr-builders.ts";
export { and, auth, not, or } from "./expr-builders.ts";
export { canonicalizeDocument, fingerprintDocument } from "./fingerprint.ts";
export { lintAthenaPolicy } from "./lint.ts";
export type {
	AthenaPolicyLintFinding,
	AthenaPolicyLintOptions,
	AthenaPolicyLintReport,
	AthenaPolicyLintSeverity,
} from "./lint.ts";
export {
	matchPolicyPrincipal,
	policyAppliesToPrincipal,
} from "./match-principal.ts";
export type {
	AuthoredPolicy,
	PolicyActionConfig,
	PolicyConfig,
	PolicyPrincipalInput,
} from "./policy.ts";
export { policy } from "./policy.ts";
export {
	authenticatedOnly,
	organizationScoped,
	ownerOrRole,
	publicRead,
	roleRestricted,
	serviceOnly,
	tenantScoped,
	userOwned,
} from "./presets.ts";
export { reportAthenaPolicySchemaImpact } from "./schema-impact.ts";
export type { AthenaPolicySchemaImpactHit } from "./schema-impact.ts";
export type {
	AthenaPolicyRegistry,
	CreatePolicyRegistryOptions,
} from "./registry.ts";
export {
	createPolicyRegistry,
	normalizePolicyDefinitions,
} from "./registry.ts";
export type { PolicyRowProxy } from "./row.ts";
export type {
	PolicyActionName,
	PolicyCompositionName,
	PolicyDefinition,
	PolicyExpr,
	PolicyIrDocument,
	PolicyOperand,
	PolicyPrincipal,
	PolicyResourceBinding,
	PolicyResourceRef,
	PolicyValue,
	SubjectRef,
	AthenaResourceIdentity,
	AthenaResourceRef,
} from "./types.ts";
export {
	ACTION_BITS,
	POLICY_IR_VERSION,
} from "./types.ts";
