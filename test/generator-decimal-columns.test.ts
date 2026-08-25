import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  defineAthenaConfig,
  generateArtifactsFromSnapshot,
} from "../src/generator/index.ts";
import type { IntrospectionSnapshot } from "../src/schema/index.ts";

const snapshot: IntrospectionSnapshot = {
  backend: "postgresql",
  database: "shop",
  generatedAt: "2026-08-19T00:00:00.000Z",
  schemas: {
    public: {
      name: "public",
      tables: {
        products: {
          columns: {
            id: {
              arrayDimensions: 0,
              dataType: "integer",
              hasDefault: false,
              isGenerated: false,
              isNullable: false,
              isPrimaryKey: true,
              name: "id",
              typeKind: "scalar",
              udtName: "int4",
            },
            price: {
              arrayDimensions: 0,
              dataType: "numeric(12,2)",
              hasDefault: false,
              isGenerated: false,
              isNullable: true,
              isPrimaryKey: false,
              name: "price",
              numericPrecision: 12,
              numericScale: 2,
              typeKind: "scalar",
              udtName: "numeric",
            },
            unit_cost: {
              arrayDimensions: 0,
              dataType: "decimal",
              hasDefault: false,
              isGenerated: false,
              isNullable: false,
              isPrimaryKey: false,
              name: "unit_cost",
              typeKind: "scalar",
              udtName: "decimal",
            },
            list_price: {
              arrayDimensions: 0,
              dataType: "money",
              hasDefault: false,
              isGenerated: false,
              isNullable: false,
              isPrimaryKey: false,
              name: "list_price",
              typeKind: "scalar",
              udtName: "money",
            },
            quantity: {
              arrayDimensions: 0,
              dataType: "bigint",
              hasDefault: false,
              isGenerated: false,
              isNullable: false,
              isPrimaryKey: false,
              name: "quantity",
              typeKind: "scalar",
              udtName: "int8",
            },
            weight: {
              arrayDimensions: 0,
              dataType: "double precision",
              hasDefault: false,
              isGenerated: false,
              isNullable: false,
              isPrimaryKey: false,
              name: "weight",
              typeKind: "scalar",
              udtName: "float8",
            },
          },
          name: "products",
          primaryKey: ["id"],
          relations: {},
          schema: "public",
        },
      },
    },
  },
};

test("generator emits decimal() for NUMERIC/DECIMAL/MONEY and number() for floats/ints", () => {
  const artifacts = generateArtifactsFromSnapshot(
    snapshot,
    defineAthenaConfig({
      output: {
        format: "table-builder",
        preset: "athena-direct",
      },
      provider: {
        connectionString: "postgres://127.0.0.1:5432/shop",
        database: "shop",
        kind: "postgres",
        mode: "direct",
        schemas: ["public"],
      },
    })
  );

  const model = artifacts.files.find((file) => file.kind === "model");
  assert.ok(model);

  assert.match(model.content, /id: number\(\)/);
  assert.match(model.content, /weight: number\(\)/);
  assert.match(
    model.content,
    /price: decimal\(\{ precision: 12, scale: 2 \}\)\.optional\(\)/
  );
  assert.match(model.content, /unit_cost: decimal\(\)/);
  assert.match(model.content, /list_price: decimal\(\)/);
  assert.match(model.content, /quantity: string\(\)/);
  assert.doesNotMatch(model.content, /price: string\(\)/);
  assert.match(
    model.content,
    /import \{ decimal, number, string, table \} from/
  );
});

test("generator derives precision/scale from format_type when numericPrecision is omitted", () => {
  const derived: IntrospectionSnapshot = {
    ...snapshot,
    schemas: {
      public: {
        name: "public",
        tables: {
          products: {
            columns: {
              id: snapshot.schemas.public.tables.products.columns.id,
              amount: {
                arrayDimensions: 0,
                dataType: "numeric(8,3)",
                hasDefault: false,
                isGenerated: false,
                isNullable: false,
                isPrimaryKey: false,
                name: "amount",
                typeKind: "scalar",
                udtName: "numeric",
              },
            },
            name: "products",
            primaryKey: ["id"],
            relations: {},
            schema: "public",
          },
        },
      },
    },
  };

  const artifacts = generateArtifactsFromSnapshot(
    derived,
    defineAthenaConfig({
      output: { format: "table-builder", preset: "athena-direct" },
      provider: {
        connectionString: "postgres://127.0.0.1:5432/shop",
        database: "shop",
        kind: "postgres",
        mode: "direct",
        schemas: ["public"],
      },
    })
  );

  const model = artifacts.files.find((file) => file.kind === "model");
  assert.ok(model);
  assert.match(
    model.content,
    /amount: decimal\(\{ precision: 8, scale: 3 \}\)/
  );
});
