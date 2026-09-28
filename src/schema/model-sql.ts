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
import type { NativeTypeDescriptor } from "./ir/type.ts";
import type {
  AnyModelDef,
  ModelColumnDefault,
  ModelColumnGenerationStrategy,
  ModelColumnKind,
  ModelColumnMetadata,
  ModelMetadataBase,
} from "./types.ts";

export type ModelSqlDialect = "postgres" | "d1" | "sqlite";

const POSTGRES_IDENTITY_NATIVE_TYPES = new Set([
  "bigint",
  "int8",
  "int2",
  "int4",
  "integer",
  "smallint",
]);

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
  defaultValue: ModelColumnDefault;
  enumValues?: readonly string[];
  hasDefault: boolean;
  identity?: "always" | "by-default";
  isGenerated: boolean;
  generationStrategy: ModelColumnGenerationStrategy;
  kind: ModelColumnKind;
  nativeType?: NativeTypeDescriptor;
  /** Authoring key; kept when `name` is remapped to a physical identifier. */
  logicalName: string;
  /** Physical column name after `.from(...)` / `columnName`. */
  name: string;
  nullable: boolean;
  precision?: number;
  scale?: number;
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

function resolveGenerationStrategy(
  logicalName: string,
  column: ModelColumnMetadata | undefined
): ModelColumnGenerationStrategy {
  if (column?.generationStrategy !== undefined) {
    const strategy = column.generationStrategy;
    if (
      column.identity !== undefined &&
      (strategy.kind !== "identity" || column.identity !== strategy.mode)
    ) {
      throw new Error(
        `Column "${logicalName}" has contradictory generation strategy metadata`
      );
    }
    if (
      column.isGenerated !== undefined &&
      column.isGenerated !== (strategy.kind === "generated-always")
    ) {
      if (strategy.kind === "identity" && column.isGenerated) {
        throw new Error(
          `PostgreSQL identity column "${logicalName}" cannot also be marked as generated`
        );
      }
      throw new Error(
        `Column "${logicalName}" has contradictory generation strategy metadata`
      );
    }
    return strategy;
  }

  const legacyStrategy: ModelColumnGenerationStrategy =
    column?.identity !== undefined
      ? { kind: "identity", mode: column.identity }
      : column?.isGenerated === true
        ? { kind: "generated-always" }
        : { kind: "none" };
  if (
    legacyStrategy.kind === "identity" &&
    column?.isGenerated === true
  ) {
    throw new Error(
      `PostgreSQL identity column "${logicalName}" cannot also be marked as generated`
    );
  }
  return legacyStrategy;
}

function resolveColumnDefault(
  logicalName: string,
  column: ModelColumnMetadata | undefined,
  generationStrategy: ModelColumnGenerationStrategy
): ModelColumnDefault {
  if (generationStrategy.kind === "identity") {
    if (column?.default !== undefined && column.default.kind !== "none") {
      throw new Error(
        `Identity column "${logicalName}" cannot also define an explicit default`
      );
    }
    return { kind: "none" };
  }
  if (column?.default !== undefined) {
    return column.default;
  }
  return column?.hasDefault === true ? { kind: "unknown" } : { kind: "none" };
}

