/**
 * ATHENA_BROWSER_BUNDLE_PG_LEAK — regression suite.
 *
 * Production regression (4.3.1): the browser bundle of `@xylex-group/athena`
 * statically reached `postgres/transport.ts` → `postgres/driver.ts` →
 * `import("pg")`, so Next.js/Turbopack tried to resolve Node built-ins:
 *
 *   Module not found: Can't resolve 'dns'
 *   ./node_modules/pg/lib/connection-parameters.js
 *
 * Invariant: browser `createClient` must not bundle PostgreSQL direct
 * transport or Node built-ins. These tests enforce that at three layers:
 *
 *   1. Source graph: every module statically reachable from the browser
 *      entries is walked; any import of `pg`, Node built-ins, `node:*`,
 *      `server-only`, or any `src/postgres/*` module fails the suite.
 *   2. Runtime: the browser entry throws `ATHENA_POSTGRES_DIRECT_NODE_REQUIRED`
 *      on `db.pgUri` and never leaks the URI into error output.
 *   3. Bundler fixture: esbuild (platform: "browser") bundles a minimal
 *      consumer and a "use client" component; the metafile must contain no
 *      `pg` / `src/postgres` inputs and the output no Node built-in imports.
 */

import { strict as assert } from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

import {
  AthenaConfigurationError,
  createClient,
} from "../src/browser.ts";

const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const FIXTURE_DIR = fileURLToPath(
  new URL("./fixtures/browser-create-client/", import.meta.url)
);

/** Bare specifiers that must never appear in a browser-reachable module. */
const FORBIDDEN_BARE_SPECIFIERS = new Set([
  "pg",
  "@noble/hashes/argon2.js",
  "@noble/hashes",
  "dns",
  "net",
  "tls",
  "fs",
  "fs/promises",
  "path",
  "os",
  "child_process",
  "module",
  "worker_threads",
  "server-only",
]);

/** Browser-targeted package entries whose full import graph must stay clean. */
const BROWSER_ENTRIES = [
  "browser.ts",
  "next/client.ts",
  "react-native/index.ts",
] as const;

/** Node-only wrapper that must never be browser-reachable. */
const NODE_ONLY_CLIENT_MODULE = "v3-client.ts";

/**
 * Reviewed exceptions: guarded cross-runtime fallbacks that prefer Web platform
 * globals and only touch Node built-ins when the global is missing (Node < 19).
 * Each entry must remain dynamic + guarded; static imports are still forbidden.
 */
const GUARDED_FALLBACK_ALLOWLIST: ReadonlyArray<{
  fileSuffix: string;
  specifier: string;
  guardFragment: string;
}> = [
  {
    fileSuffix: "/src/cookies/crypto.ts",
    specifier: "node:crypto",
    guardFragment: "globalCrypto?.subtle",
  },
];

const IMPORT_FROM_RE =
  /^[ \t]*import[ \t]+(type[ \t]+)?[^;]*?[ \t]from[ \t]*["']([^"']+)["']/gms;
