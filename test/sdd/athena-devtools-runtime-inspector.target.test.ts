/**
 * Target — DESIRED P0 Athena DevTools runtime/project inspector protocol.
 * GREEN after Athena JS owns protocol/producers/sanitizers + event channel.
 * Former characterization baseline retired to
 * test/sdd/superseded/athena-devtools-runtime-inspector.baseline.superseded.ts.
 *
 * Spec: docs/sdd/xylex/athena-devtools-runtime-inspector/SPEC.md
 * Dual-suite: docs/sdd/xylex/athena-devtools-runtime-inspector/dual-suite/dual-suite-spec.md
 *
 * Host:
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/athena-devtools-runtime-inspector.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import { resolveAthenaGatewayServerRoute } from "../../src/gateway/server/route.ts";
import type {
  AthenaDeletePayload,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from "../../src/gateway/types.ts";
import { createAthenaDataHandlers } from "../../src/next/data-handlers.ts";
import { string, table } from "../../src/schema/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const authUiRoot = join(pkgRoot, "..", "athena-auth-ui");
const packageJsonPath = join(pkgRoot, "package.json");
const tsupPath = join(pkgRoot, "tsup.config.ts");
const devtoolsDir = join(srcRoot, "devtools");
const protocolDir = join(devtoolsDir, "protocol");
const sanitizeDir = join(devtoolsDir, "sanitize");
const produceDir = join(devtoolsDir, "produce");
const bufferDir = join(devtoolsDir, "buffer");
const httpDir = join(devtoolsDir, "http");
const publicBarrelPath = join(devtoolsDir, "index.ts");
const adapterPath = join(srcRoot, "gateway", "server", "adapter.ts");
const routePath = join(srcRoot, "gateway", "server", "route.ts");
const nucleusPath = join(srcRoot, "runtime", "data", "devtools-nucleus.ts");
const authUiDataPath = join(
  authUiRoot,
  "src",
  "components",
  "auth",
  "experimental",
  "athena-devtools-data.ts"
);

const EVENTS_PATH = "/api/athena/devtools/v1/events";
const STREAM_PATH = "/api/athena/devtools/v1/stream";

const DEVTOOLS_TREE = [
  "index.ts",
  "protocol",
  "sanitize",
  "produce",
  "buffer",
  "http",
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
  "authorization",
  "storage",
  "billing",
  "network",
  "traces",
  "packages",
  "diagnostics",
] as const;

const STUB_PANEL_IDS = ["queries", "policy", "storage", "diagnostics"] as const;

const DRIFT_KINDS = [
  "model-drift",
  "missing-table",
  "missing-column",
  "type-mismatch",
  "unapplied-migration",
  "orphan-column",
] as const;

const GENERATED_BY = ["Manual", "Auth", "Billing", "Storage"] as const;

const PROVENANCE_PATHS = [
  "database",
  "auth.mode",
  "auth.passkey.rpId",
  "auth.security.trustedOrigins",
  "models",
  "migrations",
  "storage",
  "billing",
] as const;

const users = table("users")
  .schema("public")
  .columns({
    email: string(),
    id: string(),
    name: string(),
  })
  .primaryKey("id");

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

async function importSrcModule(
  relFromSrc: string
): Promise<Record<string, unknown>> {
  const abs = join(srcRoot, relFromSrc);
  assert.equal(existsSync(abs), true, `missing ${relFromSrc}`);
  return (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
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
    models: { users },
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

function eventsFromBody(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  if (isRecord(body) && Array.isArray(body.events)) {
    return body.events;
  }
  return [];
}

type DevtoolsSnapshot = {
  configuration?: {
    settings?: unknown;
  };
  migrations?: Record<string, unknown>;
  models?: Record<string, unknown>;
  panels?: unknown;
};

function snapshotSettings(
  snapshot: DevtoolsSnapshot
): Record<string, unknown>[] {
  const settings = snapshot.configuration?.settings;
  if (!Array.isArray(settings)) {
    return [];
  }
  return settings.filter(isRecord);
}

async function produceSnapshot(
  input: Record<string, unknown>
): Promise<DevtoolsSnapshot> {
  const produce = await importSrcModule("devtools/produce/index.ts");
  const fn = produce.produceAthenaDevtoolsSnapshot;
  assert.equal(
    typeof fn,
    "function",
    "produceAthenaDevtoolsSnapshot must be a function"
  );
  const snapshot = await (fn as (value: Record<string, unknown>) => unknown)(
    input
  );
  assert.ok(isRecord(snapshot), "snapshot must be an object");
  return snapshot as DevtoolsSnapshot;
}

const SNAPSHOT_INPUT = {
  auth: {
    mode: "local",
    passkey: {
      rpId: "localhost",
    },
    security: {
      trustedOrigins: ["http://localhost:3000"],
    },
  },
  billing: {
    mollie: { apiKey: "live_mollie_token_secret" },
  },
  database: {
    url: "postgres://athena:supersecret_db_password@127.0.0.1:5432/athena",
  },
  email: {
    smtp: { password: "smtp_password_secret" },
  },
  migrations: {
    directory: "athena/migrations",
  },
  models: { users },
  session: {
    token: "session_token_secret",
  },
  storage: {
    local: true,
  },
  webauthn: {
    challenge: "raw_webauthn_challenge_secret",
  },
};

test("P?: src/devtools/ protocol, sanitize, produce, buffer, http exist", () => {
  assert.equal(existsSync(devtoolsDir), true, "src/devtools/ must exist");
  for (const entry of DEVTOOLS_TREE) {
    assert.equal(
      existsSync(join(devtoolsDir, entry)),
      true,
      `src/devtools/${entry} must exist`
    );
  }
  assert.equal(existsSync(publicBarrelPath), true);
  assert.equal(existsSync(protocolDir), true);
  assert.equal(existsSync(sanitizeDir), true);
  assert.equal(existsSync(produceDir), true);
  assert.equal(existsSync(bufferDir), true);
  assert.equal(existsSync(httpDir), true);
  const produceBlob = joinedSources(produceDir);
  const bufferBlob = joinedSources(bufferDir);
  const httpBlob = joinedSources(httpDir);
  assert.match(produceBlob, /produceAthenaDevtoolsSnapshot/);
  assert.match(bufferBlob, /createAthenaDevtoolsEventBuffer/);
  assert.match(httpBlob, /devtools\/v1\/events/);
});

test("P?: public ./devtools export exists for protocol types", () => {
  const exportsMap = packageExports();
  assert.ok("./runtime" in exportsMap);
  assert.ok("./schema" in exportsMap);
  assert.ok("./migrations" in exportsMap);
  assert.equal(
    "./devtools" in exportsMap,
    true,
    "package.json exports must include ./devtools"
  );
  const tsup = readRel(tsupPath);
  assert.match(tsup, /devtools:\s*"src\/devtools\/index\.ts"/);
  const barrel = readRel(publicBarrelPath);
  assert.match(barrel, /AthenaDevtoolsDataEvent/);
  assert.equal(barrel.includes("createAthenaDevtoolsEventBuffer"), false);
  assert.equal(barrel.includes('from "./buffer'), false);
  assert.equal(barrel.includes('from "./produce'), false);
  assert.equal(barrel.includes('from "./http'), false);
});

test("P?: AthenaDevtoolsDataEvent SSOT is Athena JS not Auth-UI", () => {
  const protocolBlob = joinedSources(protocolDir);
  assert.match(
    protocolBlob,
    /export (?:type|interface) AthenaDevtoolsDataEvent/
  );
  assert.equal(existsSync(authUiDataPath), true);
  const ui = readRel(authUiDataPath);
  assert.equal(
    /export interface AthenaDevtoolsDataEvent\s*\{/.test(ui),
    false,
    "Auth-UI must not declare AthenaDevtoolsDataEvent interface body"
  );
  assert.equal(
    /export type AthenaDevtoolsDataEvent\s*=\s*\{/.test(ui),
    false,
    "Auth-UI must not declare a second AthenaDevtoolsDataEvent object type"
  );
  assert.match(
    ui,
    /@xylex-group\/athena\/devtools/,
    "Auth-UI must consume @xylex-group/athena/devtools"
  );
});

test("P?: gateway responses do not set URL-encoded x-athena-data-nucleus payloads", async () => {
  const nucleus = readRel(nucleusPath);
  assert.equal(
    nucleus.includes("encodeURIComponent(JSON.stringify(events))"),
    false,
    "devtools-nucleus must not URL-encode event payloads"
  );
  const adapter = readRel(adapterPath);
  if (adapter.includes("attachAthenaDevtoolsDataHeader")) {
    assert.equal(/encodeURIComponent\(JSON\.stringify/.test(adapter), false);
  }
  const handlers = createDevtoolsHandlers();
  const response = await handlers.POST(
    new Request("https://app.example/api/athena/gateway/insert", {
      body: JSON.stringify({
        insert_body: { email: "secret@example.com" },
        table_name: "users",
      }),
      headers: {
        "content-type": "application/json",
        "x-athena-devtools": "1",
        "x-athena-trace-id": "trace-devtools-target",
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  const bulky = response.headers.get("x-athena-data-nucleus");
  assert.equal(
    bulky,
    null,
    "mutation responses must not set x-athena-data-nucleus"
  );
});

test("P?: GET /api/athena/devtools/v1/events is served on the Next /api/athena catch-all", async () => {
  const routeSrc = readRel(routePath);
  assert.match(routeSrc, /kind:\s*"devtools-events"/);
  assert.equal(routeSrc.includes("createDevtoolsClient"), false);
  const resolved = resolveAthenaGatewayServerRoute(EVENTS_PATH);
  assert.equal(resolved.kind, "devtools-events");

  const handlers = createDevtoolsHandlers();
  const response = await handlers.GET(
    new Request(`https://app.example${EVENTS_PATH}`)
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  const body: unknown = await response.json();
  const events = eventsFromBody(body);
  assert.ok(
    Array.isArray(events),
    "events JSON must be an array or { events }"
  );
  const dataHandlersSrc = readRel(join(srcRoot, "next", "data-handlers.ts"));
  assert.equal(dataHandlersSrc.includes("createDevtoolsHandlers"), false);
  assert.match(dataHandlersSrc, /handleAthenaGatewayRequest/);
});

test("P?: development-only ring buffer records sanitized Data Nucleus events", async () => {
  assert.equal(existsSync(bufferDir), true, "src/devtools/buffer must exist");
  const bufferBlob = joinedSources(bufferDir);
  assert.match(bufferBlob, /createAthenaDevtoolsEventBuffer/);
  assert.match(bufferBlob, /limit|capacity|max/i);

  const handlers = createDevtoolsHandlers();
  const insert = await handlers.POST(
    new Request("https://app.example/api/athena/gateway/insert", {
      body: JSON.stringify({
        insert_body: { email: "secret@example.com" },
        table_name: "users",
      }),
      headers: {
        "content-type": "application/json",
        "x-athena-devtools": "1",
        "x-athena-trace-id": "trace-devtools-buffer",
      },
      method: "POST",
    })
  );
  assert.equal(insert.status, 200);

  const listed = await handlers.GET(
    new Request(`https://app.example${EVENTS_PATH}?limit=50`)
  );
  assert.equal(listed.status, 200);
  const body: unknown = await listed.json();
  const events = eventsFromBody(body);
  assert.ok(events.length >= 1, "ring buffer must record the mutation");
  const blob = JSON.stringify(events);
  assert.equal(blob.includes("secret@example.com"), false);
  assert.equal(blob.includes("insert_body"), false);
  const first = events.find(isRecord);
  assert.ok(first, "event records must be objects");
  assert.equal(first.operation, "insert");
  assert.equal(first.event, "data.insert");
  assert.equal(first.resource, "users");
  assert.equal(first.traceId, "trace-devtools-buffer");
});

test("P?: mutation responses keep x-athena-request-id and x-athena-trace-id", async () => {
  const handlers = createDevtoolsHandlers();
  const response = await handlers.POST(
    new Request("https://app.example/api/athena/gateway/insert", {
      body: JSON.stringify({
        insert_body: { email: "secret@example.com" },
        table_name: "users",
      }),
      headers: {
        "content-type": "application/json",
        "x-athena-devtools": "1",
        "x-athena-trace-id": "trace-devtools-headers",
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("x-athena-request-id"));
  assert.equal(
    response.headers.get("x-athena-trace-id"),
    "trace-devtools-headers"
  );
});

test("P?: event channel fail-closed in production", async () => {
  const httpBlob = joinedSources(httpDir);
  assert.match(httpBlob, /ATHENA_DEVTOOLS_DISABLED/);
  assert.match(httpBlob, /NODE_ENV/);
  assert.equal(existsSync(httpDir), true);

  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const handlers = createDevtoolsHandlers();
    const response = await handlers.GET(
      new Request(`https://app.example${EVENTS_PATH}`)
    );
    assert.equal(response.status, 404);
    const error = await readGatewayError(response);
    assert.equal(error.code, "ATHENA_DEVTOOLS_DISABLED");
    const stream = await handlers.GET(
      new Request(`https://app.example${STREAM_PATH}`)
    );
    assert.ok(stream.status === 404 || stream.status === 501);
  } finally {
    if (previous === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previous;
    }
  }
});

test("P?: ring buffer and producers absent from browser, next/client, react-native, Auth-UI", () => {
  assert.equal(existsSync(bufferDir), true);
  assert.equal(existsSync(produceDir), true);
  const fileSurfaces = [
    join(srcRoot, "browser.ts"),
    join(srcRoot, "next", "client.ts"),
  ];
  const dirSurfaces = [join(srcRoot, "react-native"), join(authUiRoot, "src")];
  const forbidden = [
    "devtools/buffer",
    "devtools/produce",
    "devtools/http",
    "createAthenaDevtoolsEventBuffer",
    "ATHENA_DEVTOOLS_RING",
  ];
  for (const surface of fileSurfaces) {
    const src = readRel(surface);
    for (const token of forbidden) {
      assert.equal(
        src.includes(token),
        false,
        `${surface} must not import ${token}`
      );
    }
  }
  for (const surface of dirSurfaces) {
    const blob = joinedSources(surface);
    for (const token of forbidden) {
      assert.equal(
        blob.includes(token),
        false,
        `${surface} must not import ${token}`
      );
    }
  }
  if (existsSync(publicBarrelPath)) {
    const barrel = readRel(publicBarrelPath);
    assert.equal(barrel.includes("createAthenaDevtoolsEventBuffer"), false);
    assert.equal(barrel.includes('from "./buffer'), false);
    assert.equal(barrel.includes('from "./produce'), false);
  }
});

test("P?: redacted config inspector has configured vs inferred vs effective + source", async () => {
  const protocolBlob = joinedSources(protocolDir);
  assert.match(protocolBlob, /AthenaDevtoolsSettingProvenance/);
  assert.match(protocolBlob, /configured vs inferred vs effective|configured/);
  assert.match(protocolBlob, /normalization/);
  assert.match(protocolBlob, /inference/);

  const snapshot = await produceSnapshot(SNAPSHOT_INPUT);
  const settings = snapshotSettings(snapshot);
  assert.ok(settings.length >= 1, "configuration.settings must be present");
  for (const path of PROVENANCE_PATHS) {
    const match = settings.find((row) => row.path === path);
    assert.ok(match, `missing provenance for ${path}`);
    assert.ok(
      match.configured === "set" || match.configured === "unset",
      `${path} configured must be set|unset`
    );
    assert.ok(
      match.inferred === "set" ||
        match.inferred === "unset" ||
        match.inferred === "not-applicable",
      `${path} inferred must be set|unset|not-applicable`
    );
    assert.ok(
      match.effective === "set" || match.effective === "unset",
      `${path} effective must be set|unset`
    );
    assert.equal(typeof match.source, "string");
    assert.ok(isRecord(match.stages), `${path} must include stages`);
    for (const stage of [
      "source",
      "normalization",
      "inference",
      "runtime",
    ] as const) {
      assert.ok(stage in match.stages, `${path} stages must include ${stage}`);
    }
  }
});

test("P?: billing providers.mollie.testKey counts as a configured secret", async () => {
  const snapshot = await produceSnapshot({
    ...SNAPSHOT_INPUT,
    billing: {
      providers: {
        mollie: { testKey: "test_athena_devtools_secret" },
      },
    },
  });
  const billing = snapshotSettings(snapshot).find(
    (row) => row.path === "billing"
  );
  assert.ok(billing, "billing provenance row required");
  const stages = isRecord(billing.stages) ? billing.stages : {};
  const runtime = isRecord(stages.runtime) ? stages.runtime : {};
  assert.equal(runtime.kind, "secret");
  assert.equal(runtime.configured, true);
  assert.equal(
    JSON.stringify(snapshot).includes("test_athena_devtools_secret"),
    false
  );
});

test("P?: secrets never appear — structural facts only", async () => {
  const snapshot = await produceSnapshot(SNAPSHOT_INPUT);
  const json = JSON.stringify(snapshot);
  for (const secret of [
    "supersecret_db_password",
    "postgres://athena:supersecret_db_password",
    "live_mollie_token_secret",
    "smtp_password_secret",
    "session_token_secret",
    "raw_webauthn_challenge_secret",
  ]) {
    assert.equal(json.includes(secret), false, `snapshot leaked ${secret}`);
  }
  const settings = snapshotSettings(snapshot);
  const database = settings.find((row) => row.path === "database");
  assert.ok(database, "database provenance row required");
  const stages = isRecord(database.stages) ? database.stages : {};
  const facts = [database, ...Object.values(stages)];
  for (const fact of facts) {
    if (!isRecord(fact)) {
      continue;
    }
    if (fact.kind === "secret") {
      assert.equal("value" in fact, false);
      assert.equal(typeof fact.configured, "boolean");
    }
    if (typeof fact.value === "string") {
      assert.equal(fact.value.includes("supersecret"), false);
      assert.equal(fact.value.includes("postgres://"), false);
    }
  }
});

test("P?: models inspector lists schema.table, fields, PK, relations from attached AthenaModels", async () => {
  const snapshot = await produceSnapshot(SNAPSHOT_INPUT);
  assert.ok(isRecord(snapshot.models), "snapshot.models required");
  const models = snapshot.models;
  const tables = Array.isArray(models.tables)
    ? models.tables.filter(isRecord)
    : [];
  assert.ok(tables.length >= 1, "models.tables must list attached models");
  const usersRow = tables.find(
    (row) =>
      row.table === "users" ||
      row.name === "public.users" ||
      row.identity === "public.users" ||
      row.schemaTable === "public.users"
  );
  assert.ok(usersRow, "users model must appear as schema.table");
  const schemaName = usersRow.schema ?? usersRow.schemaName;
  const tableName = usersRow.table ?? usersRow.tableName ?? usersRow.name;
  assert.equal(
    schemaName === "public" || String(tableName).includes("users"),
    true
  );
  const fields = Array.isArray(usersRow.fields)
    ? usersRow.fields
    : Array.isArray(usersRow.columns)
      ? usersRow.columns
      : [];
  const fieldNames = fields
    .map((field) =>
      isRecord(field)
        ? String(field.name ?? field.logical ?? field.physical ?? "")
        : String(field)
    )
    .filter(Boolean);
  for (const column of ["id", "email", "name"]) {
    assert.ok(
      fieldNames.includes(column),
      `users fields must include ${column}`
    );
  }
  const pk = usersRow.primaryKey ?? usersRow.pk;
  const pkNames = Array.isArray(pk)
    ? pk.map(String)
    : isRecord(pk) && Array.isArray(pk.columns)
      ? pk.columns.map(String)
      : pk
        ? [String(pk)]
        : [];
  assert.ok(pkNames.includes("id"), "users PK must include id");
  assert.ok("relations" in usersRow);
});

test("P?: drift kinds include model-drift, missing-table, missing-column, type-mismatch, unapplied-migration, orphan-column", async () => {
  const protocolBlob = joinedSources(protocolDir);
  assert.match(protocolBlob, /AthenaDevtoolsDriftKind/);
  for (const kind of DRIFT_KINDS) {
    assert.ok(
      protocolBlob.includes(`"${kind}"`) || protocolBlob.includes(`'${kind}'`),
      `protocol must enumerate ${kind}`
    );
  }
  const produceBlob = joinedSources(produceDir);
  assert.match(produceBlob, /liveCatalog/);
  const snapshot = await produceSnapshot(SNAPSHOT_INPUT);
  assert.ok(isRecord(snapshot.models));
  const drift = snapshot.models.drift;
  assert.ok(
    Array.isArray(drift) || isRecord(drift),
    "models.drift must be present (list or document)"
  );
  if (
    isRecord(snapshot.models) &&
    snapshot.models.liveCatalog === "unavailable"
  ) {
    assert.ok(true);
  }
});

test("P?: migration inspector has schema version, latest applied, local file count, applied/pending, subsystem status, generated-by", async () => {
  const protocolBlob = joinedSources(protocolDir);
  assert.match(protocolBlob, /generatedBy/);
  for (const origin of GENERATED_BY) {
    assert.ok(
      protocolBlob.includes(`"${origin}"`) ||
        protocolBlob.includes(`'${origin}'`),
      `protocol must enumerate generatedBy ${origin}`
    );
  }
  const snapshot = await produceSnapshot(SNAPSHOT_INPUT);
  assert.ok(isRecord(snapshot.migrations), "snapshot.migrations required");
  const migrations = snapshot.migrations;
  assert.ok(
    "schemaVersion" in migrations || "version" in migrations,
    "schema version required"
  );
  assert.ok(
    "latestApplied" in migrations || "latest" in migrations,
    "latest applied required"
  );
  assert.ok(
    "localFileCount" in migrations || "localMigrationFiles" in migrations,
    "local file count required"
  );
  assert.ok(Array.isArray(migrations.applied), "applied list required");
  assert.ok(Array.isArray(migrations.pending), "pending list required");
  assert.ok(
    isRecord(migrations.subsystems) || Array.isArray(migrations.subsystems),
    "embedded Auth/Billing/Storage subsystem status required"
  );
  const generated = asStringArray(migrations.generatedBy).concat(
    Array.isArray(migrations.files)
      ? migrations.files.flatMap((file) =>
          isRecord(file) && typeof file.generatedBy === "string"
            ? [file.generatedBy]
            : []
        )
      : []
  );
  assert.ok(
    generated.length === 0 ||
      generated.every((value) =>
        (GENERATED_BY as readonly string[]).includes(value)
      ),
    "generatedBy must be Manual|Auth|Billing|Storage"
  );
});

test("P?: snapshot panel catalog includes 16 ids (stubs allowed)", async () => {
  const protocolBlob = joinedSources(protocolDir);
  for (const id of INSPECTOR_PANEL_IDS) {
    assert.ok(
      protocolBlob.includes(`"${id}"`),
      `protocol must catalog panelId ${id}`
    );
  }
  const snapshot = await produceSnapshot(SNAPSHOT_INPUT);
  assert.ok(Array.isArray(snapshot.panels), "snapshot.panels must be an array");
  const panels = snapshot.panels.filter(isRecord);
  assert.equal(panels.length, 16);
  const ids = panels.map((panel) => panel.panelId);
  assert.deepEqual([...ids].sort(), [...INSPECTOR_PANEL_IDS].sort());
  for (const id of STUB_PANEL_IDS) {
    const panel = panels.find((row) => row.panelId === id);
    assert.ok(panel, `missing stub panel ${id}`);
    assert.equal(panel.status, "stub");
    assert.ok(panel.phase === "P1" || panel.phase === "P2");
  }
});

test("P?: createClient remains the only consumer constructor", () => {
  const srcBlob = joinedSources(srcRoot);
  assert.equal(srcBlob.includes("createDevtoolsClient"), false);
  assert.equal(srcBlob.includes("createInspectorClient"), false);
  const exportsMap = packageExports();
  assert.equal("./devtools/client" in exportsMap, false);
});

test("P?: do not add traces_data", () => {
  const srcBlob = joinedSources(srcRoot);
  assert.equal(srcBlob.includes("traces_data"), false);
  if (existsSync(devtoolsDir)) {
    assert.equal(joinedSources(devtoolsDir).includes("traces_data"), false);
  }
});

test("P?: Data Nucleus remains internal behind createClient({ lifecycle: { data } })", () => {
  const exportsMap = packageExports();
  for (const key of Object.keys(exportsMap)) {
    assert.equal(
      key.includes("nucleus"),
      false,
      `exports must not include nucleus path ${key}`
    );
  }
  assert.equal("./runtime/data/nucleus" in exportsMap, false);
  assert.equal(existsSync(join(srcRoot, "runtime", "data", "nucleus")), true);
  if (existsSync(publicBarrelPath)) {
    const barrel = readRel(publicBarrelPath);
    assert.equal(barrel.includes("runtime/data/nucleus"), false);
    assert.equal(barrel.includes("createNucleus"), false);
  }
});

test("P?: do not clone AthenaAuthHooks", () => {
  assert.equal(existsSync(produceDir), true, "producers must exist");
  const produceBlob = joinedSources(produceDir);
  assert.equal(
    produceBlob.includes("AthenaAuthHooks"),
    false,
    "DevTools producers must not import AthenaAuthHooks as the event contract"
  );
  assert.equal(produceBlob.includes("cloneAthenaAuthHooks"), false);
  if (existsSync(devtoolsDir)) {
    const blob = joinedSources(devtoolsDir);
    assert.equal(blob.includes("type AthenaAuthHooks"), false);
  }
});
