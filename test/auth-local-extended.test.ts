import assert from "node:assert/strict";
import { test } from "node:test";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { decodeBase32, generateTotpCode } from "../src/auth/local/totp.ts";

function createTestHasher() {
	return {
		async hash(password: string) {
			return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
		},
		needsRehash(hash: string) {
			return passwordHashNeedsRehash(hash, ATHENA_AUTH_DEFAULT_ARGON2);
		},
		async verify(password: string, hash: string) {
			return hash.endsWith(Buffer.from(password).toString("base64url"));
		},
	};
}

function createRuntime(
	email?: (message: { to: string; type: string; url?: string }) => void,
) {
	return createAthenaAuthRuntime({
		autoMigrate: false,
		email: email ? { send: email } : undefined,
		hasher: createTestHasher(),
	});
}

async function json(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

async function signUp(
	runtime: ReturnType<typeof createRuntime>,
	email: string,
) {
	const response = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email,
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(response.status, 200);
	return {
		cookie: response.headers.get("set-cookie") ?? "",
		body: await json(response),
	};
}

test("verify-email consumes a one-time token and marks the user verified", async () => {
	let captured: string | undefined;
	const runtime = createRuntime((message) => {
		captured = message.url;
	});
	await signUp(runtime, "verify@example.com");
	const send = await runtime.handle(
		new Request("http://app.local/api/auth/send-verification-email", {
			body: JSON.stringify({ email: "verify@example.com" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(send.status, 200);
	assert.ok(captured?.startsWith("verify_"));
	const verified = await runtime.handle(
		new Request(
			`http://app.local/api/auth/verify-email?token=${encodeURIComponent(captured ?? "")}`,
		),
	);
	assert.equal(verified.status, 200);
	const body = await json(verified);
	assert.equal(body.status, true);
	assert.equal((body.user as { emailVerified?: boolean }).emailVerified, true);
});

test("change-email requires confirmation and applies after verify", async () => {
	let captured: string | undefined;
	const runtime = createRuntime((message) => {
		if (message.type === "change-email") {
			captured = message.url;
		}
	});
	const { cookie } = await signUp(runtime, "old@example.com");
	const requestChange = await runtime.handle(
		new Request("http://app.local/api/auth/change-email", {
			body: JSON.stringify({ newEmail: "new@example.com" }),
			headers: {
				"content-type": "application/json",
				cookie,
			},
			method: "POST",
		}),
	);
	assert.equal(requestChange.status, 200);
	assert.ok(captured);
	const confirm = await runtime.handle(
		new Request("http://app.local/api/auth/change-email/verify", {
			body: JSON.stringify({ token: captured }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(confirm.status, 200);
	assert.equal(
		((await json(confirm)).user as { email?: string }).email,
		"new@example.com",
	);
});

test("delete-user removes the account and clears the session cookie", async () => {
	const runtime = createRuntime();
	const { cookie } = await signUp(runtime, "gone@example.com");
	const deleted = await runtime.handle(
		new Request("http://app.local/api/auth/delete-user", {
			body: JSON.stringify({ password: "Password123!" }),
			headers: {
				"content-type": "application/json",
				cookie,
			},
			method: "POST",
		}),
	);
	assert.equal(deleted.status, 200);
	assert.equal((await json(deleted)).message, "User deleted");
	const session = await runtime.handle(
		new Request("http://app.local/api/auth/get-session", {
			headers: { cookie },
		}),
	);
	assert.equal(session.status, 401);
});

test("API keys are hashed, returned once, and can authenticate get-session", async () => {
	const runtime = createRuntime();
	const { cookie } = await signUp(runtime, "keys@example.com");
	const created = await runtime.handle(
		new Request("http://app.local/api/auth/api-key/create", {
			body: JSON.stringify({ name: "ci", prefix: "ak_" }),
			headers: {
				"content-type": "application/json",
				cookie,
			},
			method: "POST",
		}),
	);
	assert.equal(created.status, 200);
	const createdBody = await json(created);
	const fullKey = createdBody.key as string;
	assert.ok(fullKey.startsWith("ak_"));
	const verify = await runtime.handle(
		new Request("http://app.local/api/auth/api-key/verify", {
			body: JSON.stringify({ key: fullKey }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal((await json(verify)).valid, true);
	const viaHeader = await runtime.handle(
		new Request("http://app.local/api/auth/get-session", {
			headers: { "x-api-key": fullKey },
		}),
	);
	assert.equal(viaHeader.status, 200);
	assert.equal(
		((await json(viaHeader)).user as { email?: string }).email,
		"keys@example.com",
	);
	const listed = await runtime.handle(
		new Request("http://app.local/api/auth/api-key/list", {
			headers: { cookie },
		}),
	);
	const apiKeys =
		((await json(listed)).apiKeys as Array<{ key?: string }>) ?? [];
	assert.equal(apiKeys.length, 1);
	assert.equal(apiKeys[0]?.key, undefined);
});

test("TOTP enable, sign-in challenge, and verify-totp issue a session", async () => {
	const runtime = createRuntime();
	const { cookie } = await signUp(runtime, "totp@example.com");
	const enabled = await runtime.handle(
		new Request("http://app.local/api/auth/two-factor/enable", {
			body: JSON.stringify({ password: "Password123!" }),
			headers: {
				"content-type": "application/json",
				cookie,
			},
			method: "POST",
		}),
	);
	assert.equal(enabled.status, 200);
	const enabledBody = await json(enabled);
	const uri = enabledBody.totpURI as string;
	const secret = new URL(uri).searchParams.get("secret");
	assert.ok(secret);
	const codes = enabledBody.backupCodes as string[];
	assert.equal(codes.length, 10);

	const signin = await runtime.handle(
		new Request("http://app.local/api/auth/sign-in/email", {
			body: JSON.stringify({
				email: "totp@example.com",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	const signinBody = await json(signin);
	assert.equal(signinBody.twoFactorRedirect, true);
	const pending = signinBody.token as string;
	const otp = await generateTotpCode(decodeBase32(secret));
	const verified = await runtime.handle(
		new Request("http://app.local/api/auth/two-factor/verify-totp", {
			body: JSON.stringify({ code: otp, token: pending }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(verified.status, 200);
	const verifiedBody = await json(verified);
	assert.equal(verifiedBody.status, true);
	assert.equal(typeof verifiedBody.token, "string");
	assert.ok(
		verified.headers.get("set-cookie")?.includes("athena-auth.session-token="),
	);
});
