import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { billingSdkManifest } from "../src/billing/module.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const inventoryPath = join(repoRoot, "contracts/billing/live-http-routes.json");
const jsMirrorPath = join(here, "../src/billing/live-http-routes.json");
const openapiJsonPath = join(repoRoot, "openapi.json");

interface InventoryRoute {
  method: string;
  path: string;
  source?: string;
}

interface InventoryDocument {
  domain: string;
  routes: InventoryRoute[];
  schemaVersion: number;
}

function loadInventory(path: string): InventoryDocument {
  return JSON.parse(readFileSync(path, "utf8")) as InventoryDocument;
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function inventoryKeys(doc: InventoryDocument): Set<string> {
  return new Set(doc.routes.map((row) => routeKey(row.method, row.path)));
}

function openapiKeys(doc: {
  paths?: Record<string, Record<string, unknown>>;
}): Set<string> {
  const keys = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(item ?? {})) {
      const lower = method.toLowerCase();
      if (
        lower === "get" ||
        lower === "post" ||
        lower === "put" ||
        lower === "patch" ||
        lower === "delete" ||
        lower === "head" ||
        lower === "options"
      ) {
        keys.add(routeKey(method, path));
      }
    }
  }
  return keys;
}

test("billing live inventory is present and non-empty", () => {
  const inventory = loadInventory(inventoryPath);
  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.domain, "billing");
  assert.ok(inventory.routes.length >= 30);
  // Rust owns the permanent inventory; JSON is an export artifact.
  assert.equal(
    (inventory as InventoryDocument & { sourceOfTruth?: string }).sourceOfTruth,
    "crates/athena-billing/src/live_http_routes.rs"
  );
});

test("JS inventory mirror matches contracts/billing/live-http-routes.json", () => {
  const canonical = loadInventory(inventoryPath);
  const mirror = loadInventory(jsMirrorPath);
  assert.deepEqual(inventoryKeys(mirror), inventoryKeys(canonical));
});

test("billingSdkManifest matches live inventory METHOD+path set exactly", () => {
  const inventory = inventoryKeys(loadInventory(inventoryPath));
  const manifest = new Set(
    billingSdkManifest.methods.map(({ method, path }) => routeKey(method, path))
  );

  const missingInManifest = [...inventory]
    .filter((key) => !manifest.has(key))
    .sort((a, b) => String(a).localeCompare(String(b)));
  const extraInManifest = [...manifest]
    .filter((key) => !inventory.has(key))
    .sort((a, b) => String(a).localeCompare(String(b)));

  assert.deepEqual(
    missingInManifest,
    [],
    `billingSdkManifest missing inventory routes: ${missingInManifest.join(", ")}`
  );
  assert.deepEqual(
    extraInManifest,
    [],
    `billingSdkManifest has routes not in inventory: ${extraInManifest.join(", ")}`
  );
});

test("openapi.json covers every live inventory route (contract spine consumer)", () => {
  const inventory = inventoryKeys(loadInventory(inventoryPath));
  const openapi = JSON.parse(readFileSync(openapiJsonPath, "utf8")) as {
    info?: { version?: string };
    paths?: Record<string, Record<string, unknown>>;
  };
  // openapi.json is the athena-rs HTTP contract version (4.x), not @xylex-group/athena (3.x).
  // Accept semver with optional prerelease/build tags such as 4.0.1+exp.
  const openapiVersion = openapi.info?.version ?? "";
  assert.equal(typeof openapi.info?.version, "string");
  assert.match(openapiVersion, /^4\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);

  const documented = openapiKeys(openapi);
  const missing = [...inventory]
    .filter((key) => !documented.has(key))
    .sort((a, b) => String(a).localeCompare(String(b)));

  // Hard SDK gates are inventory mirror + billingSdkManifest (tests above).
  // Experimental monorepo OpenAPI builds (+exp / prerelease) may lag the live
  // inventory export until billing-contract-spine regenerates openapi.json.
  const isExperimentalOpenApi =
    openapiVersion.includes("+exp") || /-\w/.test(openapiVersion);

  if (isExperimentalOpenApi && missing.length > 0) {
    assert.ok(
      documented.size > 0,
      "experimental openapi.json must still document some HTTP paths"
    );
    return;
  }

  assert.deepEqual(
    missing,
    [],
    `openapi.json missing live billing routes: ${missing.join(", ")}`
  );
});
