/**
 * Target suite — Athena Auth audit Event IR (Phases 1–9).
 * GREEN after implement. Former characterization baseline retired to
 * test/sdd/superseded/athena-auth-audit-semantics.baseline.superseded.ts.
 *
 * Spec: docs/sdd/xylex/athena-auth-audit-semantics/SPEC.md
 * Dual-suite: docs/sdd/xylex/athena-auth-audit-semantics/dual-suite/dual-suite-spec.md
 *
 * Host:
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/athena-auth-audit-semantics.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	ATHENA_AUTH_EVENT_DEFINITIONS,
	resolveAuthEventSubject,
} from "../../src/auth/domain/catalog.ts";
import { ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS } from "../../src/auth/hooks/events.ts";
import type { AthenaAuthMutationContext } from "../../src/auth/hooks/execute.ts";
import { executeAuthMutation } from "../../src/auth/hooks/execute.ts";
import type { AthenaAuthImplementedDomainEvent } from "../../src/auth/hooks/events.ts";
import type { AthenaAuthMutationScope } from "../../src/auth/hooks/scope.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { createMemoryAuthMutationTransaction } from "../../src/auth/local/mutation-transaction.ts";
import {
	createMemoryAuthAuditWriter,
	createPostgresAuthAuditWriter,
	insertAuditLogAuth,
	type MemoryAuthAuditSink,
} from "../../src/auth/observability/audit.ts";
import type { AthenaAuthAuditEntry } from "../../src/auth/observability/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const authRoot = join(srcRoot, "auth");

const USER_UUID = "11111111-1111-4111-8111-111111111111";
const ORG_UUID = "22222222-2222-4222-8222-222222222222";
const SESSION_UUID = "33333333-3333-4333-8333-333333333333";
const API_KEY_UUID = "44444444-4444-4444-8444-444444444444";
const ACTOR_ORG_UUID = "55555555-5555-4555-8555-555555555555";
const MEMBER_UUID = "66666666-6666-4666-8666-666666666666";
const PASSKEY_UUID = "77777777-7777-4777-8777-777777777777";
const ENDED_SESSION_UUID = "88888888-8888-4888-8888-888888888888";
const RESTORED_SESSION_UUID = "99999999-9999-4999-8999-999999999999";
const SESSION_B_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_C_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const MUTATION_KINDS = ["action", "create", "delete", "update"] as const;
const PREVIOUS_POLICIES = ["none", "optional", "required"] as const;
const RESULT_POLICIES = ["receipt", "resource"] as const;

type MutationKind = (typeof MUTATION_KINDS)[number];
type PreviousPolicy = (typeof PREVIOUS_POLICIES)[number];
type ResultPolicy = (typeof RESULT_POLICIES)[number];

type ExpectedIr = {
	mutationKind: MutationKind;
	orgAware: boolean;
	previous: PreviousPolicy;
	result: ResultPolicy;
	subjectType: string;
};

const EXPECTED_IR = {
	"account.link": {
		mutationKind: "create",
		orgAware: false,
		previous: "none",
		result: "resource",
		subjectType: "account",
	},
	"account.unlink": {
		mutationKind: "delete",
		orgAware: false,
		previous: "required",
		result: "receipt",
		subjectType: "account",
	},
	"apiKey.create": {
		mutationKind: "create",
		orgAware: false,
		previous: "none",
		result: "resource",
		subjectType: "api_key",
	},
	"apiKey.delete": {
		mutationKind: "delete",
		orgAware: false,
		previous: "required",
		result: "receipt",
		subjectType: "api_key",
	},
	"apiKey.update": {
		mutationKind: "update",
		orgAware: false,
		previous: "required",
		result: "resource",
		subjectType: "api_key",
	},
	"organization.create": {
		mutationKind: "create",
		orgAware: true,
		previous: "none",
		result: "resource",
		subjectType: "organization",
	},
	"organization.delete": {
		mutationKind: "delete",
		orgAware: true,
		previous: "required",
		result: "receipt",
		subjectType: "organization",
	},
	"organization.invitation.accept": {
		mutationKind: "action",
		orgAware: true,
		previous: "required",
		result: "receipt",
		subjectType: "organization.invitation",
	},
	"organization.invitation.cancel": {
		mutationKind: "action",
		orgAware: true,
		previous: "required",
		result: "receipt",
		subjectType: "organization.invitation",
	},
	"organization.invitation.create": {
		mutationKind: "create",
		orgAware: true,
		previous: "none",
		result: "resource",
		subjectType: "organization.invitation",
	},
	"organization.invitation.reject": {
		mutationKind: "action",
		orgAware: true,
		previous: "required",
		result: "receipt",
		subjectType: "organization.invitation",
	},
	"organization.member.add": {
		mutationKind: "create",
		orgAware: true,
		previous: "none",
		result: "resource",
		subjectType: "organization.member",
	},
	"organization.member.invite.reminder": {
		mutationKind: "action",
		orgAware: true,
		previous: "required",
		result: "receipt",
		subjectType: "organization.invitation",
	},
	"organization.member.remove": {
		mutationKind: "delete",
		orgAware: true,
		previous: "required",
		result: "receipt",
		subjectType: "organization.member",
	},
	"organization.member.role.update": {
		mutationKind: "update",
		orgAware: true,
		previous: "required",
		result: "resource",
		subjectType: "organization.member",
	},
	"organization.update": {
		mutationKind: "update",
		orgAware: true,
		previous: "required",
		result: "resource",
		subjectType: "organization",
	},
	"passkey.delete": {
		mutationKind: "delete",
		orgAware: false,
		previous: "required",
		result: "receipt",
		subjectType: "passkey",
	},
	"passkey.register": {
		mutationKind: "create",
		orgAware: false,
		previous: "none",
		result: "resource",
		subjectType: "passkey",
	},
	"passkey.update": {
		mutationKind: "update",
		orgAware: false,
		previous: "required",
		result: "resource",
		subjectType: "passkey",
	},
	"session.activeOrganization.update": {
		mutationKind: "update",
		orgAware: true,
		previous: "required",
		result: "resource",
		subjectType: "session",
	},
	"session.impersonation.end": {
		mutationKind: "action",
		orgAware: false,
		previous: "required",
		result: "receipt",
		subjectType: "session",
	},
	"session.impersonation.start": {
		mutationKind: "create",
		orgAware: false,
		previous: "none",
		result: "resource",
		subjectType: "session",
	},
	"session.issue": {
		mutationKind: "create",
		orgAware: false,
		previous: "none",
		result: "resource",
		subjectType: "session",
	},
	"session.revoke": {
		mutationKind: "action",
		orgAware: false,
		previous: "required",
		result: "receipt",
		subjectType: "session",
	},
	"twoFactor.disable": {
		mutationKind: "action",
		orgAware: false,
		previous: "none",
		result: "receipt",
		subjectType: "user",
	},
	"twoFactor.enable": {
		mutationKind: "action",
		orgAware: false,
		previous: "none",
		result: "receipt",
		subjectType: "user",
	},
	"user.ban": {
		mutationKind: "update",
		orgAware: false,
		previous: "required",
		result: "resource",
		subjectType: "user",
	},
	"user.create": {
		mutationKind: "create",
		orgAware: false,
		previous: "none",
		result: "resource",
		subjectType: "user",
	},
	"user.delete": {
		mutationKind: "delete",
		orgAware: false,
		previous: "required",
		result: "receipt",
		subjectType: "user",
	},
	"user.email.update": {
		mutationKind: "update",
		orgAware: false,
		previous: "required",
		result: "resource",
		subjectType: "user",
	},
	"user.email.verify": {
		mutationKind: "update",
		orgAware: false,
		previous: "required",
		result: "resource",
		subjectType: "user",
	},
	"user.password.change": {
		mutationKind: "action",
		orgAware: false,
		previous: "none",
		result: "receipt",
		subjectType: "user",
	},
	"user.password.reset": {
		mutationKind: "action",
		orgAware: false,
		previous: "none",
		result: "receipt",
		subjectType: "user",
	},
	"user.role.update": {
		mutationKind: "update",
		orgAware: false,
		previous: "required",
		result: "resource",
		subjectType: "user",
	},
	"user.security.alert": {
		mutationKind: "action",
		orgAware: false,
		previous: "none",
		result: "receipt",
		subjectType: "user",
	},
	"user.sign-in.email": {
		mutationKind: "action",
		orgAware: false,
		previous: "none",
		result: "receipt",
		subjectType: "user",
	},
	"user.sign-in.social": {
		mutationKind: "action",
		orgAware: false,
		previous: "none",
		result: "resource",
		subjectType: "user",
	},
	"user.unban": {
		mutationKind: "update",
		orgAware: false,
		previous: "required",
		result: "resource",
		subjectType: "user",
	},
	"user.update": {
		mutationKind: "update",
		orgAware: false,
		previous: "required",
		result: "resource",
		subjectType: "user",
	},
} as const satisfies Record<AthenaAuthImplementedDomainEvent, ExpectedIr>;

const FORBIDDEN_SNAPSHOT_KEYS = [
	"challenge",
	"clientSecret",
	"credentialId",
	"hash",
	"key",
	"password",
	"passwordHash",
	"pkceVerifier",
	"publicKey",
	"secret",
	"token",
	"totp",
] as const;

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
}

function eventPayloadBlock(src: string, event: string): string {
	const startNeedle = `"${event}": {`;
	const start = src.indexOf(startNeedle);
	assert.notEqual(start, -1, event);
	const rest = src.slice(start);
	const afterOpen = rest.slice(startNeedle.length);
	const nextEvent = afterOpen.search(/\n\t"[^"]+": \{/);
	return nextEvent === -1
		? rest
		: rest.slice(0, startNeedle.length + nextEvent);
}

function collectTsFiles(dir: string): string[] {
	const out: string[] = [];
	if (!existsSync(dir)) {
		return out;
	}
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
		request: { method: "POST", path: "/target" },
		traceId: "tr_aas_target",
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
		eventId: "evt_target",
		id: "aud_target",
		outcome: "success",
		request: {},
		traceId: "tr_aas_target",
		...overrides,
	};
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

function eventDef(
	event: AthenaAuthImplementedDomainEvent,
): Record<string, unknown> {
	return asRecord(ATHENA_AUTH_EVENT_DEFINITIONS[event]);
}

function errorHasCode(err: unknown, code: string): boolean {
	const parts: string[] = [];
	if (err instanceof Error) {
		parts.push(err.message);
		parts.push(err.name);
	}
	if (typeof err === "object" && err !== null) {
		const record = err as { code?: unknown; publicMessage?: unknown };
		if (typeof record.code === "string") {
			parts.push(record.code);
		}
		if (typeof record.publicMessage === "string") {
			parts.push(record.publicMessage);
		}
	}
	return parts.join("\n").includes(code);
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
}): Promise<{ sink: MemoryAuthAuditSink; stores: MemoryAuthStores }> {
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
	return { sink, stores };
}

async function expectAuditFailure(input: {
	code: string;
	context?: AthenaAuthMutationContext;
	event: AthenaAuthImplementedDomainEvent;
	execute?: (scope: AthenaAuthMutationScope) => Promise<unknown>;
	input: unknown;
	previous?: () => Promise<unknown | undefined>;
	resultOf: (result: unknown) => unknown;
}): Promise<MemoryAuthAuditSink> {
	const stores = new MemoryAuthStores();
	const sink = emptySink();
	const transaction = createMemoryAuthMutationTransaction(
		stores,
		undefined,
		sink,
	);
	let threw = false;
	try {
		await executeAuthMutation({
			auditWriter: createMemoryAuthAuditWriter(sink),
			context: input.context ?? defaultContext(),
			event: input.event,
			execute: input.execute ?? (async () => ({ ok: true })),
			input: input.input as never,
			previous: input.previous as never,
			resultOf: input.resultOf as never,
			transaction,
		});
	} catch (err) {
		threw = true;
		assert.equal(
			errorHasCode(err, input.code),
			true,
			`expected ${input.code}, got ${String(err)}`,
		);
	}
	assert.equal(threw, true, `mutation must fail closed with ${input.code}`);
	assert.equal(sink.entries.length, 0, "malformed audit must not persist");
	assert.equal(await stores.getUserById("u_should_rollback"), undefined);
	return sink;
}

function sanitizedSession(id: string): {
	activeOrganizationId: string | null;
	expiresAt: string;
	id: string;
	impersonatedBy: string | null;
	userId: string;
} {
	return {
		activeOrganizationId: null,
		expiresAt: new Date("2026-09-01T00:00:00.000Z").toISOString(),
		id,
		impersonatedBy: null,
		userId: USER_UUID,
	};
}

function jsonBlob(value: unknown): string {
	return JSON.stringify(value);
}

function assertNoForbiddenSecrets(value: unknown, label: string): void {
	const blob = jsonBlob(value).toLowerCase();
	for (const key of FORBIDDEN_SNAPSHOT_KEYS) {
		assert.equal(
			blob.includes(`"${key.toLowerCase()}":`),
			false,
			`${label} must not contain ${key}`,
		);
	}
}

test("T-AAS-001: P?: ATHENA_AUTH_EVENT_DEFINITIONS declares mutationKind and typed resolveSubject", () => {
	const catalogSrc = readSrc("auth/domain/catalog.ts");
	assert.match(catalogSrc, /mutationKind/);
	assert.match(catalogSrc, /resolveSubject/);
	assert.match(
		catalogSrc,
		/resolveSubject\s*[:(]/,
		"resolveSubject must be a typed function on the Event IR",
	);
	assert.match(catalogSrc, /AthenaAuthHookEventPayloads/);

	for (const event of ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS) {
		const def = eventDef(event);
		assert.equal(
			typeof def.mutationKind,
			"string",
			`${event} must declare mutationKind`,
		);
		assert.equal(
			MUTATION_KINDS.includes(def.mutationKind as MutationKind),
			true,
			`${event} mutationKind`,
		);
		assert.equal(
			typeof def.resolveSubject,
			"function",
			`${event} must declare typed resolveSubject`,
		);
	}
});

test("T-AAS-002: P?: resolveAuthEventSubject nestedId+stringField fallback is gone", () => {
	const catalogSrc = readSrc("auth/domain/catalog.ts");
	assert.equal(catalogSrc.includes("function nestedId("), false);
	assert.equal(catalogSrc.includes("function stringField("), false);
	assert.equal(catalogSrc.includes('nestedId(result, "user")'), false);
	assert.equal(catalogSrc.includes('stringField(result, "id")'), false);
	assert.equal(catalogSrc.includes('stringField(result, "userId")'), false);
	assert.equal(
		catalogSrc.includes('stringField(result, "organizationId")'),
		false,
	);

	const executeSrc = readSrc("auth/hooks/execute.ts");
	assert.equal(executeSrc.includes("resolveAuthEventSubject("), false);

	const scavenged = resolveAuthEventSubject(
		"session.activeOrganization.update",
		{ organizationId: ORG_UUID, sessionId: SESSION_UUID },
	);
	assert.notEqual(scavenged?.id, ORG_UUID);
	if (scavenged) {
		assert.notEqual(scavenged.id, USER_UUID);
	}
});

test("T-AAS-003: P?: AthenaAuthMutationKind is create, update, delete, or action", () => {
	const contractPath = join(authRoot, "observability", "contract.ts");
	assert.equal(existsSync(contractPath), true, "observability/contract.ts");
	const contractSrc = readFileSync(contractPath, "utf8");
	assert.match(contractSrc, /AthenaAuthMutationKind/);
	for (const kind of MUTATION_KINDS) {
		assert.match(contractSrc, new RegExp(`"${kind}"`));
	}
});

test("T-AAS-004: P?: AthenaAuthAuditSemanticContract previous none|optional|required and result resource|receipt", () => {
	const contractPath = join(authRoot, "observability", "contract.ts");
	assert.equal(existsSync(contractPath), true, "observability/contract.ts");
	const contractSrc = readFileSync(contractPath, "utf8");
	assert.match(contractSrc, /AthenaAuthAuditSemanticContract/);
	for (const policy of PREVIOUS_POLICIES) {
		assert.match(contractSrc, new RegExp(`"${policy}"`));
	}
	for (const policy of RESULT_POLICIES) {
		assert.match(contractSrc, new RegExp(`"${policy}"`));
	}

	const catalogSrc = readSrc("auth/domain/catalog.ts");
	assert.match(catalogSrc, /previous:\s*"none"\s*\|\s*"optional"\s*\|\s*"required"/);
	assert.match(catalogSrc, /result:\s*"resource"\s*\|\s*"receipt"/);

	for (const event of ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS) {
		const def = eventDef(event);
		assert.equal(
			PREVIOUS_POLICIES.includes(def.previous as PreviousPolicy),
			true,
			`${event} previous policy`,
		);
		assert.equal(
			RESULT_POLICIES.includes(def.result as ResultPolicy),
			true,
			`${event} result policy`,
		);
	}
});

test("T-AAS-005: P?: validateAuthAuditEntry runs before writeAudit", () => {
	const validatePath = join(authRoot, "observability", "validate.ts");
	assert.equal(existsSync(validatePath), true, "observability/validate.ts");
	const validateSrc = readFileSync(validatePath, "utf8");
	assert.match(validateSrc, /export function validateAuthAuditEntry/);

	const executeSrc = readSrc("auth/hooks/execute.ts");
	assert.match(executeSrc, /validateAuthAuditEntry/);
	const txnStart = executeSrc.indexOf('timePhase("transaction"');
	assert.notEqual(txnStart, -1);
	const txnFn = executeSrc.slice(txnStart, executeSrc.indexOf("return executed"));
	const validateAt = txnFn.indexOf("validateAuthAuditEntry");
	const writeAt = txnFn.indexOf("writeAudit");
	assert.notEqual(validateAt, -1, "validate inside transaction");
	assert.notEqual(writeAt, -1, "writeAudit inside transaction");
	assert.equal(validateAt < writeAt, true, "validate before writeAudit");
});

test("T-AAS-006: P?: missing required previous fails with ATHENA_AUTH_AUDIT_PREVIOUS_REQUIRED", async () => {
	await expectAuditFailure({
		code: "ATHENA_AUTH_AUDIT_PREVIOUS_REQUIRED",
		event: "apiKey.delete",
		execute: async ({ stores }) => {
			await stores.createUser({
				email: "rollback@example.test",
				id: "u_should_rollback",
				name: "Rollback",
			});
			return { deleted: true, id: API_KEY_UUID, userId: USER_UUID };
		},
		input: { id: API_KEY_UUID },
		resultOf: () => ({
			deleted: true,
			id: API_KEY_UUID,
			userId: USER_UUID,
		}),
	});
});

test("T-AAS-007: P?: missing subject fails with ATHENA_AUTH_AUDIT_SUBJECT_REQUIRED and does not insert", async () => {
	await expectAuditFailure({
		code: "ATHENA_AUTH_AUDIT_SUBJECT_REQUIRED",
		context: defaultContext({
			actor: { kind: "system" },
		}),
		event: "user.security.alert",
		input: {
			alertDetails: "login from new device",
			alertTitle: "Security alert",
			email: "ops@example.test",
		},
		resultOf: () => ({ email: "ops@example.test" }),
	});
});

test("T-AAS-008: P?: PreviousOption generics require previous for delete events", () => {
	const executeSrc = readSrc("auth/hooks/execute.ts");
	assert.match(executeSrc, /PreviousOption/);
	assert.match(
		executeSrc,
		/previous:\s*PreviousOption/,
		"required-previous events must not use previous?: for every event",
	);

	const typesSrc = readSrc("auth/hooks/types.ts");
	const apiKeyDelete = eventPayloadBlock(typesSrc, "apiKey.delete");
	assert.match(apiKeyDelete, /previous:\s*\{\s*apiKey:/);
	assert.equal(apiKeyDelete.includes("previous?: undefined"), false);
	for (const event of [
		"passkey.delete",
		"organization.delete",
		"organization.member.remove",
		"user.delete",
		"session.revoke",
	] as const) {
		assert.equal(
			eventPayloadBlock(typesSrc, event).includes("previous?: undefined"),
			false,
			event,
		);
	}
});

test("T-AAS-009: P?: apiKey.delete previous sanitized apiKey and tombstone result", async () => {
	const typesSrc = readSrc("auth/hooks/types.ts");
	assert.match(
		typesSrc,
		/"apiKey.delete": \{[\s\S]*?result:\s*\{\s*deleted:\s*true;\s*id:\s*string;\s*userId:\s*string/,
	);

	const extended = readSrc("auth/local/extended-routes.ts");
	const del = extractPathHandler(extended, "/api-key/delete");
	assert.match(del, /event: "apiKey.delete"/);
	assert.match(del, /previous:/);
	assert.match(del, /sanitizeHookApiKey/);
	assert.match(del, /deleted:\s*true/);
	assert.equal(del.includes("resultOf: () => ({ id })"), false);

	const { sink } = await runAuditedMutation({
		context: defaultContext({
			request: { method: "POST", path: "/api-key/delete" },
		}),
		event: "apiKey.delete",
		input: { id: API_KEY_UUID },
		previous: async () => ({
			apiKey: {
				id: API_KEY_UUID,
				name: "ci",
				prefix: "ak_live",
				userId: USER_UUID,
			},
		}),
		resultOf: () => ({
			deleted: true,
			id: API_KEY_UUID,
			userId: USER_UUID,
		}),
	});
	assert.equal(sink.entries.length, 1);
	const entry = sink.entries[0];
	assert.ok(entry);
	assert.equal(entry.event, "apiKey.delete");
	assert.deepEqual(entry.previous, {
		apiKey: {
			id: API_KEY_UUID,
			name: "ci",
			prefix: "ak_live",
			userId: USER_UUID,
		},
	});
	assert.deepEqual(entry.result, {
		deleted: true,
		id: API_KEY_UUID,
		userId: USER_UUID,
	});
	assert.equal(entry.subject?.type, "api_key");
	assert.equal(entry.subject?.id, API_KEY_UUID);
	assertNoForbiddenSecrets(entry.previous, "apiKey.delete previous");
	assertNoForbiddenSecrets(entry.result, "apiKey.delete result");
});

test("T-AAS-010: P?: passkey.delete, organization.delete, organization.member.remove, user.delete follow previous+tombstone", async () => {
	const typesSrc = readSrc("auth/hooks/types.ts");
	assert.match(
		typesSrc,
		/"passkey.delete": \{[\s\S]*?previous:\s*\{\s*passkey:[\s\S]*?deleted:\s*true/,
	);
	assert.match(
		typesSrc,
		/"organization.delete": \{[\s\S]*?deleted:\s*true/,
	);
	assert.match(
		typesSrc,
		/"organization.member.remove": \{[\s\S]*?deleted:\s*true[\s\S]*?id:/,
	);
	assert.match(typesSrc, /"user.delete": \{[\s\S]*?deleted:\s*true/);

	const passkeySrc = readSrc("auth/local/passkey/manage-passkeys.ts");
	assert.match(passkeySrc, /event: "passkey.delete"/);
	assert.match(passkeySrc, /deleted:\s*true/);

	const orgDelete = extractPathHandler(
		readSrc("auth/local/router.ts"),
		"/organization/delete",
	);
	assert.match(orgDelete, /event: "organization.delete"/);
	assert.match(orgDelete, /previous:/);
	assert.match(orgDelete, /deleted:\s*true/);

	const memberRemove = extractPathHandler(
		readSrc("auth/local/router.ts"),
		"/organization/remove-member",
	);
	assert.match(memberRemove, /event: "organization.member.remove"/);
	assert.match(memberRemove, /deleted:\s*true/);

	const { sink } = await runAuditedMutation({
		event: "organization.member.remove",
		input: { organizationId: ORG_UUID, userId: USER_UUID },
		previous: async () => ({
			member: {
				id: MEMBER_UUID,
				organizationId: ORG_UUID,
				role: "member",
				userId: USER_UUID,
			},
		}),
		resultOf: () => ({
			deleted: true,
			id: MEMBER_UUID,
			organizationId: ORG_UUID,
			userId: USER_UUID,
		}),
	});
	assert.equal(sink.entries.length, 1);
	const entry = sink.entries[0];
	assert.ok(entry);
	assert.equal(entry.subject?.type, "organization.member");
	assert.equal(entry.subject?.id, MEMBER_UUID);
	assert.notEqual(entry.subject?.id, USER_UUID);
	assert.deepEqual(asRecord(entry.result).deleted, true);

	const passkey = await runAuditedMutation({
		event: "passkey.delete",
		input: { id: PASSKEY_UUID },
		previous: async () => ({
			passkey: { id: PASSKEY_UUID, name: "laptop", userId: USER_UUID },
		}),
		resultOf: () => ({
			deleted: true,
			id: PASSKEY_UUID,
			userId: USER_UUID,
		}),
	});
	assert.equal(passkey.sink.entries[0]?.previous !== undefined, true);
	assert.deepEqual(asRecord(passkey.sink.entries[0]?.result).deleted, true);

	const userDel = await runAuditedMutation({
		event: "user.delete",
		input: { userId: USER_UUID },
		previous: async () => ({
			user: {
				email: "gone@example.test",
				id: USER_UUID,
				name: "Gone",
			},
		}),
		resultOf: () => ({ deleted: true, id: USER_UUID }),
	});
	assert.equal(userDel.sink.entries[0]?.previous !== undefined, true);
	assert.deepEqual(asRecord(userDel.sink.entries[0]?.result).deleted, true);

	const orgDel = await runAuditedMutation({
		event: "organization.delete",
		input: { organizationId: ORG_UUID },
		previous: async () => ({
			organization: {
				id: ORG_UUID,
				name: "Acme",
				slug: "acme",
			},
		}),
		resultOf: () => ({ deleted: true, id: ORG_UUID }),
	});
	assert.equal(orgDel.sink.entries[0]?.previous !== undefined, true);
	assert.deepEqual(asRecord(orgDel.sink.entries[0]?.result).deleted, true);
});

test("T-AAS-011: P?: session.revoke subject_id is the session id never the user id", async () => {
	const typesSrc = readSrc("auth/hooks/types.ts");
	assert.match(
		typesSrc,
		/"session.revoke": \{[\s\S]*?revoked:\s*true/,
	);

	await expectAuditFailure({
		code: "ATHENA_AUTH_AUDIT_INVALID_RESULT",
		event: "session.revoke",
		input: { scope: "all", userId: USER_UUID },
		resultOf: () => ({ userId: USER_UUID }),
	});

	const { sink } = await runAuditedMutation({
		event: "session.revoke",
		input: { scope: "one", userId: USER_UUID },
		previous: async () => ({ session: sanitizedSession(SESSION_UUID) }),
		resultOf: () => ({
			id: SESSION_UUID,
			revoked: true,
			userId: USER_UUID,
		}),
	});
	assert.equal(sink.entries.length, 1);
	const entry = sink.entries[0];
	assert.ok(entry);
	assert.equal(entry.subject?.type, "session");
	assert.equal(entry.subject?.id, SESSION_UUID);
	assert.notEqual(entry.subject?.id, USER_UUID);
	assert.notEqual(entry.subject?.id, ORG_UUID);
	assert.deepEqual(asRecord(entry.result).revoked, true);
});

test("T-AAS-012: P?: bulk session.revoke all/others emits one audit row per revoked session via secondaryEvents", async () => {
	const routerSrc = readSrc("auth/local/router.ts");
	const all = extractPathHandler(routerSrc, "/revoke-sessions");
	const others = extractPathHandler(routerSrc, "/revoke-other-sessions");
	assert.match(all, /secondaryEvents/);
	assert.match(others, /secondaryEvents/);
	assert.equal(all.includes("sessionIds"), false);
	assert.equal(others.includes("sessionIds"), false);

	const adminSrc = readSrc("auth/local/admin-routes.ts");
	const adminStart = adminSrc.indexOf(
		"ATHENA_AUTH_ADMIN_PATHS.revokeUserSessions",
	);
	assert.notEqual(adminStart, -1);
	const adminSlice = adminSrc.slice(adminStart, adminStart + 2200);
	assert.match(adminSlice, /secondaryEvents/);

	const { sink } = await runAuditedMutation({
		event: "session.revoke",
		input: { scope: "all", userId: USER_UUID },
		previous: async () => ({ session: sanitizedSession(SESSION_UUID) }),
		resultOf: () => ({
			id: SESSION_UUID,
			revoked: true,
			userId: USER_UUID,
		}),
		secondaryEvents: () => [
			{
				event: "session.revoke",
				input: { scope: "all", userId: USER_UUID },
				previous: { session: sanitizedSession(SESSION_B_UUID) },
				result: {
					id: SESSION_B_UUID,
					revoked: true,
					userId: USER_UUID,
				},
			},
			{
				event: "session.revoke",
				input: { scope: "all", userId: USER_UUID },
				previous: { session: sanitizedSession(SESSION_C_UUID) },
				result: {
					id: SESSION_C_UUID,
					revoked: true,
					userId: USER_UUID,
				},
			},
		],
	});
	const revokeRows = sink.entries.filter((row) => row.event === "session.revoke");
	assert.equal(revokeRows.length, 3);
	const ids = revokeRows.map((row) => row.subject?.id).sort();
	assert.deepEqual(ids, [SESSION_UUID, SESSION_B_UUID, SESSION_C_UUID].sort());
	for (const row of revokeRows) {
		assert.equal(row.subject?.type, "session");
		assert.notEqual(row.subject?.id, USER_UUID);
		assert.deepEqual(asRecord(row.result).revoked, true);
	}
});

test("T-AAS-013: P?: session.activeOrganization.update subject is always actor.sessionId", async () => {
	const { sink } = await runAuditedMutation({
		context: defaultContext({
			actor: {
				kind: "user",
				organizationId: ACTOR_ORG_UUID,
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
	assert.ok(entry);
	assert.equal(entry.subject?.type, "session");
	assert.equal(entry.subject?.id, SESSION_UUID);
	assert.notEqual(entry.subject?.id, ORG_UUID);
	assert.notEqual(entry.subject?.id, USER_UUID);

	await expectAuditFailure({
		code: "ATHENA_AUTH_AUDIT_SUBJECT_REQUIRED",
		context: defaultContext({
			actor: { kind: "user", userId: USER_UUID },
		}),
		event: "session.activeOrganization.update",
		input: { organizationId: ORG_UUID },
		previous: async () => ({ organizationId: ACTOR_ORG_UUID }),
		resultOf: () => ({ organizationId: ORG_UUID }),
	});
});

test("T-AAS-014: P?: session.activeOrganization.update A→null retains session subject", async () => {
	const { sink } = await runAuditedMutation({
		context: defaultContext({
			actor: {
				kind: "user",
				organizationId: ORG_UUID,
				sessionId: SESSION_UUID,
				userId: USER_UUID,
			},
		}),
		event: "session.activeOrganization.update",
		input: { organizationId: null },
		previous: async () => ({ organizationId: ORG_UUID }),
		resultOf: () => ({ organizationId: null }),
	});
	assert.equal(sink.entries.length, 1);
	const entry = sink.entries[0];
	assert.ok(entry);
	assert.equal(entry.subject?.type, "session");
	assert.equal(entry.subject?.id, SESSION_UUID);
	assert.equal(entry.organizationId, ORG_UUID);
	assert.deepEqual(entry.result, { organizationId: null });
	assert.deepEqual(entry.previous, { organizationId: ORG_UUID });
});

test("T-AAS-015: P?: insertAuditLogAuth persists entry.organizationId only", async () => {
	const auditSrc = readSrc("auth/observability/audit.ts");
	assert.equal(
		auditSrc.includes("entry.organizationId ?? entry.actor.organizationId"),
		false,
	);
	assert.match(auditSrc, /entry\.organizationId \?\? null/);

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
	assert.equal(values[9], null);
	assert.notEqual(values[9], ACTOR_ORG_UUID);
});

test("T-AAS-016: P?: org-aware events resolve organization from Event IR", async () => {
	const catalogSrc = readSrc("auth/domain/catalog.ts");
	assert.match(catalogSrc, /resolveOrganizationId/);
	const executeSrc = readSrc("auth/hooks/execute.ts");
	assert.match(executeSrc, /resolveOrganizationId/);

	const orgUpdate = eventDef("organization.update");
	assert.equal(typeof orgUpdate.resolveOrganizationId, "function");

	const { sink } = await runAuditedMutation({
		context: defaultContext({
			actor: {
				kind: "user",
				organizationId: ACTOR_ORG_UUID,
				sessionId: SESSION_UUID,
				userId: USER_UUID,
			},
		}),
		event: "organization.update",
		input: { name: "Renamed", organizationId: ORG_UUID },
		previous: async () => ({
			organization: { id: ORG_UUID, name: "Old", slug: "old" },
		}),
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
	assert.equal(sink.entries[0]?.organizationId, ORG_UUID);
	assert.notEqual(sink.entries[0]?.organizationId, ACTOR_ORG_UUID);
	assert.equal(sink.entries[0]?.subject?.id, ORG_UUID);

	await expectAuditFailure({
		code: "ATHENA_AUTH_AUDIT_ORGANIZATION_UNRESOLVED",
		event: "organization.update",
		input: { name: "Renamed", organizationId: ORG_UUID },
		previous: async () => ({ organization: { id: ORG_UUID, name: "Old" } }),
		resultOf: () => ({ organization: { name: "Renamed" } }),
	});
});

test("T-AAS-017: P?: session.issue and impersonation start/end use real session ids", async () => {
	const issue = await runAuditedMutation({
		event: "session.issue",
		input: { userId: USER_UUID },
		resultOf: () => ({ session: sanitizedSession(SESSION_UUID) }),
	});
	assert.equal(issue.sink.entries[0]?.subject?.type, "session");
	assert.equal(issue.sink.entries[0]?.subject?.id, SESSION_UUID);

	const start = await runAuditedMutation({
		event: "session.impersonation.start",
		input: { userId: USER_UUID },
		resultOf: () => ({ session: sanitizedSession(SESSION_B_UUID) }),
	});
	assert.equal(start.sink.entries[0]?.subject?.id, SESSION_B_UUID);

	const adminSrc = readSrc("auth/local/admin-routes.ts");
	const stop = adminSrc.slice(
		adminSrc.indexOf("ATHENA_AUTH_ADMIN_PATHS.stopImpersonating"),
	);
	assert.match(stop.slice(0, 2500), /event: "session.impersonation.end"/);
	assert.match(stop.slice(0, 2500), /previous:/);
	assert.match(stop.slice(0, 2500), /revoked:\s*true/);
	assert.match(stop.slice(0, 2500), /secondaryEvents/);
	assert.match(stop.slice(0, 2500), /session.issue/);

	const ended = await runAuditedMutation({
		context: defaultContext({
			actor: {
				kind: "admin",
				sessionId: ENDED_SESSION_UUID,
				userId: USER_UUID,
			},
		}),
		event: "session.impersonation.end",
		input: { sessionId: ENDED_SESSION_UUID },
		previous: async () => ({
			session: {
				...sanitizedSession(ENDED_SESSION_UUID),
				impersonatedBy: "admin_user",
			},
		}),
		resultOf: () => ({
			id: ENDED_SESSION_UUID,
			revoked: true,
			userId: USER_UUID,
		}),
		secondaryEvents: () => [
			{
				event: "session.issue",
				input: { userId: USER_UUID },
				result: { session: sanitizedSession(RESTORED_SESSION_UUID) },
			},
		],
	});
	const endRow = ended.sink.entries.find(
		(row) => row.event === "session.impersonation.end",
	);
	assert.ok(endRow);
	assert.equal(endRow.subject?.type, "session");
	assert.equal(endRow.subject?.id, ENDED_SESSION_UUID);
	assert.notEqual(endRow.subject?.id, RESTORED_SESSION_UUID);
	const restored = ended.sink.entries.find((row) => row.event === "session.issue");
	assert.ok(restored);
	assert.equal(restored.subject?.id, RESTORED_SESSION_UUID);
});

test("T-AAS-018: P?: previous/result JSON never contains hashes, passwords, WebAuthn challenges, session tokens, API key secrets", async () => {
	const snapshotsPath = join(authRoot, "observability", "snapshots.ts");
	assert.equal(existsSync(snapshotsPath), true, "observability/snapshots.ts");
	const snapshotsSrc = readFileSync(snapshotsPath, "utf8");
	assert.match(snapshotsSrc, /toAuthAuditTombstone/);
	assert.match(snapshotsSrc, /toAuthSessionRevokeReceipt/);

	const sanitizeSrc = readSrc("auth/hooks/sanitize.ts");
	assert.match(sanitizeSrc, /sanitizeHookApiKey/);
	assert.match(sanitizeSrc, /sanitizeHookSession/);
	assert.match(sanitizeSrc, /sanitizeHookPasskey/);
	assert.equal(sanitizeSrc.includes("row.token"), false);
	assert.equal(sanitizeSrc.includes("row.key"), false);

	const { sink } = await runAuditedMutation({
		event: "apiKey.delete",
		input: { id: API_KEY_UUID },
		previous: async () => ({
			apiKey: {
				id: API_KEY_UUID,
				name: "ci",
				prefix: "ak_live",
				userId: USER_UUID,
			},
		}),
		resultOf: () => ({
			deleted: true,
			id: API_KEY_UUID,
			userId: USER_UUID,
		}),
	});
	for (const entry of sink.entries) {
		assertNoForbiddenSecrets(entry.previous, `${entry.event} previous`);
		assertNoForbiddenSecrets(entry.result, `${entry.event} result`);
	}
});

test("T-AAS-019: P?: audit persist remains inside the mutation transaction", async () => {
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
				event: "apiKey.create",
				execute: async ({ stores: scoped }) => {
					await scoped.createUser({
						email: "boom@example.test",
						id: "u_boom",
						name: "Boom",
					});
					return {
						apiKey: {
							id: API_KEY_UUID,
							name: "ci",
							prefix: "ak",
							userId: USER_UUID,
						},
					};
				},
				input: { userId: USER_UUID },
				resultOf: (result) => result as never,
				transaction,
			}),
		/audit boom/,
	);
	assert.equal(sink.entries.length, 0);
	assert.equal(await stores.getUserById("u_boom"), undefined);

	const writer = createPostgresAuthAuditWriter();
	await assert.rejects(
		() => writer.write({ stores }, sampleAuditEntry()),
		/ATHENA_AUTH_AUDIT_REQUIRES_TRANSACTION/,
	);
});

test("T-AAS-020: P?: implemented audited events pass the common conformance matrix", () => {
	const catalogSrc = readSrc("auth/domain/catalog.ts");
	assert.equal(catalogSrc.includes("function nestedId("), false);

	for (const event of ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS) {
		const expected = EXPECTED_IR[event];
		const def = eventDef(event);
		assert.equal(def.audit, true, `${event} C-KIND audited`);
		assert.equal(def.mutationKind, expected.mutationKind, `${event} C-KIND`);
		assert.equal(typeof def.resolveSubject, "function", `${event} C-SUBJECT-FN`);
		assert.equal(def.subjectType, expected.subjectType, `${event} C-SUBJECT-TYPE`);
		assert.equal(def.previous, expected.previous, `${event} C-PREV`);
		assert.equal(def.result, expected.result, `${event} C-RESULT`);
		if (expected.orgAware) {
			assert.equal(
				typeof def.resolveOrganizationId,
				"function",
				`${event} C-ORG`,
			);
		}
		if (expected.mutationKind === "delete") {
			assert.equal(def.previous, "required", `${event} delete previous`);
			assert.equal(def.result, "receipt", `${event} delete receipt`);
		}
		if (expected.mutationKind === "create") {
			assert.equal(def.previous, "none", `${event} create previous`);
			assert.equal(def.result, "resource", `${event} create resource`);
		}
	}

	const executeSrc = readSrc("auth/hooks/execute.ts");
	assert.match(executeSrc, /validateAuthAuditEntry/);
	assert.match(executeSrc, /writeAudit/);
});

test("T-AAS-ARCH-001: P?: routes decide what happened; catalog decides what it means; writer only persists", () => {
	const executeSrc = readSrc("auth/hooks/execute.ts");
	assert.match(executeSrc, /resolveSubject/);
	assert.match(executeSrc, /validateAuthAuditEntry/);
	assert.equal(executeSrc.includes("nestedId("), false);

	const auditSrc = readSrc("auth/observability/audit.ts");
	assert.equal(auditSrc.includes("resolveAuthEventSubject"), false);
	assert.equal(auditSrc.includes("nestedId("), false);
	assert.equal(
		auditSrc.includes("entry.organizationId ?? entry.actor.organizationId"),
		false,
	);

	const catalogSrc = readSrc("auth/domain/catalog.ts");
	assert.match(catalogSrc, /resolveSubject/);
	assert.equal(catalogSrc.includes("function nestedId("), false);
});

test("T-AAS-ARCH-002: P?: no public nucleus and executor does not know Postgres vs Memory", () => {
	const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
		exports?: Record<string, unknown>;
	};
	const exportsMap = pkg.exports ?? {};
	assert.equal("./runtime/data/nucleus" in exportsMap, false);

	const executeSrc = readSrc("auth/hooks/execute.ts");
	const scopeSrc = readSrc("auth/hooks/scope.ts");
	assert.equal(executeSrc.includes("memory-stores"), false);
	assert.equal(executeSrc.includes("PostgresAuthStores"), false);
	assert.equal(executeSrc.includes("MemoryAuthStores"), false);
	assert.equal(scopeSrc.includes("memory-stores"), false);
	assert.equal(scopeSrc.includes("PostgresAuthStores"), false);
	assert.match(scopeSrc, /stores: AthenaAuthStores/);

	for (const file of collectTsFiles(join(authRoot, "observability"))) {
		assert.equal(
			readFileSync(file, "utf8").includes("runtime/data/nucleus"),
			false,
			file,
		);
	}
	assert.equal(
		readSrc("auth/hooks/execute.ts").includes("runtime/data/nucleus"),
		false,
	);
	assert.equal(
		readSrc("auth/domain/catalog.ts").includes("runtime/data/nucleus"),
		false,
	);
});
