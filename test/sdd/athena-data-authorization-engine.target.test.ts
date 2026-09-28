import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPolicyRegistry } from "../../src/policy/registry.ts";
import { ACTION_BITS } from "../../src/policy/types.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import {
	athenaAuthorizationReasonPublicMessage,
} from "../../src/runtime/authorization/decision-ir.ts";
import {
	authorizeAthenaAuthorization,
} from "../../src/runtime/authorization/engine.ts";
import {
	authorizeModel,
	organizationScope,
	tenantScope,
	type AthenaModelAuthorizationScope,
} from "../../src/runtime/authorization/model-binding.ts";
import { normalizeAthenaPrincipal } from "../../src/runtime/data/principal.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

const SELECT_RIGHT = parseAthenaRightKey("data.invoice.select");

function invoiceBinding(scope?: AthenaModelAuthorizationScope) {
	return authorizeModel({
		resource: {
			model: "Invoice",
			table: "billing.invoices",
		},
		rights: {
			delete: "data.invoice.delete",
			insert: "data.invoice.insert",
			select: "data.invoice.select",
			update: "data.invoice.update",
		},
		...(scope ? { scope } : {}),
	});
}

function principal(input?: {
	claims?: Readonly<Record<string, unknown>>;
	grants?: readonly string[];
	organizationId?: string;
	rights?: readonly string[];
	role?: string;
	tenantId?: string;
	userId?: string;
}) {
	return normalizeAthenaPrincipal({
		authenticated: true,
		...(input?.claims ? { claims: input.claims } : {}),
		...(input?.organizationId ? { organizationId: input.organizationId } : {}),
		...(input?.role ? { role: input.role } : {}),
		...(input?.tenantId ? { tenantId: input.tenantId } : {}),
		...(input?.userId ? { userId: input.userId } : { userId: "user_a" }),
		grants: [...(input?.grants ?? [])],
		rights: [...(input?.rights ?? [])],
	});
}

function decision(input: {
	binding: ReturnType<typeof invoiceBinding>;
	organizationId?: string;
	policies?: ReturnType<typeof createPolicyRegistry>;
	principal: ReturnType<typeof principal>;
	resource?: { kind: string; organizationId?: string; tenantId?: string };
}) {
	return authorizeAthenaAuthorization({
		action: "select",
		binding: input.binding,
		...(input.organizationId ? { organizationId: input.organizationId } : {}),
		...(input.policies ? { policies: input.policies } : {}),
		principal: input.principal,
		requiredRight: SELECT_RIGHT,
		resource:
			input.resource ??
			({
				kind: "invoices",
			} as const),
	});
}

test("T-DAUTH-RIGHT-001: P?: missing Right denies before Policy allow", () => {
	const policies = createPolicyRegistry({
		definitions: [
			{
				actions: ACTION_BITS.select,
				composition: "permissive",
				id: "allow-select",
				principals: [{ kind: "authenticated" }],
				resource: { schema: "billing", table: "invoices" },
			},
		],
		mode: "enforce",
	});
	const denied = decision({
		binding: invoiceBinding(),
		policies,
		principal: principal({
			grants: ["data.invoice.select"],
			role: "admin",
			rights: [],
		}),
	});
	assert.equal(denied.outcome, "deny");
	assert.equal(denied.reason.kind, "missing_right");
	assert.deepEqual(denied.matchedRights, []);
});

test("T-DAUTH-RIGHT-002: P?: matching Right retains provenance", () => {
	const allowed = decision({
		binding: invoiceBinding(),
		principal: principal({
			rights: ["data.*"],
		}),
	});
	assert.equal(allowed.outcome, "allow");
	assert.equal(allowed.matchedRights.length, 1);
	assert.deepEqual(allowed.matchedRights[0], {
		held: parseAthenaRightKey("data.*"),
		matchKind: "pattern",
		provenance: "principal.rights",
		required: SELECT_RIGHT,
	});
});

test("T-DAUTH-SCOPE-001: P?: scope mismatch denies before Right match", () => {
	const denied = decision({
		binding: invoiceBinding(organizationScope("organization_id")),
		principal: principal({
			organizationId: "org_1",
			rights: ["data.invoice.select"],
		}),
		resource: {
			kind: "invoices",
			organizationId: "org_2",
		},
	});
	assert.equal(denied.outcome, "deny");
	assert.equal(denied.reason.kind, "scope_mismatch");
	assert.equal(denied.reason.scope, "organizationId");
	assert.deepEqual(denied.matchedRights, []);
});

