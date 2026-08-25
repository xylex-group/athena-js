/**
 * Auth transport finality — bridge target.
 * Plan 3: GREEN against native issue/exchange + presentation-only Auth UI.
 *
 * Spec: docs/sdd/xylex/athena-auth-transport-finality/
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const authUiBridge = join(
	repoRoot,
	"packages",
	"athena-auth-ui",
	"src",
	"lib",
	"athena",
	"session-bridge.ts",
);
const jsAuthRoot = join(pkgRoot, "src", "auth");
const jsNextBridgeRoot = join(pkgRoot, "src", "next", "session-bridge");
const jsRedact = join(pkgRoot, "src", "cli", "logging", "redact.ts");

function walkTs(dir: string): string[] {
	const out: string[] = [];
	if (!existsSync(dir)) {
		return out;
	}
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules") {
			continue;
		}
		const next = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walkTs(next));
			continue;
		}
		if (entry.name.endsWith(".ts")) {
			out.push(next);
		}
	}
	return out;
}

function joined(dir: string): string {
	return walkTs(dir)
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
}

const sessionBridgeSrc = readFileSync(authUiBridge, "utf8");
const authSrc = joined(jsAuthRoot);
const nextBridgeSrc = joined(jsNextBridgeRoot);
const redactSrc = existsSync(jsRedact) ? readFileSync(jsRedact, "utf8") : "";

test("T-BRIDGE-001: session-bridge.ts must not define a pending session-token sessionStorage key", () => {
	assert.doesNotMatch(
		sessionBridgeSrc,
		/PENDING_AUTH_SESSION_TOKEN_STORAGE_KEY/,
		"remove PENDING_AUTH_SESSION_TOKEN_STORAGE_KEY; session tokens must not live in sessionStorage (AUTH-BRIDGE-01/07)",
	);
	assert.doesNotMatch(
		sessionBridgeSrc,
		/sessionStorage/,
		"session-bridge.ts must not touch sessionStorage for session credentials",
	);
});

test("T-BRIDGE-002: session-bridge.ts must not build URLs containing a session bearer token", () => {
	assert.doesNotMatch(
		sessionBridgeSrc,
		/token:\s*input\.token/,
		"buildSessionBridgeUrl must not put a session bearer on the query string (AUTH-BRIDGE-01)",
	);
	assert.doesNotMatch(
		sessionBridgeSrc,
		/searchParams\.(?:set|append)\(\s*["']token["']/,
		"redirect URLs must not include a token query parameter",
	);
	assert.doesNotMatch(
		sessionBridgeSrc,
		/\?token=|token=input\.token/,
		"no ?token= bearer bridge URLs",
	);
});

test("T-BRIDGE-003: cross-origin bootstrap must expose a bridge-code abstraction", () => {
	const surface = `${authSrc}\n${sessionBridgeSrc}\n${nextBridgeSrc}`;
	assert.match(
		surface,
		/AuthBridgeCodeStore|issueBridgeCode/,
		"AUTH-BRIDGE-02 requires AuthBridgeCodeStore / issueBridgeCode (not implemented yet)",
	);
});

test("T-BRIDGE-004: bridge-code contract requires TTL", () => {
	const surface = `${authSrc}\n${sessionBridgeSrc}`;
	assert.match(
		surface,
		/IssueBridgeCodeInput|ttlMs/,
		"AUTH-BRIDGE-03 requires IssueBridgeCodeInput.ttlMs",
	);
});

test("T-BRIDGE-005: bridge-code contract requires destination-origin binding", () => {
	const surface = `${authSrc}\n${sessionBridgeSrc}`;
	assert.match(
		surface,
		/destinationOrigin/,
		"AUTH-BRIDGE-05 requires destinationOrigin on issue/consume",
	);
});

test("T-BRIDGE-006: bridge-code store contract requires atomic consume semantics", () => {
	assert.match(
		authSrc,
		/ConsumedBridgeCode/,
		"AUTH-BRIDGE-06 requires ConsumedBridgeCode | null from consume",
	);
	assert.match(
		authSrc,
		/consume\s*\(|atomic consume|exactly one winner/i,
		"consume must be specified as atomic single-winner",
	);
});

test("T-BRIDGE-007: final session contract requires HttpOnly storage", () => {
	assert.doesNotMatch(
		sessionBridgeSrc,
		/PENDING_AUTH_SESSION_TOKEN_COOKIE_NAME/,
		"JS-readable pending session cookie is forbidden (AUTH-BRIDGE-07)",
	);
	assert.doesNotMatch(
		sessionBridgeSrc,
		/document\.cookie/,
		"browser JS must not write session credentials to document.cookie",
	);
	assert.match(
		nextBridgeSrc,
		/HttpOnly/,
		"final app-origin session Set-Cookie must include HttpOnly",
	);
});

test("T-BRIDGE-008: redirect contract accepts relative same-origin paths only", () => {
	assert.match(
		sessionBridgeSrc,
		/resolveSafeRedirectTarget/,
		"redirect helper must exist",
	);
	assert.match(
		sessionBridgeSrc,
		/pathname\.startsWith\("\/"\)/,
		"AUTH-BRIDGE-08: only same-origin relative paths",
	);
	assert.doesNotMatch(
		sessionBridgeSrc,
		/redirectTo:\s*rawValue/,
		"must not pass raw redirect URLs through",
	);
});

test("T-BRIDGE-009: redaction contract explicitly forbids bridge-code/session-token logging", () => {
	const redaction = `${redactSrc}\n${authSrc}`;
	assert.match(
		redaction,
		/bridgeCode|bridge_code|bridge-code/,
		"AUTH-BRIDGE-10: redaction must name bridge codes",
	);
	assert.match(
		redaction,
		/session[_-]?token|sessionToken/i,
		"AUTH-BRIDGE-10: redaction must name session tokens",
	);
});

test("T-BRIDGE-010: legacy bearer bridge is explicitly classified as deprecated", () => {
	assert.match(
		sessionBridgeSrc,
		/@deprecated|LEGACY_BEARER_BRIDGE/,
		"legacy ?token= / sessionStorage bridge must be classified deprecated (D0)",
	);
});
