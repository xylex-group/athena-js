/**
 * SUPERSEDED by test/sdd/athena-auth-audit-semantics.target.test.ts
 *
 * Former characterization of CURRENT scavenger / delete / session defects
 * (nested-id fallback, active-org subject = org UUID, revoke subject = user
 * UUID, apiKey.delete previous?: undefined, writer org fallback). Retired
 * after Phases 1–9 target GREEN (2026-08-25). Not collected by pnpm test
 * (superseded/ is skipped).
 *
 * Spec: docs/sdd/xylex/athena-auth-audit-semantics/SPEC.md
 * Dual-suite: docs/sdd/xylex/athena-auth-audit-semantics/dual-suite/dual-suite-spec.md
 *
 * Do not invert titles in place. Target suite is the CI source of truth.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	ATHENA_AUTH_EVENT_DEFINITIONS,
	resolveAuthEventSubject,
} from "../../../src/auth/domain/catalog.ts";
import type { AthenaAuthMutationContext } from "../../../src/auth/hooks/execute.ts";
import { executeAuthMutation } from "../../../src/auth/hooks/execute.ts";
import type { AthenaAuthImplementedDomainEvent } from "../../../src/auth/hooks/events.ts";
import type { AthenaAuthMutationScope } from "../../../src/auth/hooks/scope.ts";
import { MemoryAuthStores } from "../../../src/auth/local/memory-stores.ts";
import { createMemoryAuthMutationTransaction } from "../../../src/auth/local/mutation-transaction.ts";
import {
	createMemoryAuthAuditWriter,
	createPostgresAuthAuditWriter,
	insertAuditLogAuth,
	type MemoryAuthAuditSink,
} from "../../../src/auth/observability/audit.ts";
import type { AthenaAuthAuditEntry } from "../../../src/auth/observability/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");
const authRoot = join(srcRoot, "auth");

const USER_UUID = "11111111-1111-4111-8111-111111111111";
const ORG_UUID = "22222222-2222-4222-8222-222222222222";
const SESSION_UUID = "33333333-3333-4333-8333-333333333333";
const API_KEY_UUID = "44444444-4444-4444-8444-444444444444";
const ACTOR_ORG_UUID = "55555555-5555-4555-8555-555555555555";

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
}

function collectTsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules") {
			continue;
		}
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectTsFiles(full));
			continue;
		}
		if (entry.name.endsWith(".ts")) {
			out.push(full);
		}
	}
	return out;
}

function extractPathHandler(src: string, routePath: string): string {
	const needles = [
		`path === "${routePath}" && method === "POST"`,
		`path === "${routePath}" && method === "GET"`,
		`path === "${routePath}"`,
	];
	let start = -1;
	let needle = needles[2] ?? "";
	for (const candidate of needles) {
		const idx = src.indexOf(candidate);
		if (idx >= 0) {
			start = idx;
			needle = candidate;
			break;
		}
	}
	assert.notEqual(start, -1, `expected handler for ${routePath}`);
	const from = src.slice(start);
	const rest = from.slice(needle.length);
	const nextTwoTab = rest.search(/\n\t\tif \(path ===/);
	const nextOneTab = rest.search(/\n\tif \(/);
	const cutCandidates = [nextTwoTab, nextOneTab].filter((n) => n >= 0);
	if (cutCandidates.length === 0) {
		return from;
	}
	const cut = Math.min(...cutCandidates);
	return from.slice(0, needle.length + cut);
}

function defaultContext(
	overrides: Partial<AthenaAuthMutationContext> = {},
): AthenaAuthMutationContext {
	return {
		actor: {
			kind: "user",
			sessionId: SESSION_UUID,
			userId: USER_UUID,
		},
		request: { method: "POST", path: "/baseline" },
		traceId: "tr_aas_baseline",
		...overrides,
	};
}

function emptySink(): MemoryAuthAuditSink {
	return { entries: [] };
}

function sampleAuditEntry(
	overrides: Partial<AthenaAuthAuditEntry> = {},
): AthenaAuthAuditEntry {
	return {
		actor: { kind: "user", organizationId: ACTOR_ORG_UUID, userId: USER_UUID },
		event: "session.revoke",
		eventId: "evt_baseline",
		id: "aud_baseline",
		outcome: "success",
		request: {},
		traceId: "tr_aas_baseline",
		...overrides,
	};
}

async function runAuditedMutation(input: {
	context?: AthenaAuthMutationContext;
	event: AthenaAuthImplementedDomainEvent;
	execute?: (scope: AthenaAuthMutationScope) => Promise<unknown>;
	input: unknown;
	previous?: () => Promise<unknown | undefined>;
	resultOf: (result: unknown) => unknown;
	secondaryEvents?: (
		result: unknown,
	) => readonly {
		event: AthenaAuthImplementedDomainEvent;
		input: unknown;
		previous?: unknown;
		result: unknown;
	}[];
}): Promise<MemoryAuthAuditSink> {
	const stores = new MemoryAuthStores();
	const sink = emptySink();
	const transaction = createMemoryAuthMutationTransaction(
		stores,
		undefined,
		sink,
	);
	await executeAuthMutation({
		auditWriter: createMemoryAuthAuditWriter(sink),
		context: input.context ?? defaultContext(),
		event: input.event,
		execute: input.execute ?? (async () => ({ ok: true })),
		input: input.input as never,
		previous: input.previous as never,
		resultOf: input.resultOf as never,
		secondaryEvents: input.secondaryEvents as never,
		transaction,
	});
	return sink;
}

test("B-AAS-SCAVENGER: P?: resolveAuthEventSubject nestedId+stringField fallback", () => {
	const catalogSrc = readSrc("auth/domain/catalog.ts");
	assert.match(catalogSrc, /function nestedId\(/);
	assert.match(catalogSrc, /function stringField\(/);
	assert.match(catalogSrc, /nestedId\(result, "user"\)/);
	assert.match(catalogSrc, /nestedId\(result, "organization"\)/);
	assert.match(catalogSrc, /nestedId\(result, "session"\)/);
	assert.match(catalogSrc, /stringField\(result, "id"\)/);
	assert.match(catalogSrc, /stringField\(result, "userId"\)/);
	assert.match(catalogSrc, /stringField\(result, "organizationId"\)/);
	assert.match(catalogSrc, /stringField\(result, "sessionId"\)/);

	const crowded = resolveAuthEventSubject("session.revoke", {
		user: { id: "nested_user" },
		organization: { id: "nested_org" },
		session: { id: "nested_session" },
		id: "plain_id",
		userId: "plain_user",
		organizationId: "plain_org",
		sessionId: "plain_session",
	});
	assert.deepEqual(crowded, { id: "nested_user", type: "session" });

	const prefersIdOverUserId = resolveAuthEventSubject("apiKey.delete", {
		id: API_KEY_UUID,
		userId: USER_UUID,
	});
	assert.deepEqual(prefersIdOverUserId, { id: API_KEY_UUID, type: "api_key" });

	const prefersUserIdOverOrg = resolveAuthEventSubject(
		"organization.member.remove",
		{ organizationId: ORG_UUID, userId: USER_UUID },
	);
	assert.deepEqual(prefersUserIdOverOrg, {
		id: USER_UUID,
		type: "organization.member",
	});

	const orgThenSession = resolveAuthEventSubject(
		"session.activeOrganization.update",
		{ organizationId: ORG_UUID, sessionId: SESSION_UUID },
	);
	assert.deepEqual(orgThenSession, { id: ORG_UUID, type: "session" });

	const sessionIdOnly = resolveAuthEventSubject("session.issue", {
		sessionId: SESSION_UUID,
	});
	assert.deepEqual(sessionIdOnly, { id: SESSION_UUID, type: "session" });

	const noId = resolveAuthEventSubject("user.security.alert", {
		email: "ops@example.test",
	});
	assert.equal(noId, undefined);
});

test("B-AAS-ACTIVE-ORG: P?: session.activeOrganization.update result {organizationId} → subject_type=session subject_id=org UUID", async () => {
	const scavenged = resolveAuthEventSubject(
		"session.activeOrganization.update",
		{ organizationId: ORG_UUID },
	);
	assert.deepEqual(scavenged, { id: ORG_UUID, type: "session" });

	const aToNull = resolveAuthEventSubject(
		"session.activeOrganization.update",
		{ organizationId: null },
	);
	assert.equal(aToNull, undefined);

	const routerSrc = readSrc("auth/local/router.ts");
	const setActive = extractPathHandler(routerSrc, "/organization/set-active");
	assert.match(setActive, /event: "session.activeOrganization.update"/);
	assert.match(setActive, /resultOf: \(\) => \(\{ organizationId \}\)/);

	const sink = await runAuditedMutation({
		context: defaultContext({
			actor: {
				kind: "user",
				organizationId: ORG_UUID,
				sessionId: SESSION_UUID,
				userId: USER_UUID,
			},
			request: { method: "POST", path: "/organization/set-active" },
		}),
		event: "session.activeOrganization.update",
		input: { organizationId: ORG_UUID },
		previous: async () => ({ organizationId: ACTOR_ORG_UUID }),
		resultOf: () => ({ organizationId: ORG_UUID }),
	});
	assert.equal(sink.entries.length, 1);
	const entry = sink.entries[0];
	assert.equal(entry?.event, "session.activeOrganization.update");
	assert.equal(entry?.subject?.type, "session");
	assert.equal(entry?.subject?.id, ORG_UUID);
	assert.notEqual(entry?.subject?.id, SESSION_UUID);
});

test("B-AAS-REVOKE-USER: P?: session.revoke result {userId} with no previous and no secondaryEvents → one row with subject_id=user UUID", async () => {
	const scavenged = resolveAuthEventSubject("session.revoke", {
		userId: USER_UUID,
	});
	assert.deepEqual(scavenged, { id: USER_UUID, type: "session" });

	const typesSrc = readSrc("auth/hooks/types.ts");
	assert.match(
		typesSrc,
		/"session.revoke": \{[\s\S]*?previous\?: undefined;[\s\S]*?result: \{ userId: string \};/,
	);

	const sink = await runAuditedMutation({
		context: defaultContext({
			request: { method: "POST", path: "/revoke-sessions" },
		}),
		event: "session.revoke",
		input: { scope: "all", userId: USER_UUID },
		resultOf: () => ({ userId: USER_UUID }),
	});
	assert.equal(sink.entries.length, 1);
	const entry = sink.entries[0];
	assert.equal(entry?.event, "session.revoke");
	assert.equal(entry?.subject?.type, "session");
	assert.equal(entry?.subject?.id, USER_UUID);
	assert.notEqual(entry?.subject?.id, SESSION_UUID);
	assert.equal(entry?.previous, undefined);

	const routerSrc = readSrc("auth/local/router.ts");
	for (const route of [
		"/sign-out",
		"/revoke-session",
		"/revoke-sessions",
		"/revoke-other-sessions",
	] as const) {
		const block = extractPathHandler(routerSrc, route);
		assert.match(block, /event: "session.revoke"/, route);
		assert.match(block, /resultOf: \(\) => \(\{ userId:/, route);
		assert.equal(block.includes("secondaryEvents"), false, route);
		assert.equal(block.includes("previous:"), false, route);
	}

	const adminSrc = readSrc("auth/local/admin-routes.ts");
	assert.match(adminSrc, /event: "session.revoke"/);
	assert.match(adminSrc, /resultOf: \(\) => \(\{ userId \}\)/);
	const adminRevoke = adminSrc.slice(
		adminSrc.indexOf("ATHENA_AUTH_ADMIN_PATHS.revokeUserSessions"),
	);
	assert.equal(
		adminRevoke.slice(0, 1800).includes("secondaryEvents"),
		false,
		"admin revoke-user-sessions does not pass secondaryEvents",
	);
});

test("B-AAS-APIKEY-PREV: P?: apiKey.delete previous?: undefined + result {id}", async () => {
	const typesSrc = readSrc("auth/hooks/types.ts");
	assert.match(
		typesSrc,
		/"apiKey.delete": \{[\s\S]*?previous\?: undefined;[\s\S]*?result: \{ id: string \};/,
	);

	const extended = readSrc("auth/local/extended-routes.ts");
	const del = extractPathHandler(extended, "/api-key/delete");
	assert.match(del, /event: "apiKey.delete"/);
	assert.match(del, /resultOf: \(\) => \(\{ id \}\)/);
	assert.equal(del.includes("previous:"), false);

	const sink = await runAuditedMutation({
		context: defaultContext({
			request: { method: "POST", path: "/api-key/delete" },
		}),
		event: "apiKey.delete",
		input: { id: API_KEY_UUID },
		resultOf: () => ({ id: API_KEY_UUID }),
	});
	assert.equal(sink.entries.length, 1);
	const entry = sink.entries[0];
	assert.equal(entry?.event, "apiKey.delete");
	assert.equal(entry?.previous, undefined);
	assert.deepEqual(entry?.result, { id: API_KEY_UUID });
	assert.equal(entry?.subject?.type, "api_key");
	assert.equal(entry?.subject?.id, API_KEY_UUID);
});

test("B-AAS-WRITER-ORG: P?: insertAuditLogAuth organizationId ?? actor.organizationId", async () => {
	const auditSrc = readSrc("auth/observability/audit.ts");
	assert.match(
		auditSrc,
		/entry\.organizationId \?\? entry\.actor\.organizationId \?\? null/,
	);

	const bound: unknown[][] = [];
	const db = {
		async query(_text: string, values?: unknown[]) {
			bound.push(values ?? []);
			return { rowCount: 1, rows: [] };
		},
		async transaction<T>(fn: (inner: typeof db) => Promise<T>): Promise<T> {
			return fn(db);
		},
	};
	await insertAuditLogAuth(
		db,
		sampleAuditEntry({
			organizationId: undefined,
			actor: {
				kind: "user",
				organizationId: ACTOR_ORG_UUID,
				userId: USER_UUID,
			},
		}),
	);
	assert.equal(bound.length, 1);
	const values = bound[0];
	assert.ok(values);
	assert.equal(values[9], ACTOR_ORG_UUID);
});

test("B-AAS-THIN-DEF: P?: ATHENA_AUTH_EVENT_DEFINITIONS only has audit and subjectType", () => {
	const catalogSrc = readSrc("auth/domain/catalog.ts");
	assert.match(
		catalogSrc,
		/export interface AthenaAuthEventDefinition \{\s*audit: boolean;\s*subjectType: string;\s*\}/,
	);
	assert.equal(catalogSrc.includes("mutationKind"), false);
	assert.equal(catalogSrc.includes("resolveSubject"), false);
	assert.equal(catalogSrc.includes("resolveOrganizationId"), false);

	for (const event of Object.keys(ATHENA_AUTH_EVENT_DEFINITIONS) as Array<
		keyof typeof ATHENA_AUTH_EVENT_DEFINITIONS
	>) {
		const def = ATHENA_AUTH_EVENT_DEFINITIONS[event];
		assert.deepEqual(
			Object.keys(def).sort(),
			["audit", "subjectType"],
			event,
		);
		assert.equal("mutationKind" in def, false, event);
		assert.equal("resolveSubject" in def, false, event);
		assert.equal(def.audit, true);
	}
});

test("B-AAS-NO-VALIDATE: P?: validateAuthAuditEntry does not exist", () => {
	assert.equal(existsSync(join(authRoot, "observability", "validate.ts")), false);
	assert.equal(existsSync(join(authRoot, "observability", "contract.ts")), false);
	assert.equal(
		existsSync(join(authRoot, "observability", "snapshots.ts")),
		false,
	);

	const haystack = collectTsFiles(authRoot)
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
	assert.equal(haystack.includes("validateAuthAuditEntry"), false);
	assert.equal(haystack.includes("ATHENA_AUTH_AUDIT_PREVIOUS_REQUIRED"), false);
	assert.equal(haystack.includes("ATHENA_AUTH_AUDIT_SUBJECT_REQUIRED"), false);
	assert.equal(
		haystack.includes("ATHENA_AUTH_AUDIT_ORGANIZATION_UNRESOLVED"),
		false,
	);

	const executeSrc = readSrc("auth/hooks/execute.ts");
	assert.equal(executeSrc.includes("validateAuthAuditEntry"), false);
	assert.match(executeSrc, /subject: resolveAuthEventSubject\(/);
});

test("B-AAS-EXECUTE-ACTOR-ORG: P?: executeAuthMutation sets organizationId from actor only", async () => {
	const executeSrc = readSrc("auth/hooks/execute.ts");
	assert.match(
		executeSrc,
		/organizationId: options\.context\.actor\.organizationId/,
	);
	assert.equal(executeSrc.includes("resolveOrganizationId"), false);

	const sink = await runAuditedMutation({
		context: defaultContext({
			actor: {
				kind: "user",
				organizationId: ACTOR_ORG_UUID,
				sessionId: SESSION_UUID,
				userId: USER_UUID,
			},
		}),
		event: "organization.update",
		input: {
			name: "Renamed",
			organizationId: ORG_UUID,
		},
		resultOf: () => ({
			organization: {
				createdAt: new Date().toISOString(),
				id: ORG_UUID,
				logo: null,
				metadata: null,
				name: "Renamed",
				slug: "renamed",
				updatedAt: new Date().toISOString(),
			},
		}),
	});
	assert.equal(sink.entries.length, 1);
	assert.equal(sink.entries[0]?.organizationId, ACTOR_ORG_UUID);
	assert.notEqual(sink.entries[0]?.organizationId, ORG_UUID);
	assert.equal(sink.entries[0]?.subject?.id, ORG_UUID);
});

test("B-AAS-PREVIOUS-OPTIONAL: P?: ExecuteAuthMutationOptions.previous is optional for every event", async () => {
	const executeSrc = readSrc("auth/hooks/execute.ts");
	assert.match(
		executeSrc,
		/previous\?: \(\) => Promise<\s*AthenaAuthHookEventPayloads\[E\]\["previous"\] \| undefined\s*>;/,
	);
	assert.equal(executeSrc.includes("PreviousOption"), false);
	assert.match(
		executeSrc,
		/const previous = options.previous \? await options.previous\(\) : undefined;/,
	);

	const sink = await runAuditedMutation({
		event: "apiKey.delete",
		input: { id: API_KEY_UUID },
		resultOf: () => ({ id: API_KEY_UUID }),
	});
	assert.equal(sink.entries[0]?.previous, undefined);
});

test("B-AAS-BULK-NO-SECONDARY: P?: session.revoke bulk all/others does not pass secondaryEvents", () => {
	const routerSrc = readSrc("auth/local/router.ts");
	const all = extractPathHandler(routerSrc, "/revoke-sessions");
	const others = extractPathHandler(routerSrc, "/revoke-other-sessions");
	assert.match(all, /scope: "all"/);
	assert.match(others, /scope: "others"/);
	assert.equal(all.includes("secondaryEvents"), false);
	assert.equal(others.includes("secondaryEvents"), false);
	assert.match(all, /resultOf: \(\) => \(\{ userId: resolved\.user\.id \}\)/);
	assert.match(others, /resultOf: \(\) => \(\{ userId: resolved\.user\.id \}\)/);

	const adminSrc = readSrc("auth/local/admin-routes.ts");
	const adminStart = adminSrc.indexOf(
		"ATHENA_AUTH_ADMIN_PATHS.revokeUserSessions",
	);
	assert.notEqual(adminStart, -1);
	const adminSlice = adminSrc.slice(adminStart, adminStart + 1600);
	assert.match(adminSlice, /event: "session.revoke"/);
	assert.equal(adminSlice.includes("secondaryEvents"), false);
});

test("B-AAS-TX: P?: audit write lives in the mutation transaction", async () => {
	const executeSrc = readSrc("auth/hooks/execute.ts");
	const txnStart = executeSrc.indexOf('timePhase("transaction"');
	assert.notEqual(txnStart, -1);
	const txnFn = executeSrc.slice(txnStart, executeSrc.indexOf("return executed"));
	assert.match(txnFn, /writeAudit/);
	const afterHooks = executeSrc.slice(
		executeSrc.lastIndexOf('timePhase("after_hooks"'),
	);
	assert.equal(afterHooks.includes("writeAudit"), false);

	const stores = new MemoryAuthStores();
	const sink = emptySink();
	const transaction = createMemoryAuthMutationTransaction(
		stores,
		undefined,
		sink,
	);
	await assert.rejects(
		() =>
			executeAuthMutation({
				auditWriter: {
					async write(scope, entry) {
						await createMemoryAuthAuditWriter(sink).write(scope, entry);
						throw new Error("audit boom");
					},
				},
				context: defaultContext(),
				event: "apiKey.delete",
				execute: async ({ stores: scoped }) => {
					await scoped.createUser({
						email: "boom@example.test",
						id: "u_boom",
						name: "Boom",
					});
					return { id: API_KEY_UUID };
				},
				input: { id: API_KEY_UUID },
				resultOf: () => ({ id: API_KEY_UUID }),
				transaction,
			}),
		/audit boom/,
	);
	assert.equal(sink.entries.length, 0);
	assert.equal(await stores.getUserById("u_boom"), undefined);
});

test("B-AAS-REQUIRES-TX: P?: createPostgresAuthAuditWriter throws ATHENA_AUTH_AUDIT_REQUIRES_TRANSACTION without persistAudit", async () => {
	const writer = createPostgresAuthAuditWriter();
	const stores = new MemoryAuthStores();
	await assert.rejects(
		() => writer.write({ stores }, sampleAuditEntry()),
		/ATHENA_AUTH_AUDIT_REQUIRES_TRANSACTION/,
	);
});

test("B-AAS-NO-STORE-IMPORT: P?: executor does not import Memory or Postgres stores", () => {
	const executeSrc = readSrc("auth/hooks/execute.ts");
	const scopeSrc = readSrc("auth/hooks/scope.ts");
	assert.equal(executeSrc.includes("memory-stores"), false);
	assert.equal(executeSrc.includes("PostgresAuthStores"), false);
	assert.equal(executeSrc.includes("MemoryAuthStores"), false);
	assert.equal(scopeSrc.includes("memory-stores"), false);
	assert.equal(scopeSrc.includes("PostgresAuthStores"), false);
	assert.equal(scopeSrc.includes("MemoryAuthStores"), false);
	assert.match(scopeSrc, /stores: AthenaAuthStores/);
});

test("B-AAS-NO-NUCLEUS: P?: no public Data Nucleus from auth audit work", () => {
	const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
		exports?: Record<string, unknown>;
	};
	const exportsMap = pkg.exports ?? {};
	assert.equal("./runtime/data/nucleus" in exportsMap, false);

	for (const file of [
		"auth/observability/audit.ts",
		"auth/observability/types.ts",
		"auth/hooks/execute.ts",
		"auth/domain/catalog.ts",
	]) {
		assert.equal(
			readSrc(file).includes("runtime/data/nucleus"),
			false,
			file,
		);
	}
});
