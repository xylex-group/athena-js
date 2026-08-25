import assert from "node:assert/strict";
import { test } from "node:test";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";
import { createEmbeddedCapabilitySnapshot } from "../src/auth/capabilities.ts";
import { normalizeAthenaAuthConfig } from "../src/auth/config.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { AthenaConfigurationError, createClient } from "../src/v3-client.ts";

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

function createRuntime() {
	return createAthenaAuthRuntime({
		autoMigrate: false,
		hasher: createTestHasher(),
	});
}

async function json(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

test("GET /ok and /health terminate locally without a remote service", async () => {
	const runtime = createRuntime();
	const ok = await runtime.handle(new Request("http://app.local/api/auth/ok"));
	assert.equal(ok.status, 200);
	assert.deepEqual(await json(ok), {
		ok: true,
		capabilities: createEmbeddedCapabilitySnapshot(),
	});

	const health = await runtime.handle(
		new Request("http://app.local/api/auth/health"),
	);
	assert.equal(health.status, 200);
	const body = await json(health);
	assert.equal(body.status, "ok");
	assert.equal(body.service, "athena-auth");
	assert.ok(health.headers.get("x-athena-trace-id"));
});

test("GET /ok advertises passkeys when auth.passkey.enabled is true", async () => {
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		config: normalizeAthenaAuthConfig({
			mode: "local",
			passkey: { enabled: true, rpId: "localhost" },
		}),
		hasher: createTestHasher(),
	});
	const ok = await runtime.handle(new Request("http://app.local/api/auth/ok"));
	assert.equal(ok.status, 200);
	const body = await json(ok);
	assert.deepEqual(body.capabilities, createEmbeddedCapabilitySnapshot({
		passkeyEnabled: true,
	}));
});

test("unknown routes return a contract error envelope", async () => {
	const runtime = createRuntime();
	const response = await runtime.handle(
		new Request("http://app.local/api/auth/not-a-route"),
	);
	assert.equal(response.status, 404);
	const body = await json(response);
	assert.equal(typeof body.message, "string");
	assert.equal(typeof body.traceId, "string");
	assert.equal(typeof body.version, "string");
	assert.equal(body.traceId, response.headers.get("x-athena-trace-id"));
});

