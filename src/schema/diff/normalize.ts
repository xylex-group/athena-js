import {
  ATHENA_SCHEMA_SNAPSHOT_VERSION,
  type AthenaSchemaSnapshot,
  type SchemaColumn,
  type SchemaColumnType,
  type SchemaForeignKey,
  type SchemaIndex,
  type SchemaNamespace,
  type SchemaPrimaryKey,
  type SchemaReferentialAction,
  type SchemaTable,
  type SchemaUniqueConstraint,
} from "./types.ts";
import type { PostgresIntervalQualifier } from "../ir/type.ts";

/** Postgres type aliases → canonical names (representational noise only). */
const TYPE_ALIASES: Readonly<Record<string, string>> = {
  bigint: "bigint",
  bigserial: "bigint",
  bit: "bit",
  "bit varying": "varbit",
  bool: "boolean",
  boolean: "boolean",
  bpchar: "char",
  char: "char",
  character: "char",
  "character varying": "varchar",
  decimal: "numeric",
  "double precision": "double precision",
  float4: "real",
  float8: "double precision",
  int: "integer",
  int2: "smallint",
  int4: "integer",
  int8: "bigint",
  integer: "integer",
  numeric: "numeric",
  real: "real",
  serial: "integer",
  serial2: "smallint",
  serial4: "integer",
  serial8: "bigint",
  smallint: "smallint",
  smallserial: "smallint",
  time: "time",
  "time with time zone": "timetz",
  "time without time zone": "time",
  timestamp: "timestamp",
  "timestamp with time zone": "timestamptz",
  "timestamp without time zone": "timestamp",
  timestamptz: "timestamptz",
  timetz: "timetz",
  varchar: "varchar",
  varbit: "varbit",
};

const POSTGRES_INTERVAL_QUALIFIERS: ReadonlySet<PostgresIntervalQualifier> =
  new Set([
    "year",
    "month",
    "day",
    "hour",
    "minute",
    "second",
    "year to month",
    "day to hour",
    "day to minute",
    "day to second",
    "hour to minute",
    "hour to second",
    "minute to second",
  ]);

// Transaction-start time only. statement_timestamp() is intentionally excluded:
// it is statement-start time and must remain distinct from now()/CURRENT_TIMESTAMP.
const DEFAULT_NOW_EQUIVALENTS = new Set([
  "now()",
  "current_timestamp",
  "current_timestamp()",
  "transaction_timestamp()",
]);

/**
 * Parse a Postgres `format_type` / model type string into a structured type.
 * Does not invent precision when absent.
 */
export function parseSchemaTypeString(
  raw: string,
  arrayDimensions = 0
): SchemaColumnType {
  let text = raw.trim().toLowerCase();
  let dims = arrayDimensions;

  while (text.endsWith("[]")) {
    dims += 1;
    text = text.slice(0, -2).trim();
  }

  // `_int4` style udt array markers
  if (text.startsWith("_") && !text.includes(" ")) {
    dims = Math.max(dims, 1);
    text = text.slice(1);
  }

  let length: number | null = null;
  let precision: number | null = null;
  let scale: number | null = null;
  let intervalQualifier: PostgresIntervalQualifier | undefined;

  const qualifiedInterval = text.match(
    /^interval\s+(year to month|day to hour|day to minute|day to second|hour to minute|hour to second|minute to second|year|month|day|hour|minute|second)(?:\s*\((\d+)\))?$/
  );
  if (qualifiedInterval) {
    const qualifier = qualifiedInterval[1] as PostgresIntervalQualifier;
    if (POSTGRES_INTERVAL_QUALIFIERS.has(qualifier)) {
      intervalQualifier = qualifier;
      text = "interval";
      if (qualifiedInterval[2] !== undefined) {
        precision = Number(qualifiedInterval[2]);
      }
    }
  }

  const paramMatch = intervalQualifier
    ? null
    : text.match(/^([a-z0-9_ ]+?)\s*\(([^)]+)\)(.*)$/);
  if (paramMatch) {
    text = `${paramMatch[1].trim()}${paramMatch[3] ? ` ${paramMatch[3].trim()}` : ""}`.trim();
    const parts = paramMatch[2].split(",").map((p) => p.trim());
    if (parts.length === 1) {
      const n = Number(parts[0]);
      if (Number.isFinite(n)) {
        length = n;
        precision = n;
      }
    } else if (parts.length >= 2) {
      const p = Number(parts[0]);
      const s = Number(parts[1]);
      if (Number.isFinite(p)) {
        precision = p;
      }
      if (Number.isFinite(s)) {
        scale = s;
      }
    }
  }

  const canonical = TYPE_ALIASES[text] ?? text;

  // length only meaningful for char/varchar; precision/scale for numeric
  if (
    canonical === "varchar" ||
    canonical === "char" ||
    canonical === "bit" ||
    canonical === "varbit"
  ) {
    precision = null;
    scale = null;
  } else if (canonical === "numeric") {
    length = null;
  } else if (
    canonical === "interval" ||
    canonical === "time" ||
    canonical === "timetz" ||
    canonical === "timestamp" ||
    canonical === "timestamptz"
  ) {
    length = null;
  } else {
    length = null;
    // keep precision/scale only for numeric-like; drop for others
    if (canonical !== "numeric") {
      precision = null;
      scale = null;
    }
  }

  return {
    arrayDimensions: dims,
    enumValues: null,
    ...(intervalQualifier === undefined ? {} : { intervalQualifier }),
    length,
    name: canonical,
    precision,
    scale,
  };
}

