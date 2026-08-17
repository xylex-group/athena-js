/**
 * Emit dialect SQL (CREATE TABLE) from AthenaModels / registries.
 *
 * - {@link sqlPostgres} — schema-qualified Postgres DDL
 * - {@link sqlD1} — bare-table SQLite/D1 DDL (same physical names edge uses)
 * - {@link modelsToSqlFiles} — in-memory `.sql` descriptors (no I/O)
 * - Node: {@link writeModelSqlFiles} in `./model-sql-write.ts`
 */

import { quoteQualifiedIdentifier } from "../sql-identifiers.ts";
import { isAthenaModelTarget } from "./model-target.ts";
import type {
  AnyModelDef,
  ModelColumnKind,
  ModelColumnMetadata,
  ModelMetadataBase,
} from "./types.ts";

export type ModelSqlDialect = "postgres" | "d1" | "sqlite";

/**
 * Anything that can yield one or more models: a single model, list, schema,
 * database, registry, or flat model map.
 */
export type ModelSqlInput =
  | AnyModelDef
  | readonly AnyModelDef[]
  | Record<string, unknown>;

export interface ModelSqlOptions {
  /**
   * Emit `CREATE SCHEMA IF NOT EXISTS` for distinct Postgres schemas.
   * Default: `true` for postgres, ignored for D1/SQLite.
   */
  createSchema?: boolean;
  /** `CREATE TABLE IF NOT EXISTS`. Default: true. */
  ifNotExists?: boolean;
  /** Prefix each table with `DROP TABLE IF EXISTS …;`. Default: false. */
  includeDrop?: boolean;
}

export interface ModelSqlFile {
  readonly content: string;
  readonly dialect: ModelSqlDialect;
  /** Relative filename suggestion, e.g. `d1/public/users.sql`. */
  readonly filename: string;
  readonly key: string;
}

export interface ModelsToSqlFilesOptions extends ModelSqlOptions {
  /**
   * Dialects to emit. Default: `["postgres", "d1"]`.
   * `sqlite` is an alias of `d1` content with a `sqlite/` path prefix.
   */
  dialects?: readonly ModelSqlDialect[];
  /**
   * When true (default), emit one file per table per dialect.
   * When false, emit one combined script per dialect (`postgres/all.sql`, …).
   */
  perTable?: boolean;
}

interface ResolvedColumn {
  enumValues?: readonly string[];
  hasDefault: boolean;
  isGenerated: boolean;
  kind: ModelColumnKind;
  name: string;
  nullable: boolean;
}