test("T-DAUTH-POLICY-002: P?: Policy deny restricts a present Right", () => {
	const policies = createPolicyRegistry({
		definitions: [
			{
				actions: ACTION_BITS.select,
				composition: "restrictive",
				id: "deny-without-permissive",
				principals: [{ kind: "authenticated" }],
				resource: { schema: "billing", table: "invoices" },
			},
		],
		mode: "enforce",
	});
	const denied = decision({
		binding: invoiceBinding(),
		policies,
		principal: principal({
			rights: ["data.invoice.select"],
		}),
	});
	assert.equal(denied.outcome, "deny");
	assert.equal(denied.reason.kind, "policy_denied");
	assert.equal(denied.reason.policyReason, "principal_not_allowed");
	assert.equal(denied.matchedRights.length, 1);
});

test("T-DAUTH-POLICY-003: P?: Right plus Policy allow returns allow", () => {
	const policies = createPolicyRegistry({
		definitions: [
			{
				actions: ACTION_BITS.select,
				composition: "permissive",
				id: "allow-authenticated",
				principals: [{ kind: "authenticated" }],
				resource: { schema: "billing", table: "invoices" },
			},
		],
		mode: "enforce",
	});
	const allowed = decision({
		binding: invoiceBinding(),
		policies,
		principal: principal({
			rights: ["data.invoice.select"],
		}),
	});
	assert.equal(allowed.outcome, "allow");
	assert.equal(allowed.reason.kind, "allowed");
	assert.equal(allowed.reason.source, "policy_allowed");
});

test("T-DAUTH-SCOPE-002: P?: tenant scope uses principal.tenantId only", () => {
	const denied = decision({
		binding: invoiceBinding(tenantScope("tenant_id")),
		principal: principal({
			claims: Object.freeze({ tenantId: "tenant_spoof" }),
			rights: ["data.invoice.select"],
		}),
		resource: {
			kind: "invoices",
			tenantId: "tenant_spoof",
		},
	});
	assert.equal(denied.outcome, "deny");
	assert.equal(denied.reason.kind, "trusted_subject_missing");
	assert.equal(denied.reason.subject, "tenantId");
});

test("T-DAUTH-OBL-001: P?: SELECT includes scope filter obligation", () => {
	const allowed = decision({
		binding: invoiceBinding(organizationScope("organization_id")),
		principal: principal({
			organizationId: "org_1",
			rights: ["data.invoice.select"],
		}),
		resource: {
			kind: "invoices",
			organizationId: "org_1",
		},
	});
	assert.equal(allowed.outcome, "allow");
	assert.deepEqual(allowed.obligations, [
		{
			expression: {
				left: {
					column: {
						logical: "organization_id",
						physical: "organization_id",
					},
					kind: "column",
				},
				op: "eq",
				right: {
					kind: "subject",
					subject: { slot: "organizationId" },
				},
			},
			kind: "filter",
		},
	]);
});

test("T-DAUTH-SEC-001: P?: unauthenticated principal and spoofed claims fail closed", () => {
	const denied = authorizeAthenaAuthorization({
		action: "select",
		binding: invoiceBinding(organizationScope("organization_id")),
		principal: normalizeAthenaPrincipal({
			authenticated: false,
			claims: { organizationId: "org_spoof" },
			rights: ["data.invoice.select"],
		}),
		requiredRight: SELECT_RIGHT,
		resource: { kind: "invoices", organizationId: "org_spoof" },
	});
	assert.equal(denied.outcome, "deny");
	assert.equal(denied.reason.kind, "unauthenticated");
});

test("T-DAUTH-REASON-001: P?: reason maps to public error semantics", () => {
	assert.equal(
		athenaAuthorizationReasonPublicMessage({
			kind: "missing_right",
			missing: [SELECT_RIGHT],
		}),
		"insufficient rights",
	);
	assert.equal(
		athenaAuthorizationReasonPublicMessage({
			kind: "scope_mismatch",
			scope: "organizationId",
		}),
		"not found",
	);
	assert.equal(
		athenaAuthorizationReasonPublicMessage({
			kind: "trusted_subject_missing",
			subject: "tenantId",
		}),
		"unauthorized",
	);
});

test("T-DAUTH-POLICY-004: P?: policy evaluator reuses existing Policy decide", () => {
	const source = readFileSync(
		join(pkgRoot, "src/runtime/authorization/policy-evaluator.ts"),
		"utf8",
	);
	assert.match(source, /from ["']\.\.\/\.\.\/policy\/decide\.ts["']/);
	assert.doesNotMatch(source, /evaluatePolicyExpr\(/);
});