export function normalizeSchemaColumnType(
  type: SchemaColumnType
): SchemaColumnType {
  const base = parseSchemaTypeString(type.name, type.arrayDimensions ?? 0);
  const name = TYPE_ALIASES[base.name] ?? base.name;
  const intervalQualifier =
    name === "interval"
      ? (type.intervalQualifier ?? base.intervalQualifier)
      : undefined;

  let length = type.length ?? base.length ?? null;
  let precision = type.precision ?? base.precision ?? null;
  let scale = type.scale ?? base.scale ?? null;

  if (
    name === "varchar" ||
    name === "char" ||
    name === "bit" ||
    name === "varbit"
  ) {
    precision = null;
    scale = null;
  } else if (name === "numeric") {
    length = null;
  } else if (
    name === "interval" ||
    name === "time" ||
    name === "timetz" ||
    name === "timestamp" ||
    name === "timestamptz"
  ) {
    length = null;
    scale = null;
  } else {
    length = null;
    precision = null;
    scale = null;
  }

  const enumValues =
    type.enumValues && type.enumValues.length > 0 ? [...type.enumValues] : null;

  return {
    arrayDimensions: base.arrayDimensions,
    enumValues,
    ...(intervalQualifier === undefined ? {} : { intervalQualifier }),
    length,
    name,
    precision,
    scale,
  };
}

/**
 * Conservative default normalization — only proven-safe syntactic noise.
 */
