import assert from "node:assert/strict";
import test from "node:test";
import {
  ATHENA_TABLE_SCHEMA_ROUTE,
  type AthenaTableCatalogQueryClient,
  type AthenaTableSchemaConfig,
  buildAthenaTableCatalogQueries,
  createAthenaTableSchemaHandlers,
  fetchAthenaTableCatalog,
  hasAthenaTableSchemaCredentials,
  isAthenaTableSchemaConfig,
  parseAthenaTableSchemaScope,
} from "../src/tables/index.ts";

const validConfig: AthenaTableSchemaConfig = {
  clientName: "demo",
  gatewayDatabase: "app_db",
  gatewayKey: "key-1",
  gatewayUrl: "https://gateway.example.com",
  schemaScope: "public, athena, public",
};

test("parseAthenaTableSchemaScope trims and dedupes", () => {
  assert.deepEqual(parseAthenaTableSchemaScope(validConfig.schemaScope), [
    "public",
    "athena",
  ]);
  assert.deepEqual(parseAthenaTableSchemaScope("  "), []);
});

test("isAthenaTableSchemaConfig validates required string fields", () => {
  assert.equal(isAthenaTableSchemaConfig(validConfig), true);
  assert.equal(isAthenaTableSchemaConfig(null), false);
  assert.equal(
    isAthenaTableSchemaConfig({
      ...validConfig,
      gatewayUrl: 1,
    }),
    false
  );
});

test("hasAthenaTableSchemaCredentials rejects blank credentials", () => {
  assert.equal(hasAthenaTableSchemaCredentials(validConfig), true);
  assert.equal(
    hasAthenaTableSchemaCredentials({
      ...validConfig,
      gatewayKey: "   ",
    }),
    false
  );
});

test("buildAthenaTableCatalogQueries inlines schema literals", () => {
  const queries = buildAthenaTableCatalogQueries(["public", "app's"]);
  assert.match(queries.columns, /ARRAY\['public', 'app''s'\]::text\[\]/);
  assert.match(queries.primaryKeys, /ARRAY\['public', 'app''s'\]::text\[\]/);
  assert.match(queries.foreignKeys, /ARRAY\['public', 'app''s'\]::text\[\]/);
  assert.doesNotMatch(queries.columns, /\$1::text\[\]/);
});

test("buildAthenaTableCatalogQueries uses postgres-introspection SSOT SQL", () => {
  const queries = buildAthenaTableCatalogQueries(["public"]);
  // Full column catalog from schema/postgres-introspection-core (not the old slim SELECT).
  assert.match(queries.columns, /t\.typname AS udt_name/);
  assert.match(queries.columns, /a\.attndims AS array_dimensions/);
  assert.match(queries.foreignKeys, /source_is_unique/);
});

test("POST handler rejects invalid body", async () => {
  const { POST } = createAthenaTableSchemaHandlers();
  const response = await POST(
    new Request(`https://app.example.com${ATHENA_TABLE_SCHEMA_ROUTE}`, {
      body: JSON.stringify({ config: { gatewayUrl: "x" } }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? "", /invalid/i);
});

test("POST handler rejects empty credentials", async () => {
  const { POST } = createAthenaTableSchemaHandlers();
  const response = await POST(
    new Request(`https://app.example.com${ATHENA_TABLE_SCHEMA_ROUTE}`, {
      body: JSON.stringify({
        config: {
          ...validConfig,
          gatewayKey: "",
        },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? "", /required/i);
});

test("POST handler returns catalog from injected client queries", async () => {
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql);
      // Column catalog query only (PK/FK also reference pg_attribute).
      if (sql.includes("format_type(a.atttypid")) {
        return {
          data: [
            {
              column_name: "id",
              data_type: "uuid",
              is_nullable: false,
              schema_name: "public",
              table_name: "users",
            },
            {
              column_name: "email",
              data_type: "text",
              is_nullable: true,
              schema_name: "public",
              table_name: "users",
            },
          ],
          error: null,
          raw: null,
          status: 200,
        };
      }
      if (sql.includes("con.contype = 'p'")) {
        return {
          data: [
            {
              columns: ["id"],
              schema_name: "public",
              table_name: "users",
            },
          ],
          error: null,
          raw: null,
          status: 200,
        };
      }
      return {
        data: [],
        error: null,
        raw: null,
        status: 200,
      };
    },
  };

  const { POST } = createAthenaTableSchemaHandlers({
    client: client as AthenaTableCatalogQueryClient,
  });
  const response = await POST(
    new Request(`https://app.example.com${ATHENA_TABLE_SCHEMA_ROUTE}`, {
      body: JSON.stringify({ config: validConfig }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 3);

  const body = (await response.json()) as {
    database: string;
    tables: Array<{
      id: string;
      primaryKey: string[];
      columns: Array<{ name: string; isPrimaryKey: boolean }>;
    }>;
  };
  assert.equal(body.database, "app_db");
  assert.equal(body.tables.length, 1);
  assert.equal(body.tables[0]?.id, "public.users");
  assert.deepEqual(body.tables[0]?.primaryKey, ["id"]);
  assert.equal(
    body.tables[0]?.columns.find((c) => c.name === "id")?.isPrimaryKey,
    true
  );
});

test("fetchAthenaTableCatalog surfaces gateway errors", async () => {
  const client = {
    async query() {
      return {
        data: null,
        error: { message: "boom" },
        status: 500,
      };
    },
  } as unknown as AthenaTableCatalogQueryClient;

  await assert.rejects(
    () => fetchAthenaTableCatalog(validConfig, { client }),
    /boom/
  );
});

test("POST handler maps catalog errors to 500", async () => {
  const client = {
    async query() {
      throw new Error("network down");
    },
  } as unknown as AthenaTableCatalogQueryClient;
  const { POST } = createAthenaTableSchemaHandlers({ client });
  const response = await POST(
    new Request(`https://app.example.com${ATHENA_TABLE_SCHEMA_ROUTE}`, {
      body: JSON.stringify({ config: validConfig }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 500);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "network down");
});
