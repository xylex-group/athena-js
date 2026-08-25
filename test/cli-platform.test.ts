import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { CLI_COMMAND_REGISTRY } from "../src/cli/commands/register.ts";
import { CliExitCode, parseCommand, runCLI } from "../src/cli/index.ts";
import {
	CLI_JSON_SCHEMA_VERSION,
	encodeCliJsonFailure,
	encodeCliJsonSuccess,
	peelGlobalFlags,
} from "../src/cli/platform/index.ts";

test("registry is the executable SSOT for migrate subcommands", () => {
	const ids = CLI_COMMAND_REGISTRY.ids();
	assert.equal(ids.includes("migrate"), true);
	assert.equal(ids.includes("migrate.plan"), true);
	assert.equal(ids.includes("migrate.status"), true);
	assert.equal(ids.includes("migrate.check"), true);
	assert.equal(ids.includes("migrate.reconcile"), true);
	assert.equal(ids.includes("migrate.repair"), true);
	assert.ok(CLI_COMMAND_REGISTRY.findByPath(["migrate", "plan"]));
	assert.equal(
		CLI_COMMAND_REGISTRY.match(["migrate", "plan", "--json"])?.command.id,
		"migrate.plan",
	);
});

test("peelGlobalFlags treats --json/-j as --output json and leaves command argv", () => {
	const peeled = peelGlobalFlags([
		"migrate",
		"plan",
		"--json",
		"--config",
		"./athena.config.ts",
		"--strict",
	]);
	assert.equal(peeled.globals.output, "json");
	assert.equal(peeled.globals.strict, true);
	assert.equal(peeled.globals.configPath, "./athena.config.ts");
	assert.deepEqual(peeled.argv, ["migrate", "plan"]);

	const alias = peelGlobalFlags(["doctor", "-j"]);
	assert.equal(alias.globals.output, "json");
	assert.deepEqual(alias.argv, ["doctor"]);
});

test("peelGlobalFlags keeps -v/-q for version and -C for commands", () => {
	const version = peelGlobalFlags(["-v", "--short"]);
	assert.equal(version.globals.verbosity, "normal");
	assert.deepEqual(version.argv, ["-v", "--short"]);

	const quietVersion = peelGlobalFlags(["version", "-q"]);
	assert.equal(quietVersion.globals.verbosity, "normal");
	assert.deepEqual(quietVersion.argv, ["version", "-q"]);

	const commands = peelGlobalFlags(["-C", "--json"]);
	assert.equal(commands.globals.output, "json");
	assert.deepEqual(commands.argv, ["-C"]);

	const verbose = peelGlobalFlags(["doctor", "--verbose"]);
	assert.equal(verbose.globals.verbosity, "verbose");
	assert.deepEqual(verbose.argv, ["doctor"]);
});

test("parseCommand still returns legacy migrate objects after registry split", () => {
	assert.equal(parseCommand(["migrate", "plan"]).command, "migrate");
	assert.equal(
		parseCommand(["migrate", "plan"]).command === "migrate" &&
			parseCommand(["migrate", "plan"]).mode,
		"plan",
	);
	assert.equal(
		parseCommand(["migrate", "plan", "--json"]).command === "migrate" &&
			parseCommand(["migrate", "plan", "--json"]).json,
		true,
	);
});

test("JSON protocol encodes schemaVersion 1 success and failure envelopes", () => {
	assert.deepEqual(encodeCliJsonSuccess("migrate.plan", { pending: 2 }), {
		schemaVersion: CLI_JSON_SCHEMA_VERSION,
		command: "migrate.plan",
		ok: true,
		data: { pending: 2 },
	});
	assert.deepEqual(
		encodeCliJsonFailure("migrate.apply", {
			code: "ATHENA_MIGRATION_CHECKSUM_MISMATCH",
			message: "checksum mismatch",
			hint: "athena-js migrate reconcile",
		}),
		{
			schemaVersion: CLI_JSON_SCHEMA_VERSION,
			command: "migrate.apply",
			ok: false,
			error: {
				code: "ATHENA_MIGRATION_CHECKSUM_MISMATCH",
				message: "checksum mismatch",
				hint: "athena-js migrate reconcile",
			},
		},
	);
});

test("runCLI unknown command uses usage exit code 2 and JSON envelope for --json", async () => {
	const previous = process.exitCode;
	process.exitCode = undefined;
	const errors: string[] = [];
	try {
		await runCLI(["generat"], {
			errorLog: (message) => {
				errors.push(message);
			},
			log: () => undefined,
		});
		assert.equal(process.exitCode, CliExitCode.Usage);
		assert.equal(
			errors.some((line) => line.includes('Unknown command "generat"')),
			true,
		);
	} finally {
		process.exitCode = previous;
	}

	process.exitCode = undefined;
	const logs: string[] = [];
	try {
		await runCLI(["generat", "--json"], {
			log: (message) => {
				logs.push(message);
			},
			errorLog: () => undefined,
		});
		assert.equal(process.exitCode, CliExitCode.Usage);
		const envelope = JSON.parse(logs[0] ?? "{}") as {
			schemaVersion?: number;
			ok?: boolean;
			error?: { code?: string };
		};
		assert.equal(envelope.schemaVersion, 1);
		assert.equal(envelope.ok, false);
		assert.equal(envelope.error?.code, "CLI002");
	} finally {
		process.exitCode = previous;
	}
});
