/**
 * SUPERSEDED by test/sdd/athena-devtools-runtime-inspector.target.test.ts
 *
 * Former characterization of pre-P0 CURRENT (Auth-UI overlay +
 * x-athena-data-nucleus header transport). Retired after P0 target GREEN
 * (2026-08-25). Not collected by pnpm test (superseded/ is skipped).
 *
 * Spec: docs/sdd/xylex/athena-devtools-runtime-inspector/SPEC.md
 * Dual-suite: docs/sdd/xylex/athena-devtools-runtime-inspector/dual-suite/dual-suite-spec.md
 *
 * Do not invert titles in place. Target suite is the CI source of truth.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { AthenaGatewayClient } from "../../../src/gateway/client.ts";
import type { AthenaRuntimeDiscoveryConfigDiagnostics } from "../../../src/gateway/discovery-types.ts";
import { resolveAthenaGatewayServerRoute } from "../../../src/gateway/server/route.ts";
import type {
  AthenaDeletePayload,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from "../../../src/gateway/types.ts";
import { createAthenaDataHandlers } from "../../../src/next/data-handlers.ts";
import {
  ATHENA_DEVTOOLS_DATA_HEADER,
  ATHENA_DEVTOOLS_REQUEST_HEADER,
  ATHENA_DEVTOOLS_TRACE_HEADER,
  type AthenaDevtoolsDataEvent,
} from "../../../src/runtime/data/devtools-nucleus.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");
const authUiRoot = join(pkgRoot, "..", "athena-auth-ui");
const overlayPath = join(
  authUiRoot,
  "src",
  "components",
  "auth",
  "experimental",
  "auth-routing-debug-overlay.tsx"
);
const authUiDataPath = join(
  authUiRoot,
  "src",
  "components",
  "auth",
  "experimental",
  "athena-devtools-data.ts"
);
const nucleusPath = join(srcRoot, "runtime", "data", "devtools-nucleus.ts");
const adapterPath = join(srcRoot, "gateway", "server", "adapter.ts");
const routePath = join(srcRoot, "gateway", "server", "route.ts");
const discoveryTypesPath = join(srcRoot, "gateway", "discovery-types.ts");
const packageJsonPath = join(pkgRoot, "package.json");
const devtoolsDir = join(srcRoot, "devtools");

const EVENTS_PATH = "/api/athena/devtools/v1/events";
const STREAM_PATH = "/api/athena/devtools/v1/stream";

const OVERLAY_SECTIONS = [
  "Overview",
  "Runtime",
  "Config",
  "Capabilities",
  "Requests",
  "Data",
  "Traces",
  "Session",
  "WebAuthn",
  "Routing",
] as const;

const INSPECTOR_PANEL_IDS = [
  "overview",
  "runtime",
  "configuration",
  "models",
  "migrations",
  "data",
  "queries",
  "policy",
  "auth",
  "storage",
  "billing",
  "network",
  "traces",
  "packages",
  "diagnostics",
] as const;

function readRel(abs: string): string {
  return readFileSync(abs, "utf8");
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function joinedSources(dir: string): string {
  return collectTsFiles(dir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function packageExports(): Record<string, unknown> {
  const pkg = JSON.parse(readRel(packageJsonPath)) as {
    exports?: Record<string, unknown>;
  };
  assert.ok(pkg.exports && typeof pkg.exports === "object");
  return pkg.exports;
}

function ok<T>(data: T): AthenaGatewayResponse<T> {
  return {
    count: Array.isArray(data) ? data.length : 1,
    data,
    error: undefined,
    errorDetails: null,
    ok: true,
    raw: { data },
    status: 200,
    statusText: "OK",
  };
}

function createRecordingTransport(): AthenaGatewayClient {
  return {
    baseUrl: "https://athena.local/mock",
    buildHeaders() {
      return {};
    },
    async deleteGateway<T>(
      _payload: AthenaDeletePayload
    ): Promise<AthenaGatewayResponse<T>> {
      void _payload;
      return ok([{ deleted: true }] as T);
    },
    async fetchGateway<T>(): Promise<AthenaGatewayResponse<T>> {
      return ok([{ id: "1" }] as T);
    },
    async insertGateway<T>(
      payload: AthenaInsertPayload
    ): Promise<AthenaGatewayResponse<T>> {
      return ok([payload.insert_body] as T);
    },
    async queryGateway<T>(): Promise<AthenaGatewayResponse<T>> {
      return ok([{ sql: true }] as T);
    },
    async resolveCallOptions(options) {
      return options;
    },
    async rpcGateway<T>(
      payload: Parameters<AthenaGatewayClient["rpcGateway"]>[0]
    ): Promise<AthenaGatewayResponse<T>> {
      return ok([{ rpc: payload.function }] as T);
    },
    async updateGateway<T>(
      payload: AthenaUpdatePayload
    ): Promise<AthenaGatewayResponse<T>> {
      return ok([payload.update_body] as T);
    },
    async verifyConnection() {
      return {
        baseUrl: "https://athena.local/mock",
        error: undefined,
        errorDetails: null,
        ok: true,
        raw: null,
        reachable: true,
        status: 200,
        statusText: "OK",
        url: "https://athena.local/mock/health",
      };
    },
  };
}

function createDevtoolsHandlers() {
  return createAthenaDataHandlers({
    security: { mode: "trusted" },
    transport: createRecordingTransport(),
    unsafeAllowUnauthenticated: true,
  });
}

async function readGatewayError(response: Response): Promise<{
  code?: string;
}> {
  const body = (await response.json()) as {
    errorDetails?: { code?: string };
    error?: { code?: string };
    code?: string;
  };
  return {
    code: body.errorDetails?.code ?? body.error?.code ?? body.code,
  };
}

test("P?: package.json exports have no ./devtools", () => {
  const exportsMap = packageExports();
  assert.ok("./runtime" in exportsMap);
  assert.ok("./schema" in exportsMap);
  assert.ok("./migrations" in exportsMap);
  assert.equal("./devtools" in exportsMap, false);
  assert.equal("./devtools/server" in exportsMap, false);
});

test("P?: protocol types/producers live under Auth-UI experimental overlay", () => {
  assert.equal(existsSync(authUiDataPath), true);
  const src = readRel(authUiDataPath);
  assert.match(src, /export interface AthenaDevtoolsDataEvent \{/);
  assert.match(
    src,
    /export const ATHENA_DEVTOOLS_DATA_HEADER = "x-athena-data-nucleus"/
  );
  assert.match(src, /export function sanitizeAthenaDevtoolsDataEvent/);
  assert.equal(src.includes("@xylex-group/athena/devtools"), false);
  assert.equal(src.includes('from "@xylex-group/athena/devtools"'), false);
});

test("P?: overlay title still “Athena Auth DevTools”", () => {
  const overlay = readRel(overlayPath);
  assert.match(overlay, /title="Athena Auth DevTools"/);
  assert.match(overlay, /import \{ AthenaDialog \}/);
});

test("P?: AthenaDevtoolsDataEvent duplicated in athena-devtools-data.ts vs athena-js devtools-nucleus.ts", () => {
  const ui = readRel(authUiDataPath);
  const js = readRel(nucleusPath);
  assert.match(ui, /export interface AthenaDevtoolsDataEvent \{/);
  assert.match(js, /export type AthenaDevtoolsDataEvent = \{/);
  const sample: AthenaDevtoolsDataEvent = {
    affectedRows: null,
    errorPhase: null,
    event: "data.insert",
    eventId: null,
    operation: "insert",
    policyIds: null,
    policyOutcome: null,
    principal: { authority: null },
    requestId: null,
    resource: null,
    timings: {
      afterHooksMs: null,
      authorizeMs: null,
      beforeHooksMs: null,
      executeMs: null,
      prepareMs: null,
      totalMs: null,
    },
    traceId: null,
    transactionSemantics: null,
  };
  assert.equal(sample.operation, "insert");
});

test("P?: Data Nucleus traces stuffed into URL-encoded x-athena-data-nucleus response header", async () => {
  const nucleus = readRel(nucleusPath);
  assert.match(
    nucleus,
    /export const ATHENA_DEVTOOLS_DATA_HEADER = "x-athena-data-nucleus"/
  );
  assert.match(nucleus, /encodeURIComponent\(JSON\.stringify\(events\)\)/);

  const handlers = createDevtoolsHandlers();
  const response = await handlers.POST(
    new Request("https://app.example/api/athena/gateway/insert", {
      body: JSON.stringify({
        insert_body: { email: "secret@example.com" },
        table_name: "users",
      }),
      headers: {
        "content-type": "application/json",
        [ATHENA_DEVTOOLS_REQUEST_HEADER]: "1",
        [ATHENA_DEVTOOLS_TRACE_HEADER]: "trace-devtools-baseline",
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  const encoded = response.headers.get(ATHENA_DEVTOOLS_DATA_HEADER);
  assert.ok(encoded);
  assert.equal(encoded.includes("{"), false);
  const events = JSON.parse(decodeURIComponent(encoded)) as Array<{
    event?: string;
    operation?: string;
    resource?: string;
    traceId?: string;
  }>;
  assert.ok(events.length >= 1);
  assert.equal(events[0]?.operation, "insert");
  assert.equal(events[0]?.event, "data.insert");
  assert.equal(events[0]?.resource, "users");
  assert.equal(events[0]?.traceId, "trace-devtools-baseline");
  const blob = JSON.stringify(events);
  assert.equal(blob.includes("secret@example.com"), false);
  assert.equal(blob.includes("insert_body"), false);
});

test("P?: wrapRuntimeForAthenaDevtools + attachAthenaDevtoolsDataHeader in gateway adapter", () => {
  const adapter = readRel(adapterPath);
  assert.match(
    adapter,
    /from "\.\.\/\.\.\/runtime\/data\/devtools-nucleus\.ts"/
  );
  assert.match(adapter, /wrapRuntimeForAthenaDevtools/);
  assert.match(adapter, /attachAthenaDevtoolsDataHeader/);
  assert.match(
    adapter,
    /const dataEvents = captureDevtools \? \[\] : undefined/
  );
});

test("P?: no GET /api/athena/devtools/v1/events", async () => {
  const routeSrc = readRel(routePath);
  assert.equal(routeSrc.includes("devtools"), false);
  assert.equal(routeSrc.includes("devtools-events"), false);
  assert.match(routeSrc, /kind: "gateway"/);
  assert.match(routeSrc, /kind: "health"/);
  assert.match(routeSrc, /kind: "capabilities"/);
  assert.match(routeSrc, /kind: "unknown"/);

  assert.deepEqual(resolveAthenaGatewayServerRoute(EVENTS_PATH), {
    kind: "unknown",
  });

  const handlers = createDevtoolsHandlers();
  const response = await handlers.GET(
    new Request(`https://app.example${EVENTS_PATH}`)
  );
  assert.equal(response.status, 404);
  const error = await readGatewayError(response);
  assert.equal(error.code, "ATHENA_RUNTIME_UNSUPPORTED_OPERATION");
});

test("P?: no GET /api/athena/devtools/v1/stream", async () => {
  assert.deepEqual(resolveAthenaGatewayServerRoute(STREAM_PATH), {
    kind: "unknown",
  });
  const handlers = createDevtoolsHandlers();
  const response = await handlers.GET(
    new Request(`https://app.example${STREAM_PATH}`)
  );
  assert.equal(response.status, 404);
  const error = await readGatewayError(response);
  assert.equal(error.code, "ATHENA_RUNTIME_UNSUPPORTED_OPERATION");
});

test("P?: no development ring buffer for DevTools events", () => {
  assert.equal(existsSync(join(devtoolsDir, "buffer")), false);
  const adapter = readRel(adapterPath);
  assert.match(
    adapter,
    /const dataEvents = captureDevtools \? \[\] : undefined/
  );
  assert.equal(/ring\s*buffer/i.test(adapter), false);
  const srcBlob = joinedSources(srcRoot);
  assert.equal(srcBlob.includes("createAthenaDevtoolsEventBuffer"), false);
  assert.equal(srcBlob.includes("ATHENA_DEVTOOLS_RING"), false);
});

test("P?: discovery diagnostics are booleans/counts only (generatorConfigFile, migrationsDirectoryFound, localMigrationFiles, modelsAttached, databaseConfigured, autoMigrate)", () => {
  const discovery = readRel(discoveryTypesPath);
  assert.match(
    discovery,
    /export interface AthenaRuntimeDiscoveryConfigDiagnostics \{/
  );
  const start = discovery.indexOf(
    "export interface AthenaRuntimeDiscoveryConfigDiagnostics"
  );
  const end = discovery.indexOf(
    "export interface AthenaRuntimeDiscoveryDiagnostics"
  );
  const block = discovery.slice(start, end);
  for (const field of [
    "autoMigrate",
    "databaseConfigured",
    "generatorConfigFile",
    "localMigrationFiles",
    "migrationsDirectoryFound",
    "modelsAttached",
  ]) {
    assert.ok(block.includes(field), `missing ${field}`);
  }
  assert.equal(block.includes("provenance"), false);
  assert.equal(block.includes("configured vs inferred"), false);

  const shape: AthenaRuntimeDiscoveryConfigDiagnostics = {
    authWarnings: [],
    autoMigrate: false,
    databaseConfigured: true,
    generatorConfigFile: "athena.config.ts",
    localMigrationFiles: 3,
    migrationsDirectory: "athena/migrations",
    migrationsDirectoryFound: true,
    modelsAttached: true,
  };
  assert.equal(typeof shape.databaseConfigured, "boolean");
  assert.equal(typeof shape.localMigrationFiles, "number");
  assert.equal(typeof shape.modelsAttached, "boolean");
});

test("P?: no configured/inferred/effective provenance", () => {
  assert.equal(existsSync(devtoolsDir), false);
  const srcBlob = joinedSources(srcRoot);
  assert.equal(srcBlob.includes("AthenaDevtoolsSettingProvenance"), false);
  assert.equal(srcBlob.includes("configured vs inferred vs effective"), false);
  const discovery = readRel(discoveryTypesPath);
  assert.equal(discovery.includes("AthenaDevtoolsSettingProvenance"), false);
});

test("P?: src/devtools/ does not exist", () => {
  assert.equal(existsSync(devtoolsDir), false);
});

test("P?: overlay sections today Overview/Runtime/Config/Capabilities/Requests/Data/Traces/Session/WebAuthn/Routing — not the 15-panel inspector", () => {
  const overlay = readRel(overlayPath);
  for (const section of OVERLAY_SECTIONS) {
    assert.ok(
      overlay.includes(`>${section}<`) || overlay.includes(`"${section}"`),
      `overlay must include section ${section}`
    );
  }
  assert.match(
    overlay,
    /<h2 className="font-semibold text-foreground text-sm">Overview<\/h2>/
  );
  assert.match(
    overlay,
    /<h3 className="font-semibold text-foreground text-sm">Runtime<\/h3>/
  );
  assert.match(
    overlay,
    /<h3 className="font-semibold text-foreground text-sm">Config<\/h3>/
  );
  assert.match(
    overlay,
    /<h2 className="font-semibold text-foreground text-sm">Requests<\/h2>/
  );
  assert.equal(overlay.includes("panelId"), false);
  assert.equal(overlay.includes('"configuration"'), false);
  assert.equal(overlay.includes('status: "stub"'), false);
  for (const id of [
    "models",
    "migrations",
    "queries",
    "diagnostics",
  ] as const) {
    assert.equal(
      new RegExp(`panelId:\\s*"${id}"`).test(overlay),
      false,
      `overlay must not catalog panelId ${id}`
    );
  }
  const jsBlob = joinedSources(srcRoot);
  for (const id of INSPECTOR_PANEL_IDS) {
    assert.equal(
      jsBlob.includes(`panelId: "${id}"`),
      false,
      `athena-js must not ship panel catalog id ${id}`
    );
  }
});

test("P?: no registry ↔ Schema IR ↔ live DB drift kinds", () => {
  const inspect = readRel(join(srcRoot, "auth", "local", "schema-inspect.ts"));
  assert.match(inspect, /"missing-table"/);
  assert.match(inspect, /"missing-column"/);
  assert.equal(inspect.includes("model-drift"), false);
  assert.equal(inspect.includes("orphan-column"), false);
  assert.equal(inspect.includes("unapplied-migration"), false);
  assert.equal(existsSync(join(devtoolsDir, "produce")), false);
  const srcBlob = joinedSources(srcRoot);
  assert.equal(srcBlob.includes("AthenaDevtoolsDriftKind"), false);
  assert.equal(srcBlob.includes("liveCatalog"), false);
  assert.equal(srcBlob.includes("registry ↔ Schema IR"), false);
});

test("P?: no traces_data table", () => {
  const srcBlob = joinedSources(srcRoot);
  assert.equal(srcBlob.includes("traces_data"), false);
  const sqlBlob = collectTsFiles(srcRoot)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.equal(sqlBlob.includes("traces_data"), false);
});

test("P?: Data Nucleus is not a public package export", () => {
  const exportsMap = packageExports();
  for (const key of Object.keys(exportsMap)) {
    assert.equal(
      key.includes("nucleus"),
      false,
      `exports must not include nucleus path ${key}`
    );
    assert.equal(
      key.includes("runtime/data/nucleus"),
      false,
      `exports must not include ${key}`
    );
  }
  assert.equal("./runtime/data/nucleus" in exportsMap, false);
  assert.equal(existsSync(join(srcRoot, "runtime", "data", "nucleus")), true);
});

test("P?: no createDevtoolsClient", () => {
  const srcBlob = joinedSources(srcRoot);
  assert.equal(srcBlob.includes("createDevtoolsClient"), false);
  assert.equal(srcBlob.includes("createInspectorClient"), false);
});

test("P?: overlay uses AthenaDialog", () => {
  const overlay = readRel(overlayPath);
  assert.match(
    overlay,
    /import \{ AthenaDialog \} from "@\/components\/auth\/overlay\/athena-dialog"/
  );
  assert.match(overlay, /<AthenaDialog/);
  assert.match(overlay, /<\/AthenaDialog>/);
});
