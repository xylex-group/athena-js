import { collectModelsFromSqlInput, type ModelSqlInput } from "../model-sql.ts";
import type { ModelColumnKind, ModelRelationMetadata } from "../types.ts";
import { normalizeSchemaSnapshot, parseSchemaTypeString } from "./normalize.ts";
import {
  ATHENA_SCHEMA_SNAPSHOT_VERSION,
  type AthenaSchemaSnapshot,
  type SchemaColumn,
  type SchemaForeignKey,
  type SchemaTable,
} from "./types.ts";

export interface SchemaSnapshotFromModelsOptions {
  /** Backend label stored on the snapshot (default `postgresql`). */
  readonly backend?: string | null;
  /** Default schema when model metadata omits schema (default `public`). */
  readonly defaultSchema?: string;
}

function modelKindToSqlType(
  kind: ModelColumnKind,
  isSoleGeneratedPk: boolean
): string {
  if (isSoleGeneratedPk && kind === "number") {
    return "bigint";
  }
  switch (kind) {
    case "boolean":
      return "boolean";
    case "number":
      return "double precision";
    case "json":
      return "jsonb";
    case "enumeration":
      return "text";
    default:
      return "text";
  }
}

function relationToForeignKey(
  relation: ModelRelationMetadata
): SchemaForeignKey | null {
  if (
    relation.kind !== "many-to-one" &&
    relation.kind !== "one-to-one"
  ) {
    return null;
  }
  if (relation.through) {
    return null;
  }
  return {
    name: null,
    columns: [...relation.sourceColumns],
    target: {
      schema: relation.targetSchema,
      name: relation.targetModel,
    },
    targetColumns: [...relation.targetColumns],
    onDelete: "no_action",
    onUpdate: "no_action",
  };
}

/**
 * Extract a canonical schema snapshot from AthenaModels / registries.
 *
 * Uses the same physical naming + type mapping conventions as `model-sql`
 * (postgres dialect) so desired snapshots align with generated DDL.
 *
 * Gaps (by design — models DSL does not yet express them):
 * - explicit SQL type overrides beyond kind mapping
 * - unique constraints / indexes / check constraints
 * - default expressions (only hasDefault flag exists)
 * - FK referential actions
 */
export function schemaSnapshotFromModels(
  input: ModelSqlInput,
  options: SchemaSnapshotFromModelsOptions = {}
): AthenaSchemaSnapshot {
  const defaultSchema = options.defaultSchema?.trim() || "public";
  const backend = options.backend === undefined ? "postgresql" : options.backend;
  const resolved = collectModelsFromSqlInput(input);

  const bySchema = new Map<string, SchemaTable[]>();

  for (const table of resolved) {
    const schemaName = table.schemaName?.trim() || defaultSchema;
    const solePk =
      table.primaryKey.length === 1 ? table.primaryKey[0] : undefined;
    const soleGeneratedPk =
      solePk !== undefined &&
      table.columns.some(
        (c) => c.name === solePk && c.isGenerated && c.kind === "number"
      );

    const columns: SchemaColumn[] = table.columns.map((column) => {
      const isSoleGeneratedPk = Boolean(
        soleGeneratedPk && column.name === solePk && column.kind === "number"
      );
      const sqlType = modelKindToSqlType(column.kind, isSoleGeneratedPk);
      const parsed = parseSchemaTypeString(sqlType, 0);
      // Enumeration columns are emitted as TEXT + CHECK by modelsToSql, not
      // PostgreSQL enum types — never attach enumValues (avoids false drift
      // vs introspection, which only reads pg_enum and not CHECKs).
      const type = parsed;

      // BIGSERIAL (sole generated numeric PK) introspects as bigint with a
      // nextval(...) default and attgenerated=false — mirror that shape so an
      // unchanged DB does not spuriously alter_column.
      if (isSoleGeneratedPk) {
        const seqName = `${table.tableName}_${column.name}_seq`;
        return {
          name: column.name,
          type,
          nullable: column.nullable,
          default: `nextval('${seqName}'::regclass)`,
          isGenerated: false,
        };
      }

      return {
        name: column.name,
        type,
        nullable: column.nullable,
        default: null,
        isGenerated: column.isGenerated,
      };
    });

    const foreignKeys: SchemaForeignKey[] = [];
    const relations = table.model.meta.relations ?? {};
    for (const relation of Object.values(relations)) {
      const fk = relationToForeignKey(relation);
      if (fk) {
        foreignKeys.push(fk);
      }
    }

    const schemaTable: SchemaTable = {
      schema: schemaName,
      name: table.tableName,
      columns,
      primaryKey:
        table.primaryKey.length > 0
          ? { name: null, columns: [...table.primaryKey] }
          : null,
      uniqueConstraints: [],
      foreignKeys,
      indexes: [],
    };

    const list = bySchema.get(schemaName) ?? [];
    list.push(schemaTable);
    bySchema.set(schemaName, list);
  }

  const schemas = [...bySchema.entries()].map(([name, tables]) => ({
    name,
    tables,
  }));

  return normalizeSchemaSnapshot({
    version: ATHENA_SCHEMA_SNAPSHOT_VERSION,
    backend,
    schemas,
  });
}
