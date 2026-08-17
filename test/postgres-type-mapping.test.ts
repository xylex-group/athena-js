import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { resolvePostgresColumnType } from "../src/generator/index.ts";
import type { IntrospectionColumn } from "../src/schema/index.ts";

function column(
  dataType: string,
  udtName: string,
  typeKind: IntrospectionColumn["typeKind"] = "scalar",
  arrayDimensions = 0,
  enumValues?: string[]
): IntrospectionColumn {
  return {
    arrayDimensions,
    dataType,
    enumValues,
    hasDefault: false,
    isGenerated: false,
    isNullable: false,
    isPrimaryKey: false,
    name: "col",
    typeKind,
    udtName,
  };
}

test("resolvePostgresColumnType covers scalar families and advanced postgres datatypes", () => {
  const cases: Array<{ input: IntrospectionColumn; expected: string }> = [
    { expected: "number", input: column("smallint", "int2") },
    { expected: "number", input: column("integer", "int4") },
    { expected: "string", input: column("bigint", "int8") },
    { expected: "string", input: column("numeric", "numeric") },
    { expected: "boolean", input: column("boolean", "bool") },
    { expected: "Buffer", input: column("bytea", "bytea") },
    { expected: "string", input: column("uuid", "uuid") },
    { expected: "Record<string, unknown>", input: column("jsonb", "jsonb") },
    {
      expected: "string",
      input: column("timestamp with time zone", "timestamptz"),
    },
    { expected: "string", input: column("inet", "inet") },
    { expected: "string", input: column("point", "point") },
    { expected: "string", input: column("bit varying", "varbit") },
    { expected: "string", input: column("xml", "xml") },
    { expected: "string", input: column("tsvector", "tsvector") },
    { expected: "string", input: column("int4range", "int4range", "range") },
    {
      expected: "string",
      input: column("int4multirange", "int4multirange", "multirange"),
    },
    {
      expected: "Record<string, unknown>",
      input: column("address_type", "address_type", "composite"),
    },
    {
      expected: "'happy' | 'sad'",
      input: column("mood", "mood", "enum", 0, ["happy", "sad"]),
    },
    {
      expected: "Array<string>",
      input: column("text[]", "_text", "scalar", 1),
    },
    {
      expected: "Array<Array<number>>",
      input: column("int4[][]", "_int4", "scalar", 2),
    },
  ];

  for (const entry of cases) {
    assert.equal(resolvePostgresColumnType(entry.input), entry.expected);
  }
});
