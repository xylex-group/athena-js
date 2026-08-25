/**
 * Architecture guards for Athena Email vs Auth Email vs Auth Email Store.
 */

import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const srcRoot = join(pkgRoot, "src");

const IMPORT_FROM_RE =
	/^[ \t]*import[ \t]+(?:type[ \t]+)?[^;]*?[ \t]from[ \t]*["']([^"']+)["']/gm;

function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	if (!existsSync(dir)) {
		return out;
	}
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const next = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...listTsFiles(next));
		} else if (entry.name.endsWith(".ts")) {
			out.push(next);
		}
	}
	return out;
}

function sourceOf(rel: string): string {
	return readFileSync(join(pkgRoot, rel), "utf8");
}

test("src/auth does not import SMTP, Resend, or generic HTTP provider implementations", () => {
	const offenders: string[] = [];
	for (const file of listTsFiles(join(srcRoot, "auth"))) {
		const source = readFileSync(file, "utf8");
		const rel = relative(srcRoot, file).replaceAll("\\", "/");
		if (
			source.includes("email-node") ||
			source.includes("email/providers") ||
			/\bsmtp\s*\(/.test(source) ||
			/\bresend\s*\(/.test(source) ||
			/\bhttpEmailProvider\s*\(/.test(source)
		) {
			offenders.push(rel);
		}
		IMPORT_FROM_RE.lastIndex = 0;
		for (const match of source.matchAll(IMPORT_FROM_RE)) {
			const specifier = match[1] ?? "";
			if (
				specifier.includes("email-node") ||
				specifier.includes("email/providers")
			) {
				offenders.push(`${rel} from ${specifier}`);
			}
		}
	}
	assert.deepEqual(offenders, []);
});

test("browser entrypoints do not import src/email-node", () => {
	const entries = [
		"src/browser.ts",
		"src/v3-client-core.ts",
		"src/email/public.ts",
		"src/email/index.ts",
		"src/cloudflare/index.ts",
		"src/next/client.ts",
	];
	for (const rel of entries) {
		const source = sourceOf(rel);
		IMPORT_FROM_RE.lastIndex = 0;
		for (const match of source.matchAll(IMPORT_FROM_RE)) {
			const specifier = match[1] ?? "";
			assert.equal(
				specifier.includes("email-node"),
				false,
				`${rel} imports ${specifier}`,
			);
		}
	}
});

test("AthenaAuthConfig does not declare email transport fields", () => {
	const config = sourceOf("src/v3-client-core.ts");
	const match = config.match(
		/export interface AthenaAuthConfig[\s\S]*?\nexport interface AthenaStorageConfig/,
	);
	assert.ok(match);
	assert.doesNotMatch(match[0], /\bprovider\?:/);
	assert.doesNotMatch(match[0], /\bsmtp\?:/);
	assert.doesNotMatch(match[0], /\bresend\?:/);
	assert.doesNotMatch(match[0], /email\?:\s*\{/);
});

test("provider SDK types do not leak into public email declarations", () => {
	const files = [
		...listTsFiles(join(srcRoot, "email")),
		join(srcRoot, "email-node", "smtp.ts"),
		join(srcRoot, "index.ts"),
		join(srcRoot, "browser.ts"),
	];
	const offenders: string[] = [];
	for (const file of files) {
		if (!existsSync(file)) {
			continue;
		}
		const source = readFileSync(file, "utf8");
		IMPORT_FROM_RE.lastIndex = 0;
		for (const match of source.matchAll(IMPORT_FROM_RE)) {
			const specifier = match[1] ?? "";
			if (
				specifier === "nodemailer" ||
				specifier.startsWith("nodemailer/") ||
				specifier === "resend" ||
				specifier.startsWith("@resend/")
			) {
				offenders.push(
					`${relative(srcRoot, file).replaceAll("\\", "/")} imports ${specifier}`,
				);
			}
		}
	}
	assert.deepEqual(offenders, []);
});

test("embedded Auth does not construct its own email transport", () => {
	const runtime = sourceOf("src/auth/local/runtime.ts");
	const deps = sourceOf("src/auth/local/runtime-dependencies.ts");
	assert.equal(runtime.includes("smtp("), false);
	assert.equal(runtime.includes("resend("), false);
	assert.equal(runtime.includes("httpEmailProvider("), false);
	assert.equal(runtime.includes("consoleEmailProvider("), false);
	assert.match(deps, /let delivery = options\.delivery/);
	const client = sourceOf("src/v3-client.ts");
	assert.match(client, /createEmailDeliveryPort\(client\.email\)/);
	assert.equal(
		client.includes("createAthenaAuthRuntime") && client.includes("smtp("),
		false,
	);
});

test("console delivery is never implicit", () => {
	const module = sourceOf("src/email/module.ts");
	const normalize = sourceOf("src/email/normalize-config.ts");
	assert.equal(module.includes("consoleEmailProvider"), false);
	assert.equal(normalize.includes("consoleEmailProvider"), false);
	assert.match(module, /ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED/);
});

test("remote Auth does not consume the local root email provider", () => {
	const client = sourceOf("src/v3-client.ts");
	const remoteFn = client.match(
		/function attachRemoteAuthHandlers[\s\S]*?function rejectUnsupportedEmbeddedAuthFeatures/,
	);
	assert.ok(remoteFn);
	assert.equal(remoteFn[0].includes("createEmailDeliveryPort"), false);
	assert.equal(remoteFn[0].includes("client.email"), false);
	assert.match(
		client,
		/if \(!isLocalAthenaAuthConfig\(config\.auth\)\) \{\s*assertLocalAuthHooks[\s\S]*return attachRemoteAuthHandlers/,
	);
});

test("Auth no longer exports a parallel EmailMessage/provider transport", () => {
	const contract = sourceOf("src/auth/email/contract.ts");
	assert.equal(contract.includes("AthenaAuthEmailProvider"), false);
	assert.equal(contract.includes("AthenaAuthEmailMessage"), false);
	assert.equal(contract.includes("AthenaAuthEmailDeliveryResult"), false);
	assert.match(contract, /AthenaAuthEmailRecordRow/);
	assert.match(contract, /AthenaAuthEmailFailureRow/);
});
