import type { SchemaColumn } from "./column.ts";
import type {
  SchemaConstraint,
  SchemaReferentialAction,
} from "./constraint.ts";
import type { SchemaDatabase } from "./database.ts";
import type { AthenaSchemaIr } from "./document.ts";
import { asSchemaObjectId, type SchemaObjectIdentity } from "./identity.ts";
import type { SchemaIndex } from "./indexes.ts";
import type { SchemaMetadata } from "./metadata.ts";
import type { SchemaEnum, SchemaNamespace } from "./namespace.ts";
import type { SchemaRelation } from "./relation.ts";
import type { SchemaTable } from "./table.ts";
import type {
  NativeTypeDescriptor,
  PostgresIntervalQualifier,
  SchemaType,
} from "./type.ts";
import { validateAthenaSchemaIr } from "./validate.ts";
import { ATHENA_SCHEMA_IR_KIND, ATHENA_SCHEMA_IR_VERSION } from "./version.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonOptionalFiniteNumber(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(
    "native length, precision, and scale must be finite numbers or null"
  );
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

const REFERENTIAL_ACTIONS = new Set<SchemaReferentialAction>([
  "no_action",
  "restrict",
  "cascade",
  "set_null",
  "set_default",
]);

const POSTGRES_INTERVAL_QUALIFIERS = new Set<PostgresIntervalQualifier>([
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

function asReferentialAction(
  value: unknown,
  label: string
): SchemaReferentialAction | undefined {
  if (value === undefined) {
    return;
  }
  if (
    typeof value === "string" &&
    REFERENTIAL_ACTIONS.has(value as SchemaReferentialAction)
  ) {
    return value as SchemaReferentialAction;
  }
  throw new Error(`${label} "${String(value)}" is unsupported`);
}

function compareId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function canonIdentity(raw: unknown): SchemaObjectIdentity {
  const obj = isObject(raw) ? raw : {};
  const logical = isObject(obj.logical) ? obj.logical : {};
  const physical = isObject(obj.physical) ? obj.physical : logical;
  const database = asString(logical.database);
  const namespace = asString(logical.namespace);
  const name = asString(logical.name);
  return {
    logical: { database, name, namespace },
    physical: {
      database: asString(physical.database, database),
      name: asString(physical.name, name),
      namespace: asString(physical.namespace, namespace),
    },
  };
}

function canonNative(raw: unknown): NativeTypeDescriptor {
  const obj = isObject(raw) ? raw : {};
  const dims =
    typeof obj.arrayDimensions === "number" &&
    Number.isFinite(obj.arrayDimensions)
      ? obj.arrayDimensions
      : 0;
  const native: NativeTypeDescriptor = {
    arrayDimensions: dims,
    backend: asString(obj.backend, "postgresql"),
    name: asString(obj.name),
  };
  if (obj.intervalQualifier !== undefined) {
    if (
      typeof obj.intervalQualifier !== "string" ||
      !POSTGRES_INTERVAL_QUALIFIERS.has(
        obj.intervalQualifier as PostgresIntervalQualifier
      )
    ) {
      throw new Error(
        `Unsupported PostgreSQL interval qualifier "${String(obj.intervalQualifier)}"`
      );
    }
    return addNativeNumericFields(
      {
        ...native,
        intervalQualifier:
          obj.intervalQualifier as PostgresIntervalQualifier,
      },
      obj
    );
  }
  return addNativeNumericFields(native, obj);
}

function addNativeNumericFields(
  native: NativeTypeDescriptor,
  obj: Record<string, unknown>
): NativeTypeDescriptor {
  const withLength =
    obj.length === undefined
      ? native
      : { ...native, length: canonOptionalFiniteNumber(obj.length) };
  const withPrecision =
    obj.precision === undefined
      ? withLength
      : {
          ...withLength,
          precision: canonOptionalFiniteNumber(obj.precision),
        };
  if (obj.scale === undefined) {
    return withPrecision;
  }
  return {
    ...withPrecision,
    scale: canonOptionalFiniteNumber(obj.scale),
  };
}

function canonType(raw: unknown): SchemaType {
  const obj = isObject(raw) ? raw : {};
  const native = canonNative(obj.native);
  if (obj.kind === "enum" || typeof obj.enumId === "string") {
    return {
      enumId: asString(obj.enumId),
      kind: "enum",
      native,
    };
  }
  if (obj.kind === "native") {
    return { kind: "native", native };
  }
  return {
    kind: "scalar",
    native,
    semantic: asString(obj.semantic, native.name),
  };
}

function canonColumn(raw: unknown): SchemaColumn {
  const obj = isObject(raw) ? raw : {};
  const nullable = obj.nullable === true;
  const column: SchemaColumn = {
    id: asSchemaObjectId(asString(obj.id)),
    identity: canonIdentity(obj.identity),
    nullable,
    type: canonType(obj.type),
  };
  const withDefault =
    obj.default === undefined
      ? column
      : {
          ...column,
          default: obj.default === null ? null : asString(obj.default),
        };
  if (obj.generationStrategy !== undefined) {
    const strategy = obj.generationStrategy;
    if (
      !isObject(strategy) ||
      (strategy.kind !== "none" &&
        strategy.kind !== "generated-always" &&
        strategy.kind !== "identity")
    ) {
      throw new Error("Invalid column generation strategy");
    }
    if (
      strategy.kind === "identity" &&
      strategy.mode !== "always" &&
      strategy.mode !== "by-default"
    ) {
      throw new Error("Invalid identity generation strategy mode");
    }
    return {
      ...withDefault,
      generationStrategy: strategy as SchemaColumn["generationStrategy"],
      generated: strategy.kind === "generated-always",
    };
  }
  if (obj.generated === undefined && obj.isGenerated === undefined) {
    return withDefault;
  }
  const generated = obj.generated === true || obj.isGenerated === true;
  return {
    ...withDefault,
    generationStrategy: generated
      ? { kind: "generated-always" }
      : { kind: "none" },
    generated,
  };
}

function canonConstraint(raw: unknown): SchemaConstraint {
  const obj = isObject(raw) ? raw : {};
  const id = asSchemaObjectId(asString(obj.id));
  const kindRaw = asString(obj.kind).toLowerCase();
  const columns = Array.isArray(obj.columns)
    ? obj.columns.map((c) => asString(c))
    : [];
  const name =
    obj.name === undefined
      ? undefined
      : obj.name === null
        ? null
        : asString(obj.name);

  if (kindRaw === "check") {
    return {
      expression: asString(obj.expression),
      id,
      kind: "check",
      ...(name === undefined ? {} : { name }),
    };
  }
  if (kindRaw === "unique") {
    return {
      columns,
      id,
      kind: "unique",
      ...(name === undefined ? {} : { name }),
    };
  }
  if (kindRaw === "foreign_key" || kindRaw === "fk") {
    return {
      columns,
      id,
      kind: "foreign_key",
      targetColumns: Array.isArray(obj.targetColumns)
        ? obj.targetColumns.map((c) => asString(c))
        : [],
      targetTableId: asString(obj.targetTableId),
      ...(name === undefined ? {} : { name }),
      ...(obj.onDelete === undefined
        ? {}
        : {
            onDelete: asReferentialAction(
              obj.onDelete,
              "SchemaConstraint.onDelete"
            ),
          }),
      ...(obj.onUpdate === undefined
        ? {}
        : {
            onUpdate: asReferentialAction(
              obj.onUpdate,
              "SchemaConstraint.onUpdate"
            ),
          }),
    };
  }
  return {
    columns,
    id,
    kind: "primary_key",
    ...(name === undefined ? {} : { name }),
  };
}

function canonRelation(raw: unknown): SchemaRelation {
  const obj = isObject(raw) ? raw : {};
  const through = isObject(obj.through)
    ? {
        sourceColumns: Array.isArray(obj.through.sourceColumns)
          ? obj.through.sourceColumns.map((c) => asString(c))
          : [],
        tableId: asString(obj.through.tableId),
        targetColumns: Array.isArray(obj.through.targetColumns)
          ? obj.through.targetColumns.map((c) => asString(c))
          : [],
      }
    : undefined;
  const relation: SchemaRelation = {
    backingConstraintIds: Array.isArray(obj.backingConstraintIds)
      ? [...obj.backingConstraintIds].map((c) => asString(c)).sort()
      : [],
    cardinality: asString(obj.cardinality) as SchemaRelation["cardinality"],
    id: asSchemaObjectId(asString(obj.id)),
    sourceTableId: asString(obj.sourceTableId),
    targetTableId: asString(obj.targetTableId),
  };
  const withSource =
    obj.sourceColumns === undefined
      ? relation
      : {
          ...relation,
          sourceColumns: Array.isArray(obj.sourceColumns)
            ? obj.sourceColumns.map((c) => asString(c))
            : [],
        };
  const withCols =
    obj.targetColumns === undefined
      ? withSource
      : {
          ...withSource,
          targetColumns: Array.isArray(obj.targetColumns)
            ? obj.targetColumns.map((c) => asString(c))
            : [],
        };
  const withThrough =
    through === undefined ? withCols : { ...withCols, through };
  if (obj.name === undefined) {
    return withThrough;
  }
  return {
    ...withThrough,
    name: obj.name === null ? null : asString(obj.name),
  };
}

function canonIndex(raw: unknown): SchemaIndex {
  const obj = isObject(raw) ? raw : {};
  const columns = Array.isArray(obj.columns)
    ? obj.columns.map((col) => {
        if (typeof col === "string") {
          return { direction: "asc" as const, name: col };
        }
        const c = isObject(col) ? col : {};
        const direction =
          c.direction === "desc" ? ("desc" as const) : ("asc" as const);
        return { direction, name: asString(c.name) };
      })
    : [];
  return {
    columns,
    id: asSchemaObjectId(asString(obj.id)),
    unique: obj.unique === true,
    ...(obj.name === undefined
      ? {}
      : { name: obj.name === null ? null : asString(obj.name) }),
    ...(obj.predicate === undefined
      ? {}
      : { predicate: obj.predicate === null ? null : asString(obj.predicate) }),
    ...(obj.method === undefined
      ? {}
      : { method: obj.method === null ? null : asString(obj.method) }),
  };
}

function canonEnum(raw: unknown): SchemaEnum {
  const obj = isObject(raw) ? raw : {};
  const labels = Array.isArray(obj.labels)
    ? obj.labels.map((l) => asString(l))
    : Array.isArray(obj.values)
      ? obj.values.map((l) => asString(l))
      : [];
  return {
    id: asSchemaObjectId(asString(obj.id)),
    identity: canonIdentity(obj.identity),
    labels,
    ...(obj.name === undefined
      ? {}
      : { name: obj.name === null ? null : asString(obj.name) }),
  };
}

function canonTable(raw: unknown): SchemaTable {
  const obj = isObject(raw) ? raw : {};
  return {
    columns: (Array.isArray(obj.columns) ? obj.columns : [])
      .map(canonColumn)
      .sort(compareId),
    constraints: (Array.isArray(obj.constraints) ? obj.constraints : [])
      .map(canonConstraint)
      .sort(compareId),
    id: asSchemaObjectId(asString(obj.id)),
    identity: canonIdentity(obj.identity),
    indexes: (Array.isArray(obj.indexes) ? obj.indexes : [])
      .map(canonIndex)
      .sort(compareId),
    relations: (Array.isArray(obj.relations) ? obj.relations : [])
      .map(canonRelation)
      .sort(compareId),
  };
}

function canonNamespace(raw: unknown): SchemaNamespace {
  const obj = isObject(raw) ? raw : {};
  const enums = (Array.isArray(obj.enums) ? obj.enums : [])
    .map(canonEnum)
    .sort(compareId);
  return {
    enums,
    id: asSchemaObjectId(asString(obj.id)),
    identity: canonIdentity(obj.identity),
    tables: (Array.isArray(obj.tables) ? obj.tables : [])
      .map(canonTable)
      .sort(compareId),
  };
}

function canonDatabase(raw: unknown): SchemaDatabase {
  const obj = isObject(raw) ? raw : {};
  const namespacesRaw = obj.namespaces ?? obj.schemas;
  const db: SchemaDatabase = {
    id: asSchemaObjectId(asString(obj.id)),
    identity: canonIdentity(obj.identity),
    namespaces: (Array.isArray(namespacesRaw) ? namespacesRaw : [])
      .map(canonNamespace)
      .sort(compareId),
  };
  const withEnums = Array.isArray(obj.enums)
    ? { ...db, enums: obj.enums.map(canonEnum).sort(compareId) }
    : db;
  if (obj.backend === undefined) {
    return withEnums;
  }
  return {
    ...withEnums,
    backend: obj.backend === null ? null : asString(obj.backend),
  };
}

function canonMetadata(raw: unknown): SchemaMetadata {
  if (!isObject(raw)) {
    return {};
  }
  const provenance = isObject(raw.provenance)
    ? {
        ...(raw.provenance.source === undefined
          ? {}
          : { source: asString(raw.provenance.source) }),
        ...(raw.provenance.generatedAt === undefined
          ? {}
          : { generatedAt: asString(raw.provenance.generatedAt) }),
        ...(raw.provenance.generator === undefined
          ? {}
          : { generator: asString(raw.provenance.generator) }),
        ...(raw.provenance.backend === undefined
          ? {}
          : {
              backend:
                raw.provenance.backend === null
                  ? null
                  : asString(raw.provenance.backend),
            }),
      }
    : undefined;
  const extensions = isObject(raw.extensions)
    ? { ...raw.extensions }
    : undefined;
  return {
    ...(provenance === undefined ? {} : { provenance }),
    ...(extensions === undefined ? {} : { extensions }),
  };
}

/**
 * Normalize document structure (stable array order by id, folded aliases).
 * Idempotent: canonicalize(canonicalize(doc)) === canonicalize(doc).
 */
export function canonicalizeAthenaSchemaIr(doc: unknown): AthenaSchemaIr {
  validateAthenaSchemaIr(doc);
  const obj = doc as Record<string, unknown>;
  const canonical: AthenaSchemaIr = {
    databases: (Array.isArray(obj.databases) ? obj.databases : [])
      .map(canonDatabase)
      .sort(compareId),
    irVersion: ATHENA_SCHEMA_IR_VERSION,
    kind: ATHENA_SCHEMA_IR_KIND,
    metadata: canonMetadata(obj.metadata),
  };
  return canonical;
}
