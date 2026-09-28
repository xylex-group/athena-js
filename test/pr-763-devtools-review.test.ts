/**
 * PR #763 review regressions (Codex discussion_r 3853209551–3853209583).
 */
import { strict as assert } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../src/auth/contract/index.ts";
import {
  produceAthenaDevtoolsSnapshot,
  resolveAthenaDevtoolsProduceInput,
} from "../src/devtools/produce/index.ts";
import type { AthenaGatewayClient } from "../src/gateway/client.ts";
import type {
  AthenaDeletePayload,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from "../src/gateway/types.ts";
import { createAthenaDataHandlers } from "../src/next/data-handlers.ts";
import type { AthenaRuntimeSessionLookup } from "../src/runtime/data/principal.ts";
import { string, table } from "../src/schema/index.ts";
import { schemaIrFromModels } from "../src/schema/ir/compatibility.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const authUiRoot = join(pkgRoot, "..", "athena-auth-ui");
const overlayPath = join(
  authUiRoot,
  "src",
  "components",
  "auth",
  "experimental",
  "auth-routing-debug-overlay.tsx"
);
const runtimePath = join(
  authUiRoot,
  "src",
  "components",
  "auth",
  "experimental",
  "athena-devtools-runtime.ts"
);

const users = table("users")
  .schema("public")
  .columns({
    email: string(),
    id: string(),
    name: string(),
  })
  .primaryKey("id");

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function databaseSetting(
  snapshot: Awaited<ReturnType<typeof produceAthenaDevtoolsSnapshot>>
): Record<string, unknown> | undefined {
  const settings = snapshot.configuration.settings;
  return settings.find((row) => row.path === "database") as
    | Record<string, unknown>
    | undefined;
}

test("P?: Expose the snapshot producer through the existing handler", async () => {
  const handlers = createAthenaDataHandlers({
    databaseUrl: "postgres://athena:secret@127.0.0.1:5432/athena",
    models: { users },
    security: { mode: "trusted" },
    transport: createRecordingTransport(),
    unsafeAllowUnauthenticated: true,
  });
  const response = await handlers.GET(
    new Request("https://app.example/api/athena/capabilities")
  );
  assert.equal(response.status, 200);
  const body: unknown = await response.json();
  assert.ok(isRecord(body), "capabilities JSON must be an object");
  const snapshot = isRecord(body.devtools)
    ? body.devtools
    : isRecord(body.snapshot)
      ? body.snapshot
      : null;
  assert.ok(
    snapshot,
    "capabilities handler must expose produceAthenaDevtoolsSnapshot"
  );
  assert.ok(
    isRecord(snapshot.configuration),
    "snapshot.configuration required"
  );
  assert.ok(isRecord(snapshot.models), "snapshot.models required");
  assert.ok(isRecord(snapshot.migrations), "snapshot.migrations required");

  const runtimeSrc = readFileSync(runtimePath, "utf8");
  assert.match(
    runtimeSrc,
    /devtools/,
    "overlay runtime parser must consume the capabilities snapshot"
  );
  assert.match(runtimeSrc, /configuration/);
  assert.match(runtimeSrc, /migrations/);
  const overlaySrc = readFileSync(overlayPath, "utf8");
  assert.match(
    overlaySrc,
    /snapshot\.(configuration|devtools|models)/,
    "overlay must render configuration/models/migrations from the snapshot"
  );
  assert.match(runtimeSrc, /mergeAthenaDevtoolsFetchHeaders/);
  assert.match(overlaySrc, /mergeAthenaDevtoolsFetchHeaders/);
  assert.match(overlaySrc, /input instanceof Request \? input\.method/);
  assert.doesNotMatch(overlaySrc, /correlationTraceId/);
});

test("P?: Read database settings from AthenaClientConfig", async () => {
  const fromDatabaseUrl = await produceAthenaDevtoolsSnapshot({
    databaseUrl:
      "postgres://athena:supersecret_db_password@127.0.0.1:5432/athena",
    models: { users },
  });
  const fromDatabaseUrlSetting = databaseSetting(fromDatabaseUrl);
  assert.ok(fromDatabaseUrlSetting, "database setting must exist");
  assert.equal(
    fromDatabaseUrlSetting.configured,
    "set",
    "AthenaClientConfig.databaseUrl must mark database configured"
  );
  assert.equal(fromDatabaseUrlSetting.effective, "set");

  const fromPgUri = await produceAthenaDevtoolsSnapshot({
    db: {
      pgUri: "postgres://athena:supersecret_db_password@127.0.0.1:5432/athena",
    },
    models: { users },
  });
  const fromPgUriSetting = databaseSetting(fromPgUri);
  assert.ok(fromPgUriSetting, "database setting must exist for db.pgUri");
  assert.equal(
    fromPgUriSetting.configured,
    "set",
    "AthenaClientConfig.db.pgUri must mark database configured"
  );

  const fromDbUrl = await produceAthenaDevtoolsSnapshot({
    db: {
      url: "postgres://athena:supersecret_db_password@127.0.0.1:5432/athena",
    },
    models: { users },
  });
  const fromDbUrlSetting = databaseSetting(fromDbUrl);
  assert.ok(fromDbUrlSetting, "database setting must exist for db.url");
  assert.equal(
    fromDbUrlSetting.configured,
    "set",
    "AthenaClientConfig.db.url must mark database configured"
  );
});

test("P?: Compare the live catalog before declaring it available", async () => {
  const noise = await produceAthenaDevtoolsSnapshot({
    liveCatalog: { notACatalog: true },
    models: { users },
  });
  assert.equal(
    noise.models.liveCatalog,
    "unavailable",
    "a non-catalog object must not be declared available"
  );
  assert.equal(noise.models.drift.length, 0);

  const missingTable = await produceAthenaDevtoolsSnapshot({
    liveCatalog: { tables: [] },
    models: { users },
  });
  assert.equal(missingTable.models.liveCatalog, "available");
  assert.ok(
    missingTable.models.drift.some(
      (entry) =>
        entry.kind === "missing-table" && entry.object.includes("users")
    ),
    "attached users table missing from live catalog must be missing-table drift"
  );

  const mismatched = await produceAthenaDevtoolsSnapshot({
    liveCatalog: {
      tables: [
        {
          fields: [
            { name: "id", type: "int" },
            { name: "email", type: "string" },
          ],
          schema: "public",
          table: "users",
        },
      ],
    },
    models: { users },
  });
  assert.equal(mismatched.models.liveCatalog, "available");
  assert.ok(
    mismatched.models.drift.some(
      (entry) => entry.kind === "type-mismatch" && entry.object.includes("id")
    ),
    "mismatched id column type must be type-mismatch drift"
  );
  assert.ok(
    mismatched.models.drift.some(
      (entry) =>
        entry.kind === "missing-column" && entry.object.includes("name")
    ),
    "attached name column missing from live catalog must be missing-column drift"
  );
});

test("P?: Resolve migration paths against the supplied cwd", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-devtools-cwd-"));
  const directory = join(root, "athena", "migrations");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "0001_init.sql"), "-- init\n", "utf8");

  const snapshot = await produceAthenaDevtoolsSnapshot({
    cwd: root,
    migrations: { directory: "athena/migrations" },
    models: { users },
  });
  assert.equal(
    snapshot.migrations.localFileCount,
    1,
    "relative migrations.directory must resolve against the supplied cwd"
  );
  assert.equal(snapshot.migrations.files.length, 1);
  assert.equal(snapshot.migrations.files[0]?.filename, "0001_init.sql");
});