export function normalizeDefaultExpression(
  value: string | null | undefined
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  let text = value.trim();
  if (!text) {
    return null;
  }

  // Strip trailing ::type casts repeatedly: 'active'::text → 'active'
  for (let i = 0; i < 4; i += 1) {
    const castMatch = text.match(/^(.*?)::[a-zA-Z_][\w\s."]*$/);
    if (!castMatch) {
      break;
    }
    text = castMatch[1].trim();
  }

  // nextval('seq'::regclass) → nextval('seq')
  text = text.replace(
    /nextval\s*\(\s*'([^']+)'\s*::\s*regclass\s*\)/gi,
    (_m, seq: string) => `nextval('${seq}')`
  );

  const lower = text.toLowerCase();
  if (DEFAULT_NOW_EQUIVALENTS.has(lower)) {
    return "now()";
  }

  return text;
}

export function normalizeReferentialAction(
  action: SchemaReferentialAction | string | null | undefined
): SchemaReferentialAction {
  if (!action) {
    return "no_action";
  }
  const normalized = String(action).trim().toLowerCase().replace(/\s+/g, "_");
  switch (normalized) {
    case "a":
    case "no_action":
    case "noaction":
      return "no_action";
    case "r":
    case "restrict":
      return "restrict";
    case "c":
    case "cascade":
      return "cascade";
    case "n":
    case "set_null":
    case "setnull":
      return "set_null";
    case "d":
    case "set_default":
    case "setdefault":
      return "set_default";
    default:
      return "no_action";
  }
}

function normalizeColumn(column: SchemaColumn): SchemaColumn {
  return {
    default: normalizeDefaultExpression(column.default),
    isGenerated: Boolean(column.isGenerated),
    name: column.name,
    nullable: Boolean(column.nullable),
    type: normalizeSchemaColumnType(column.type),
  };
}

function normalizePrimaryKey(
  pk: SchemaPrimaryKey | null | undefined
): SchemaPrimaryKey | null {
  if (!pk || pk.columns.length === 0) {
    return null;
  }
  return {
    columns: [...pk.columns],
    name: pk.name ?? null,
  };
}

function normalizeUnique(
  unique: SchemaUniqueConstraint
): SchemaUniqueConstraint {
  return {
    columns: [...unique.columns],
    name: unique.name ?? null,
  };
}

function normalizeForeignKey(fk: SchemaForeignKey): SchemaForeignKey {
  const database = fk.target.database?.trim();
  return {
    columns: [...fk.columns],
    name: fk.name ?? null,
    onDelete: normalizeReferentialAction(fk.onDelete),
    onUpdate: normalizeReferentialAction(fk.onUpdate),
    target: {
      name: fk.target.name,
      schema: fk.target.schema,
      ...(database ? { database } : {}),
    },
    targetColumns: [...fk.targetColumns],
  };
}

function normalizeIndex(index: SchemaIndex): SchemaIndex {
  return {
    columns: index.columns.map((c) => ({
      direction: c.direction === "desc" ? "desc" : "asc",
      name: c.name,
    })),
    method: index.method?.trim() ? index.method.trim().toLowerCase() : null,
    name: index.name ?? null,
    predicate: index.predicate?.trim() ? index.predicate.trim() : null,
    unique: Boolean(index.unique),
  };
}

function compareByName<T extends { name: string }>(a: T, b: T): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function uniqueSortKey(u: SchemaUniqueConstraint): string {
  return u.columns.join("\0");
}

function fkSortKey(fk: SchemaForeignKey): string {
  return [
    fk.columns.join(","),
    fk.target.database ?? "",
    fk.target.schema,
    fk.target.name,
    fk.targetColumns.join(","),
    fk.onDelete,
    fk.onUpdate,
    fk.name ?? "",
  ].join("\0");
}

function indexSortKey(ix: SchemaIndex): string {
  return [
    ix.unique ? "1" : "0",
    ix.columns.map((c) => `${c.name}:${c.direction ?? "asc"}`).join(","),
    ix.predicate ?? "",
    ix.method ?? "",
    ix.name ?? "",
  ].join("\0");
}

function normalizeTable(table: SchemaTable): SchemaTable {
  const columns = table.columns.map(normalizeColumn).sort(compareByName);
  const uniqueConstraints = table.uniqueConstraints
    .map(normalizeUnique)
    .sort((a, b) => {
      const ka = uniqueSortKey(a);
      const kb = uniqueSortKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  const foreignKeys = table.foreignKeys
    .map(normalizeForeignKey)
    .sort((a, b) => {
      const ka = fkSortKey(a);
      const kb = fkSortKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  const indexes = table.indexes.map(normalizeIndex).sort((a, b) => {
    const ka = indexSortKey(a);
    const kb = indexSortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const database = table.database?.trim();
  return {
    name: table.name,
    schema: table.schema,
    ...(database ? { database } : {}),
    columns,
    foreignKeys,
    indexes,
    primaryKey: normalizePrimaryKey(table.primaryKey),
    uniqueConstraints,
  };
}

function normalizeNamespace(ns: SchemaNamespace): SchemaNamespace {
  const tables = ns.tables.map(normalizeTable).sort((a, b) => {
    if (a.name < b.name) {
      return -1;
    }
    if (a.name > b.name) {
      return 1;
    }
    return 0;
  });
  const database = ns.database?.trim();
  return {
    name: ns.name,
    tables,
    ...(database && database.length > 0 ? { database } : {}),
  };
}

/**
 * Pure normalization: returns a new snapshot; never mutates input.
 * Idempotent: normalize(normalize(s)) === normalize(s) (deep equality).
 */
export function normalizeSchemaSnapshot(
  snapshot: AthenaSchemaSnapshot
): AthenaSchemaSnapshot {
  const schemas = snapshot.schemas.map(normalizeNamespace).sort((a, b) => {
    const database = (a.database ?? "").localeCompare(b.database ?? "");
    if (database !== 0) {
      return database;
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return {
    backend: snapshot.backend ?? null,
    schemas,
    version: ATHENA_SCHEMA_SNAPSHOT_VERSION,
  };
}

export function columnTypesEqual(
  a: SchemaColumnType,
  b: SchemaColumnType
): boolean {
  const na = normalizeSchemaColumnType(a);
  const nb = normalizeSchemaColumnType(b);
  if (na.name !== nb.name) {
    return false;
  }
  if (na.arrayDimensions !== nb.arrayDimensions) {
    return false;
  }
  if ((na.length ?? null) !== (nb.length ?? null)) {
    return false;
  }
  if ((na.precision ?? null) !== (nb.precision ?? null)) {
    return false;
  }
  if ((na.scale ?? null) !== (nb.scale ?? null)) {
    return false;
  }
  const ea = na.enumValues ?? null;
  const eb = nb.enumValues ?? null;
  if (ea === null && eb === null) {
    return true;
  }
  if (ea === null || eb === null) {
    return false;
  }
  if (ea.length !== eb.length) {
    return false;
  }
  for (let i = 0; i < ea.length; i += 1) {
    if (ea[i] !== eb[i]) {
      return false;
    }
  }
  return true;
}

export function columnsEqual(a: SchemaColumn, b: SchemaColumn): boolean {
  return (
    a.name === b.name &&
    columnTypesEqual(a.type, b.type) &&
    a.nullable === b.nullable &&
    normalizeDefaultExpression(a.default) ===
      normalizeDefaultExpression(b.default) &&
    a.isGenerated === b.isGenerated
  );
}

export function primaryKeysEqual(
  a: SchemaPrimaryKey | null,
  b: SchemaPrimaryKey | null
): boolean {
  if (a === null && b === null) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  if (a.columns.length !== b.columns.length) {
    return false;
  }
  for (let i = 0; i < a.columns.length; i += 1) {
    if (a.columns[i] !== b.columns[i]) {
      return false;
    }
  }
  return true;
}
