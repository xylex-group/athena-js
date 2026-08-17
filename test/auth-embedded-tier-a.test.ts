/**
 * Embedded Tier A Auth routes required for the 5.1 capability set.
 * Seam: black-box local runtime HTTP, not store internals.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";

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

async function json(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

test("Tier A: username sign-in, set-password, org helpers, and token aliases exist", async () => {
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher: createTestHasher(),
	});
	const origin = "http://app.local/api/auth";
	const signup = await runtime.handle(
		new Request(`${origin}/sign-up/email`, {
			body: JSON.stringify({
				email: "tier-a@example.com",
				name: "Tier A",
				password: "Password123!",
				username: "tiera",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(signup.status, 200);
	const cookie = signup.headers.get("set-cookie") ?? "";

	const username = await runtime.handle(
		new Request(`${origin}/sign-in/username`, {
			body: JSON.stringify({ password: "Password123!", username: "tiera" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(username.status, 200);

	const setPassword = await runtime.handle(
		new Request(`${origin}/set-password`, {
			body: JSON.stringify({ newPassword: "Password1234!" }),
			headers: { "content-type": "application/json", cookie },
			method: "POST",
		}),
	);
	assert.equal(setPassword.status, 200);

	const access = await runtime.handle(
		new Request(`${origin}/get-access-token`, {
			body: JSON.stringify({ audience: "athena" }),
			headers: { "content-type": "application/json", cookie },
			method: "POST",
		}),
	);
	assert.equal(access.status, 200);
	const accessBody = await json(access);
	assert.equal(typeof accessBody.token, "string");

	const refresh = await runtime.handle(
		new Request(`${origin}/refresh-token`, {
			body: JSON.stringify({ audience: "athena" }),
			headers: { "content-type": "application/json", cookie },
			method: "POST",
		}),
	);
	assert.equal(refresh.status, 200);

	const org = await runtime.handle(
		new Request(`${origin}/organization/create`, {
			body: JSON.stringify({ name: "Tier A Org", slug: "tier-a-org" }),
			headers: { "content-type": "application/json", cookie },
			method: "POST",
		}),
	);
	assert.equal(org.status, 200);

	const slugTaken = await runtime.handle(
		new Request(`${origin}/organization/check-slug`, {
			body: JSON.stringify({ slug: "tier-a-org" }),
			headers: { "content-type": "application/json", cookie },
			method: "POST",
		}),
	);
	assert.equal(slugTaken.status, 200);
	assert.equal((await json(slugTaken)).status, false);

	const slugFree = await runtime.handle(
		new Request(`${origin}/organization/check-slug`, {
			body: JSON.stringify({ slug: "available-slug" }),
			headers: { "content-type": "application/json", cookie },
			method: "POST",
		}),
	);
	assert.equal((await json(slugFree)).status, true);

	const permission = await runtime.handle(
		new Request(`${origin}/organization/has-permission`, {
			body: JSON.stringify({ permissions: { organization: ["update"] } }),
			headers: { "content-type": "application/json", cookie },
			method: "POST",
		}),
	);
	assert.equal(permission.status, 200);
	assert.equal((await json(permission)).success, true);

	const member = await runtime.handle(
		new Request(`${origin}/organization/get-active-member`, {
			headers: { cookie },
		}),
	);
	assert.equal(member.status, 200);

	const invite = await runtime.handle(
		new Request(`${origin}/organization/invite-member`, {
			body: JSON.stringify({ email: "invitee@example.com", role: "member" }),
			headers: { "content-type": "application/json", cookie },
			method: "POST",
		}),
	);
	assert.equal(invite.status, 200);
	const invitation = (await json(invite)).invitation as { id?: string };
	assert.equal(typeof invitation?.id, "string");

	const getInvite = await runtime.handle(
		new Request(
			`${origin}/organization/get-invitation?invitationId=${invitation.id}`,
			{ headers: { cookie } },
		),
	);
	assert.equal(getInvite.status, 200);

	const userInvites = await runtime.handle(
		new Request(`${origin}/organization/list-user-invitations`, {
			headers: { cookie },
		}),
	);
	assert.equal(userInvites.status, 200);

	const reject = await runtime.handle(
		new Request(`${origin}/organization/reject-invitation`, {
			body: JSON.stringify({ invitationId: invitation.id }),
			headers: { "content-type": "application/json", cookie },
			method: "POST",
		}),
	);
	assert.equal(reject.status, 200);

	const createdKey = await runtime.handle(
		new Request(`${origin}/api-key/create`, {
			body: JSON.stringify({ name: "tier-a" }),
			headers: { "content-type": "application/json", cookie },
			method: "POST",
		}),
	);
	assert.equal(createdKey.status, 200);
	const keyBody = await json(createdKey);
	const keyId = (keyBody.id ??
		(keyBody.apiKey as { id?: string } | undefined)?.id) as string | undefined;
	assert.equal(typeof keyId, "string");

	const updated = await runtime.handle(
		new Request(`${origin}/api-key/update`, {
			body: JSON.stringify({ id: keyId, name: "tier-a-renamed" }),
			headers: { "content-type": "application/json", cookie },
			method: "POST",
		}),
	);
	assert.equal(updated.status, 200);
});