test("P?: Read trusted origins from the canonical auth security config", async () => {
  const snapshot = await produceAthenaDevtoolsSnapshot({
    auth: {
      security: {
        trustedOrigins: ["https://app.example.com"],
      },
    },
    models: { users },
  });
  const trusted = snapshot.configuration.settings.find(
    (row) =>
      row.path === "auth.security.trustedOrigins" ||
      row.path === "auth.passkey.trustedOrigins"
  );
  assert.ok(trusted, "trustedOrigins setting must exist");
  assert.equal(
    trusted.path,
    "auth.security.trustedOrigins",
    "inspector must read auth.security.trustedOrigins, not auth.passkey.trustedOrigins"
  );
  assert.equal(trusted.configured, "set");
  assert.equal(trusted.effective, "set");
  assert.notEqual(trusted.source, "unset");
});

test("P?: Derive effective auth mode from the resolved runtime plan", async () => {
  const snapshot = await produceAthenaDevtoolsSnapshot({
    auth: {},
    databaseUrl: "postgres://athena:secret@127.0.0.1:5432/athena",
  });
  const authMode = snapshot.configuration.settings.find(
    (row) => row.path === "auth.mode"
  );
  assert.ok(authMode, "auth.mode provenance row required");
  assert.equal(authMode.configured, "unset");
  assert.equal(authMode.inferred, "set");
  assert.equal(authMode.effective, "set");
  assert.equal(authMode.source, "runtime-plan");
  assert.equal(authMode.stages.runtime.kind, "structural");
  assert.equal(
    authMode.stages.runtime.kind === "structural"
      ? authMode.stages.runtime.value
      : null,
    "embedded"
  );
});