function resolveColumns(meta: ModelMetadataBase): ResolvedColumn[] {
  const columnMeta = meta.columns ?? {};
  const keys = Object.keys(columnMeta);
  if (keys.length === 0) {
    // Legacy defineModel without column metadata: PK-only stub columns.
    return meta.primaryKey.map((name) => ({
      defaultValue: { kind: "none" as const },
      generationStrategy: { kind: "none" as const },
      hasDefault: false,
      identity: undefined,
      isGenerated: false,
      kind: "string" as const,
      logicalName: name,
      name,
      nullable: false,
    }));
  }

  const columns = keys.map((logicalName) => {
    const col = columnMeta[logicalName] as ModelColumnMetadata | undefined;
    const generationStrategy = resolveGenerationStrategy(logicalName, col);
    const identity =
      generationStrategy.kind === "identity"
        ? generationStrategy.mode
        : undefined;
    const isGenerated = generationStrategy.kind === "generated-always";
    if (
      identity !== undefined &&
      (!col ||
        (col.kind !== "smallint" &&
          col.kind !== "integer" &&
          col.kind !== "bigint" &&
          col.kind !== "number"))
    ) {
      throw new Error(
        `PostgreSQL identity column "${logicalName}" must use an integer builder (legacy number() is also supported); received kind "${col?.kind ?? "unknown"}"`
      );
    }
    if (identity !== undefined && isGenerated) {
      throw new Error(
        `PostgreSQL identity column "${logicalName}" cannot also be marked as generated`
      );
    }
    const physical = col?.columnName?.trim() || logicalName;
    const nullable =
      col?.nullable === true || meta.nullable?.[logicalName] === true;
    if (identity !== undefined && nullable) {
      throw new Error(
        `PostgreSQL identity column "${logicalName}" must be non-nullable`
      );
    }
    if (
      !nullable &&
      col?.default?.kind === "literal" &&
      col.default.value === null
    ) {
      throw new Error(
        `Column "${logicalName}" has a literal null default but is non-nullable`
      );
    }
    return {
      defaultValue: resolveColumnDefault(
        logicalName,
        col,
        generationStrategy
      ),
      enumValues: col?.enumValues,
      generationStrategy,
      hasDefault: col?.hasDefault === true,
      ...(identity === undefined ? {} : { identity }),
      isGenerated,
      kind: col?.kind ?? "string",
      logicalName,
      name: physical,
      ...(col?.nativeType === undefined ? {} : { nativeType: col.nativeType }),
      nullable,
      ...(col?.precision === undefined ? {} : { precision: col.precision }),
      ...(col?.scale === undefined ? {} : { scale: col.scale }),
    };
  });

  const physicalOwners = new Map<string, string>();
  for (const column of columns) {
    const previousLogicalName = physicalOwners.get(column.name);
    if (previousLogicalName !== undefined && previousLogicalName !== column.logicalName) {
      throw new Error(
        `Logical columns "${previousLogicalName}" and "${column.logicalName}" map to the same physical column "${column.name}"`
      );
    }

    physicalOwners.set(column.name, column.logicalName);
  }

  return columns;
}

function resolvePrimaryKey(
  logicalPrimaryKey: readonly string[],
  columns: readonly ResolvedColumn[]
): string[] {
  const physicalPrimaryKey = logicalPrimaryKey.map((logicalName) => {
    const column = columns.find((candidate) => candidate.logicalName === logicalName);
    if (column === undefined) {
      throw new Error(
        `Primary key logical column "${logicalName}" does not exist in model columns`
      );
    }
    return column.name;
  });

  const seen = new Set<string>();
  for (const physicalName of physicalPrimaryKey) {
    if (seen.has(physicalName)) {
      throw new Error(
        `Primary key logical columns map to the same physical column "${physicalName}"`
      );
    }
    seen.add(physicalName);
  }

  return physicalPrimaryKey;
}