interface ResolvedTable {
  columns: ResolvedColumn[];
  key: string;
  model: AnyModelDef;
  primaryKey: string[];
  schemaName?: string;
  tableName: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function quoteIdent(name: string): string {
  return quoteQualifiedIdentifier(name);
}

function resolvePhysicalNames(meta: ModelMetadataBase): {
  schemaName?: string;
  tableName: string;
  key: string;
} {
  const explicit = meta.tableName?.trim();
  if (explicit) {
    const firstDot = explicit.indexOf(".");
    if (firstDot > 0 && firstDot === explicit.lastIndexOf(".")) {
      const schemaName = explicit.slice(0, firstDot).trim();
      const tableName = explicit.slice(firstDot + 1).trim();
      if (schemaName && tableName) {
        return {
          key: `${schemaName}.${tableName}`,
          schemaName,
          tableName,
        };
      }
    }
    return { key: explicit, tableName: explicit };
  }

  const tableName = (meta.model ?? "").trim();
  if (!tableName) {
    throw new Error(
      "Model is missing meta.model or meta.tableName; cannot emit SQL"
    );
  }
  const schemaName = meta.schema?.trim() || undefined;
  return {
    key: schemaName ? `${schemaName}.${tableName}` : tableName,
    schemaName,
    tableName,
  };
}

function resolveColumns(meta: ModelMetadataBase): ResolvedColumn[] {
  const columnMeta = meta.columns ?? {};
  const keys = Object.keys(columnMeta);
  if (keys.length === 0) {
    // Legacy defineModel without column metadata: PK-only stub columns.
    return meta.primaryKey.map((name) => ({
      hasDefault: false,
      isGenerated: false,
      kind: "string" as const,
      name,
      nullable: false,
    }));
  }

  return keys.map((logicalName) => {
    const col = columnMeta[logicalName] as ModelColumnMetadata | undefined;
    const physical = col?.columnName?.trim() || logicalName;
    const nullable =
      col?.nullable === true || meta.nullable?.[logicalName] === true;
    return {
      enumValues: col?.enumValues,
      hasDefault: col?.hasDefault === true,
      isGenerated: col?.isGenerated === true,
      kind: col?.kind ?? "string",
      name: physical,
      nullable,
    };
  });
}

function resolveTable(model: AnyModelDef): ResolvedTable {
  const meta = model.meta;
  const names = resolvePhysicalNames(meta);
  return {
    columns: resolveColumns(meta),
    key: names.key,
    model,
    primaryKey: [...meta.primaryKey],
    schemaName: names.schemaName,
    tableName: names.tableName,
  };
}

/**
 * Walk registries / schema maps and collect models with stable keys.
 */
export function collectModelsFromSqlInput(
  input: ModelSqlInput
): ResolvedTable[] {
  const seen = new Set<AnyModelDef>();
  const out: ResolvedTable[] = [];

  const visit = (value: unknown): void => {
    if (value === null) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (isAthenaModelTarget(value)) {
      if (seen.has(value as AnyModelDef)) {
        return;
      }
      seen.add(value as AnyModelDef);
      out.push(resolveTable(value as AnyModelDef));
      return;
    }
    if (!isPlainObject(value)) {
      return;
    }

    // SchemaDef: { models: { users: model } }
    if (isPlainObject(value.models)) {
      for (const model of Object.values(value.models)) {
        visit(model);
      }
      return;
    }

    // DatabaseDef: { schemas: { public: { models } } }
    if (isPlainObject(value.schemas)) {
      for (const schema of Object.values(value.schemas)) {
        visit(schema);
      }
      return;
    }

    // Registry or flat map: recurse values
    for (const child of Object.values(value)) {
      if (isAthenaModelTarget(child)) {
        visit(child);
        continue;
      }
      if (isPlainObject(child) && ("models" in child || "schemas" in child)) {
        visit(child);
        continue;
      }
      if (isPlainObject(child)) {
        const childValues = Object.values(child);
        if (
          childValues.length > 0 &&
          childValues.every((entry) => isAthenaModelTarget(entry))
        ) {
          for (const entry of childValues) {
            visit(entry);
          }
        }
      }
    }
  };

  visit(input);

  if (out.length === 0) {
    throw new Error(
      "No AthenaModels found in sql input. Pass a model, model list, schema, database, or registry."
    );
  }

  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

function sqlTypePostgres(
  column: ResolvedColumn,
  isSoleGeneratedPk: boolean
): string {
  if (isSoleGeneratedPk && column.kind === "number") {
    return "BIGSERIAL";
  }
  switch (column.kind) {
    case "boolean":
      return "BOOLEAN";
    case "number":
      return "DOUBLE PRECISION";
    case "json":
      return "JSONB";
    default:
      return "TEXT";
  }
}

function sqlTypeD1(column: ResolvedColumn, isSoleGeneratedPk: boolean): string {
  if (isSoleGeneratedPk && column.kind === "number") {
    return "INTEGER";
  }
  switch (column.kind) {
    case "boolean":
      return "INTEGER";
    case "number":
      return "REAL";
    case "json":
      return "TEXT";
    default:
      return "TEXT";
  }
}

function enumCheck(column: ResolvedColumn): string | undefined {
  if (column.kind !== "enumeration" || !column.enumValues?.length) {
    return;
  }
  const list = column.enumValues
    .map((value) => `'${String(value).replace(/'/g, "''")}'`)
    .join(", ");
  return `CHECK (${quoteIdent(column.name)} IN (${list}))`;
}

function renderCreateTable(
  table: ResolvedTable,
  dialect: ModelSqlDialect,
  options: Required<Pick<ModelSqlOptions, "ifNotExists" | "includeDrop">> & {
    createSchema: boolean;
  }
): string {
  const isPostgres = dialect === "postgres";
  const bareTable = table.tableName;
  const qualified =
    isPostgres && table.schemaName
      ? `${table.schemaName}.${bareTable}`
      : bareTable;
  const tableSql = quoteIdent(qualified);

  const pkSet = new Set(table.primaryKey);
  const solePk =
    table.primaryKey.length === 1 ? table.primaryKey[0] : undefined;
  const soleGeneratedPkCol =
    solePk === undefined
      ? undefined
      : table.columns.find(
          (column) =>
            column.name === solePk &&
            column.isGenerated &&
            column.kind === "number"
        );

  const lines: string[] = [];

  if (options.includeDrop) {
    lines.push(`DROP TABLE IF EXISTS ${tableSql};`);
  }

  if (isPostgres && options.createSchema && table.schemaName) {
    lines.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(table.schemaName)};`);
  }

  const ifNotExists = options.ifNotExists ? "IF NOT EXISTS " : "";
  const columnLines: string[] = [];
  const tableChecks: string[] = [];

  for (const column of table.columns) {
    const isSoleGeneratedPk =
      soleGeneratedPkCol !== undefined &&
      column.name === soleGeneratedPkCol.name;
    const typeSql = isPostgres
      ? sqlTypePostgres(column, isSoleGeneratedPk)
      : sqlTypeD1(column, isSoleGeneratedPk);

    let line = `  ${quoteIdent(column.name)} ${typeSql}`;

    if (isSoleGeneratedPk && !isPostgres) {
      line += " PRIMARY KEY AUTOINCREMENT";
    } else if (isSoleGeneratedPk && isPostgres && typeSql === "BIGSERIAL") {
      line += " PRIMARY KEY";
    } else {
      if (!(column.nullable || column.hasDefault || column.isGenerated)) {
        line += " NOT NULL";
      }
      if (
        table.primaryKey.length === 1 &&
        pkSet.has(column.name) &&
        !isSoleGeneratedPk
      ) {
        line += " PRIMARY KEY";
      }
    }

    columnLines.push(line);

    const check = enumCheck(column);
    if (check) {
      tableChecks.push(`  ${check}`);
    }
  }

  if (table.primaryKey.length > 1) {
    const pkCols = table.primaryKey.map((name) => quoteIdent(name)).join(", ");
    columnLines.push(`  PRIMARY KEY (${pkCols})`);
  }

  const body = [...columnLines, ...tableChecks].join(",\n");
  lines.push(`CREATE TABLE ${ifNotExists}${tableSql} (\n${body}\n);`);
  return lines.join("\n");
}

function normalizeOptions(
  options?: ModelSqlOptions
): Required<
  Pick<ModelSqlOptions, "ifNotExists" | "includeDrop" | "createSchema">
> {
  return {
    createSchema: options?.createSchema !== false,
    ifNotExists: options?.ifNotExists !== false,
    includeDrop: options?.includeDrop === true,
  };
}

function emitForDialect(
  tables: ResolvedTable[],
  dialect: ModelSqlDialect,
  options?: ModelSqlOptions
): string {
  const normalized = normalizeOptions(options);
  const effective: ModelSqlDialect =
    dialect === "sqlite" ? "d1" : dialect === "postgres" ? "postgres" : "d1";
  const parts: string[] = [];
  const header =
    effective === "postgres"
      ? "-- Generated by @xylex-group/athena from AthenaModels (PostgreSQL)"
      : "-- Generated by @xylex-group/athena from AthenaModels (D1/SQLite)";
  parts.push(header);

  if (effective === "postgres" && normalized.createSchema) {
    const schemas = [
      ...new Set(
        tables
          .map((table) => table.schemaName)
          .filter((schema): schema is string => Boolean(schema))
      ),
    ].sort();
    for (const schema of schemas) {
      parts.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)};`);
    }
    normalized.createSchema = false;
  }

  for (const table of tables) {
    parts.push(renderCreateTable(table, effective, normalized));
  }
  return `${parts.join("\n\n")}\n`;
}