test("P?: Report migration state only from the migration ledger", async () => {
  const { ATHENA_SCHEMA_IR_VERSION } = await import(
    "../src/schema/ir/version.ts"
  );
  const root = mkdtempSync(join(tmpdir(), "athena-devtools-ledger-"));
  const directory = join(root, "athena", "migrations");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "0001_init.sql"), "-- init\n", "utf8");
  writeFileSync(join(directory, "0002_users.sql"), "-- users\n", "utf8");

  const withoutLedger = await produceAthenaDevtoolsSnapshot({
    cwd: root,
    migrations: { directory: "athena/migrations" },
  });
  assert.equal(withoutLedger.migrations.files.length, 2);
  assert.equal(
    withoutLedger.migrations.pending.length,
    0,
    "must not label discovered files pending without a ledger"
  );
  assert.equal(withoutLedger.migrations.applied.length, 0);
  assert.equal(withoutLedger.migrations.latestApplied, null);
  assert.notEqual(
    withoutLedger.migrations.schemaVersion,
    ATHENA_SCHEMA_IR_VERSION,
    "migration schemaVersion must not be the Schema IR document version"
  );

  const withLedger = await produceAthenaDevtoolsSnapshot({
    appliedMigrations: [{ name: "init", version: 1 }],
    cwd: root,
    migrations: { directory: "athena/migrations" },
  });
  assert.equal(withLedger.migrations.applied.length, 1);
  assert.equal(withLedger.migrations.applied[0]?.version, 1);
  assert.equal(withLedger.migrations.pending.length, 1);
  assert.equal(withLedger.migrations.pending[0]?.version, 2);
  assert.equal(withLedger.migrations.latestApplied, 1);
});

test("P?: Decode Schema IR v2 columns before reporting drift", async () => {
  const liveCatalog = schemaIrFromModels({ users });
  const snapshot = await produceAthenaDevtoolsSnapshot({
    liveCatalog,
    models: { users },
  });
  assert.equal(snapshot.models.liveCatalog, "available");
  const missingColumns = snapshot.models.drift.filter(
    (entry) => entry.kind === "missing-column"
  );
  assert.equal(
    missingColumns.length,
    0,
    `IR v2 liveCatalog must not mark real columns missing-column: ${JSON.stringify(missingColumns)}`
  );
});

