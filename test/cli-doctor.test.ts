import { strict as assert } from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatDoctorReport, runCliDoctor } from "../src/cli/doctor.ts";
import { parseCommand, runCLI, usage } from "../src/cli/index.ts";
import type { EnvCheckResult } from "../src/cli/project-env.ts";
import type { ValidationReport } from "../src/cli/validate-local.ts";
import { PACKAGE_VERSION } from "../src/sdk-version.ts";

function envResult(
	resolvedMode: EnvCheckResult["resolvedMode"],
	errorCount = 0,
): EnvCheckResult {
	return {
		checks: [
			{
				field: "postgresUrl",
				keysTried: ["DATABASE_URL"],
				message:
					resolvedMode === "direct"
						? "DATABASE_URL is set"
						: "No Postgres URL found",
				severity: resolvedMode === "direct" ? "ok" : "warn",
				source: resolvedMode === "direct" ? "process" : "missing",
				sourceKey: resolvedMode === "direct" ? "DATABASE_URL" : undefined,
			},
		],
		cwd: "/tmp/athena-doctor",
		errorCount,
		files: [],
		mode: "auto",
		resolvedMode,
		sdkVersion: PACKAGE_VERSION,
		warnCount: resolvedMode === "direct" ? 0 : 1,
	};
}

function runtimeReport(): ValidationReport {
	return {
		checks: [
			{
				group: "data",
				id: "data.connect",
				status: "ok",
				title: "Database connection",
			},
		],
		errorCount: 0,
		ok: true,
		target: { database: "app", provider: "postgres/direct" },
		title: "Athena JS · validate local",
		warnCount: 0,
	};
}

test("parseCommand supports doctor flags", () => {
	assert.deepEqual(parseCommand(["doctor"]), {
		command: "doctor",
		configPath: undefined,
		json: false,
		plain: false,
		skipRuntime: false,
		strict: false,
	});
	assert.deepEqual(
		parseCommand(["doctor", "--skip-runtime", "--strict", "--json"]),
		{
			command: "doctor",
			configPath: undefined,
			json: true,
			plain: false,
			skipRuntime: true,
			strict: true,
		},
	);
	assert.deepEqual(parseCommand(["help", "doctor"]), {
		command: "help",
		topic: "doctor",
	});
	assert.equal(usage("doctor").includes("athena-js doctor"), true);
	assert.equal(usage("root").includes("athena-js doctor"), true);
});

test("runCliDoctor reports tooling, missing config, and skipped runtime", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "athena-doctor-"));
	const report = await runCliDoctor({
		cwd,
		skipRuntime: false,
		validateEnv: () => envResult("none"),
	});
	assert.equal(report.title, "Athena JS · doctor");
	assert.equal(report.sdkVersion, PACKAGE_VERSION);
	assert.equal(report.resolvedMode, "none");
	assert.equal(
		report.checks.some(
			(check) => check.id === "cli.sdk" && check.status === "ok",
		),
		true,
	);
	assert.equal(
		report.checks.some(
			(check) => check.id === "cli.node" && check.status === "ok",
		),
		true,
	);
	assert.equal(
		report.checks.some(
			(check) => check.id === "project.config" && check.status === "warn",
		),
		true,
	);
	assert.equal(
		report.checks.some(
			(check) => check.id === "runtime.inspect" && check.status === "skip",
		),
		true,
	);
	assert.equal(report.ok, true);
	const text = formatDoctorReport(report);
	assert.match(text, /result: OK/);
	assert.match(text, /Tooling/);
	assert.match(text, /Environment/);
});

test("runCliDoctor folds local runtime checks in direct mode", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "athena-doctor-"));
	const report = await runCliDoctor({
		cwd,
		validateEnv: () => envResult("direct"),
		validateLocal: async () => runtimeReport(),
	});
	assert.equal(
		report.checks.some(
			(check) => check.id === "runtime.data.connect" && check.status === "ok",
		),
		true,
	);
	assert.equal(report.ok, true);
});

test("runCLI doctor --json uses injected runner", async () => {
	const logs: string[] = [];
	await runCLI(["doctor", "--json", "--skip-runtime"], {
		log: (message) => {
			logs.push(message);
		},
		runCliDoctor: async () => ({
			checks: [
				{
					group: "tooling",
					id: "cli.sdk",
					status: "ok",
					title: `@xylex-group/athena ${PACKAGE_VERSION}`,
				},
			],
			cwd: "/tmp",
			errorCount: 0,
			ok: true,
			resolvedMode: "none",
			sdkVersion: PACKAGE_VERSION,
			title: "Athena JS · doctor",
			warnCount: 0,
		}),
	});
	const parsed = JSON.parse(logs[0] ?? "{}") as {
		ok?: boolean;
		title?: string;
	};
	assert.equal(parsed.ok, true);
	assert.equal(parsed.title, "Athena JS · doctor");
});
