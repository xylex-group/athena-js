#!/usr/bin/env node
/**
 * Unit / regression runner. Excludes the superseded local-finality baseline
 * characterization file so `pnpm test` stays the product suite.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "./ensure-dev-self-link.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SUPERSEDED = new Set(["local-verification-finality.baseline.test.ts"]);
// Plan 1 / ADR 0046–0047 contract freeze: keep RED until later PRs implement.
const RED_CONTRACT_FREEZE = new Set([
	"athena-data-lifecycle-security.target.test.ts",
	"athena-notifications-runtime-finality.target.test.ts",
	"athena-js-billing-webhook-ingress.target.test.ts",
	"athena-js-storage-billing-transport-conformance.target.test.ts",
	"athena-js-storage-billing-transport-finality.target.test.ts",
]);

function collect(dir, prefix) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "superseded") {
			continue;
		}
		if (entry.isDirectory() && entry.name === "billing-release") {
			continue;
		}
		const nextPrefix = `${prefix}/${entry.name}`;
		if (entry.isDirectory()) {
			out.push(...collect(join(dir, entry.name), nextPrefix));
			continue;
		}
		if (
			!entry.name.endsWith(".test.ts") ||
			SUPERSEDED.has(entry.name) ||
			RED_CONTRACT_FREEZE.has(entry.name)
		) {
			continue;
		}
		out.push(nextPrefix);
	}
	return out;
}

const selected = [
	...readdirSync(join(root, "test"))
		.filter((name) => name.endsWith(".test.ts"))
		.map((name) => `test/${name}`),
	...collect(join(root, "test", "auth"), "test/auth"),
	...collect(join(root, "test", "sdd"), "test/sdd"),
	...collect(join(root, "test", "conformance"), "test/conformance"),
];

// Windows libuv aborts (`UV_HANDLE_CLOSING`) when `--test-force-exit` races
// spawnSync("git") or pgsql-parser uv_async teardown. Run those files without
// force-exit so handles can finish closing.
const win32NoForceExit = new Set([
	"test/migrations-git-worktree.test.ts",
	"test/migrations-managed-auth.test.ts",
	"test/auth-schema-release-lock.test.ts",
	"test/migrations-analysis-cache.test.ts",
	"test/migrations-system-columns.test.ts",
]);
const isolated =
	process.platform === "win32"
		? selected.filter((file) => win32NoForceExit.has(file))
		: [];
const rest = selected.filter((file) => !isolated.includes(file));

// `bun run test` can execute this file through Bun's node shim, so
// `process.execPath` is bun. `bun --test` is not Node's test runner and
// reports every file as `'test failed'` with no assertion body.
function nodeExecutable() {
	if (process.versions.bun !== null) {
		return "node";
	}
	return process.execPath;
}

function runNodeTest(files, forceExit) {
	if (files.length === 0) {
		return { status: 0 };
	}
	return spawnSync(
		nodeExecutable(),
		[
			"--import",
			"./test/register-server-only.mjs",
			"--import",
			"tsx",
			...(process.platform === "win32"
				? ["--import", "./test/windows-defer-force-exit.mjs"]
				: []),
			"--test",
			...(forceExit ? ["--test-force-exit"] : []),
			...files,
		],
		{
			cwd: root,
			shell: false,
			stdio: "inherit",
		},
	);
}

const restResult = runNodeTest(rest, true);
const restStatus =
	typeof restResult.status === "number" ? restResult.status : 1;
if (restStatus !== 0) {
	process.exit(restStatus);
}
const isolatedResult = runNodeTest(isolated, false);
process.exit(
	typeof isolatedResult.status === "number" ? isolatedResult.status : 1,
);