/**
 * PostgreSQL DDL for one or more AthenaModels (schema-qualified when meta has schema).
 */
export function sqlPostgres(
  input: ModelSqlInput,
  options?: ModelSqlOptions
): string {
  return emitForDialect(collectModelsFromSqlInput(input), "postgres", options);
}

/**
 * D1/SQLite DDL for one or more AthenaModels (bare table names — edge drop-in).
 */
export function sqlD1(input: ModelSqlInput, options?: ModelSqlOptions): string {
  return emitForDialect(collectModelsFromSqlInput(input), "d1", options);
}

/**
 * SQLite DDL alias of {@link sqlD1} (same SQL; useful for non-Cloudflare SQLite).
 */
export function sqlSqlite(
  input: ModelSqlInput,
  options?: ModelSqlOptions
): string {
  return emitForDialect(collectModelsFromSqlInput(input), "sqlite", options);
}

/**
 * Dialect-generic entry: `modelsToSql(models, "postgres" | "d1" | "sqlite")`.
 */
export function modelsToSql(
  input: ModelSqlInput,
  dialect: ModelSqlDialect,
  options?: ModelSqlOptions
): string {
  return emitForDialect(collectModelsFromSqlInput(input), dialect, options);
}

function filenameForTable(
  dialect: ModelSqlDialect,
  key: string,
  perTable: boolean
): string {
  const folder = dialect;
  if (!perTable) {
    return `${folder}/all.sql`;
  }
  // public.users → public/users.sql ; users → users.sql
  const safe = key
    .split(".")
    .map((segment) => segment.replace(/[^\w.-]+/g, "_"))
    .join("/");
  return `${folder}/${safe}.sql`;
}

/**
 * Build in-memory `.sql` file descriptors (no I/O).
 */
export function modelsToSqlFiles(
  input: ModelSqlInput,
  options?: ModelsToSqlFilesOptions
): ModelSqlFile[] {
  const tables = collectModelsFromSqlInput(input);
  const dialects = options?.dialects ?? (["postgres", "d1"] as const);
  const perTable = options?.perTable !== false;
  const files: ModelSqlFile[] = [];

  for (const dialect of dialects) {
    if (perTable) {
      for (const table of tables) {
        const content = emitForDialect([table], dialect, options);
        files.push({
          content,
          dialect,
          filename: filenameForTable(dialect, table.key, true),
          key: table.key,
        });
      }
    } else {
      const content = emitForDialect(tables, dialect, options);
      files.push({
        content,
        dialect,
        filename: filenameForTable(dialect, "all", false),
        key: "all",
      });
    }
  }

  return files;
}