function resolveTable(model: AnyModelDef): ResolvedTable {
  const meta = model.meta;
  const names = resolvePhysicalNames(meta);
  const columns = resolveColumns(meta);
  return {
    columns,
    key: names.key,
    model,
    primaryKey: resolvePrimaryKey(meta.primaryKey, columns),
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

function formatNumericSqlType(column: ResolvedColumn): string {
  if (
    typeof column.precision === "number" &&
    typeof column.scale === "number"
  ) {
    return `NUMERIC(${column.precision}, ${column.scale})`;
  }

  if (typeof column.precision === "number") {
    return `NUMERIC(${column.precision})`;
  }
  return "NUMERIC";
}

function formatNativePostgresType(
  nativeType: NativeTypeDescriptor
): string | undefined {
  if (nativeType.backend !== "postgresql") {
    return;
  }

  const rawName = nativeType.name.trim();
  const name =
    nativeType.arrayDimensions > 0 && rawName.startsWith("_")
      ? rawName.slice(1)
      : rawName;
  const normalizedName = name.toLowerCase().replace(/\s+/g, " ");
  const datetimeTypmod = normalizedName.match(
    /^(interval|timestamp|timestamptz|time|timetz)\s*\((\d+)\)(\s+(?:with|without)\s+time\s+zone)?$/
  );
  const normalizedBaseName = datetimeTypmod
    ? `${datetimeTypmod[1]}${datetimeTypmod[3] ?? ""}`.trim()
    : normalizedName;
  const inlineDatetimePrecision = datetimeTypmod
    ? Number(datetimeTypmod[2])
    : undefined;
  const baseType =
    {
      bool: "BOOLEAN",
      boolean: "BOOLEAN",
      bpchar: "CHAR",
      char: "CHAR",
      "character varying": "VARCHAR",
      decimal: "NUMERIC",
      bit: "BIT",
      varbit: "VARBIT",
      "bit varying": "VARBIT",
      float4: "REAL",
      float8: "DOUBLE PRECISION",
      bigint: "BIGINT",
      int2: "SMALLINT",
      int4: "INTEGER",
      int8: "BIGINT",
      integer: "INTEGER",
      numeric: "NUMERIC",
      real: "REAL",
      smallint: "SMALLINT",
      text: "TEXT",
      varchar: "VARCHAR",
      interval: "INTERVAL",
      time: "TIME",
      "time with time zone": "TIMETZ",
      "time without time zone": "TIME",
      timestamp: "TIMESTAMP",
      "timestamp with time zone": "TIMESTAMPTZ",
      "timestamp without time zone": "TIMESTAMP",
      timestamptz: "TIMESTAMPTZ",
      timetz: "TIMETZ",
    }[normalizedBaseName] ?? quoteQualifiedIdentifier(name);

  let typeSql = baseType;
  if (normalizedBaseName === "interval" && nativeType.intervalQualifier) {
    const qualifier = nativeType.intervalQualifier.toUpperCase();
    const precision =
      typeof nativeType.precision === "number" &&
      nativeType.intervalQualifier.endsWith("second")
        ? `(${nativeType.precision})`
        : "";
    typeSql = `INTERVAL ${qualifier}${precision}`;
  } else if (
    normalizedName === "char" ||
    normalizedName === "bpchar" ||
    normalizedName === "varchar" ||
    normalizedName === "bit" ||
    normalizedName === "varbit" ||
    normalizedName === "bit varying"
  ) {
    if (typeof nativeType.length === "number") {
      typeSql = `${baseType}(${nativeType.length})`;
    }
  } else if (normalizedName === "numeric" || normalizedName === "decimal") {
    if (
      typeof nativeType.precision === "number" &&
      typeof nativeType.scale === "number"
    ) {
      typeSql = `${baseType}(${nativeType.precision}, ${nativeType.scale})`;
    } else if (typeof nativeType.precision === "number") {
      typeSql = `${baseType}(${nativeType.precision})`;
    }
  } else if (
    normalizedBaseName === "interval" ||
    normalizedBaseName === "time" ||
    normalizedBaseName === "time without time zone" ||
    normalizedBaseName === "time with time zone" ||
    normalizedBaseName === "timestamp" ||
    normalizedBaseName === "timestamp without time zone" ||
    normalizedBaseName === "timestamp with time zone" ||
    normalizedBaseName === "timestamptz" ||
    normalizedBaseName === "timetz"
  ) {
    const precision = nativeType.precision ?? inlineDatetimePrecision;
    if (typeof precision === "number") {
      typeSql = `${baseType}(${precision})`;
    }
  }

  return `${typeSql}${"[]".repeat(nativeType.arrayDimensions)}`;
}

function sqlTypePostgres(
  column: ResolvedColumn,
  isSoleGeneratedPk: boolean
): string {
  if (
    column.identity !== undefined &&
    column.nativeType !== undefined &&
    (column.nativeType.arrayDimensions !== 0 ||
      column.nativeType.backend !== "postgresql" ||
      !POSTGRES_IDENTITY_NATIVE_TYPES.has(
        column.nativeType.name.trim().toLowerCase()
      ))
  ) {
    throw new Error(
      `PostgreSQL identity column "${column.name}" must use a scalar zero-dimensional integer native type`
    );
  }
  if (isSoleGeneratedPk) {
    if (column.kind === "smallint") {
      return "SMALLSERIAL";
    }
    if (column.kind === "integer") {
      return "SERIAL";
    }
    if (column.kind === "bigint" || column.kind === "number") {
      return "BIGSERIAL";
    }
  }
  if (column.identity !== undefined && column.kind === "number") {
    const nativeType = column.nativeType
      ? formatNativePostgresType(column.nativeType)
      : undefined;
    if (nativeType !== undefined) {
      return nativeType;
    }
    return "BIGINT";
  }
  const nativeType = column.nativeType
    ? formatNativePostgresType(column.nativeType)
    : undefined;
  if (nativeType !== undefined) {
    return nativeType;
  }
  switch (column.kind) {
    case "boolean":
      return "BOOLEAN";
    case "number":
      return "DOUBLE PRECISION";
    case "smallint":
      return "SMALLINT";
    case "integer":
      return "INTEGER";
    case "bigint":
      return "BIGINT";
    case "decimal":
      return formatNumericSqlType(column);
    case "json":
      return "JSONB";
    default:
      return "TEXT";
  }
}

function sqlTypeD1(column: ResolvedColumn, isSoleGeneratedPk: boolean): string {
  if (column.identity !== undefined) {
    throw new Error(
      `D1 does not support identity columns (column "${column.name}")`
    );
  }
  if (isSoleGeneratedPk && column.kind === "bigint") {
    throw new Error(
      "D1 cannot generate bigint primary keys without lossless decoding"
    );
  }
  if (
    isSoleGeneratedPk &&
    (column.kind === "number" ||
      column.kind === "smallint" ||
      column.kind === "integer" ||
      column.kind === "bigint")
  ) {
    return "INTEGER";
  }
  switch (column.kind) {
    case "boolean":
      return "INTEGER";
    case "number":
      return "REAL";
    case "smallint":
    case "integer":
      return "INTEGER";
    case "bigint":
      // D1 returns INTEGER values without column-aware decoding. TEXT keeps
      // bigint rows lossless, matching the precision-safe decimal strategy.
      return "TEXT";
    case "decimal":
      // SQLite/D1 has no exact NUMERIC — store as TEXT for precision safety.
      return "TEXT";
    case "json":
      return "TEXT";
    default:
      return "TEXT";
  }
}

function isSerialType(typeSql: string): boolean {
  return (
    typeSql === "SMALLSERIAL" || typeSql === "SERIAL" || typeSql === "BIGSERIAL"
  );
}

function renderColumnDefault(
  column: ResolvedColumn,
  dialect: ModelSqlDialect
): string | undefined {
  switch (column.defaultValue.kind) {
    case "none":
      return;
    case "unknown":
      throw new Error(
        `Cannot emit ${dialect} SQL for column "${column.logicalName}": unknown database default`
      );
    case "literal": {
      const value = column.defaultValue.value;
      if (value === null) {
        return "NULL";
      }
      if (typeof value === "string") {
        return `'${value.replaceAll("'", "''")}'`;
      }
      if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          throw new Error(
            `Cannot emit ${dialect} SQL for column "${column.logicalName}": default number must be finite`
          );
        }
        return String(value);
      }
      return value ? "TRUE" : "FALSE";
    }
    case "sql": {
      const expectedDialect = dialect === "postgres" ? "postgres" : "sqlite";
      const actualDialect =
        column.defaultValue.dialect === "d1"
          ? "sqlite"
          : column.defaultValue.dialect;
      const expression = column.defaultValue.expression.trim();
      if (!expression) {
        throw new Error(
          `Cannot emit ${dialect} SQL for column "${column.logicalName}": default expression is empty`
        );
      }
      if (actualDialect !== expectedDialect) {
        throw new Error(
          `Cannot emit ${dialect} SQL for column "${column.logicalName}": default belongs to ${column.defaultValue.dialect}`
        );
      }
      return expression;
    }
  }
}

