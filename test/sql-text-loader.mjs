/**
 * Node ESM loader: `import x from "./file.sql"` → default string export.
 */
import { readFileSync } from "node:fs";

export async function load(url, context, nextLoad) {
  const pathname = url.split("?")[0] ?? url;
  if (pathname.endsWith(".sql")) {
    const source = readFileSync(new URL(url), "utf8");
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(source)};`,
    };
  }
  return nextLoad(url, context);
}