const IMPORT_SIDE_EFFECT_RE = /^[ \t]*import[ \t]*["']([^"']+)["']/gm;
const EXPORT_FROM_RE =
  /^[ \t]*export[ \t]+(type[ \t]+)?(?:\*|[^{]*\{[^;]*\})[ \t]*(?:from[ \t]*["']([^"']+)["'])?/gm;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE_RE = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

interface SourceImport {
  specifier: string;
  typeOnly: boolean;
  dynamic: boolean;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

function collectImports(source: string): SourceImport[] {
  const imports: SourceImport[] = [];
  const cleaned = stripComments(source);

  for (const match of cleaned.matchAll(IMPORT_FROM_RE)) {
    imports.push({
      specifier: match[2],
      typeOnly: Boolean(match[1]),
      dynamic: false,
    });
  }
  for (const match of cleaned.matchAll(IMPORT_SIDE_EFFECT_RE)) {
    imports.push({ specifier: match[1], typeOnly: false, dynamic: false });
  }
  for (const match of cleaned.matchAll(EXPORT_FROM_RE)) {
    if (match[2]) {
      imports.push({
        specifier: match[2],
        typeOnly: Boolean(match[1]),
        dynamic: false,
      });
    }
  }
  for (const match of cleaned.matchAll(DYNAMIC_IMPORT_RE)) {
    imports.push({ specifier: match[1], typeOnly: false, dynamic: true });
  }
  for (const match of cleaned.matchAll(REQUIRE_RE)) {
    imports.push({ specifier: match[1], typeOnly: false, dynamic: false });
  }
  return imports;
}

function isForbiddenBareSpecifier(specifier: string): boolean {
  return (
    FORBIDDEN_BARE_SPECIFIERS.has(specifier) || specifier.startsWith("node:")
  );
}

function resolveRelativeImport(
  fromFile: string,
  specifier: string
): string | undefined {
  const baseUrl = pathToFileURL(`${dirname(fromFile)}/`);
  const resolved = fileURLToPath(new URL(specifier, baseUrl));
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
  return undefined;
}

interface GraphViolation {
  file: string;
  specifier: string;
  reason: string;
}

async function walkImportGraph(entryRelativePaths: readonly string[]): Promise<{
  visited: Set<string>;
  violations: GraphViolation[];
}> {
  const visited = new Set<string>();
  const violations: GraphViolation[] = [];
  const queue = entryRelativePaths.map((entry) =>
    fileURLToPath(new URL(`../src/${entry}`, import.meta.url))
  );

  while (queue.length > 0) {
    const file = queue.pop() as string;
    const normalized = file.replaceAll("\\", "/");
    if (visited.has(normalized)) {
      continue;
    }
    visited.add(normalized);

    const source = await readFile(file, "utf8");
    for (const sourceImport of collectImports(source)) {
      const { specifier } = sourceImport;
      if (specifier.startsWith(".")) {
        if (sourceImport.typeOnly) {
          continue;
        }
        const resolved = resolveRelativeImport(normalized, specifier);
        if (resolved) {
          queue.push(resolved);
        }
        continue;
      }
      if (isForbiddenBareSpecifier(specifier)) {
        const exception = GUARDED_FALLBACK_ALLOWLIST.find(
          (entry) =>
            normalized.endsWith(entry.fileSuffix) &&
            entry.specifier === specifier
        );
        if (exception) {
          // The exception is only valid while it stays dynamic and guarded
          // behind the Web-platform global (never reached in browsers).
          if (!sourceImport.dynamic) {
            violations.push({
              file: normalized,
              specifier,
              reason: "allowlisted fallback must remain a dynamic import",
            });
          } else if (!source.includes(exception.guardFragment)) {
            violations.push({
              file: normalized,
              specifier,
              reason: `allowlisted fallback lost its Web-global guard (${exception.guardFragment})`,
            });
          }
          continue;
        }
        violations.push({
          file: normalized,
          specifier,
          reason: sourceImport.typeOnly
            ? "type-only import of a forbidden specifier (keeps pg types out of the browser graph)"
            : sourceImport.dynamic
              ? "dynamic import of a Node-only specifier"
              : "static import of a Node-only specifier",
        });
      }
    }
  }

  return { visited, violations };
}

test("ATHENA_BROWSER_BUNDLE_PG_LEAK: browser source graph has zero pg / Node built-in imports", async () => {
  const { visited, violations } = await walkImportGraph(BROWSER_ENTRIES);

  assert.deepEqual(
    violations,
    [],
    `browser-reachable modules import Node-only specifiers:\n${violations
      .map((v) => `  ${v.file} -> "${v.specifier}" (${v.reason})`)
      .join("\n")}`
  );

  const postgresModules = [...visited].filter((file) =>
    file.includes("/src/postgres/")
  );
  assert.deepEqual(
    postgresModules,
    [],
    `browser dependency graph must not contain src/postgres/* modules:\n${postgresModules
      .map((f) => `  ${f}`)
      .join("\n")}`
  );

  const nodeWrapper = [...visited].filter((file) =>
    file.endsWith(`/src/${NODE_ONLY_CLIENT_MODULE}`)
  );
  assert.deepEqual(
    nodeWrapper,
    [],
    `browser entries must not reach the Node-only ${NODE_ONLY_CLIENT_MODULE} wrapper`
  );

  const localAuthModules = [...visited].filter(
    (file) =>
      file.includes("/src/auth/local/") ||
      file.endsWith("/src/auth/server-entry.ts")
  );
  assert.deepEqual(
    localAuthModules,
    [],
    `browser dependency graph must not contain the local auth runtime:\n${localAuthModules
      .map((file) => `  ${file}`)
      .join("\n")}`
  );

  // Sanity: the walk must actually cover the client core, otherwise the
  // assertions above are vacuous.
  assert.ok(
    [...visited].some((file) => file.endsWith("/src/v3-client-core.ts")),
    "source walk must reach v3-client-core.ts (sanity check)"
  );
  assert.ok(visited.size > 50, "source walk suspiciously small");
});

test("ATHENA_BROWSER_BUNDLE_PG_LEAK: browser createClient works for HTTP gateway config", () => {
  const client = createClient({
    url: "https://athena.example.com",
    key: "public-key",
  });
  assert.equal(typeof client, "object");
  assert.ok(client !== null);
});

test("ATHENA_BROWSER_BUNDLE_PG_LEAK: browser db.pgUri fails fast with server-only diagnostic", () => {
  const secretUri = "postgres://s3cret-user:hunter2@db.internal:5432/prod";

  let thrown: Error | undefined;
  try {
    createClient({
      db: { pgUri: secretUri },
    });
  } catch (error) {
    thrown = error as Error;
  }

  assert.ok(thrown instanceof AthenaConfigurationError);
  assert.equal(thrown.code, "ATHENA_POSTGRES_DIRECT_NODE_REQUIRED");
  assert.equal(thrown.service, "db");

  // The error must never leak the URI (secret) into output.
  assert.ok(!thrown.message.includes(secretUri));
  assert.ok(!thrown.message.includes("s3cret-user"));
  assert.ok(!thrown.message.includes("hunter2"));
  assert.ok(!thrown.message.includes("db.internal"));
  assert.ok(!thrown.message.includes("postgres://"));
  assert.match(thrown.message, /not available in browser runtimes/);
  assert.match(thrown.message, /Node\.js\/server runtime/);
});

test("ATHENA_BROWSER_BUNDLE_PG_LEAK: browser auth.mode local fails closed", () => {
  let thrown: Error | undefined;
  try {
    createClient({
      url: "https://athena.example.com",
      key: "public-key",
      auth: { mode: "local" },
    });
  } catch (error) {
    thrown = error as Error;
  }

  assert.ok(thrown instanceof AthenaConfigurationError);
  assert.equal(thrown.code, "ATHENA_AUTH_LOCAL_NODE_REQUIRED");
  assert.equal(thrown.service, "auth");
  assert.ok(!thrown.message.includes("DATABASE_URL"));
  assert.match(thrown.message, /Node\.js server runtime/);
});

test("ATHENA_BROWSER_BUNDLE_PG_LEAK: empty pgUri values do not trip the browser guard", () => {
  for (const pgUri of ["", "   ", null, undefined]) {
    const client = createClient({
      url: "https://athena.example.com",
      key: "public-key",
      db: { pgUri },
    });
    assert.ok(client);
  }
});

test("ATHENA_BROWSER_BUNDLE_PG_LEAK: browser fixture bundles cleanly with a real bundler", async () => {
  const athenaBrowserConditionPlugin: esbuild.Plugin = {
    name: "athena-browser-condition",
    setup(build) {
      // Mirror the package.json "." -> browser -> src/browser.ts condition
      // against sources so the test does not depend on a prior dist build.
      build.onResolve({ filter: /^@xylex-group\/athena$/ }, () => ({
        path: `${SRC_DIR}browser.ts`,
      }));
    },
  };

  const result = await esbuild.build({
    entryPoints: [
      `${FIXTURE_DIR}src/index.ts`,
      `${FIXTURE_DIR}src/client-component.tsx`,
    ],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    outdir: "out",
    metafile: true,
    conditions: ["browser"],
    plugins: [athenaBrowserConditionPlugin],
    external: [
      // Guarded WebCrypto fallback (GUARDED_FALLBACK_ALLOWLIST): Turbopack
      // tolerates the dynamic `import("crypto")` in dist/browser.js; only the
      // Node < 19 webcrypto fallback path ever executes it.
      "crypto",
      "node:crypto",
      "react",
      "react/*",
      "react-dom",
      "react-dom/*",
      "@react-email/components",
      "@react-email/render",
    ],
    logLevel: "silent",
  });

  const inputs = Object.keys(result.metafile.inputs).map((input) =>
    input.replaceAll("\\", "/")
  );

  const pgInputs = inputs.filter(
    (input) =>
      input.includes("node_modules/pg") ||
      input.includes("node_modules/.pnpm/pg@")
  );
  assert.deepEqual(
    pgInputs,
    [],
    `browser bundle metafile must not include pg modules:\n${pgInputs.join("\n")}`
  );

  const postgresSourceInputs = inputs.filter((input) =>
    input.includes("/src/postgres/")
  );
  assert.deepEqual(
    postgresSourceInputs,
    [],
    `browser bundle metafile must not include src/postgres/* sources:\n${postgresSourceInputs.join("\n")}`
  );

  const nodeWrapperInputs = inputs.filter((input) =>
    input.endsWith("/v3-client.ts")
  );
  assert.deepEqual(
    nodeWrapperInputs,
    [],
    "browser bundle must not include the Node-only v3-client.ts wrapper"
  );

  const outputText = result.outputFiles
    .map((file) => file.text)
    .join("\n");
  const forbiddenOutputPatterns: ReadonlyArray<readonly [string, RegExp]> = [
    ["dynamic import('pg')", /import\(\s*["']pg["']\s*\)/],
    ["static from \"pg\"", /from\s+["']pg["']/],
    ["require(\"pg\")", /require\(\s*["']pg["']\s*\)/],
    ["require(\"dns\")", /require\(\s*["']dns["']\s*\)/],
    ["require(\"net\")", /require\(\s*["']net["']\s*\)/],
    ["require(\"tls\")", /require\(\s*["']tls["']\s*\)/],
    ["require(\"fs\")", /require\(\s*["']fs["']\s*\)/],
    ["require(\"child_process\")", /require\(\s*["']child_process["']\s*\)/],
    ["node: specifier", /["']node:(?:dns|net|tls|fs|child_process)["']/],
  ];
  for (const [label, pattern] of forbiddenOutputPatterns) {
    assert.ok(
      !pattern.test(outputText),
      `bundled browser output contains forbidden pattern: ${label}`
    );
  }
});

test("ATHENA_BROWSER_BUNDLE_PG_LEAK: built dist/browser.* artifacts stay clean (when built)", async () => {
  const artifacts = ["dist/browser.js", "dist/browser.cjs"] as const;
  const present = artifacts.filter((artifact) =>
    existsSync(`${PACKAGE_ROOT}${artifact}`)
  );
  if (present.length === 0) {
    // The dist-level hard gate is scripts/audit-browser-bundle-safety.mjs,
    // which fails when artifacts are missing. Skip only for test-only runs.
    return;
  }

  const forbiddenDistPatterns: ReadonlyArray<readonly [string, RegExp]> = [
    ["pg static import", /from\s+["']pg["']|require\(["']pg["']\)/],
    ["pg dynamic import", /import\(["']pg["']\)/],
    ["dns", /from\s+["']dns["']|require\(["']dns["']\)|["']node:dns["']/],
    ["net", /from\s+["']net["']|require\(["']net["']\)|["']node:net["']/],
    ["tls", /from\s+["']tls["']|require\(["']tls["']\)|["']node:tls["']/],
    ["fs", /from\s+["']fs["']|require\(["']fs["']\)|["']node:fs["']/],
    [
      "child_process",
      /from\s+["']child_process["']|require\(["']child_process["']\)|["']node:child_process["']/,
    ],
  ];

  for (const artifact of present) {
    const content = await readFile(`${PACKAGE_ROOT}${artifact}`, "utf8");
    for (const [label, pattern] of forbiddenDistPatterns) {
      assert.ok(
        !pattern.test(content),
        `${artifact} contains forbidden pattern: ${label}`
      );
    }
  }
});
