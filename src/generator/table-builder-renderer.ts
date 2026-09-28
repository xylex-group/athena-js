import { parseSchemaTypeString } from "../schema/diff/normalize.ts";
import type {
  IntrospectionColumn,
  IntrospectionSnapshot,
} from "../schema/types.ts";
import { normalizeGeneratorConfig } from "./config.ts";
import {
  escapeStringLiteral,
  escapeTypePropertyName,
  toSafeIdentifier,
} from "./naming.ts";
import { resolvePostgresColumnType } from "./postgres-type-mapping.ts";
import {
  composeGeneratorArtifacts,
  type ModelArtifactDescriptorBase,
  renderObjectKey,
  renderRelationLiteral,
  resolveOutputPath,
} from "./render-shared.ts";
import type {
  AthenaGeneratorConfig,
  GeneratedArtifact,
  GeneratedArtifacts,
  NormalizedAthenaGeneratorConfig,
} from "./types.ts";

type ModelRenderDescriptor = ModelArtifactDescriptorBase & {
  rowTypeName: string;
  insertTypeName: string;
  updateTypeName: string;
  formValuesTypeName: string;
  tableConstName: string;
};

const SMALLINT_TYPES = new Set(["int2", "smallint", "serial2", "smallserial"]);
const INTEGER_TYPES = new Set(["int4", "integer", "serial", "serial4"]);
const BIGINT_TYPES = new Set(["int8", "bigint", "serial8", "bigserial"]);
const SAFE_NUMBER_TYPES = new Set([
  "float4",
  "float8",
  "real",
  "double precision",
]);

const JSON_TYPES = new Set(["json", "jsonb"]);
const BOOLEAN_TYPES = new Set(["bool", "boolean"]);
/** Exact-numeric PG types → `decimal()` (string-backed, precision-safe). */
const DECIMAL_TYPES = new Set(["numeric", "decimal", "money"]);
/** PostgreSQL int8 values stay string-backed to preserve precision at the JS boundary. */
const STRING_TYPES = new Set([
  "bytea",
]);
const BUILTIN_POSTGRES_TYPES = new Set([
  "bigint",
  "bigserial",
  "bit",
  "boolean",
  "bytea",
  "char",
  "date",
  "double precision",
  "inet",
  "integer",
  "interval",
  "json",
  "jsonb",
  "macaddr",
  "money",
  "numeric",
  "real",
  "smallint",
  "smallserial",
  "text",
  "time",
  "timestamp",
  "timestamptz",
  "timetz",
  "uuid",
  "varbit",
  "varchar",
  "xml",
]);

function normalizeTypeLabel(column: IntrospectionColumn): string {
  const preferred = (column.udtName || column.dataType).toLowerCase().trim();
  // Strip format_type params: "numeric(12,2)" → "numeric"
  const bare = preferred.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (column.arrayDimensions > 0 && bare.startsWith("_")) {
    return bare.slice(1);
  }
  return bare;
}

function parseFormattedType(column: IntrospectionColumn) {
  const parsed = parseSchemaTypeString(column.dataType || column.udtName, 0);
  const catalogDimensions = column.arrayDimensions ?? 0;
  if ((parsed.arrayDimensions > 0) !== (catalogDimensions > 0)) {
    throw new Error(
      `Column "${column.name}" has inconsistent PostgreSQL array dimensions: formatted type has ${parsed.arrayDimensions}, catalog has ${catalogDimensions}`
    );
  }
  return catalogDimensions === parsed.arrayDimensions
    ? parsed
    : { ...parsed, arrayDimensions: catalogDimensions };
}

