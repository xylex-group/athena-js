import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { resolveGeneratorProvider } from "../src/generator/index.ts";

type QueryResultRow = Record<string, unknown>;

interface GatewayCall {
  body: { query: string };
  method: string;
  url: string;
}

interface GatewayFetchMockOptions {
  foreignKeysAsStringLiterals?: boolean;
}

function createMinimalPgCatalogMock() {
  return async (sqlText: string) => {
    if (sqlText.includes("FROM pg_attribute")) {
      const rows: QueryResultRow[] = [
        {
          array_dimensions: 0,
          column_name: "id",
          data_type: "uuid",
          has_default: false,
          is_generated: false,
          is_nullable: false,
          schema_name: "public",
          table_name: "users",
          type_kind_code: "b",
          type_oid: 1,
          udt_name: "uuid",
        },
        {
          array_dimensions: 0,
          column_name: "email",
          data_type: "text",
          has_default: false,
          is_generated: false,
          is_nullable: false,
          schema_name: "public",
          table_name: "users",
          type_kind_code: "b",
          type_oid: 2,
          udt_name: "text",
        },
      ];
      return { rows };
    }

    if (
      sqlText.includes("FROM pg_type t") &&
      sqlText.includes("JOIN pg_enum")
    ) {
      return { rows: [] };
    }

    if (sqlText.includes("WHERE con.contype = 'p'")) {
      return {
        rows: [
          {
            columns: ["id"],
            schema_name: "public",
            table_name: "users",
          },
        ],
      };
    }

    if (sqlText.includes("WHERE con.contype = 'f'")) {
      return { rows: [] };
    }

    if (sqlText.includes("con.contype = 'u'")) {
      return { rows: [] };
    }

    if (sqlText.includes("FROM pg_index ix")) {
      return { rows: [] };
    }

    throw new Error(
      `Unexpected SQL in pg_url provider test: ${sqlText.slice(0, 80)}...`
    );
  };
}

function createGatewayFetchMock(options: GatewayFetchMockOptions = {}) {
  const calls: GatewayCall[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { query: string };
    calls.push({
      body: payload,
      method: String(init?.method ?? "GET"),
      url: String(url),
    });

    const sqlText = payload.query;
    if (sqlText.includes("FROM pg_attribute")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              array_dimensions: 0,
              column_name: "id",
              data_type: "uuid",
              has_default: false,
              is_generated: false,
              is_nullable: false,
              schema_name: "public",
              table_name: "users",
              type_kind_code: "b",
              type_oid: 1,
              udt_name: "uuid",
            },
            {
              array_dimensions: 0,
              column_name: "email",
              data_type: "text",
              has_default: false,
              is_generated: false,
              is_nullable: false,
              schema_name: "public",
              table_name: "users",
              type_kind_code: "b",
              type_oid: 2,
              udt_name: "text",
            },
          ],
          error: null,
          status: 200,
        }),
        { status: 200 }
      );
    }

    if (
      sqlText.includes("FROM pg_type t") &&
      sqlText.includes("JOIN pg_enum")
    ) {
      return new Response(
        JSON.stringify({
          data: [],
          error: null,
          status: 200,
        }),
        { status: 200 }
      );
    }

    if (sqlText.includes("WHERE con.contype = 'p'")) {
      return new Response(
        JSON.stringify({
          data: [
            { columns: ["id"], schema_name: "public", table_name: "users" },
          ],
          error: null,
          status: 200,
        }),
        { status: 200 }
      );
    }

    if (sqlText.includes("WHERE con.contype = 'f'")) {
      const foreignKeyRows = options.foreignKeysAsStringLiterals
        ? [
            {
              constraint_name: "profile_user_fk",
              source_columns: "{user_id}",
              source_is_unique: true,
              source_schema: "public",
              source_table: "profiles",
              target_columns: "{id}",
              target_schema: "public",
              target_table: "users",
            },
          ]
        : [];

      return new Response(
        JSON.stringify({
          data: foreignKeyRows,
          error: null,
          status: 200,
        }),
        { status: 200 }
      );
    }

    if (sqlText.includes("WHERE con.contype = 'u'")) {
      return new Response(
        JSON.stringify({
          data: [],
          error: null,
          status: 200,
        }),
        { status: 200 }
      );
    }

    if (sqlText.includes("FROM pg_index")) {
      return new Response(
        JSON.stringify({
          data: [],
          error: null,
          status: 200,
        }),
        { status: 200 }
      );
    }

    return new Response(
      JSON.stringify({
        error: `Unexpected SQL in gateway provider test: ${sqlText.slice(0, 80)}...`,
      }),
      { status: 400 }
    );
  };

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test("resolveGeneratorProvider supports direct postgres provider from pg_url connection strings", async () => {
  const originalQuery = Pool.prototype.query;
  const originalEnd = Pool.prototype.end;
  (Pool.prototype.query as unknown as (
    sql: string
  ) => Promise<{ rows: QueryResultRow[] }>) = createMinimalPgCatalogMock();
  (Pool.prototype.end as unknown as () => Promise<void>) = async () =>
    undefined;

  try {
    const provider = resolveGeneratorProvider(
      {
        connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
        database: "app_db",
        kind: "postgres",
        mode: "direct",
      },
      {
        postgresGatewayIntrospection: false,
        scyllaProviderContracts: true,
      }
    );

    const snapshot = await provider.inspect({ schemas: ["public"] });
    assert.equal(snapshot.backend, "postgresql");
    assert.equal(snapshot.database, "app_db");
    assert.deepEqual(snapshot.schemas.public.tables.users.primaryKey, ["id"]);
  } finally {
    Pool.prototype.query = originalQuery;
    Pool.prototype.end = originalEnd;
  }
});

