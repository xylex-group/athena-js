/**
 * Athena Policy IR types (wire-compatible with athena-policy-core).
 */

import type {
  AthenaResourceIdentity,
  AthenaResourceRef,
} from "../schema/resource.ts";

export type { AthenaResourceIdentity, AthenaResourceRef };

/** Policy IR binds authorization expressions to {@link AthenaResourceIdentity}. */
export type PolicyResourceBinding = AthenaResourceIdentity;

export type PolicyActionName =
	| "select"
	| "insert"
	| "update"
	| "delete"
	| "storage.object.read"
	| "storage.object.write"
	| "storage.object.delete";

export type PolicyCompositionName = "permissive" | "restrictive";

export type PolicyPrincipal =
	| { kind: "public" }
	| { kind: "anonymous" }
	| { kind: "authenticated" }
	| { kind: "role"; name: string }
	| { kind: "permission"; name: string }
	| { kind: "service"; name: string }
	| { kind: "admin" };

/**
 * Policy IR subject slots.
 *
 * `{ slot: "claim"; path }` is resolved only against the server trusted-claim
 * store (`TrustedClaims`). Request headers, query params, and body fields are
 * never authoritative claim operands.
 */
export type SubjectRef =
	| { slot: "userId" }
	| { slot: "organizationId" }
	| { slot: "sessionId" }
	| { slot: "roles" }
	| { slot: "permissions" }
	| { slot: "claim"; path: string };

export type PolicyValue =
	| { type: "null" }
	| { type: "bool"; value: boolean }
	| { type: "string"; value: string }
	| { type: "integer"; value: number }
	| { type: "uuid"; value: string }
	| { type: "date_time"; value: string }
	| { type: "list"; value: PolicyValue[] };

export interface PolicyColumnRef {
	logical: string;
	physical?: string;
}

export type PolicyOperand =
	| { kind: "column"; column: PolicyColumnRef }
	| { kind: "subject"; subject: SubjectRef }
	| { kind: "literal"; value: PolicyValue };

export type PolicyExpr =
	| { op: "eq"; left: PolicyOperand; right: PolicyOperand }
	| { op: "ne"; left: PolicyOperand; right: PolicyOperand }
	| { op: "lt"; left: PolicyOperand; right: PolicyOperand }
	| { op: "lte"; left: PolicyOperand; right: PolicyOperand }
	| { op: "gt"; left: PolicyOperand; right: PolicyOperand }
	| { op: "gte"; left: PolicyOperand; right: PolicyOperand }
	| { op: "is_null"; operand: PolicyOperand }
	| { op: "is_not_null"; operand: PolicyOperand }
	| { op: "in"; needle: PolicyOperand; haystack: PolicyOperand[] }
	| { op: "and"; exprs: PolicyExpr[] }
	| { op: "or"; exprs: PolicyExpr[] }
	| { op: "not"; expr: PolicyExpr };

export type PolicyResourceRef = AthenaResourceRef;

export interface PolicyDefinition {
	id: string;
	name?: string;
	resource: PolicyResourceRef;
	/** Action bitmask: select=1, insert=2, update=4, delete=8, storage.object.read=16, write=32, delete=64 */
	actions: number;
	composition: PolicyCompositionName;
	principals: PolicyPrincipal[];
	visibility?: PolicyExpr;
	check?: PolicyExpr;
}

export interface PolicyIrDocument {
	irVersion: number;
	policies: PolicyDefinition[];
}

export const POLICY_IR_VERSION = 1 as const;

export const ACTION_BITS = {
	select: 1,
	insert: 2,
	update: 4,
	delete: 8,
	"storage.object.read": 16,
	"storage.object.write": 32,
	"storage.object.delete": 64,
} as const satisfies Record<PolicyActionName, number>;
