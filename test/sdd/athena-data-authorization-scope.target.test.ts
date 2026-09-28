import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	applyAuthorizationScopeFilterToPayload,
} from "../../src/policy/authorization-policy-adapter.ts";
import {
	projectAuthorizationScopePolicyExpr,
} from "../../src/policy/authorization-scope.ts";
import {
	authorizeModel,
	organizationScope,
	tenantScope,
	userScope,
	type AthenaModelAuthorizationScope,
} from "../../src/runtime/authorization/model-binding.ts";
import { normalizeAthenaPrincipal } from "../../src/runtime/data/principal.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

function binding(scope: AthenaModelAuthorizationScope) {
	return authorizeModel({
		resource: { model: "Invoice", table: "billing.invoices" },
		rights: {
			delete: "data.invoice.delete",
			insert: "data.invoice.insert",
			select: "data.invoice.select",
			update: "data.invoice.update",
		},
		scope,
	});
}

function principal(input?: {
	claims?: Readonly<Record<string, unknown>>;
	organizationId?: string;
	tenantId?: string;
	userId?: string;
}) {
	return normalizeAthenaPrincipal({
		authenticated: true,
		...(input?.claims ? { claims: input.claims } : {}),
		...(input?.organizationId ? { organizationId: input.organizationId } : {}),
		...(input?.tenantId ? { tenantId: input.tenantId } : {}),
		...(input?.userId ? { userId: input.userId } : { userId: "user_1" }),
		grants: [],
		rights: [],
	});
}

test("T-DAUTH-SCOPE-001: P?: organization scope uses the configured physical column", () => {
	const projected = projectAuthorizationScopePolicyExpr({
		binding: binding(organizationScope("organization_id")),
		principal: principal({ organizationId: "org_1" }),
	});
	assert.equal(projected.kind, "filter");
	assert.deepEqual(projected.expression, {
		left: {
			column: { logical: "organization_id", physical: "organization_id" },
			kind: "column",
		},
		op: "eq",
		right: {
			kind: "subject",
			subject: { slot: "organizationId" },
		},
	});
});

test("T-DAUTH-SCOPE-002: P?: tenant scope uses canonical principal.tenantId only", () => {
	const projected = projectAuthorizationScopePolicyExpr({
		binding: binding(tenantScope("tenant_id")),
		principal: principal({
			claims: Object.freeze({ tenantId: "tenant_spoof" }),
		}),
	});
	assert.equal(projected.kind, "trusted_subject_missing");
	assert.equal(projected.subject, "tenantId");

	const projectedWithTenant = projectAuthorizationScopePolicyExpr({
		binding: binding(tenantScope("tenant_id")),
		principal: principal({
			claims: Object.freeze({ tenantId: "tenant_spoof" }),
			tenantId: "tenant_real",
		}),
	});
	assert.equal(projectedWithTenant.kind, "filter");
	const lowered = applyAuthorizationScopeFilterToPayload({
		action: "select",
		expression: projectedWithTenant.expression,
		payload: {
			table_name: "billing.invoices",
		},
		policyMode: "observe",
		principal: principal({
			claims: Object.freeze({ tenantId: "tenant_spoof" }),
			tenantId: "tenant_real",
		}),
	});
	assert.equal(lowered.ok, true);
	if (!lowered.ok) {
		return;
	}
	assert.deepEqual(
		(lowered.payload as { conditions?: unknown[] }).conditions?.find(
			(item) =>
				Boolean(item) &&
				typeof item === "object" &&
				(item as { column?: string }).column === "tenant_id",
		),
		{
			column: "tenant_id",
			operator: "eq",
			value: "tenant_real",
		},
	);
});

test("T-DAUTH-SCOPE-003: P?: user scope binds the canonical user ID", () => {
	const projected = projectAuthorizationScopePolicyExpr({
		binding: binding(userScope("user_id")),
		principal: principal({
			claims: Object.freeze({ userId: "user_spoof" }),
			userId: "user_real",
		}),
	});
	assert.equal(projected.kind, "filter");
	const lowered = applyAuthorizationScopeFilterToPayload({
		action: "delete",
		expression: projected.expression,
		payload: { table_name: "billing.invoices" },
		policyMode: "observe",
		principal: principal({
			claims: Object.freeze({ userId: "user_spoof" }),
			userId: "user_real",
		}),
	});
	assert.equal(lowered.ok, true);
	if (!lowered.ok) {
		return;
	}
	assert.deepEqual(
		(lowered.payload as { conditions?: unknown[] }).conditions?.find(
			(item) =>
				Boolean(item) &&
				typeof item === "object" &&
				(item as { column?: string }).column === "user_id",
		),
		{
			column: "user_id",
			operator: "eq",
			value: "user_real",
		},
	);
});

test("T-DAUTH-SCOPE-004: P?: row ownership lowers into original query with no pre-read", () => {
	const projected = projectAuthorizationScopePolicyExpr({
		binding: binding(organizationScope("organization_id")),
		principal: principal({ organizationId: "org_1" }),
	});
	assert.equal(projected.kind, "filter");
	const lowered = applyAuthorizationScopeFilterToPayload({
		action: "select",
		expression: projected.expression,
		payload: {
			table_name: "billing.invoices",
			where: { status: { eq: "open" } },
		},
		policyMode: "observe",
		principal: principal({ organizationId: "org_1" }),
	});
	assert.equal(lowered.ok, true);
	if (!lowered.ok) {
		return;
	}
	const conditions = (lowered.payload as { conditions?: unknown[] }).conditions;
	assert.deepEqual(conditions, [
		{
			column: "status",
			operator: "eq",
			value: "open",
		},
		{
			column: "organization_id",
			operator: "eq",
			value: "org_1",
		},
	]);
});

test("T-DAUTH-SCOPE-005: P?: known foreign resource mismatch is distinct from row filtering", () => {
	const scopeBinding = binding(organizationScope("organization_id"));
	const mismatch = projectAuthorizationScopePolicyExpr({
		binding: scopeBinding,
		principal: principal({ organizationId: "org_1" }),
		resource: { kind: "invoices", organizationId: "org_2" },
	});
	assert.equal(mismatch.kind, "known_resource_mismatch");
	assert.equal(mismatch.subject, "organizationId");

	const collection = projectAuthorizationScopePolicyExpr({
		binding: scopeBinding,
		principal: principal({ organizationId: "org_1" }),
		resource: { kind: "invoices" },
	});
	assert.equal(collection.kind, "filter");
});

test("scope lane does not introduce claimScope or a second evaluator", () => {
	const scopeSource = readFileSync(
		join(pkgRoot, "src/policy/authorization-scope.ts"),
		"utf8",
	);
	const adapterSource = readFileSync(
		join(pkgRoot, "src/policy/authorization-policy-adapter.ts"),
		"utf8",
	);
	assert.doesNotMatch(scopeSource, /claimScope\s*\(/);
	assert.match(adapterSource, /bindPolicyExpr\(/);
	assert.match(adapterSource, /applyAthenaPolicyDecision\(/);
	assert.doesNotMatch(adapterSource, /evaluatePolicyExpr\(/);
});
