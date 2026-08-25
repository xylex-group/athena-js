/**
 * PR #764 review-comment regressions. Titles encode the original found case
 * (`P?: <exact subject>`).
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { executeAuthMutation } from "../../src/auth/hooks/execute.ts";
import {
	ATHENA_AUTH_DOMAIN_EVENTS,
	ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS,
} from "../../src/auth/hooks/events.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { createMemoryAuthMutationTransaction } from "../../src/auth/local/mutation-transaction.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
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

test("P?: Do not advertise the unserved social sign-in event", () => {
	assert.equal(
		ATHENA_AUTH_DOMAIN_EVENTS["user.sign-in.social"].status,
		"implemented",
	);
	assert.equal(
		ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS.includes("user.sign-in.social"),
		true,
	);
	assert.equal(
		readSrc("auth/local/social/routes.ts").includes(
			'event: "user.sign-in.social"',
		),
		true,
		"social routes emit user.sign-in.social after HTTP landing",
	);
});

test("P?: Keep account lifecycle events reserved until handlers migrate", () => {
	assert.equal(ATHENA_AUTH_DOMAIN_EVENTS["account.link"].status, "implemented");
	assert.equal(ATHENA_AUTH_DOMAIN_EVENTS["account.unlink"].status, "implemented");
	assert.equal(
		ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS.includes("account.link"),
		true,
	);
	assert.equal(
		ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS.includes("account.unlink"),
		true,
	);
	const socialSrc = readSrc("auth/local/social/routes.ts");
	assert.equal(socialSrc.includes('event: "account.link"'), true);
	assert.equal(socialSrc.includes('event: "account.unlink"'), true);
});

test("P?: Update all session-revoke route payloads", () => {
	const routerSrc = readSrc("auth/local/router.ts");
	for (const route of [
		"/sign-out",
		"/revoke-session",
		"/revoke-sessions",
		"/revoke-other-sessions",
	] as const) {
		const handler = extractPathHandler(routerSrc, route);
		assert.match(handler, /previous:/, `${route} must capture previous`);
		assert.match(
			handler,
			/revoked:\s*true/,
			`${route} must emit a session revoke receipt`,
		);
		assert.equal(
			/resultOf:\s*\(\)\s*=>\s*\(\{\s*userId:/.test(handler),
			false,
			`${route} must not return only { userId }`,
		);
	}
	assert.match(
		extractPathHandler(routerSrc, "/revoke-sessions"),
		/secondaryEvents/,
	);
	assert.match(
		extractPathHandler(routerSrc, "/revoke-other-sessions"),
		/secondaryEvents/,
	);
});

test("P?: Wire the session loader into the admin route", () => {
	const routerSrc = readSrc("auth/local/router.ts");
	const start = routerSrc.indexOf("handleAdminRoute(");
	assert.notEqual(start, -1);
	const construction = routerSrc.slice(start, start + 1800);
	assert.match(construction, /listSessionsForUser:/);
	assert.match(construction, /listUserSessions/);
});

test("P?: Derive bulk revoke receipts from the transactional session set", () => {
	const routerSrc = readSrc("auth/local/router.ts");
	for (const route of ["/revoke-sessions", "/revoke-other-sessions"] as const) {
		const handler = extractPathHandler(routerSrc, route);
		const mutateAt = handler.indexOf("await mutate(");
		assert.notEqual(mutateAt, -1, `${route} must enter mutate`);
		const beforeMutate = handler.slice(0, mutateAt);
		assert.equal(
			beforeMutate.includes("splitPrimaryAndRest"),
			false,
			`${route} must not partition sessions before mutate`,
		);
		assert.equal(
			/\bif \(partitioned\) \{/.test(handler),
			false,
			`${route} must not skip mutate when the pre-transaction set is empty`,
		);
		const executeAt = handler.indexOf("execute:", mutateAt);
		assert.notEqual(executeAt, -1, `${route} must have execute`);
		const executeBody = handler.slice(executeAt);
		assert.match(
			executeBody,
			/listUserSessions/,
			`${route} must list the live set inside execute`,
		);
		assert.match(
			executeBody,
			/splitPrimaryAndRest/,
			`${route} must derive receipts from the transactional session set`,
		);
		assert.match(
			handler,
			/resultOf:\s*\(\s*[A-Za-z_]/,
			`${route} resultOf must use the execute result`,
		);
		assert.match(
			handler,
			/secondaryEvents:\s*\(\s*[A-Za-z_]/,
			`${route} secondaryEvents must use the execute result`,
		);
	}
});

test("P?: Derive admin revokes from the transactional session set", () => {
	const src = readSrc("auth/local/admin-routes.ts");
	const start = src.indexOf("ATHENA_AUTH_ADMIN_PATHS.revokeUserSessions");
	assert.notEqual(start, -1, "expected admin revoke-user-sessions handler");
	const from = src.slice(start);
	const nextIf = from.search(/\n\tif \(/);
	const handler = nextIf === -1 ? from : from.slice(0, nextIf);
	const mutateAt = handler.indexOf("await ctx.mutate(");
	assert.notEqual(mutateAt, -1, "admin revoke-user-sessions must enter mutate");
	const beforeMutate = handler.slice(0, mutateAt);
	assert.equal(
		beforeMutate.includes("listSessionsForUser"),
		false,
		"must not snapshot sessions before mutate",
	);
	assert.equal(
		beforeMutate.includes("splitPrimaryAndRest"),
		false,
		"must not partition sessions before mutate",
	);
	assert.equal(
		/await ctx\.store\.deleteUserSessions/.test(beforeMutate),
		false,
		"must not delete sessions outside the mutation executor",
	);
	const executeAt = handler.indexOf("execute:", mutateAt);
	assert.notEqual(executeAt, -1, "must have execute");
	const executeBody = handler.slice(executeAt);
	assert.match(
		executeBody,
		/listUserSessions|listSessionsForUser/,
		"must list the live set inside execute",
	);
	assert.match(
		executeBody,
		/splitPrimaryAndRest/,
		"must derive receipts from the transactional session set",
	);
	assert.match(
		executeBody,
		/revokeBridgeCodesForUser/,
		"must revoke bridge codes inside execute even when the live set is empty",
	);
	assert.match(
		handler,
		/resultOf:\s*\(\s*[A-Za-z_]/,
		"resultOf must use the execute result",
	);
	assert.match(
		handler,
		/secondaryEvents:\s*\(\s*[A-Za-z_]/,
		"secondaryEvents must use the execute result",
	);
});

test("P?: Preserve idempotent active-organization clears", () => {
	const handler = extractPathHandler(
		readSrc("auth/local/router.ts"),
		"/organization/set-active",
	);
	const mutateAt = handler.indexOf("await mutate(");
	assert.notEqual(mutateAt, -1);
	const beforeMutate = handler.slice(0, mutateAt);
	assert.match(
		beforeMutate,
		/active_organization_id/,
		"must compare against the current active organization before mutating",
	);
	assert.match(
		beforeMutate,
		/organizationId ===/,
		"must skip the no-op null-to-null set-active mutation",
	);
});

test("P2: Wire the snapshot producer into the runtime inspector", () => {
	const adapter = readSrc("gateway/server/adapter.ts");
	assert.match(
		adapter,
		/payload\.devtools\s*=\s*await produceAthenaDevtoolsSnapshot/,
		"capabilities handler must call produceAthenaDevtoolsSnapshot",
	);
	const authUiExperimental = join(
		pkgRoot,
		"..",
		"athena-auth-ui",
		"src",
		"components",
		"auth",
		"experimental",
	);
	const runtimeUi = readFileSync(
		join(authUiExperimental, "athena-devtools-runtime.ts"),
		"utf8",
	);
	assert.match(
		runtimeUi,
		/isRecord\(value\.devtools\)/,
		"overlay runtime parser must consume the capabilities snapshot",
	);
	const overlay = readFileSync(
		join(authUiExperimental, "auth-routing-debug-overlay.tsx"),
		"utf8",
	);
	assert.match(overlay, /snapshot\.configuration/);
	assert.match(overlay, /snapshot\.models/);
	assert.match(overlay, /snapshot\.migrations/);
});

test("P?: Migrate the remaining organization delete handlers", () => {
	const routerSrc = readSrc("auth/local/router.ts");
	const orgDelete = extractPathHandler(routerSrc, "/organization/delete");
	assert.match(orgDelete, /event: "organization.delete"/);
	assert.match(orgDelete, /deleted:\s*true/);
	assert.match(orgDelete, /\bid:/);
	assert.equal(
		/resultOf:\s*\(\)\s*=>\s*\(\{\s*organizationId\s*\}\)/.test(orgDelete),
		false,
	);

	const removeMember = extractPathHandler(
		routerSrc,
		"/organization/remove-member",
	);
	assert.match(removeMember, /event: "organization.member.remove"/);
	assert.match(removeMember, /deleted:\s*true/);
	assert.match(removeMember, /\bid:/);

	const leave = extractPathHandler(routerSrc, "/organization/leave");
	assert.match(leave, /event: "organization.member.remove"/);
	assert.match(leave, /deleted:\s*true/);
	assert.match(leave, /\bid:/);
});

test("P?: Remove nonexistent social modules from the source scan", () => {
	const hooksTest = readFileSync(
		join(pkgRoot, "test", "auth-domain-hooks.test.ts"),
		"utf8",
	);
	for (const rel of [
		"local/social/routes.ts",
		"local/social/runtime.ts",
	] as const) {
		assert.equal(
			existsSync(join(srcRoot, "auth", ...rel.split("/"))),
			true,
			`src/auth/${rel} must exist after embedded social HTTP`,
		);
		assert.equal(
			hooksTest.includes(`"${rel}"`),
			true,
			`auth-domain-hooks source scan must list ${rel}`,
		);
	}
});

test("P?: Keep audit suppression from bypassing after hooks", async () => {
	const stores = new MemoryAuthStores();
	const transaction = createMemoryAuthMutationTransaction(stores);
	const phases: string[] = [];
	const session = {
		activeOrganizationId: null,
		expiresAt: new Date().toISOString(),
		id: "sess_1",
		impersonatedBy: null,
		userId: "user_1",
	};
	await executeAuthMutation({
		context: {
			actor: { kind: "user", userId: "user_1" },
			request: { method: "POST", path: "/revoke-sessions" },
			traceId: "tr_revoke_noop",
		},
		event: "session.revoke",
		execute: async () => undefined,
		hooks: {
			after: {
				"session.revoke": async () => {
					phases.push("after");
				},
			},
			before: {
				"session.revoke": async () => {
					phases.push("before");
				},
			},
		},
		input: { scope: "all", userId: "user_1" },
		previous: async () => ({ session }),
		resultOf: () => ({
			id: session.id,
			revoked: true as const,
			userId: session.userId,
		}),
		shouldPersistAudit: () => false,
		transaction,
	});
	assert.deepEqual(
		phases,
		["before", "after"],
		"found case: shouldPersistAudit false skipped after after before already ran",
	);
});