test("resolveGeneratorProvider direct postgres mode uses config schemas when inspect options are omitted", async () => {
  const originalQuery = Pool.prototype.query;
  const originalEnd = Pool.prototype.end;
  const schemaParams: unknown[] = [];

  (Pool.prototype.query as unknown as (
    ...args: unknown[]
  ) => Promise<{ rows: QueryResultRow[] }>) = async (
    sqlTextValue: unknown,
    values?: unknown
  ) => {
    const sqlText = String(sqlTextValue);
    if (Array.isArray(values)) {
      schemaParams.push(values[0]);
    }

    if (sqlText.includes("FROM pg_attribute")) {
      return {
        rows: [
          {
            array_dimensions: 0,
            column_name: "id",
            data_type: "uuid",
            has_default: false,
            is_generated: false,
            is_nullable: false,
            schema_name: "public",
            table_name: "users",
            type_kind_code: "b",
            type_oid: 1,
            udt_name: "uuid",
          },
          {
            array_dimensions: 0,
            column_name: "id",
            data_type: "uuid",
            has_default: false,
            is_generated: false,
            is_nullable: false,
            schema_name: "athena",
            table_name: "audit_log",
            type_kind_code: "b",
            type_oid: 1,
            udt_name: "uuid",
          },
        ],
      };
    }

    if (
      sqlText.includes("FROM pg_type t") &&
      sqlText.includes("JOIN pg_enum")
    ) {
      return { rows: [] };
    }

    if (sqlText.includes("WHERE con.contype = 'p'")) {
      return {
        rows: [
          { columns: ["id"], schema_name: "public", table_name: "users" },
          { columns: ["id"], schema_name: "athena", table_name: "audit_log" },
        ],
      };
    }

    if (sqlText.includes("WHERE con.contype = 'f'")) {
      return { rows: [] };
    }

    if (sqlText.includes("con.contype = 'u'")) {
      return { rows: [] };
    }

    if (sqlText.includes("FROM pg_index ix")) {
      return { rows: [] };
    }

    throw new Error(
      `Unexpected SQL in direct schema-selection test: ${sqlText.slice(0, 80)}...`
    );
  };
  (Pool.prototype.end as unknown as () => Promise<void>) = async () =>
    undefined;

  try {
    const provider = resolveGeneratorProvider(
      {
        connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
        database: "app_db",
        kind: "postgres",
        mode: "direct",
        schemas: [" public ", "athena", "public"],
      },
      {
        postgresGatewayIntrospection: false,
        scyllaProviderContracts: true,
      }
    );

    const snapshot = await provider.inspect();
    assert.deepEqual(schemaParams.find(Array.isArray), ["public", "athena"]);
    assert.deepEqual(snapshot.schemas.athena.tables.audit_log.primaryKey, [
      "id",
    ]);
  } finally {
    Pool.prototype.query = originalQuery;
    Pool.prototype.end = originalEnd;
  }
});

test("resolveGeneratorProvider supports gateway-only postgres introspection over /gateway/query", async () => {
  const { calls, restore } = createGatewayFetchMock();

  try {
    const provider = resolveGeneratorProvider(
      {
        apiKey: "secret",
        database: "app_db",
        gatewayUrl: "https://athena-db.com",
        kind: "postgres",
        mode: "gateway",
      },
      {
        postgresGatewayIntrospection: true,
        scyllaProviderContracts: true,
      }
    );

    const snapshot = await provider.inspect({ schemas: ["public"] });

    assert.equal(snapshot.backend, "postgresql");
    assert.equal(snapshot.database, "app_db");
    assert.deepEqual(snapshot.schemas.public.tables.users.primaryKey, ["id"]);
    assert.equal(calls.length, 6);
    assert.equal(
      calls.every((call) => call.url.endsWith("/gateway/query")),
      true
    );
    assert.equal(
      calls.every((call) => call.method === "POST"),
      true
    );
    assert.equal(
      calls.some((call) => call.body.query.includes("pg_attribute")),
      true
    );
    assert.equal(
      calls.some((call) => call.body.query.includes("ARRAY['public']::text[]")),
      true
    );
  } finally {
    restore();
  }
});