function formattedBaseType(column: IntrospectionColumn): string {
  let formatted = (column.dataType || column.udtName).trim();
  while (formatted.endsWith("[]")) {
    formatted = formatted.slice(0, -2).trim();
  }
  return formatted.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function resolveExactNumericBounds(column: IntrospectionColumn): {
  precision?: number;
  scale?: number;
} {
  if (
    typeof column.numericPrecision === "number" ||
    typeof column.numericScale === "number"
  ) {
    return {
      ...(typeof column.numericPrecision === "number"
        ? { precision: column.numericPrecision }
        : {}),
      ...(typeof column.numericScale === "number"
        ? { scale: column.numericScale }
        : {}),
    };
  }

  const parsed = parseFormattedType(column);
  if (parsed.name !== "numeric") {
    return {};
  }
  return {
    ...(typeof parsed.precision === "number"
      ? { precision: parsed.precision }
      : {}),
    ...(typeof parsed.scale === "number" ? { scale: parsed.scale } : {}),
  };
}

export function renderNativeTypeDescriptor(column: IntrospectionColumn): string {
  const parsed = parseFormattedType(column);
  const rawName = (
    BUILTIN_POSTGRES_TYPES.has(parsed.name)
      ? column.udtName || parsed.name
      : formattedBaseType(column)
  ).trim();
  const name =
    parsed.arrayDimensions > 0 && rawName.startsWith("_")
      ? rawName.slice(1)
      : rawName;
  const fields = [
    `arrayDimensions: ${parsed.arrayDimensions}`,
    "backend: 'postgresql'",
    ...(parsed.intervalQualifier === undefined
      ? []
      : [`intervalQualifier: ${escapeStringLiteral(parsed.intervalQualifier)}`]),
    ...(parsed.length === null || parsed.length === undefined
      ? []
      : [`length: ${parsed.length}`]),
    `name: ${escapeStringLiteral(name)}`,
    ...(parsed.precision === null || parsed.precision === undefined
      ? []
      : [`precision: ${parsed.precision}`]),
    ...(parsed.scale === null || parsed.scale === undefined
      ? []
      : [`scale: ${parsed.scale}`]),
  ];
  return `{ ${fields.join(", ")} }`;
}

function renderNativeType(column: IntrospectionColumn): string {
  return `.nativeType(${renderNativeTypeDescriptor(column)})`;
}

function renderDecimalBuilder(column: IntrospectionColumn): string {
  const { precision, scale } = resolveExactNumericBounds(column);

  if (precision === undefined && scale === undefined) {
    return "decimal()";
  }

  const options: string[] = [];
  if (precision !== undefined) {
    options.push(`precision: ${precision}`);
  }
  if (scale !== undefined) {
    options.push(`scale: ${scale}`);
  }
  return `decimal({ ${options.join(", ")} })`;
}

export function renderColumnBuilder(column: IntrospectionColumn): {
  helper:
    | "boolean"
    | "number"
    | "smallint"
    | "integer"
    | "bigint"
    | "string"
    | "json"
    | "enumeration"
    | "decimal";
  expression: string;
} {
  if (column.identity !== undefined && column.isNullable) {
    throw new Error(
      `Identity column "${column.name}" must be non-nullable`
    );
  }
  if (column.identity !== undefined && column.isGenerated) {
    throw new Error(
      `Cannot render identity column "${column.name}" with multiple generation strategies`
    );
  }
  const label = normalizeTypeLabel(column);
  let helper:
    | "boolean"
    | "number"
    | "smallint"
    | "integer"
    | "bigint"
    | "string"
    | "json"
    | "enumeration"
    | "decimal";
  let expression: string;

  if (
    column.typeKind === "enum" &&
    column.enumValues &&
    column.enumValues.length > 0
  ) {
    helper = "enumeration";
    expression = `enumeration([${column.enumValues.map((value) => escapeStringLiteral(value)).join(", ")}] as const)`;
  } else if (
    column.arrayDimensions > 0 ||
    JSON_TYPES.has(label) ||
    column.typeKind === "composite"
  ) {
    helper = "json";
    expression = `json<${resolvePostgresColumnType(column)}>()`;
  } else if (BOOLEAN_TYPES.has(label)) {
    helper = "boolean";
    expression = "boolean()";
  } else if (SMALLINT_TYPES.has(label)) {
    helper = "smallint";
    expression = "smallint()";
  } else if (INTEGER_TYPES.has(label)) {
    helper = "integer";
    expression = "integer()";
  } else if (BIGINT_TYPES.has(label)) {
    helper = "bigint";
    expression = "bigint()";
  } else if (SAFE_NUMBER_TYPES.has(label)) {
    helper = "number";
    expression = "number()";
  } else if (DECIMAL_TYPES.has(label)) {
    helper = "decimal";
    expression = renderDecimalBuilder(column);
  } else if (STRING_TYPES.has(label)) {
    helper = "string";
    expression = "string()";
  } else {
    helper = "string";
    expression = "string()";
  }

  if (column.isNullable) {
    expression = `${expression}.optional()`;
  }
  if (column.hasDefault) {
    const defaultExpression = column.defaultExpression?.trim();
    expression =
      defaultExpression === undefined || defaultExpression.length === 0
        ? `${expression}.defaulted()`
        : `${expression}.defaulted({ dialect: 'postgres', expression: ${escapeStringLiteral(defaultExpression)} })`;
  }
  if (column.identity) {
    if (
      helper !== "smallint" &&
      helper !== "integer" &&
      helper !== "bigint"
    ) {
      throw new Error(
        `Cannot render identity column "${column.name}" with incompatible helper "${helper}"`
      );
    }
    expression = `${expression}.identity("${column.identity}")`;
  } else if (column.isGenerated) {
    expression = `${expression}.generated()`;
  }

  expression = `${expression}${renderNativeType(column)}`;
  return { expression, helper };
}

function renderModelArtifact(
  descriptor: ModelRenderDescriptor,
  config: NormalizedAthenaGeneratorConfig
): GeneratedArtifact {
  const helperImports = new Set<string>(["table"]);
  const columnLines = Object.entries(descriptor.table.columns)
    .map(([columnName, column]) => {
      const propertyName = escapeTypePropertyName(columnName);
      const rendered = renderColumnBuilder(column);
      helperImports.add(rendered.helper);
      return `    ${propertyName}: ${rendered.expression}`;
    })
    .join(",\n");

  const helperImportLine = Array.from(helperImports).sort().join(", ");
  const rowSchemaConstName = `${descriptor.tableConstName}_row_schema`;
  const insertSchemaConstName = `${descriptor.tableConstName}_insert_schema`;
  const updateSchemaConstName = `${descriptor.tableConstName}_update_schema`;
  const formSchemaConstName = `${descriptor.tableConstName}_form_schema`;

  const relationEntries = Object.entries(descriptor.table.relations);
  const relationsAssignment =
    config.features.emitRelations && relationEntries.length > 0
      ? `
Object.assign(${descriptor.tableConstName}.meta, {
  relations: {
${relationEntries
  .map(
    ([relationKey, relationValue]) =>
      `    ${renderObjectKey(relationKey)}: ${renderRelationLiteral(relationValue)}`
  )
  .join(",\n")}
  }
})
`
      : "";

  const content = `import { ${helperImportLine} } from '@xylex-group/athena'
import type { FormValuesOf, InsertOf, RowOf, UpdateOf } from '@xylex-group/athena'

export const ${descriptor.tableConstName} = table(${escapeStringLiteral(descriptor.tableName)})
  .schema(${escapeStringLiteral(descriptor.schemaName)})
  .columns({
${columnLines}
  })
  ${
    descriptor.table.primaryKey.length > 0
      ? `.primaryKey(${descriptor.table.primaryKey.map((value) => escapeStringLiteral(value)).join(", ")})`
      : ".withoutPrimaryKey()"
  }
${relationsAssignment ? `${relationsAssignment}` : ""}
export type ${descriptor.rowTypeName} = RowOf<typeof ${descriptor.tableConstName}>
export type ${descriptor.insertTypeName} = InsertOf<typeof ${descriptor.tableConstName}>
export type ${descriptor.updateTypeName} = UpdateOf<typeof ${descriptor.tableConstName}>
export type ${descriptor.formValuesTypeName} = FormValuesOf<typeof ${descriptor.tableConstName}>

export const ${rowSchemaConstName} = ${descriptor.tableConstName}.schemas.row
export const ${insertSchemaConstName} = ${descriptor.tableConstName}.schemas.insert
export const ${updateSchemaConstName} = ${descriptor.tableConstName}.schemas.update
export const ${formSchemaConstName} = ${descriptor.tableConstName}.schemas.form
`;

  return {
    content,
    kind: "model",
    path: descriptor.filePath,
  };
}

export function generateTableBuilderArtifactsFromSnapshot(
  snapshot: IntrospectionSnapshot,
  config: AthenaGeneratorConfig | NormalizedAthenaGeneratorConfig
): GeneratedArtifacts {
  const normalizedConfig =
    "internal" in config
      ? (config as NormalizedAthenaGeneratorConfig)
      : normalizeGeneratorConfig(config as AthenaGeneratorConfig);
  return composeGeneratorArtifacts({
    config: normalizedConfig,
    createModelDescriptor({
      providerName,
      databaseName,
      schemaName,
      tableName,
      table,
    }) {
      const tableConstName = toSafeIdentifier(tableName, "preserve", "table");
      return {
        exportConstName: tableConstName,
        filePath: resolveOutputPath(
          normalizedConfig.output.targets.model,
          {
            database: databaseName,
            kind: "model",
            model: tableName,
            provider: providerName,
            schema: schemaName,
          },
          normalizedConfig
        ),
        formValuesTypeName: `${toSafeIdentifier(`${schemaName} ${tableName}`, normalizedConfig.naming.modelType, "Model")}FormValues`,
        insertTypeName: `${toSafeIdentifier(`${schemaName} ${tableName}`, normalizedConfig.naming.modelType, "Model")}Insert`,
        rowTypeName: `${toSafeIdentifier(`${schemaName} ${tableName}`, normalizedConfig.naming.modelType, "Model")}Row`,
        schemaName,
        table,
        tableConstName,
        tableName,
        updateTypeName: `${toSafeIdentifier(`${schemaName} ${tableName}`, normalizedConfig.naming.modelType, "Model")}Update`,
      };
    },
    renderModelArtifact: (descriptor) =>
      renderModelArtifact(descriptor, normalizedConfig),
    snapshot,
  });
}