function isAutoIncrementGeneratedColumn(column: ResolvedColumn): boolean {
  return (
    column.isGenerated &&
    column.generationStrategy.kind === "generated-always" &&
    column.defaultValue.kind === "none"
  );
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
  if (
    dialect === "d1" &&
    table.primaryKey.some((primaryKeyColumn) =>
      table.columns.some(
        (column) =>
          column.name === primaryKeyColumn &&
          column.isGenerated &&
          !isAutoIncrementGeneratedColumn(column)
      )
    )
  ) {
    throw new Error(
      "D1 does not support generated columns in primary keys"
    );
  }
  const solePk =
    table.primaryKey.length === 1 ? table.primaryKey[0] : undefined;
  const soleAutoIncrementPkCol =
    solePk === undefined
      ? undefined
      : table.columns.find(
          (column) =>
            column.name === solePk &&
            isAutoIncrementGeneratedColumn(column) &&
            (column.kind === "number" ||
              column.kind === "smallint" ||
              column.kind === "integer" ||
              column.kind === "bigint")
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
      soleAutoIncrementPkCol !== undefined &&
      column.name === soleAutoIncrementPkCol.name;
    const typeSql = isPostgres
      ? sqlTypePostgres(column, isSoleGeneratedPk)
      : sqlTypeD1(column, isSoleGeneratedPk);

    let line = `  ${quoteIdent(column.name)} ${typeSql}`;
    if (isPostgres && column.identity) {
      line += ` GENERATED ${column.identity === "always" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY`;
    }
    const defaultSql = renderColumnDefault(column, dialect);
    if (column.isGenerated && defaultSql !== undefined) {
      line += ` GENERATED ALWAYS AS (${defaultSql}) STORED`;
    } else if (defaultSql !== undefined) {
      line += ` DEFAULT ${defaultSql}`;
    }

    if (isSoleGeneratedPk && !isPostgres) {
      line += " PRIMARY KEY AUTOINCREMENT";
    } else if (isSoleGeneratedPk && isPostgres && isSerialType(typeSql)) {
      line += " PRIMARY KEY";
    } else {
      if (
        column.identity ||
        !column.nullable
      ) {
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
