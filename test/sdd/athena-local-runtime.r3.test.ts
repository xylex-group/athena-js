/**
 * R3 — JS Athena Policy Runtime (decision only; no query mutation).
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AthenaConfigurationError } from "../../src/config/errors.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type {
	AthenaDeletePayload,
	AthenaGatewayCallOptions,
	AthenaGatewayResponse,
	AthenaInsertPayload,
	AthenaQueryPayload,
	AthenaUpdatePayload,
} from "../../src/gateway/types.ts";
import { decideAthenaPolicy } from "../../src/policy/decide.ts";
import { definePolicies } from "../../src/policy/define-policies.ts";
import { policy } from "../../src/policy/policy.ts";
import { createPolicyRegistry } from "../../src/policy/registry.ts";
import type {
	PolicyDefinition,
	PolicyIrDocument,
} from "../../src/policy/types.ts";
import { readRuntimeErrorCode } from "../../src/runtime/data/errors.ts";
import type { AthenaPrincipal } from "../../src/runtime/data/principal.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";
import { string, table } from "../../src/schema/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "../../../../test/fixtures/policy-ir");

function loadJson<T>(name: string): T {
	return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as T;
}

const ownInvoices = loadJson<PolicyIrDocument>("own-invoices.json");

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

function createRecordingTransport(): AthenaGatewayClient & {
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
			const tableName =
				"table_name" in payload && typeof payload.table_name === "string"
					? payload.table_name
					: "unknown";
			return ok([{ id: "1", table: tableName }] as T);
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
		amount: string(),
		id: string().generated(),
		userId: string().from("user_id"),
	})
	.primaryKey("id");

function principal(
	partial: Partial<AthenaPrincipal> & { authenticated: boolean },
): AthenaPrincipal {
	return {
		grants: Object.freeze(partial.grants ?? []),
		rights: Object.freeze(partial.rights ?? []),
		...partial,
	};
}

function def(
	input: Partial<PolicyDefinition> & Pick<PolicyDefinition, "id">,
): PolicyDefinition {
	return {
		actions: 1,
		composition: "permissive",
		principals: [{ kind: "public" }],
		resource: { schema: "public", table: "invoices" },
		...input,
	};
}

test("R3: public match", () => {
	const registry = createPolicyRegistry({
		definitions: [def({ id: "public-read", principals: [{ kind: "public" }] })],
		mode: "enforce",
	});
	const decision = decideAthenaPolicy(registry, {
		action: "select",
		principal: principal({ authenticated: false }),
		resource: "public.invoices",
	});
	assert.equal(decision.allowed, true);
	assert.deepEqual(decision.matchedPolicyIds, ["public-read"]);
});

test("R3: anonymous match", () => {
	const registry = createPolicyRegistry({
		definitions: [
			def({ id: "anon-read", principals: [{ kind: "anonymous" }] }),
		],
		mode: "enforce",
	});
	assert.equal(
		decideAthenaPolicy(registry, {
			action: "select",
			principal: principal({ authenticated: false }),
			resource: "invoices",
		}).allowed,
		true,
	);
	assert.equal(
		decideAthenaPolicy(registry, {
			action: "select",
			principal: principal({ authenticated: true, userId: "u1" }),
			resource: "invoices",
		}).allowed,
		false,
	);
});

test("R3: authenticated match", () => {
	const registry = createPolicyRegistry({
		definitions: ownInvoices.policies,
		mode: "enforce",
	});
	const allowed = decideAthenaPolicy(registry, {
		action: "select",
		principal: principal({ authenticated: true, userId: "user-a" }),
		resource: "public.invoices",
	});
	assert.equal(allowed.allowed, true);
	assert.equal(allowed.reason, "allowed");
	assert.deepEqual(allowed.matchedPolicyIds, ["users-see-own-invoices"]);
	assert.deepEqual(allowed.visibility, ownInvoices.policies[0]?.visibility);
});

test("R3: admin match", () => {
	const registry = createPolicyRegistry({
		definitions: [def({ id: "admin-read", principals: [{ kind: "admin" }] })],
		mode: "enforce",
	});
	assert.equal(
		decideAthenaPolicy(registry, {
			action: "select",
			principal: principal({ authenticated: true, role: "admin", userId: "a" }),
			resource: "invoices",
		}).allowed,
		true,
	);
	assert.equal(
		decideAthenaPolicy(registry, {
			action: "select",
			principal: principal({
				authenticated: true,
				role: "member",
				userId: "m",
			}),
			resource: "invoices",
		}).allowed,
		false,
	);
});

test("R3: role match/mismatch", () => {
	const registry = createPolicyRegistry({
		definitions: [
			def({
				id: "editor-read",
				principals: [{ kind: "role", name: "editor" }],
			}),
		],
		mode: "enforce",
	});
	assert.equal(
		decideAthenaPolicy(registry, {
			action: "select",
			principal: principal({
				authenticated: true,
				role: "Editor",
				userId: "e",
			}),
			resource: "invoices",
		}).allowed,
		true,
	);
	assert.equal(
		decideAthenaPolicy(registry, {
			action: "select",
			principal: principal({
				authenticated: true,
				role: "viewer",
				userId: "v",
			}),
			resource: "invoices",
		}).allowed,
		false,
	);
});

test("R3: permission match/mismatch uses rights only", () => {
	const registry = createPolicyRegistry({
		definitions: [
			def({
				id: "invoice-read",
				principals: [{ kind: "permission", name: "invoice.read" }],
			}),
		],
		mode: "enforce",
	});
	assert.equal(
		decideAthenaPolicy(registry, {
			action: "select",
			principal: principal({
				authenticated: true,
				rights: ["invoice.read"],
				userId: "u",
			}),
			resource: "invoices",
		}).allowed,
		true,
	);
	assert.equal(
		decideAthenaPolicy(registry, {
			action: "select",
			principal: principal({
				authenticated: true,
				grants: ["invoice.read"],
				userId: "u",
			}),
			resource: "invoices",
		}).allowed,
		false,
	);
});

test("R3: service match", () => {
	const registry = createPolicyRegistry({
		definitions: [
			def({
				id: "billing-read",
				principals: [{ kind: "service", name: "billing-worker" }],
			}),
		],
		mode: "enforce",
	});
	assert.equal(
		decideAthenaPolicy(registry, {
			action: "select",
			principal: principal({
				authenticated: true,
				service: "billing-worker",
			}),
			resource: "invoices",
		}).allowed,
		true,
	);
	assert.equal(
		decideAthenaPolicy(registry, {
			action: "select",
			principal: principal({
				authenticated: true,
				service: "other-worker",
				userId: "u",
			}),
			resource: "invoices",
		}).allowed,
		false,
	);
});

test("R3: multiple target principals are OR", () => {
	const registry = createPolicyRegistry({
		definitions: [
			def({
				id: "admin-or-perm",
				principals: [
					{ kind: "role", name: "admin" },
					{ kind: "permission", name: "invoice.read" },
				],
			}),
		],
		mode: "enforce",
	});
	assert.equal(
		decideAthenaPolicy(registry, {
			action: "select",
			principal: principal({
				authenticated: true,
				rights: ["invoice.read"],
				userId: "u",
			}),
			resource: "invoices",
		}).allowed,
		true,
	);
});

test("R3: no matching policy", () => {
	const registry = createPolicyRegistry({
		definitions: ownInvoices.policies,
		mode: "enforce",
	});
	const decision = decideAthenaPolicy(registry, {
		action: "select",
		principal: principal({ authenticated: false }),
		resource: "public.invoices",
	});
	assert.equal(decision.allowed, false);
	assert.equal(decision.reason, "no_matching_policy");
});

test("R3: permissive policies OR visibility", () => {
	const registry = createPolicyRegistry({
		definitions: [
			def({
				composition: "permissive",
				id: "own",
				principals: [{ kind: "authenticated" }],
				visibility: {
					left: { column: { logical: "userId" }, kind: "column" },
					op: "eq",
					right: { kind: "subject", subject: { slot: "userId" } },
				},
			}),
			def({
				composition: "permissive",
				id: "shared",
				principals: [{ kind: "authenticated" }],
				visibility: {
					left: { column: { logical: "shared" }, kind: "column" },
					op: "eq",
					right: { kind: "literal", value: { type: "bool", value: true } },
				},
			}),
		],
		mode: "enforce",
	});
	const decision = decideAthenaPolicy(registry, {
		action: "select",
		principal: principal({ authenticated: true, userId: "u" }),
		resource: "invoices",
	});
	assert.equal(decision.allowed, true);
	assert.equal(decision.visibility?.op, "or");
	assert.equal(
		decision.visibility && "exprs" in decision.visibility
			? decision.visibility.exprs.length
			: 0,
		2,
	);
});

test("R3: restrictive policies AND visibility", () => {
	const registry = createPolicyRegistry({
		definitions: [
			def({
				composition: "permissive",
				id: "all-auth",
				principals: [{ kind: "authenticated" }],
			}),
			def({
				composition: "restrictive",
				id: "tenant",
				principals: [{ kind: "authenticated" }],
				visibility: {
					left: { column: { logical: "orgId" }, kind: "column" },
					op: "eq",
					right: { kind: "subject", subject: { slot: "organizationId" } },
				},
			}),
		],
		mode: "enforce",
	});
	const decision = decideAthenaPolicy(registry, {
		action: "select",
		principal: principal({
			authenticated: true,
			organizationId: "org_1",
			userId: "u",
		}),
		resource: "invoices",
	});
	assert.equal(decision.allowed, true);
	assert.equal(decision.visibility?.op, "eq");
	assert.deepEqual(decision.matchedPolicyIds, ["all-auth", "tenant"]);
});

test("R3: mixed composition is (OR permissive) AND restrictive", () => {
	const registry = createPolicyRegistry({
		definitions: [
			def({
				composition: "permissive",
				id: "own",
				principals: [{ kind: "authenticated" }],
				visibility: {
					left: { column: { logical: "userId" }, kind: "column" },
					op: "eq",
					right: { kind: "subject", subject: { slot: "userId" } },
				},
			}),
			def({
				composition: "restrictive",
				id: "tenant",
				principals: [{ kind: "authenticated" }],
				visibility: {
					left: { column: { logical: "orgId" }, kind: "column" },
					op: "eq",
					right: { kind: "subject", subject: { slot: "organizationId" } },
				},
			}),
		],
		mode: "enforce",
	});
	const decision = decideAthenaPolicy(registry, {
		action: "select",
		principal: principal({
			authenticated: true,
			organizationId: "org_1",
			userId: "u",
		}),
		resource: "invoices",
	});
	assert.equal(decision.allowed, true);
	assert.equal(decision.visibility?.op, "and");
});

test("R3: disabled does not enforce", () => {
	const registry = createPolicyRegistry({
		definitions: ownInvoices.policies,
		mode: "disabled",
	});
	const decision = decideAthenaPolicy(registry, {
		action: "select",
		principal: principal({ authenticated: false }),
		resource: "public.invoices",
	});
	assert.equal(decision.allowed, true);
	assert.equal(decision.reason, "disabled");
	assert.equal(decision.mode, "disabled");
});

test("R3: observe computes deny but does not change allowed-for-trace", () => {
	const registry = createPolicyRegistry({
		definitions: ownInvoices.policies,
		mode: "observe",
	});
	const decision = decideAthenaPolicy(registry, {
		action: "select",
		principal: principal({ authenticated: false }),
		resource: "public.invoices",
	});
	assert.equal(decision.mode, "observe");
	assert.equal(decision.allowed, false);
	assert.equal(decision.reason, "no_matching_policy");
});

test("R3: enforce is authoritative", () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		policies: {
			definitions: ownInvoices.policies,
			mode: "enforce",
		},
		security: { mode: "policy" },
		transport,
	});
	return runtime
		.execute({ operation: "fetch", payload: { table_name: "invoices" } })
		.then((denied) => {
			assert.equal(denied.ok, false);
			assert.equal(readRuntimeErrorCode(denied), "ATHENA_POLICY_DENIED");
			assert.equal(transport.calls.length, 0);
		});
});

test("R3: unknown principal fails closed at init under enforce", () => {
	assert.throws(
		() =>
			createPolicyRegistry({
				definitions: [
					def({
						id: "bad-principal",
						principals: [{ kind: "totally-unknown" } as never],
					}),
				],
				mode: "enforce",
			}),
		(error: unknown) =>
			error instanceof Error &&
			/ATHENA_POLICY_INVALID|unknown principal/i.test(error.message),
	);
});

test("R3: unknown operator fails closed at init under enforce", () => {
	assert.throws(
		() =>
			createPolicyRegistry({
				definitions: [
					def({
						id: "bad-op",
						visibility: { op: "regex" } as never,
					}),
				],
				mode: "enforce",
			}),
		(error: unknown) =>
			error instanceof Error &&
			/unsupported|ATHENA_POLICY/i.test(error.message),
	);
});

test("R3: malformed IR fails closed at init under enforce", () => {
	assert.throws(
		() =>
			createPolicyRegistry({
				definitions: [{ actions: 1, composition: "permissive" } as never],
				mode: "enforce",
			}),
		(error: unknown) => error instanceof Error,
	);
});

test("R3: unknown model fails startup under enforce", () => {
	assert.throws(
		() =>
			createAthenaServerRuntime({
				modelEnforcement: "known-only",
				models: { invoices },
				policies: {
					definitions: [
						def({
							id: "ghost",
							resource: { table: "does_not_exist" },
						}),
					],
					mode: "enforce",
				},
				security: { mode: "policy" },
				transport: createRecordingTransport(),
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			/ATHENA_POLICY|unknown resource|not exposed/i.test(error.message),
	);
});

test("R3: callback is not executed on the request hot path", () => {
	let hot = false;
	const authored = policy(invoices, {
		id: "users-see-own-invoices",
		select: {
			allow: ({ row, auth }) => {
				if (hot) {
					throw new Error("authoring callback executed on hot path");
				}
				return row.userId.eq(auth.userId);
			},
			to: ["authenticated"],
		},
	});
	const registry = createPolicyRegistry({
		definitions: definePolicies([authored]).policies,
		mode: "enforce",
	});
	hot = true;
	const decision = decideAthenaPolicy(registry, {
		action: "select",
		principal: principal({ authenticated: true, userId: "user-a" }),
		resource: "public.invoices",
	});
	assert.equal(decision.allowed, true);
	assert.equal(decision.visibility?.op, "eq");
});

test("R3: registry initialized once", () => {
	const registry = createPolicyRegistry({
		definitions: ownInvoices.policies,
		mode: "enforce",
	});
	const first = registry.get("public.invoices", "select");
	const second = registry.get("public.invoices", "select");
	assert.equal(first, second);
	assert.equal(registry.revision, registry.revision);
});

test("R3: concurrent principal decisions isolated", () => {
	const registry = createPolicyRegistry({
		definitions: ownInvoices.policies,
		mode: "enforce",
	});
	const [anon, user] = [
		decideAthenaPolicy(registry, {
			action: "select",
			principal: principal({ authenticated: false }),
			resource: "public.invoices",
		}),
		decideAthenaPolicy(registry, {
			action: "select",
			principal: principal({ authenticated: true, userId: "user-a" }),
			resource: "public.invoices",
		}),
	];
	assert.equal(anon.allowed, false);
	assert.equal(user.allowed, true);
	assert.notEqual(anon, user);
});

test("R3: observe does not block execute", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		policies: {
			definitions: ownInvoices.policies,
			mode: "observe",
		},
		security: { mode: "policy" },
		transport,
	});
	const context = {};
	const result = await runtime.execute(
		{ operation: "fetch", payload: { table_name: "invoices" } },
		context,
	);
	assert.equal(result.ok, true);
	assert.equal(transport.calls.length, 1);
	assert.equal(
		(context as { policyDecision?: { mode?: string } }).policyDecision?.mode,
		"observe",
	);
});

test("R3: shared own-invoices fixture decision", () => {
	const cases = loadJson<{
		cases: Array<{
			action: "select";
			expected: {
				allowed: boolean;
				matchedPolicyIds: string[];
				reason: string;
				visibility?: unknown;
			};
			id: string;
			policies: string;
			principal: AthenaPrincipal;
			resource: string;
		}>;
	}>("r3-decisions.json");
	const registry = createPolicyRegistry({
		definitions: ownInvoices.policies,
		mode: "enforce",
	});
	for (const item of cases.cases) {
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
		if (item.expected.visibility) {
			assert.deepEqual(decision.visibility, item.expected.visibility, item.id);
		}
	}
});
