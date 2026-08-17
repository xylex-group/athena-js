import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	type AccountStatus,
	type AppleNonConformUser,
	type AthenaProfile,
	athena,
	github,
	google,
	type SocialProvider,
	SocialProviderListEnum,
	socialProviderList,
	socialProviders,
} from "../src/social-providers/index.ts";

test("package exports expose ./social-providers entrypoint", async () => {
	const packageJson = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	) as {
		exports: Record<
			string,
			{
				types?: string;
				import?: string;
				require?: string;
				default?: string;
			}
		>;
	};

	assert.equal(
		packageJson.exports["./social-providers"]?.types,
		"./dist/social-providers.d.ts",
	);
	assert.equal(
		packageJson.exports["./social-providers"]?.import,
		"./dist/social-providers.js",
	);
	assert.equal(
		packageJson.exports["./social-providers"]?.require,
		"./dist/social-providers.cjs",
	);
	assert.equal(
		packageJson.exports["./social-providers"]?.default,
		"./dist/social-providers.js",
	);
});

test("socialProviders registry includes better-auth providers and athena", () => {
	assert.equal(typeof socialProviders.google, "function");
	assert.equal(typeof socialProviders.github, "function");
	assert.equal(typeof socialProviders.apple, "function");
	assert.equal(typeof socialProviders.athena, "function");
	assert.ok(socialProviderList.includes("google"));
	assert.ok(socialProviderList.includes("athena"));
	assert.ok(socialProviderList.length >= 30);
});

test("provider factories return expected ids", () => {
	const g = google({ clientId: "cid", clientSecret: "secret" });
	const gh = github({ clientId: "cid", clientSecret: "secret" });
	const a = athena({
		clientId: "cid",
		clientSecret: "secret",
		issuer: "https://auth.example.com",
	});

	assert.equal(g.id, "google");
	assert.equal(gh.id, "github");
	assert.equal(a.id, "athena");
	assert.equal(a.name, "Athena");
});

test("athena createAuthorizationURL builds issuer-based authorize URL", async () => {
	const provider = athena({
		clientId: "cid",
		clientSecret: "secret",
		issuer: "https://auth.example.com",
	});
	const url = await provider.createAuthorizationURL({
		codeVerifier: "verifier-012345678901234567890123456789",
		redirectURI: "https://app.example.com/callback",
		state: "state",
	});

	assert.equal(url.origin, "https://auth.example.com");
	assert.equal(url.pathname, "/oauth2/authorize");
	assert.equal(url.searchParams.get("client_id"), "cid");
	assert.equal(url.searchParams.get("response_type"), "code");
	assert.ok(url.searchParams.get("scope")?.includes("openid"));
});

test("SocialProvider and AccountStatus types accept known values", () => {
	const provider: SocialProvider = "google";
	const custom: SocialProvider = "my-custom-provider";
	const status: AccountStatus = "active";
	const appleUser: AppleNonConformUser = {
		email: "jane@privaterelay.appleid.com",
		name: { firstName: "Jane", lastName: "Doe" },
	};
	const profile: AthenaProfile = { email: "a@b.c", sub: "user_1" };

	assert.equal(provider, "google");
	assert.equal(custom, "my-custom-provider");
	assert.equal(status, "active");
	assert.equal(appleUser.name.firstName, "Jane");
	assert.equal(profile.sub, "user_1");
});

test("SocialProviderListEnum parses known and custom providers", () => {
	assert.equal(SocialProviderListEnum.parse("github"), "github");
	assert.equal(SocialProviderListEnum.parse("athena"), "athena");
	assert.equal(SocialProviderListEnum.parse("custom-idp"), "custom-idp");
});
