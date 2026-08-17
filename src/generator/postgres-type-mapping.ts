import type { IntrospectionColumn } from "../schema/types.ts";

const NUMBER_TYPES = new Set([
  "int2",
  "int4",
  "float4",
  "float8",
  "smallint",
  "integer",
  "real",
  "double precision",
]);

const STRING_NUMERIC_TYPES = new Set([
  "int8",
  "bigint",
  "serial8",
  "bigserial",
  "numeric",
  "decimal",
  "money",
]);

const TEXT_TYPES = new Set([
  "char",
  "bpchar",
  "varchar",
  "character varying",
  "text",
  "citext",
  "name",
  "uuid",
  "date",
  "time",
  "timetz",
  "timestamp",
  "timestamptz",
  "interval",
  "inet",
  "cidr",
  "macaddr",
  "macaddr8",
  "point",
  "line",
  "lseg",
  "box",
  "path",
  "polygon",
  "circle",
  "bit",
  "varbit",
  "xml",
  "tsvector",
  "tsquery",
  "jsonpath",
]);

function normalizeTypeLabel(column: IntrospectionColumn): string {
  const preferred = (column.udtName || column.dataType).toLowerCase().trim();
  if (column.arrayDimensions > 0 && preferred.startsWith("_")) {
    return preferred.slice(1);
  }
  return preferred;
}

function wrapArrayType(baseType: string, depth: number): string {
  let wrapped = baseType;
  for (let index = 0; index < depth; index += 1) {
    wrapped = `Array<${wrapped}>`;
  }
  return wrapped;
}

function resolveScalarType(column: IntrospectionColumn): string {
  const label = normalizeTypeLabel(column);

  if (NUMBER_TYPES.has(label)) {
    return "number";
  }

  if (STRING_NUMERIC_TYPES.has(label)) {
    return "string";
  }

  if (label === "bool" || label === "boolean") {
    return "boolean";
  }

  if (label === "bytea") {
    return "Buffer";
  }

  if (label === "json" || label === "jsonb") {
    return "Record<string, unknown>";
  }

  if (TEXT_TYPES.has(label)) {
    return "string";
  }

  if (label.endsWith("range") || label.endsWith("multirange")) {
    return "string";
  }

  return "unknown";
}

function resolveKindAwareType(column: IntrospectionColumn): string {
  if (column.typeKind === "enum") {
    const values = column.enumValues ?? [];
    if (values.length === 0) {
      return "string";
    }
    return values
      .map((value) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`)
      .join(" | ");
  }

  if (column.typeKind === "composite") {
    return "Record<string, unknown>";
  }

  if (
    column.typeKind === "domain" ||
    column.typeKind === "range" ||
    column.typeKind === "multirange"
  ) {
    return "string";
  }

  return resolveScalarType(column);
}

export function resolvePostgresColumnType(column: IntrospectionColumn): string {
  const baseType = resolveKindAwareType(column);
  if (!column.arrayDimensions || column.arrayDimensions <= 0) {
    return baseType;
  }
  return wrapArrayType(baseType, column.arrayDimensions);
}
