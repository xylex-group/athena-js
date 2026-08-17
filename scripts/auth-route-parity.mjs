/**
 * Mechanical Athena Auth route inventory.
 * Compares Rust AuthRoute tables to the JS SDK endpoint union and
 * embedded local-runtime path matches. Live source is authoritative.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "../..");

const RUST_ROOTS = [
  path.join(repoRoot, "services/athena-auth/crates/api/src"),
  path.join(repoRoot, "services/athena-auth/crates/core/src"),
];

const JS_LOCAL_ROOT = path.join(packageRoot, "src/auth/local");
const JS_TYPES = path.join(packageRoot, "src/auth/types.ts");

const NONPORTABLE = new Set([
  "GET /reference/openapi.json",
  "GET /admin/docs.html",
  "GET /admin/api-config.json",
  "GET /schema-debug",
  "GET /schema-debug.html",
]);

function walk(dir, acc = []) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return acc;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (/\.(rs|ts)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function rustRoutes() {
  const routes = new Map();
  const pattern =
    /AuthRoute::(get|post|put|delete|patch)\(\s*"([^"]+)"/g;
  const constPattern = /AuthRoute::(get|post)\(\s*([A-Z0-9_]+)/g;
  const constValues = {
    TOKEN_PATH: "/token",
    JWKS_PATH: "/.well-known/jwks.json",
    DISCOVERY_PATH: "/.well-known/openid-configuration",
    OK: "/ok",
    ERROR: "/error",
    HEALTH: "/health",
    OPENAPI_SPEC: "/reference/openapi.json",
    UPDATE_USER: "/update-user",
    DELETE_USER: "/delete-user",
    CHANGE_EMAIL: "/change-email",
    DELETE_USER_CALLBACK: "/delete-user/callback",
  };

  for (const root of RUST_ROOTS) {
    for (const file of walk(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(pattern)) {
        const key = `${match[1].toUpperCase()} ${match[2]}`;
        routes.set(key, { file: path.relative(repoRoot, file), key });
      }
      for (const match of text.matchAll(
        /\b(get|post|put|delete|patch)\s+"(\/[^"]+)"\s*=>/g
      )) {
        const key = `${match[1].toUpperCase()} ${match[2]}`;
        routes.set(key, { file: path.relative(repoRoot, file), key });
      }
      for (const match of text.matchAll(constPattern)) {
        const resolved = constValues[match[2]];
        if (resolved) {
          const key = `${match[1].toUpperCase()} ${resolved}`;
          routes.set(key, { file: path.relative(repoRoot, file), key });
        }
      }
    }
  }
  return routes;
}

function jsSdkPaths() {
  const text = readFileSync(JS_TYPES, "utf8");
  const start = text.indexOf("export type AthenaAuthEndpointPath");
  const slice = text.slice(start, text.indexOf(";", start));
  const paths = [...slice.matchAll(/"(\/[^"]+)"/g)].map((match) => match[1]);
  return new Set(paths);
}

function jsLocalRoutes() {
  const routes = new Set();
  for (const file of walk(JS_LOCAL_ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/if\s*\(([\s\S]*?)\)\s*\{/g)) {
      const cond = match[1];
      const paths = [...cond.matchAll(/path === "([^"]+)"/g)].map((item) => item[1]);
      const methods = [...cond.matchAll(/method === "([A-Z]+)"/g)].map(
        (item) => item[1]
      );
      for (const routePath of paths) {
        for (const method of methods) {
          routes.add(`${method} ${routePath}`);
        }
      }
    }
  }
  return routes;
}

function pathOnly(route) {
  return route.split(" ").slice(1).join(" ");
}

export function buildAuthRouteInventory() {
  const rust = rustRoutes();
  const local = jsLocalRoutes();
  const sdk = jsSdkPaths();
  const rustKeys = [...rust.keys()].sort();
  const missingInLocal = rustKeys.filter(
    (key) => !NONPORTABLE.has(key) && !local.has(key)
  );
  const extraLocal = [...local].filter((key) => !rust.has(key)).sort();
  const sdkMissing = rustKeys
    .map(pathOnly)
    .filter(
      (routePath) =>
        !routePath.includes("{") &&
        !sdk.has(routePath) &&
        !NONPORTABLE.has(`GET ${routePath}`) &&
        !NONPORTABLE.has(`POST ${routePath}`)
    );

  return {
    generatedAt: new Date().toISOString(),
    rustCount: rustKeys.length,
    localCount: local.size,
    sdkPathCount: sdk.size,
    rust: rustKeys,
    local: [...local].sort(),
    missingInLocal,
    extraLocal,
    sdkMissing: [...new Set(sdkMissing)].sort(),
    nonportable: [...NONPORTABLE].sort(),
  };
}

const inventory = buildAuthRouteInventory();
const outDir = path.join(packageRoot, "contracts/auth");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, "routes.generated.json"),
  `${JSON.stringify(inventory, null, 2)}\n`
);

if (process.argv.includes("--print")) {
  process.stdout.write(
    `${JSON.stringify(
      {
        rustCount: inventory.rustCount,
        localCount: inventory.localCount,
        missingInLocal: inventory.missingInLocal,
        extraLocal: inventory.extraLocal,
        sdkMissing: inventory.sdkMissing,
      },
      null,
      2
    )}\n`
  );
}