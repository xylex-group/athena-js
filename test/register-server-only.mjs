import { createRequire, register } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testHomeRoot = process.env.ATHENA_TEST_HOME_ROOT;
if (testHomeRoot) {
	const testHome = mkdtempSync(join(testHomeRoot, `worker-${process.pid}-`));
	process.env.ATHENA_HOME = testHome;
	if (resolve(testHome) === resolve(homedir(), ".athena")) {
		throw new Error("Athena JS tests must use an isolated ATHENA_HOME.");
	}
	process.once("exit", () =>
		rmSync(testHome, { force: true, recursive: true, maxRetries: 10 }),
	);
}

const loaderPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "server-only-loader.mjs"
);
register(pathToFileURL(loaderPath).href);

// Packed dist/*.cjs uses require("server-only"); ESM resolve hooks miss that.
const Module = createRequire(import.meta.url)("node:module");
const originalLoad = Module._load;
Module._load = function patchedServerOnly(request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};
