import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const loaderPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "server-only-loader.mjs"
);
register(pathToFileURL(loaderPath).href);
