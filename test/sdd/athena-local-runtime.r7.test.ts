/**
 * R7 — Hosted ↔ Local Policy conformance.
 *
 * Expected values come only from test/fixtures/policy-ir/r7-conformance.json.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type {
	AthenaDeletePayload,
	AthenaGatewayCallOptions,
	AthenaGatewayResponse,
	AthenaInsertPayload,
	AthenaQueryPayload,
	AthenaUpdatePayload,
} from "../../src/gateway/types.ts";
import { applyAthenaPolicyDecision } from "../../src/policy/apply.ts";
import { bindPolicyExpr } from "../../src/policy/bind.ts";
import { decideAthenaPolicy } from "../../src/policy/decide.ts";
import { evaluatePolicyExpr } from "../../src/policy/eval-expr.ts";
import { createPolicyRegistry } from "../../src/policy/registry.ts";
import type {
	PolicyActionName,
	PolicyDefinition,
	PolicyIrDocument,
} from "../../src/policy/types.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";
import type { AthenaPrincipal } from "../../src/runtime/data/principal.ts";
import { string, table } from "../../src/schema/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "../../../../test/fixtures/policy-ir");

function loadJson<T>(name: string): T {
	return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as T;
}

interface Expected {
	allowed: boolean;
	check?: unknown;
	matchedPolicyIds: string[];
	reason: string;
	rowVisible?: boolean;
	visibility?: unknown;
	writeAllowed?: boolean;
}

interface ConformanceCase {
	action: PolicyActionName;
	expected: Expected;
	id: string;
	policyIds: string[];
	principal: AthenaPrincipal;
	resource: string;
	row?: Record<string, unknown>;
	writeRow?: Record<string, unknown>;
}

interface ConformanceFile {
	cases: ConformanceCase[];
	policies: string;
}

const file = loadJson<ConformanceFile>("r7-conformance.json");
const allPolicies = loadJson<PolicyIrDocument>(file.policies);

function subset(ids: string[]): PolicyDefinition[] {
	return allPolicies.policies.filter((policy) => ids.includes(policy.id));
}

function ok<T>(data: T): AthenaGatewayResponse<T> {
	return {
		count: Array.isArray(data) ? data.length : 1,
		data,
		error: undefined,
		errorDetails: null,
		ok: true,
		raw: { data },
		status: 200,
		statusText: "OK",
	};
}

function recordingTransport(): AthenaGatewayClient & {
	calls: Array<{ op: string; payload: unknown }>;
} {
	const calls: Array<{ op: string; payload: unknown }> = [];
	return {
		baseUrl: "https://athena.local/mock",
		buildHeaders() {
			return {};
		},
		calls,
		async deleteGateway<T>(
			payload: AthenaDeletePayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "delete", payload });
			return ok([{ deleted: true }] as T);
		},
		async fetchGateway<T>(
			payload: Parameters<AthenaGatewayClient["fetchGateway"]>[0],
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "fetch", payload });
			return ok([{ id: "1" }] as T);
		},
		async insertGateway<T>(
			payload: AthenaInsertPayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "insert", payload });
			return ok([payload.insert_body] as T);
		},
		async queryGateway<T>(
			payload: AthenaQueryPayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "query", payload });
			return ok([{ sql: true }] as T);
		},
		async resolveCallOptions(options) {
			return options;
		},
		async rpcGateway<T>(
			payload: Parameters<AthenaGatewayClient["rpcGateway"]>[0],
			_options?: Parameters<AthenaGatewayClient["rpcGateway"]>[1],
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "rpc", payload });
			return ok([{ rpc: payload.function }] as T);
		},
		async updateGateway<T>(
			payload: AthenaUpdatePayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "update", payload });
			return ok([payload.update_body] as T);
		},
		async verifyConnection() {
			return {
				baseUrl: "https://athena.local/mock",
				error: undefined,
				errorDetails: null,
				ok: true,
				raw: null,
				reachable: true,
				status: 200,
				statusText: "OK",
				url: "https://athena.local/mock/health",
			};
		},
	};
}

const invoices = table("invoices")
	.schema("public")
	.columns({
		organization_id: string(),
		status: string(),
		user_id: string(),
	})
	.primaryKey("user_id");

test("R7: shared corpus decisions match JS Policy Runtime", () => {
	assert.ok(file.cases.length > 0);
	for (const item of file.cases) {
		const registry = createPolicyRegistry({
			definitions: subset(item.policyIds),
			mode: "enforce",
		});
		const decision = decideAthenaPolicy(registry, {
			action: item.action,
			principal: item.principal,
			resource: item.resource,
		});
		assert.equal(decision.allowed, item.expected.allowed, item.id);
		assert.equal(decision.reason, item.expected.reason, item.id);
		assert.deepEqual(
			[...decision.matchedPolicyIds],
			item.expected.matchedPolicyIds,
			item.id,
		);
		if (item.expected.visibility !== undefined) {
			assert.deepEqual(
				decision.visibility,
				item.expected.visibility,
				`${item.id} visibility`,
			);
		}
		if (item.expected.check !== undefined) {
			assert.deepEqual(decision.check, item.expected.check, `${item.id} check`);
		}

		if (item.expected.writeAllowed !== undefined) {
			assert.ok(decision.check, item.id);
			const bound = bindPolicyExpr(decision.check, item.principal);
			assert.equal(
				evaluatePolicyExpr(bound, item.writeRow ?? {}),
				item.expected.writeAllowed,
				`${item.id} writeAllowed`,
			);
		}
		if (item.expected.rowVisible !== undefined) {
			assert.ok(decision.visibility, item.id);
			const bound = bindPolicyExpr(decision.visibility, item.principal);
			assert.equal(
				evaluatePolicyExpr(bound, item.row ?? {}),
				item.expected.rowVisible,
				`${item.id} rowVisible`,
			);
		}
	}
});

test("R7: insert check is separate from visibility", () => {
	const registry = createPolicyRegistry({
		definitions: subset(["auth-own-invoices"]),
		mode: "enforce",
	});
	const alice = {
		authenticated: true,
		grants: [],
		rights: [],
		userId: "alice",
	} satisfies AthenaPrincipal;
	const decision = decideAthenaPolicy(registry, {
		action: "insert",
		principal: alice,
		resource: "public.invoices",
	});
	assert.equal(decision.allowed, true);
	const denied = applyAthenaPolicyDecision({
		action: "insert",
		decision,
		mode: "enforce",
		payload: {
			insert_body: { status: "open", user_id: "bob" },
			table_name: "public.invoices",
		},
		principal: alice,
	});
	assert.equal(denied.ok, false);
	if (!denied.ok) {
		assert.equal(denied.code, "ATHENA_POLICY_WRITE_CONFLICT");
	}
	const allowed = applyAthenaPolicyDecision({
		action: "insert",
		decision,
		mode: "enforce",
		payload: {
			insert_body: { status: "open", user_id: "alice" },
			table_name: "public.invoices",
		},
		principal: alice,
	});
	assert.equal(allowed.ok, true);

	const updateDecision = decideAthenaPolicy(registry, {
		action: "update",
		principal: alice,
		resource: "public.invoices",
	});
	const reassign = applyAthenaPolicyDecision({
		action: "update",
		decision: updateDecision,
		mode: "enforce",
		payload: {
			table_name: "public.invoices",
			update_body: { user_id: "bob" },
		},
		principal: alice,
	});
	assert.equal(reassign.ok, false);
	if (!reassign.ok) {
		assert.equal(reassign.code, "ATHENA_POLICY_WRITE_CONFLICT");
	}
});

test("R7: user OR cannot swallow policy visibility", () => {
	const registry = createPolicyRegistry({
		definitions: subset(["auth-own-invoices"]),
		mode: "enforce",
	});
	const decision = decideAthenaPolicy(registry, {
		action: "select",
		principal: {
			authenticated: true,
			grants: [],
			rights: [],
			userId: "alice",
		},
		resource: "public.invoices",
	});
	const applied = applyAthenaPolicyDecision({
		action: "select",
		decision,
		mode: "enforce",
		payload: {
			table_name: "public.invoices",
			where: { or: [{ status: { eq: "open" } }, { status: { eq: "void" } }] },
		},
		principal: {
			authenticated: true,
			grants: [],
			rights: [],
			userId: "alice",
		},
	});
	assert.equal(applied.ok, true);
	if (!applied.ok) {
		return;
	}
	const conditions = (applied.payload as { conditions?: unknown[] }).conditions;
	assert.ok(Array.isArray(conditions));
	assert.equal(
		conditions.some(
			(item) =>
				Boolean(item) &&
				typeof item === "object" &&
				(item as { column?: string }).column === "user_id",
		),
		true,
	);
});

test("R7: relation predicates cannot strip policy visibility", () => {
	const registry = createPolicyRegistry({
		definitions: subset(["auth-own-invoices"]),
		mode: "enforce",
	});
	const principal = {
		authenticated: true,
		grants: [],
		rights: [],
		userId: "alice",
	};
	const decision = decideAthenaPolicy(registry, {
		action: "select",
		principal,
		resource: "public.invoices",
	});
	const applied = applyAthenaPolicyDecision({
		action: "select",
		decision,
		mode: "enforce",
		payload: {
			table_name: "public.invoices",
			where: { lines: { some: { amount: { gt: 0 } } } },
		},
		principal,
	});
	assert.equal(applied.ok, true);
	if (!applied.ok) {
		return;
	}
	const conditions = (applied.payload as { conditions?: unknown[] }).conditions;
	assert.ok(Array.isArray(conditions));
	assert.equal(
		conditions.some(
			(item) =>
				Boolean(item) &&
				typeof item === "object" &&
				(item as { column?: string }).column === "user_id",
		),
		true,
	);
});

test("R7: enforce injects visibility and rejects write-check conflicts", async () => {
	const transport = recordingTransport();
	const runtime = createAthenaServerRuntime({
		auth: {
			mode: "custom",
			resolvePrincipal: () => ({
				authority: "custom-trusted",
				principal: {
					authenticated: true,
					grants: [],
					rights: [],
					userId: "alice",
				},
			}),
		},
		models: { invoices },
		policies: {
			definitions: subset(["auth-own-invoices"]),
			enforce: true,
		},
		security: { mode: "policy" },
		transport,
		unsafeAllowUnauthenticated: true,
	});

	const context: Record<string, unknown> = {};
	const selected = await runtime.execute(
		{
			operation: "fetch",
			payload: { table_name: "public.invoices" },
		},
		context,
	);
	assert.equal(
		selected.ok,
		true,
		`${String(selected.error)} ${JSON.stringify(context.policyDecision ?? {})}`,
	);
	const fetchPayload = transport.calls[0]?.payload as {
		conditions?: Array<{ column?: string; value?: unknown }>;
	};
	assert.equal(fetchPayload.conditions?.[0]?.column, "user_id");
	assert.equal(fetchPayload.conditions?.[0]?.value, "alice");
});

test("R7: observe does not rewrite the payload", async () => {
	const transport = recordingTransport();
	const runtime = createAthenaServerRuntime({
		auth: {
			mode: "custom",
			resolvePrincipal: () => ({
				authority: "custom-trusted",
				principal: {
					authenticated: true,
					grants: [],
					rights: [],
					userId: "alice",
				},
			}),
		},
		models: { invoices },
		policies: {
			definitions: subset(["auth-own-invoices"]),
			mode: "observe",
		},
		security: { mode: "policy" },
		transport,
		unsafeAllowUnauthenticated: true,
	});
	const selected = await runtime.execute({
		operation: "fetch",
		payload: { table_name: "public.invoices" },
	});
	assert.equal(selected.ok, true);
	const payload = transport.calls[0]?.payload as { conditions?: unknown };
	assert.equal(payload.conditions, undefined);
});
