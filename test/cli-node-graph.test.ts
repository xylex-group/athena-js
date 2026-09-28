/**
 * CLI import graph must stay pure Node. A raw Node process is not Next's
 * `react-server` condition, so `import "server-only"` throws immediately.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(pkgRoot, "src");
const cliEntry = join(srcRoot, "cli", "index.ts");

const IMPORT_FROM_RE =
  /^[ \t]*import[ \t]+(type[ \t]+)?[^;]*?[ \t]from[ \t]*["']([^"']+)["']/gms;
const IMPORT_SIDE_EFFECT_RE = /^[ \t]*import[ \t]*["']([^"']+)["']/gm;
const EXPORT_FROM_RE =
  /^[ \t]*export[ \t]+(type[ \t]+)?(?:\*|[^{]*\{[^;]*\})[ \t]*(?:from[ \t]*["']([^"']+)["'])?/gm;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

const FORBIDDEN_PATH_FRAGMENTS = [
  "/src/server.ts",
  "/src/next/",
  "/src/auth/server-entry.ts",
  "/src/email-node/",
  "/src/runtime/authority/resolve.ts",
  "/src/auth/social/server/social-config.ts",
] as const;

function posix(path: string): string {
  return path.replaceAll("\\", "/");
}

function resolveRelativeImport(
  fromFile: string,
  specifier: string
): string | undefined {
  const resolved = fileURLToPath(
    new URL(specifier, pathToFileURL(`${dirname(fromFile)}/`))
  );
  const candidates: string[] = [];
  if (specifier.endsWith(".ts")) {
    candidates.push(resolved);
  } else if (specifier.endsWith(".js")) {
    candidates.push(`${resolved.slice(0, -".js".length)}.ts`, resolved);
  } else {
    candidates.push(`${resolved}.ts`, join(resolved, "index.ts"));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
}

function collectValueSpecifiers(source: string): string[] {
  const cleaned = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  const specifiers: string[] = [];
  for (const match of cleaned.matchAll(IMPORT_FROM_RE)) {
    if (!match[1] && match[2]) {
      specifiers.push(match[2]);
    }
  }
  for (const match of cleaned.matchAll(IMPORT_SIDE_EFFECT_RE)) {
    if (match[1]) {
      specifiers.push(match[1]);
    }
  }
  for (const match of cleaned.matchAll(EXPORT_FROM_RE)) {
    if (!match[1] && match[2]) {
      specifiers.push(match[2]);
    }
  }
  for (const match of cleaned.matchAll(DYNAMIC_IMPORT_RE)) {
    if (match[1]) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

test("CLI source graph never reaches server-only or framework server entries", () => {
  const visited = new Set<string>();
  const queue = [cliEntry];
  const hits: string[] = [];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    const normalized = posix(file);
    if (visited.has(normalized)) {
      continue;
    }
    visited.add(normalized);
    const source = readFileSync(file, "utf8");
    if (/^[ \t]*import[ \t]+["']server-only["']/m.test(source)) {
      hits.push(`${relative(srcRoot, file)} imports server-only`);
    }
    for (const specifier of collectValueSpecifiers(source)) {
      if (specifier === "server-only") {
        hits.push(`${relative(srcRoot, file)} -> "server-only"`);
        continue;
      }
      if (!specifier.startsWith(".")) {
        continue;
      }
      const resolved = resolveRelativeImport(normalized, specifier);
      if (resolved) {
        queue.push(resolved);
      }
    }
  }

  assert.ok(visited.size > 1, "expected a CLI value-import graph");
  for (const visitedFile of visited) {
    for (const fragment of FORBIDDEN_PATH_FRAGMENTS) {
      if (visitedFile.endsWith(fragment) || visitedFile.includes(fragment)) {
        hits.push(
          `CLI reachable: ${visitedFile.slice(visitedFile.indexOf("/src/"))}`
        );
      }
    }
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("CLI esbuild metafile rejects server-only and framework server entries", async () => {
  const result = await esbuild.build({
    absWorkingDir: pkgRoot,
    bundle: true,
    entryPoints: [cliEntry],
    format: "esm",
    loader: { ".sql": "text" },
    logLevel: "silent",
    metafile: true,
    outfile: "cli-graph-probe.js",
    packages: "external",
    platform: "node",
    write: false,
  });
  const output = result.outputFiles?.map((file) => file.text).join("\n") ?? "";
  assert.doesNotMatch(
    output,
    /\bimport\s*["']server-only["']|\bfrom\s*["']server-only["']|\brequire\(\s*["']server-only["']\s*\)/
  );

  const inputs = Object.keys(result.metafile?.inputs ?? {}).map(posix);
  const forbidden = inputs.filter((input) => {
    const lowered = input.toLowerCase();
    return (
      lowered.includes("node_modules/server-only") ||
      input.endsWith("/src/server.ts") ||
      input.includes("/src/next/") ||
      input.endsWith("/src/auth/server-entry.ts") ||
      input.includes("/src/email-node/") ||
      input.endsWith("/src/runtime/authority/resolve.ts") ||
      input.endsWith("/src/auth/social/server/social-config.ts")
    );
  });
  assert.deepEqual(forbidden, [], forbidden.join("\n"));
});
