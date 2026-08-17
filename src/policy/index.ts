/**
 * Athena Policy authoring surface (`@xylex-group/athena/policy`).
 *
 * Browser-safe: expression builders + IR types only.
 * Node-only import/compiler tooling must not be re-exported here (ACT-POL-07).
 */

export { and, auth, not, or } from "./expr-builders.ts";
export type {
  PolicyExprNode,
  PolicyOperandInput,
  PolicyOperandNode,
} from "./expr-builders.ts";
export { definePolicies, serializePolicyIr } from "./define-policies.ts";
export { decideAthenaPolicy } from "./decide.ts";
export { applyAthenaPolicyDecision } from "./apply.ts";
export { bindPolicyExpr } from "./bind.ts";
export { evaluatePolicyExpr } from "./eval-expr.ts";
export type {
  AthenaPolicyDecision,
  AthenaPolicyDecisionReason,
  AthenaPolicyMode,
} from "./decision.ts";
export { actionFromRuntimeOperation } from "./decision.ts";
export { createPolicyRegistry, normalizePolicyDefinitions } from "./registry.ts";
export type { AthenaPolicyRegistry, CreatePolicyRegistryOptions } from "./registry.ts";
export {
  matchPolicyPrincipal,
  policyAppliesToPrincipal,
} from "./match-principal.ts";
export { fingerprintDocument, canonicalizeDocument } from "./fingerprint.ts";
export { policy } from "./policy.ts";
export type {
  AuthoredPolicy,
  PolicyActionConfig,
  PolicyConfig,
  PolicyPrincipalInput,
} from "./policy.ts";
export type { PolicyRowProxy } from "./row.ts";
export {
  ACTION_BITS,
  POLICY_IR_VERSION,
} from "./types.ts";
export type {
  PolicyActionName,
  PolicyCompositionName,
  PolicyDefinition,
  PolicyExpr,
  PolicyIrDocument,
  PolicyOperand,
  PolicyPrincipal,
  PolicyResourceRef,
  PolicyValue,
  SubjectRef,
} from "./types.ts";
export { publicAuthorizationMessage } from "../authorization/types.ts";
export type {
  DecisionOutcome,
  DecisionReasonKind,
  PrincipalKind,
  PublicAuthorizationMessage,
} from "../authorization/types.ts";