test("resolveGeneratorProvider gateway mode normalizes config schemas when inspect options are omitted", async () => {
  const { calls, restore } = createGatewayFetchMock();

  try {
    const provider = resolveGeneratorProvider(
      {
        apiKey: "secret",
        database: "app_db",
        gatewayUrl: "https://athena-db.com",
        kind: "postgres",
        mode: "gateway",
        schemas: " public, athena, public ",
      },
      {
        postgresGatewayIntrospection: true,
        scyllaProviderContracts: true,
      }
    );

    await provider.inspect();
    assert.equal(
      calls.some((call) =>
        call.body.query.includes("ARRAY['public', 'athena']::text[]")
      ),
      true
    );
  } finally {
    restore();
  }
});

test("resolveGeneratorProvider gateway mode normalizes string-literal foreign key arrays", async () => {
  const { restore } = createGatewayFetchMock({
    foreignKeysAsStringLiterals: true,
  });

  try {
    const provider = resolveGeneratorProvider(
      {
        apiKey: "secret",
        database: "app_db",
        gatewayUrl: "https://athena-db.com",
        kind: "postgres",
        mode: "gateway",
      },
      {
        postgresGatewayIntrospection: true,
        scyllaProviderContracts: true,
      }
    );

    const snapshot = await provider.inspect({ schemas: ["public"] });
    const profilesRelation = Object.values(
      snapshot.schemas.public.tables.profiles.relations
    ).find((relation) => relation.targetModel === "users");
    const usersRelation = Object.values(
      snapshot.schemas.public.tables.users.relations
    ).find((relation) => relation.targetModel === "profiles");

    assert.ok(profilesRelation);
    assert.ok(usersRelation);

    assert.deepEqual(profilesRelation.sourceColumns, ["user_id"]);
    assert.deepEqual(profilesRelation.targetColumns, ["id"]);
    assert.deepEqual(usersRelation.sourceColumns, ["id"]);
    assert.deepEqual(usersRelation.targetColumns, ["user_id"]);
  } finally {
    restore();
  }
});

test("resolveGeneratorProvider gateway mode works without experimental postgres flag", async () => {
  const { restore } = createGatewayFetchMock();

  try {
    const provider = resolveGeneratorProvider(
      {
        apiKey: "secret",
        database: "app_db",
        gatewayUrl: "https://athena-db.com",
        kind: "postgres",
        mode: "gateway",
      },
      {
        postgresGatewayIntrospection: false,
        scyllaProviderContracts: true,
      }
    );

    const snapshot = await provider.inspect({ schemas: ["public"] });
    assert.equal(snapshot.backend, "postgresql");
    assert.equal(snapshot.database, "app_db");
  } finally {
    restore();
  }
});

test("resolveGeneratorProvider rejects scylla when experimental contracts are disabled", () => {
  assert.throws(
    () =>
      resolveGeneratorProvider(
        {
          contactPoints: ["127.0.0.1"],
          keyspace: "app_ks",
          kind: "scylla",
          mode: "direct",
        },
        {
          postgresGatewayIntrospection: false,
          scyllaProviderContracts: false,
        }
      ),
    /Scylla provider contracts are disabled/
  );
});

test("resolveGeneratorProvider scylla placeholder throws not-implemented on inspect", async () => {
  const provider = resolveGeneratorProvider(
    {
      contactPoints: ["127.0.0.1"],
      keyspace: "app_ks",
      kind: "scylla",
      mode: "direct",
    },
    {
      postgresGatewayIntrospection: false,
      scyllaProviderContracts: true,
    }
  );

  assert.equal(provider.backend, "scylladb");
  await assert.rejects(
    () => provider.inspect(),
    /Scylla introspection provider is not implemented yet for keyspace app_ks/
  );
});

test("resolveGeneratorProvider gateway mode bubbles structured query failures", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: null,
        error: { message: "catalog role denied" },
        status: 403,
      }),
      { status: 403 }
    );

  try {
    const provider = resolveGeneratorProvider(
      {
        apiKey: "secret",
        database: "app_db",
        gatewayUrl: "https://athena-db.com",
        kind: "postgres",
        mode: "gateway",
      },
      {
        postgresGatewayIntrospection: false,
        scyllaProviderContracts: true,
      }
    );

    await assert.rejects(
      () => provider.inspect({ schemas: ["public"] }),
      /catalog role denied/
    );
  } finally {
    globalThis.fetch = original;
  }
});
