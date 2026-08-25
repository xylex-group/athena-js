import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
	type CliRuntime,
	parseCommand,
	runCLI,
	usage,
} from "../src/cli/index.ts";
import type { MigrationRunSummary } from "../src/migrations/types.ts";
import { MigrationError } from "../src/migrations/types.ts";

test("root help mentions migrate", () => {
	const text = usage("root");
	assert.equal(text.includes("athena-js migrate"), true);
	assert.equal(text.includes("migrate status"), true);
});

test("migrate help documents dry-run and direct postgres", () => {
	const text = usage("migrate");
	assert.equal(text.includes("athena-js migrate"), true);
	assert.equal(text.includes("--dry-run"), true);
	assert.equal(text.includes("provider.mode=direct"), true);
	assert.equal(text.includes("advisory lock"), true);
	assert.equal(text.includes("migrate check"), true);
	assert.equal(text.includes("physical"), true);
	assert.equal(text.includes("--allow-dirty-migrations"), true);
	assert.equal(text.includes("migrate reconcile"), true);
	assert.equal(text.includes("--apply"), true);
});

test("migrate status help is available", () => {
	const text = usage("migrate-status");
	assert.equal(text.includes("migrate status"), true);
	assert.equal(text.includes("Does not apply migrations"), true);
});

test("parseCommand supports migrate modes", () => {
	const base = {
		command: "migrate" as const,
		configPath: undefined,
		dryRun: false,
		explainTarget: undefined,
		json: false,
		plain: false,
		strict: false,
		allowDirty: false,
		applyReconcile: false,
		yes: false,
	};
	assert.deepEqual(parseCommand(["migrate"]), {
		...base,
		mode: "apply",
	});
	assert.deepEqual(parseCommand(["migrate", "status"]), {
		...base,
		mode: "status",
	});
	assert.deepEqual(parseCommand(["migrate", "--dry-run"]), {
		...base,
		dryRun: true,
		mode: "dry-run",
	});
	assert.deepEqual(
		parseCommand(["migrate", "plan", "--config", "./athena.config.ts"]),
		{
			...base,
			configPath: "./athena.config.ts",
			mode: "plan",
		},
	);
	assert.deepEqual(parseCommand(["migrate", "check", "--strict"]), {
		...base,
		mode: "check",
		strict: true,
	});
	assert.deepEqual(parseCommand(["migrate", "explain", "0007"]), {
		...base,
		explainTarget: "0007",
		mode: "explain",
	});
	assert.deepEqual(parseCommand(["migrate", "explain"]), {
		command: "help",
		topic: "migrate",
	});
	assert.deepEqual(parseCommand(["migrate", "--allow-dirty-migrations"]), {
		...base,
		allowDirty: true,
		mode: "apply",
	});
	assert.deepEqual(parseCommand(["migrate", "--help"]), {
		command: "help",
		topic: "migrate",
	});
	assert.deepEqual(parseCommand(["help", "migrate"]), {
		command: "help",
		topic: "migrate",
	});
	assert.deepEqual(parseCommand(["migrate", "status", "--help"]), {
		command: "help",
		topic: "migrate-status",
	});
});

test("parseCommand rejects unknown migrate options", () => {
	assert.throws(
		() => parseCommand(["migrate", "--force"]),
		/Unknown option "--force"/,
	);
});

test("runCLI migrate delegates and sets exit code on MigrationError", async () => {
	const logs: string[] = [];
	const errors: string[] = [];
	let sawOptions: unknown;

	const runtime: CliRuntime = {
		log: (message) => {
			logs.push(message);
		},
		errorLog: (message) => {
			errors.push(message);
		},
		runMigrations: async (options) => {
			sawOptions = options;
			throw new MigrationError(
				"PROVIDER",
				"athena-js migrate currently requires a direct PostgreSQL provider.",
			);
		},
	};

	const previous = process.exitCode;
	process.exitCode = undefined;
	try {
		await runCLI(
			["migrate", "--dry-run", "--config", "./athena.config.ts"],
			runtime,
		);
		assert.equal(process.exitCode, 3);
		assert.equal(
			(sawOptions as { configPath?: string }).configPath,
			"./athena.config.ts",
		);
		assert.equal((sawOptions as { dryRun?: boolean }).dryRun, true);
		assert.equal((sawOptions as { mode?: string }).mode, "dry-run");
		assert.equal(typeof (sawOptions as { log?: unknown }).log, "function");
		assert.equal(
			errors.some((line) => line.includes("direct PostgreSQL provider")),
			true,
		);
	} finally {
		process.exitCode = previous;
	}
});

test("runCLI migrate success path does not set failure exit code", async () => {
	const summary: MigrationRunSummary = {
		appliedCount: 0,
		conflicts: [],
		databaseLabel: "app",
		directory: "athena/migrations",
		dryRun: true,
		failedCount: 0,
		mode: "dry-run",
		newlyApplied: [],
		pendingCount: 0,
		plan: { applied: [], conflicts: [], pending: [] },
		providerLabel: "postgres/direct",
		skippedCount: 0,
	};

	const previous = process.exitCode;
	process.exitCode = undefined;
	try {
		await runCLI(["migrate", "--dry-run"], {
			runMigrations: async () => summary,
			log: () => undefined,
			errorLog: () => undefined,
		});
		assert.equal(
			process.exitCode === undefined || process.exitCode === 0,
			true,
		);
	} finally {
		process.exitCode = previous;
	}
});
