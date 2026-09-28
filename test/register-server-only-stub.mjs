import { createRequire, register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const loaderPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "stub-server-only-loader.mjs"
);
register(pathToFileURL(loaderPath).href);

const Module = createRequire(import.meta.url)("node:module");
const originalLoad = Module._load;
Module._load = function patchedServerOnly(request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};