test("email signup, signin, get-session, and sign-out form one local loop", async () => {
	const runtime = createRuntime();
	const signup = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email: "ada@example.com",
				name: "Ada",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(signup.status, 200);
	const signupBody = await json(signup);
	assert.equal(typeof signupBody.token, "string");
	const cookie = signup.headers.get("set-cookie");
	assert.ok(cookie?.includes("athena-auth.session-token="));
	assert.ok(cookie?.includes("HttpOnly"));

	const session = await runtime.handle(
		new Request("http://app.local/api/auth/get-session", {
			headers: { cookie: cookie ?? "" },
		}),
	);
	assert.equal(session.status, 200);
	const sessionBody = await json(session);
	const user = sessionBody.user as { email?: string };
	assert.equal(user.email, "ada@example.com");

	await runtime.handle(
		new Request("http://app.local/api/auth/sign-out", {
			headers: { cookie: cookie ?? "" },
			method: "POST",
		}),
	);

	const signin = await runtime.handle(
		new Request("http://app.local/api/auth/sign-in/email", {
			body: JSON.stringify({
				email: "ada@example.com",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(signin.status, 200);
	const signinBody = await json(signin);
	assert.equal(signinBody.redirect, false);
	assert.equal(typeof signinBody.token, "string");
});

test("duplicate signup conflicts without leaking a stack", async () => {
	const runtime = createRuntime();
	const payload = {
		body: JSON.stringify({
			email: "dup@example.com",
			password: "Password123!",
		}),
		headers: { "content-type": "application/json" },
		method: "POST",
	};
	const first = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", payload),
	);
	assert.equal(first.status, 200);
	const second = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", payload),
	);
	assert.equal(second.status, 409);
	const body = await json(second);
	assert.equal(body.message, "A user with this email already exists");
});

test("wrong password returns Invalid credentials", async () => {
	const runtime = createRuntime();
	await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email: "secret@example.com",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	const failed = await runtime.handle(
		new Request("http://app.local/api/auth/sign-in/email", {
			body: JSON.stringify({
				email: "secret@example.com",
				password: "wrong-password",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(failed.status, 401);
	assert.equal((await json(failed)).message, "Invalid credentials");
});

test("forgot password is enumeration-resistant and reset consumes the token once", async () => {
	const runtime = createRuntime();
	await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email: "reset@example.com",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	const missing = await runtime.handle(
		new Request("http://app.local/api/auth/forget-password", {
			body: JSON.stringify({ email: "missing@example.com" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(missing.status, 200);
	assert.equal((await json(missing)).status, true);

	let capturedToken: string | undefined;
	const capturing = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher: createTestHasher(),
		legacySend: (message) => {
			capturedToken = message.url;
		},
	});
	await capturing.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email: "reset2@example.com",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	await capturing.handle(
		new Request("http://app.local/api/auth/forget-password", {
			body: JSON.stringify({ email: "reset2@example.com" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.ok(capturedToken);
	const reset = await capturing.handle(
		new Request("http://app.local/api/auth/reset-password", {
			body: JSON.stringify({
				newPassword: "NewPassword123!",
				token: capturedToken,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(reset.status, 200);
	const replay = await capturing.handle(
		new Request("http://app.local/api/auth/reset-password", {
			body: JSON.stringify({
				newPassword: "AnotherPassword123!",
				token: capturedToken,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(replay.status, 400);
});

test("organization create/list/invite/accept stay scoped to the member", async () => {
	const runtime = createRuntime();
	const owner = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email: "owner@example.com",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	const ownerCookie = owner.headers.get("set-cookie") ?? "";
	const created = await runtime.handle(
		new Request("http://app.local/api/auth/organization/create", {
			body: JSON.stringify({ name: "Acme", slug: "acme" }),
			headers: {
				"content-type": "application/json",
				cookie: ownerCookie,
			},
			method: "POST",
		}),
	);
	assert.equal(created.status, 200);
	const createdBody = await json(created);
	const organization = createdBody.organization as { id: string };
	assert.ok(organization.id);

	const selfInvite = await runtime.handle(
		new Request("http://app.local/api/auth/organization/invite-member", {
			body: JSON.stringify({
				email: "  Owner@Example.com ",
				organizationId: organization.id,
				role: "member",
			}),
			headers: {
				"content-type": "application/json",
				cookie: ownerCookie,
			},
			method: "POST",
		}),
	);
	assert.equal(selfInvite.status, 400);
	const selfInviteBody = await json(selfInvite);
	assert.equal(
		selfInviteBody.message,
		"You cannot invite your own email as a member",
	);

	const member = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email: "member@example.com",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	const memberCookie = member.headers.get("set-cookie") ?? "";
	const invited = await runtime.handle(
		new Request("http://app.local/api/auth/organization/invite-member", {
			body: JSON.stringify({
				email: "member@example.com",
				organizationId: organization.id,
				role: "member",
			}),
			headers: {
				"content-type": "application/json",
				cookie: ownerCookie,
			},
			method: "POST",
		}),
	);
	const invitation = ((await json(invited)).invitation as { id: string }).id;
	const accepted = await runtime.handle(
		new Request("http://app.local/api/auth/organization/accept-invitation", {
			body: JSON.stringify({ invitationId: invitation }),
			headers: {
				"content-type": "application/json",
				cookie: memberCookie,
			},
			method: "POST",
		}),
	);
	assert.equal(accepted.status, 200);

	const crossRead = await runtime.handle(
		new Request(
			`http://app.local/api/auth/organization/list-members?organizationId=${organization.id}`,
			{
				headers: {
					cookie:
						(
							await runtime.handle(
								new Request("http://app.local/api/auth/sign-up/email", {
									body: JSON.stringify({
										email: "outsider@example.com",
										password: "Password123!",
									}),
									headers: { "content-type": "application/json" },
									method: "POST",
								}),
							)
						).headers.get("set-cookie") ?? "",
				},
			},
		),
	);
	assert.equal(crossRead.status, 403);
});

test("createClient local mode requires pgUri", () => {
	assert.throws(
		() =>
			createClient({
				auth: { mode: "local" },
				url: "https://athena.example.com",
				key: "key",
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_AUTH_LOCAL_DATABASE_REQUIRED",
	);
});

test("password PHC hashes from the Rust default profile do not need rehash", () => {
	const rustStyleHash = "$argon2id$v=19$m=1024,t=2,p=1$c29tZXNhbHQ$dGVzdGhhc2g";
	assert.equal(passwordHashNeedsRehash(rustStyleHash), false);
	assert.equal(
		passwordHashNeedsRehash("$argon2id$v=19$m=512,t=2,p=1$c29tZXNhbHQ$dGVzdA"),
		true,
	);
	assert.equal(
		passwordHashNeedsRehash(
			"$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$dGVzdA",
		),
		false,
	);
});

test("organization update applies Better Auth data envelope name, slug, and logo", async () => {
	const runtime = createRuntime();
	const owner = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email: "org-update@example.com",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	const ownerCookie = owner.headers.get("set-cookie") ?? "";
	const created = await runtime.handle(
		new Request("http://app.local/api/auth/organization/create", {
			body: JSON.stringify({ name: "Acme", slug: "acme" }),
			headers: {
				"content-type": "application/json",
				cookie: ownerCookie,
			},
			method: "POST",
		}),
	);
	assert.equal(created.status, 200);
	const createdBody = await json(created);
	const organization = createdBody.organization as { id: string };

	const updated = await runtime.handle(
		new Request("http://app.local/api/auth/organization/update", {
			body: JSON.stringify({
				data: {
					image: "data:image/png;base64,abc",
					logo: "data:image/png;base64,abc",
					name: "Acme Labs",
					slug: "acme-labs",
				},
				organizationId: organization.id,
			}),
			headers: {
				"content-type": "application/json",
				cookie: ownerCookie,
			},
			method: "POST",
		}),
	);
	assert.equal(updated.status, 200);
	const updatedBody = await json(updated);
	const next = updatedBody.organization as {
		logo: string | null;
		name: string;
		slug: string;
	};
	assert.equal(next.name, "Acme Labs");
	assert.equal(next.slug, "acme-labs");
	assert.equal(next.logo, "data:image/png;base64,abc");

	const cleared = await runtime.handle(
		new Request("http://app.local/api/auth/organization/update", {
			body: JSON.stringify({
				data: { logo: "" },
				organizationId: organization.id,
			}),
			headers: {
				"content-type": "application/json",
				cookie: ownerCookie,
			},
			method: "POST",
		}),
	);
	assert.equal(cleared.status, 200);
	const clearedBody = await json(cleared);
	const afterClear = clearedBody.organization as { logo: string | null };
	assert.equal(afterClear.logo, null);
});
