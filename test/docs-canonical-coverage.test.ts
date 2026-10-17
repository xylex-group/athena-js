import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractDocsApi } from "../scripts/docs/extract-api.mts";
import { readPackageJson } from "../scripts/docs/extract-exports.mts";
import { validateDocsApi } from "../scripts/docs/validate-api.mts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("canonical Docs API coverage has at least forty fully exampled symbols", () => {
	const pkg = readPackageJson(packageRoot);
	const report = validateDocsApi(extractDocsApi(packageRoot), {
		packageRoot,
		exports: pkg.exports,
	});
	assert.ok(report.canonical >= 40, `expected at least 40 canonical APIs, got ${report.canonical}`);
	assert.equal(report.canonicalWithExamples, report.canonical);
	const posture = extractDocsApi(packageRoot).entrypoints.flatMap((entry) => entry.symbols).find((symbol) => symbol.name === "athena.auth.organization.authenticationPosture.list");
	assert.ok(posture?.tags.canonical);
	assert.deepEqual(posture.semantic?.authorization?.requiredRights, ["organization.authentication.read"]);
	assert.deepEqual(posture.semantic?.capabilities, ["organizations"]);
});
