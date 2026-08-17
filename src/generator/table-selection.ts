import type {
  IntrospectionSchema,
  IntrospectionSnapshot,
} from "../schema/types.ts";
import type {
  GeneratorTableSelection,
  NormalizedGeneratorFilterConfig,
} from "./types.ts";

function normalizeTableSelector(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeTableSelection(
  value: GeneratorTableSelection | undefined
): string[] {
  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(",")
          .map(normalizeTableSelector)
          .filter((entry): entry is string => Boolean(entry))
      )
    );
  }

  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((entry) =>
            typeof entry === "string"
              ? normalizeTableSelector(entry)
              : undefined
          )
          .filter((entry): entry is string => Boolean(entry))
      )
    );
  }

  return [];
}

function matchesTableSelector(
  schemaName: string,
  tableName: string,
  selector: string
): boolean {
  const separatorIndex = selector.indexOf(".");
  if (separatorIndex < 0) {
    return tableName === selector;
  }

  const selectorSchema = selector.slice(0, separatorIndex).trim();
  const selectorTable = selector.slice(separatorIndex + 1).trim();
  return selectorSchema === schemaName && selectorTable === tableName;
}

function shouldKeepTable(
  schemaName: string,
  tableName: string,
  filter: NormalizedGeneratorFilterConfig
): boolean {
  const included =
    filter.includeTables.length === 0 ||
    filter.includeTables.some((selector) =>
      matchesTableSelector(schemaName, tableName, selector)
    );
  if (!included) {
    return false;
  }

  return !filter.excludeTables.some((selector) =>
    matchesTableSelector(schemaName, tableName, selector)
  );
}

function hasTableFilters(filter: NormalizedGeneratorFilterConfig): boolean {
  return filter.includeTables.length > 0 || filter.excludeTables.length > 0;
}

export function filterIntrospectionSnapshot(
  snapshot: IntrospectionSnapshot,
  filter: NormalizedGeneratorFilterConfig
): IntrospectionSnapshot {
  if (!hasTableFilters(filter)) {
    return snapshot;
  }

  const schemas: Record<string, IntrospectionSchema> = {};

  for (const [schemaName, schema] of Object.entries(snapshot.schemas)) {
    const tables = Object.fromEntries(
      Object.entries(schema.tables).filter(([tableName]) =>
        shouldKeepTable(schemaName, tableName, filter)
      )
    );

    if (Object.keys(tables).length === 0) {
      continue;
    }

    schemas[schemaName] = {
      ...schema,
      tables,
    };
  }

  if (Object.keys(schemas).length === 0) {
    const includeLabel =
      filter.includeTables.length > 0
        ? ` includeTables=${filter.includeTables.join(", ")}`
        : "";
    const excludeLabel =
      filter.excludeTables.length > 0
        ? ` excludeTables=${filter.excludeTables.join(", ")}`
        : "";
    throw new Error(
      `Generator table filters matched no tables after schema selection.${includeLabel}${excludeLabel}`
    );
  }

  return {
    ...snapshot,
    schemas,
  };
}