test("P?: Apply access controls to the event channel", async () => {
  const seeder = createAthenaDataHandlers({
    security: { mode: "trusted" },
    transport: createRecordingTransport(),
    unsafeAllowUnauthenticated: true,
  });
  const insert = await seeder.POST(
    new Request("https://app.example/api/athena/gateway/insert", {
      body: JSON.stringify({
        insert_body: { email: "secret@example.com" },
        table_name: "users",
      }),
      headers: {
        "content-type": "application/json",
        "x-athena-devtools": "1",
        "x-athena-trace-id": "trace-other-user-ops",
      },
      method: "POST",
    })
  );
  assert.equal(insert.status, 200);

  async function lookupSession(
    token: string
  ): Promise<AthenaRuntimeSessionLookup | null> {
    if (token !== "sess_a") {
      return null;
    }
    return {
      session: { id: "session-a", userId: "user-a" },
      user: { id: "user-a" },
    };
  }

  const authenticated = createAthenaDataHandlers({
    auth: { lookupSession, mode: "athena-session" },
    security: { mode: "authenticated" },
    transport: createRecordingTransport(),
  });
  const unauthenticated = await authenticated.GET(
    new Request("https://app.example/api/athena/devtools/v1/events?limit=50")
  );
  assert.equal(
    unauthenticated.status,
    401,
    "unauthenticated same-origin GET must not read the process-global event buffer"
  );
  const denied: unknown = await unauthenticated.json();
  const deniedBlob = JSON.stringify(denied);
  assert.equal(deniedBlob.includes("trace-other-user-ops"), false);
  assert.equal(deniedBlob.includes("secret@example.com"), false);
  assert.ok(isRecord(denied) && isRecord(denied.error));
  assert.equal(denied.error.code, "ATHENA_AUTH_REQUIRED");

  const allowed = await authenticated.GET(
    new Request("https://app.example/api/athena/devtools/v1/events?limit=50", {
      headers: {
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_a`,
      },
    })
  );
  assert.equal(allowed.status, 200);
});

test("P?: Preserve ledger-only applied migrations", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-devtools-ledger-only-"));
  const directory = join(root, "athena", "migrations");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "0002_users.sql"), "-- users\n", "utf8");

  const snapshot = await produceAthenaDevtoolsSnapshot({
    appliedMigrations: [
      {
        filename: "0001_init.sql",
        generatedBy: "Manual",
        name: "init",
        version: 1,
      },
    ],
    cwd: root,
    migrations: { directory: "athena/migrations" },
  });
  assert.equal(snapshot.migrations.latestApplied, 1);
  assert.equal(
    snapshot.migrations.applied.length,
    1,
    "applied must keep the ledger row when the local SQL file was renamed or removed"
  );
  assert.equal(snapshot.migrations.applied[0]?.version, 1);
  assert.equal(snapshot.migrations.applied[0]?.filename, "0001_init.sql");
  assert.equal(snapshot.migrations.applied[0]?.name, "init");
  assert.equal(snapshot.migrations.pending.length, 1);
  assert.equal(snapshot.migrations.pending[0]?.version, 2);
  assert.equal(snapshot.migrations.pending[0]?.filename, "0002_users.sql");
});

test("P2: inspector shows effective passkey rpId inferred from app.url", async () => {
  const snapshot = await produceAthenaDevtoolsSnapshot({
    app: { url: "https://app.example.com" },
    auth: { mode: "local" },
  });
  const rp = snapshot.configuration.settings.find(
    (setting) => setting.path === "auth.passkey.rpId"
  );
  assert.ok(rp);
  assert.equal(rp.configured, "unset");
  assert.equal(rp.effective, "set");
  assert.equal(rp.inferred, "set");
  assert.equal(rp.source, "createClient");
  assert.equal(rp.stages.runtime.kind, "structural");
  if (rp.stages.runtime.kind === "structural") {
    assert.equal(rp.stages.runtime.value, "app.example.com");
  }
});

test("P1: live catalog and applied ledger load only through an explicit postgres loader", async () => {
  const resolved = await resolveAthenaDevtoolsProduceInput(
    {
      database: { url: "postgres://inspector.example/athena" },
    },
    {
      loadLiveAuthorities: async (databaseUrl) => {
        assert.equal(databaseUrl, "postgres://inspector.example/athena");
        return {
          appliedMigrations: [{ name: "init", version: 1 }],
          liveCatalog: schemaIrFromModels([users]),
        };
      },
    }
  );
  const snapshot = await produceAthenaDevtoolsSnapshot(resolved);
  assert.equal(snapshot.models.liveCatalog, "available");
  assert.equal(snapshot.migrations.latestApplied, 1);
  assert.equal(snapshot.migrations.applied[0]?.name, "init");

  const skipped = await resolveAthenaDevtoolsProduceInput({
    database: { url: "postgres://inspector.example/athena" },
  });
  const skippedSnapshot = await produceAthenaDevtoolsSnapshot(skipped);
  assert.equal(skippedSnapshot.models.liveCatalog, "unavailable");
  assert.equal(skippedSnapshot.migrations.applied.length, 0);
});
