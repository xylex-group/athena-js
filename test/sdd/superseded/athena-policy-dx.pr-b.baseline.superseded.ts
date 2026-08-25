/**
 * SUPERSEDED by test/sdd/athena-policy-dx.target.test.ts (PR B GREEN).
 * Former characterization of Policy DX extras still ABSENT after Wave 1.
 *
 * See docs/sdd/xylex/athena-policy/SPEC.md and dual-suite/dual-suite-spec.md.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CLI_COMMAND_CATALOG } from "../../src/cli/commands-catalog.ts";
import { CLI_REGISTERED_COMMANDS } from "../../src/cli/commands/register.ts";
import * as policyBarrel from "../../src/policy/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

const PRESET_IDS = [
	"organizationScoped",
	"tenantScoped",
	"userOwned",
	"publicRead",
	"authenticatedOnly",
	"roleRestricted",
	"serviceOnly",
	"ownerOrRole",
] as const;

const POLICY_DX_COMMANDS = [
	"policy list",
	"policy show",
	"policy validate",
	"policy lint",
	"policy coverage",
	"policy explain",
	"policy simulate",
	"policy fingerprint",
	"policy export",
] as const;

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
}

function collectTsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
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

test("B-PDX-CLI-NO-POLICY: CLI catalog/group/register have no policy surface", () => {
	const catalogSrc = readSrc("cli/commands-catalog.ts");
	const groupUnion = catalogSrc.slice(
		catalogSrc.indexOf("group:"),
		catalogSrc.indexOf("helpTopic?:"),
	);
	assert.equal(groupUnion.includes('"policy"'), false);
	assert.match(groupUnion, /"schema"/);
	assert.match(groupUnion, /"auth"/);

	const helpUnionStart = catalogSrc.indexOf("export type CatalogHelpTopic");
	const helpUnionEnd = catalogSrc.indexOf(
		"export const CLI_COMMAND_CATALOG",
	);
	const helpUnion = catalogSrc.slice(helpUnionStart, helpUnionEnd);
	assert.equal(helpUnion.includes('"policy"'), false);
	assert.match(helpUnion, /"schema"/);

	const titlesStart = catalogSrc.indexOf("const GROUP_TITLES");
	const titlesEnd = catalogSrc.indexOf("export type CommandsListFormat");
	assert.ok(titlesStart >= 0 && titlesEnd > titlesStart);
	const titles = catalogSrc.slice(titlesStart, titlesEnd);
	assert.equal(titles.includes("policy:"), false);
	assert.equal(titles.includes('"policy"'), false);

	for (const entry of CLI_COMMAND_CATALOG) {
		assert.notEqual(String(entry.group), "policy");
		assert.notEqual(String(entry.helpTopic ?? ""), "policy");
		assert.equal(
			entry.command === "policy" || entry.command.startsWith("policy "),
			false,
		);
	}

	for (const registered of CLI_REGISTERED_COMMANDS) {
		assert.notEqual(registered.path[0], "policy");
	}

	assert.equal(existsSync(join(srcRoot, "cli", "commands", "policy")), false);
});

test("B-PDX-NO-LINT-COVERAGE: catalog has no policy lint/coverage (or other policy DX) commands", () => {
	const commands = new Set(CLI_COMMAND_CATALOG.map((entry) => entry.command));
	for (const command of POLICY_DX_COMMANDS) {
		assert.equal(commands.has(command), false, command);
	}
	assert.equal(commands.has("policy create"), false);
	assert.equal(commands.has("policy update"), false);
	assert.equal(commands.has("policy test"), false);
});

test("B-PDX-NO-PRESETS: named presets are absent from src/policy and the policy barrel", () => {
	const policyFiles = collectTsFiles(join(srcRoot, "policy"));
	for (const file of policyFiles) {
		const text = readFileSync(file, "utf8");
		for (const id of PRESET_IDS) {
			assert.equal(
				new RegExp(`\\b${id}\\b`).test(text),
				false,
				`${id} in ${file}`,
			);
		}
		assert.equal(/\bimmutableAfterCreate\b/.test(text), false, file);
	}

	const barrel = policyBarrel as Record<string, unknown>;
	for (const id of PRESET_IDS) {
		assert.equal(id in barrel, false, id);
		assert.equal(typeof barrel[id], "undefined", id);
	}
	assert.equal(typeof policyBarrel.policy, "function");
	assert.equal(typeof policyBarrel.definePolicies, "function");
});

test("B-PDX-NO-EXPLAIN: explainAthenaPolicy / simulate are absent", () => {
	const policyFiles = collectTsFiles(join(srcRoot, "policy"));
	for (const file of policyFiles) {
		const text = readFileSync(file, "utf8");
		assert.equal(/\bexplainAthenaPolicy\b/.test(text), false, file);
		assert.equal(/\bsimulateAthenaPolicy\b/.test(text), false, file);
	}
	const barrel = policyBarrel as Record<string, unknown>;
	assert.equal("explainAthenaPolicy" in barrel, false);
	assert.equal(typeof policyBarrel.decideAthenaPolicy, "function");
	assert.equal(typeof policyBarrel.canonicalizeDocument, "function");
	assert.equal(typeof policyBarrel.fingerprintDocument, "function");
});
