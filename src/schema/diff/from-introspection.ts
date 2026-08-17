import type {
  IntrospectionColumn,
  IntrospectionRelation,
  IntrospectionSnapshot,
  IntrospectionTable,
} from "../types.ts";
import {
  normalizeReferentialAction,
  normalizeSchemaSnapshot,
  parseSchemaTypeString,
} from "./normalize.ts";
import {
  ATHENA_SCHEMA_SNAPSHOT_VERSION,
  type AthenaSchemaSnapshot,
  type SchemaColumn,
  type SchemaForeignKey,
  type SchemaIndex,
  type SchemaTable,
  type SchemaUniqueConstraint,
} from "./types.ts";

/**
 * Athena bookkeeping schema excluded from managed-application diffs by default.
 * Verified against packages/athena-js/docs/migrations.md (`athena.schema_migrations`).
 */
export const ATHENA_INTERNAL_SCHEMAS = new Set(["athena"]);

export interface SchemaSnapshotFromIntrospectionOptions {
  /**
   * Schema names to include. When omitted, all introspected schemas are kept
   * except {@link ATHENA_INTERNAL_SCHEMAS} when `excludeInternal` is true.
   */
  readonly schemas?: readonly string[];
  /** Drop Athena internal namespaces (default true). */
  readonly excludeInternal?: boolean;
}

function columnFromIntrospection(column: IntrospectionColumn): SchemaColumn {
  const type = parseSchemaTypeString(
    column.udtName || column.dataType,
    column.arrayDimensions ?? 0
  );
  const defaultExpr =
      column.defaultExpression === undefined
        ? null
        : column.defaultExpression;

    if (column.enumValues && column.enumValues.length > 0) {
      return {
        name: column.name,
        type: {
          ...type,
          enumValues: [...column.enumValues],
        },
        nullable: column.isNullable,
        default: defaultExpr,
        isGenerated: column.isGenerated,
      };
    }
    // Prefer format_type (dataType) when it carries precision: varchar(64)
    const formatted = parseSchemaTypeString(
      column.dataType || column.udtName,
      column.arrayDimensions ?? 0
    );
    return {
      name: column.name,
      type: {
        ...formatted,
        // keep udt-normalized name when format_type is verbose alias
        name: type.name.length <= formatted.name.length ? type.name : formatted.name,
        length: formatted.length ?? type.length,
        precision: formatted.precision ?? type.precision,
        scale: formatted.scale ?? type.scale,
      },
      nullable: column.isNullable,
      default: defaultExpr,
      isGenerated: column.isGenerated,
    };
  }

function isOutboundFkRelation(relation: IntrospectionRelation): boolean {
  return (
    relation.kind === "many-to-one" ||
    relation.kind === "one-to-one"
  );
}

function foreignKeysFromRelations(
  table: IntrospectionTable
): SchemaForeignKey[] {
  const fks: SchemaForeignKey[] = [];
  const seen = new Set<string>();

  for (const relation of Object.values(table.relations)) {
    if (!isOutboundFkRelation(relation)) {
      continue;
    }
    // many-to-many through edges are not physical FKs on this table
    if (relation.through) {
      continue;
    }
    const key = [
      relation.sourceColumns.join(","),
      relation.targetSchema,
      relation.targetModel,
      relation.targetColumns.join(","),
    ].join("\0");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    fks.push({
          name: relation.name ?? null,
          columns: [...relation.sourceColumns],
          target: {
            schema: relation.targetSchema,
            name: relation.targetModel,
          },
          targetColumns: [...relation.targetColumns],
          onDelete: normalizeReferentialAction(relation.onDelete),
          onUpdate: normalizeReferentialAction(relation.onUpdate),
        });
  }

  return fks;
}

    function uniqueFromIntrospection(
      table: IntrospectionTable
    ): SchemaUniqueConstraint[] {
      const raw = table.uniqueConstraints ?? [];
      return raw.map((u) => ({
        name: u.name ?? null,
        columns: [...u.columns],
      }));
    }

    function indexesFromIntrospection(table: IntrospectionTable): SchemaIndex[] {
      const raw = table.indexes ?? [];
      return raw.map((ix) => {
        const directions = ix.columnDirections ?? [];
        return {
          name: ix.name ?? null,
          unique: Boolean(ix.unique),
          predicate: ix.predicate ?? null,
          method: ix.method ?? null,
          columns: ix.columns.map((name, i) => ({
            name,
            direction: directions[i] === "desc" ? ("desc" as const) : ("asc" as const),
          })),
        };
      });
    }

    function tableFromIntrospection(table: IntrospectionTable): SchemaTable {
      const columns = Object.values(table.columns).map(columnFromIntrospection);
      const primaryKey =
        table.primaryKey.length > 0
          ? { name: null as string | null, columns: [...table.primaryKey] }
          : null;

      return {
        schema: table.schema,
        name: table.name,
        columns,
        primaryKey,
        uniqueConstraints: uniqueFromIntrospection(table),
        foreignKeys: foreignKeysFromRelations(table),
        indexes: indexesFromIntrospection(table),
      };
    }

/**
 * Adapt an {@link IntrospectionSnapshot} into the canonical schema IR.
 *
 * Coverage (when catalog rows populated — direct Postgres provider):
 * - FULL: schemas, tables, columns (type/null/default expr/generated), PK,
 *   unique constraints, indexes, FK endpoints + referential actions
 * - PARTIAL: enum lifecycle (labels on columns only), expression indexes omitted
 * - UNSUPPORTED: checks, views, functions, triggers, extensions, RLS
 */
export function schemaSnapshotFromIntrospection(
  snapshot: IntrospectionSnapshot,
  options: SchemaSnapshotFromIntrospectionOptions = {}
): AthenaSchemaSnapshot {
  const excludeInternal = options.excludeInternal !== false;
  const allow = options.schemas ? new Set(options.schemas) : null;

  const schemas = Object.values(snapshot.schemas)
    .filter((ns) => {
      if (allow && !allow.has(ns.name)) {
        return false;
      }
      if (excludeInternal && ATHENA_INTERNAL_SCHEMAS.has(ns.name)) {
        return false;
      }
      return true;
    })
    .map((ns) => ({
      name: ns.name,
      tables: Object.values(ns.tables).map(tableFromIntrospection),
    }));

  return normalizeSchemaSnapshot({
    version: ATHENA_SCHEMA_SNAPSHOT_VERSION,
    backend: snapshot.backend,
    schemas,
  });
}
