/**
 * Target — one shared AthenaResourceRef across Schema, Policy, model index,
 * and Data Nucleus. No generic `name`. Do not implement product code here.
 *
 * See docs/sdd/xylex/athena-resource-identity/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type {
  AthenaDeletePayload,
  AthenaGatewayCallOptions,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaQueryPayload,
  AthenaUpdatePayload,
} from "../../src/gateway/types.ts";
import { buildAthenaRuntimeModelIndex } from "../../src/runtime/data/model-registry.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";
import { string, table } from "../../src/schema/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const resourcePath = join(srcRoot, "schema", "resource.ts");

type ResourceModule = {
  canonicalAthenaResource: (ref: {
    database?: string;
    schema?: string;
    table: string;
  }) => string;
  parseAthenaResourceRef: (value: string) => {
    database?: string;
    schema?: string;
    table: string;
  };
  athenaResourceKeys: (ref: {
    database?: string;
    schema?: string;
    table: string;
  }) => string[];
  matchAthenaResource: (
    scope: { database?: string; schema?: string; table: string } | string,
    resolved: {
      canonicalResource: string;
      database?: string;
      schema?: string;
      table: string;
    }
  ) => boolean;
  resolveAthenaResourceFromPayload: (
    payload: unknown,
    modelIndex?: ReturnType<typeof buildAthenaRuntimeModelIndex>
  ) =>
    | {
        canonicalResource: string;
        database?: string;
        model?: string;
        schema?: string;
        table: string;
      }
    | undefined;
};

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

async function loadResourceModule(): Promise<ResourceModule> {
  assert.equal(existsSync(resourcePath), true, "src/schema/resource.ts");
  return (await import(pathToFileURL(resourcePath).href)) as ResourceModule;
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
      _payload: AthenaDeletePayload,
      _options?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
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
    async queryGateway<T>(
      _payload: AthenaQueryPayload
    ): Promise<AthenaGatewayResponse<T>> {
      return ok([{ sql: true }] as T);
    },
    async resolveCallOptions(options) {
      return options;
    },
    async rpcGateway<T>(): Promise<AthenaGatewayResponse<T>> {
      return ok([{ rpc: true }] as T);
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

test("P?: Schema owns AthenaResourceRef; PolicyResourceRef aliases it", async () => {
  const resource = await loadResourceModule();
  assert.equal(
    resource.canonicalAthenaResource({
      database: "main",
      schema: "auth",
      table: "users",
    }),
    "main.auth.users"
  );
  const policyTypes = readSrc("policy/types.ts");
  assert.match(
    policyTypes,
    /export type PolicyResourceRef = AthenaResourceRef/
  );
  const schemaIndex = readSrc("schema/index.ts");
  assert.match(schemaIndex, /AthenaResourceRef/);
  const policyIndex = readSrc("policy/index.ts");
  assert.match(policyIndex, /AthenaResourceRef/);
});

test("P?: shared resource vocabulary has no generic name field", async () => {
  const src = readFileSync(resourcePath, "utf8");
  assert.equal(/\bname\??:/.test(src), false);
  const parsed = (await loadResourceModule()).parseAthenaResourceRef(
    "main.auth.users"
  );
  assert.deepEqual(parsed, {
    database: "main",
    schema: "auth",
    table: "users",
  });
});

test("P?: runtime model index keeps database, model, and database-qualified canonical", () => {
  const index = buildAthenaRuntimeModelIndex(
    {
      User: {
        meta: {
          database: "main",
          model: "User",
          primaryKey: ["id"],
          schema: "auth",
          tableName: "users",
        },
      },
    },
    "strict"
  );
  const byQualified = index.get("auth.users");
  const byCanonical = index.get("main.auth.users");
  const byBare = index.get("users");
  assert.ok(byQualified);
  assert.equal(byQualified.database, "main");
  assert.equal(byQualified.model, "User");
  assert.equal(byQualified.schema, "auth");
  assert.equal(byQualified.table, "users");
  assert.equal(byQualified.canonicalResource, "main.auth.users");
  assert.equal(byCanonical, byQualified);
  assert.equal(byBare, byQualified);
});

test("P?: payload resource resolution uses the model index, not raw table_name", async () => {
  const { resolveAthenaResourceFromPayload, athenaResourceKeys } =
    await loadResourceModule();
  const index = buildAthenaRuntimeModelIndex(
    {
      User: {
        meta: {
          database: "main",
          model: "User",
          primaryKey: ["id"],
          schema: "auth",
          tableName: "users",
        },
      },
    },
    "strict"
  );
  const resolved = resolveAthenaResourceFromPayload(
    { table_name: "users" },
    index
  );
  assert.deepEqual(resolved, {
    canonicalResource: "main.auth.users",
    database: "main",
    model: "User",
    schema: "auth",
    table: "users",
  });
  assert.deepEqual(
    athenaResourceKeys({
      database: "main",
      schema: "auth",
      table: "users",
    }).sort(),
    ["main.auth.users", "auth.users", "users"].sort()
  );
});

test("P?: Data Nucleus hooks receive AthenaResolvedResource, not table-only", async () => {
  const users = table("users")
    .schema("auth")
    .columns({
      email: string(),
      id: string(),
    })
    .primaryKey("id");
  const model = {
    ...users,
    meta: {
      ...users.meta,
      database: "main",
      model: "User",
    },
  };
  let seen:
    | {
        database?: string;
        model?: string;
        resource?: {
          canonicalResource: string;
          database?: string;
          model?: string;
          schema?: string;
          table: string;
        };
        schema?: string;
        table?: string;
      }
    | undefined;
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        prepareInsert(event) {
          seen = event;
          return event.record;
        },
      },
    },
    modelEnforcement: "known-only",
    models: { users: model },
    security: { mode: "trusted" },
    transport: createRecordingTransport(),
  });
  const result = await runtime.execute({
    operation: "insert",
    payload: {
      insert_body: { email: "ada@example.com", id: "1" },
      table_name: "users",
    },
  });
  assert.equal(result.ok, true, result.error);
  assert.ok(seen?.resource);
  assert.equal(seen.resource.database, "main");
  assert.equal(seen.resource.schema, "auth");
  assert.equal(seen.resource.table, "users");
  assert.equal(seen.resource.model, "User");
  assert.equal(seen.resource.canonicalResource, "main.auth.users");
  assert.equal(seen.table, "users");
  assert.equal(seen.schema, "auth");
  assert.equal(seen.database, "main");
  assert.equal(seen.model, "User");
});

test("P?: resource shorthand normalizes to AthenaResourceRef", async () => {
  const { matchAthenaResource, parseAthenaResourceRef } =
    await loadResourceModule();
  assert.deepEqual(parseAthenaResourceRef("auth.users"), {
    schema: "auth",
    table: "users",
  });
  assert.equal(
    matchAthenaResource("auth.users", {
      canonicalResource: "main.auth.users",
      database: "main",
      schema: "auth",
      table: "users",
    }),
    true
  );
  assert.equal(
    matchAthenaResource(
      { schema: "public", table: "users" },
      {
        canonicalResource: "main.auth.users",
        database: "main",
        schema: "auth",
        table: "users",
      }
    ),
    false
  );
});

test("P?: multi-database same schema.table keeps qualified aliases and drops short ones", () => {
  const index = buildAthenaRuntimeModelIndex(
    {
      AnalyticsUser: {
        meta: {
          database: "analytics",
          model: "AnalyticsUser",
          primaryKey: ["id"],
          schema: "auth",
          tableName: "users",
        },
      },
      MainUser: {
        meta: {
          database: "main",
          model: "MainUser",
          primaryKey: ["id"],
          schema: "auth",
          tableName: "users",
        },
      },
    },
    "strict"
  );
  assert.equal(index.get("main.auth.users")?.database, "main");
  assert.equal(index.get("main.auth.users")?.model, "MainUser");
  assert.equal(index.get("analytics.auth.users")?.database, "analytics");
  assert.equal(index.get("analytics.auth.users")?.model, "AnalyticsUser");
  assert.equal(index.get("auth.users"), undefined);
  assert.equal(index.get("users"), undefined);
});

test("P?: database requires schema so two-part strings stay schema.table", async () => {
  const {
    canonicalAthenaResource,
    matchAthenaResource,
    parseAthenaResourceRef,
  } = await loadResourceModule();
  assert.equal(
    canonicalAthenaResource({ database: "main", table: "users" }),
    "users"
  );
  assert.deepEqual(parseAthenaResourceRef("main.users"), {
    schema: "main",
    table: "users",
  });
  assert.deepEqual(
    parseAthenaResourceRef(
      canonicalAthenaResource({
        database: "main",
        schema: "auth",
        table: "users",
      })
    ),
    {
      database: "main",
      schema: "auth",
      table: "users",
    }
  );
  assert.equal(
    matchAthenaResource("main.users", {
      canonicalResource: "users",
      database: "main",
      table: "users",
    }),
    false
  );
  const src = readFileSync(resourcePath, "utf8");
  assert.match(src, /export type AthenaResourceRef =/);
  assert.match(src, /schema: string; table: string; database\?: string/);
  assert.doesNotMatch(src, /if \(database && table && !schema\)/);
});
