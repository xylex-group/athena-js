import assert from "node:assert/strict";
import test from "node:test";

import {
	EXPORTS_FIXTURE,
	resolvePublishedExports,
	tryParseTsupSourceHints,
	unknownRuntimeClassification,
} from "../scripts/docs/extract-exports-core.mts";
import { classifyAthenaJsRuntime } from "../scripts/docs/runtime-classification.mts";

test("athena-js runtime table is explicit for published keys", () => {
	const cases: Array<[string, string[]]> = [
		[".", ["node", "browser"]],
		["./browser", ["browser"]],
		["./react", ["browser"]],
		["./next/client", ["browser"]],
		["./next/server", ["node"]],
		["./cloudflare", ["workerd"]],
		["./cloudflare/d1/statement-classifier", ["workerd"]],
		["./config", ["node"]],
		["./local", ["node"]],
		["./react-native", ["react-native"]],
		["./policy", ["node", "browser", "workerd"]],
		["./capabilities", ["node", "browser", "workerd"]],
		["./rights", ["node", "browser", "workerd"]],
	];
	for (const [exportKey, expected] of cases) {
		const classified = classifyAthenaJsRuntime(exportKey);
		assert.equal(classified.runtimeClassification, "explicit");
		for (const id of expected) {
			if (id === "react-native") {
				assert.equal(classified.runtime.reactNative, "supported");
			} else {
				assert.equal(classified.runtime[id as "node" | "browser" | "workerd"], "supported");
			}
		}
		if (!expected.includes("node")) {
			assert.notEqual(classified.runtime.node, "supported");
		}
	}
});

test("unknown published export is never Node-only", () => {
	const classified = classifyAthenaJsRuntime("./not-a-real-export");
	assert.equal(classified.runtimeClassification, "unknown");
	assert.equal(classified.runtime.node, "unknown");
	assert.equal(classified.runtime.browser, "unknown");
	assert.notEqual(classified.runtime.node, "supported");
});

test("generic export resolution keeps API membership when tsup hints fail", () => {
	const resolved = resolvePublishedExports({
		packageRoot: process.cwd(),
		packageName: "@fixture/docs-api",
		exports: EXPORTS_FIXTURE,
		classifyRuntime: (exportKey) =>
			exportKey === "./foo"
				? unknownRuntimeClassification()
				: classifyAthenaJsRuntime(exportKey === "./server" ? "./server" : exportKey),
		classifyFramework: () => [],
		tsupHints: {},
	});
	const keys = resolved.map((item) => item.exportKey);
	assert.deepEqual(
		keys.sort(),
		[".", "./browser", "./foo", "./server", "./styles.css"].sort(),
	);
	assert.equal(resolved.find((item) => item.exportKey === "./styles.css")?.kind, "css");
	const foo = resolved.find((item) => item.exportKey === "./foo");
	assert.equal(foo?.runtimeClassification, "unknown");
	assert.equal(foo?.runtime.node, "unknown");
	assert.equal(keys.includes("./package.json"), false);
});

test("tryParseTsupSourceHints is optional and cannot drop exports", () => {
	const matching = tryParseTsupSourceHints(`
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "next/client": "src/next/client.ts",
  },
});
`);
	assert.equal(matching.index, "src/index.ts");
	assert.equal(matching["next/client"], "src/next/client.ts");

	const custom = tryParseTsupSourceHints(`
const entry = { index: "src/index.ts" };
export default defineConfig({ bundler: true });
`);
	assert.deepEqual(custom, {});

	const resolved = resolvePublishedExports({
		packageRoot: process.cwd(),
		packageName: "@fixture/docs-api",
		exports: EXPORTS_FIXTURE,
		classifyRuntime: () => unknownRuntimeClassification(),
		classifyFramework: () => [],
		tsupHints: custom,
	});
	assert.ok(resolved.some((item) => item.exportKey === "."));
	assert.ok(resolved.some((item) => item.exportKey === "./foo"));
});
