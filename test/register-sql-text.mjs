import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

register(
  pathToFileURL(
    join(dirname(fileURLToPath(import.meta.url)), "sql-text-loader.mjs")
  ).href
);
