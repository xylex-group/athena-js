import { AthenaConfigurationError } from "../../config/errors.ts";
import type { ModelRelationMetadata } from "../../schema/types.ts";
import type { AthenaRuntimeModelEnforcement } from "./types.ts";

export interface AthenaRuntimeModelDescriptor {
  readonly canonicalResource: string;
  readonly columns: ReadonlySet<string>;
  readonly primaryKey?: readonly string[];
  readonly relations: ReadonlyMap<string, ModelRelationMetadata>;
  readonly schema?: string;
  readonly table: string;
  readonly uniqueKeys: readonly (readonly string[])[];
}

export interface AthenaRuntimeModelIndex {
  readonly descriptors: readonly AthenaRuntimeModelDescriptor[];
  readonly enforcement: AthenaRuntimeModelEnforcement;
  get(resource: string): AthenaRuntimeModelDescriptor | undefined;
}

interface ModelMetaLike {
  columns?: Partial<Record<string, unknown>>;
  model?: string;
  primaryKey?: unknown;
  relations?: Record<string, ModelRelationMetadata>;
  schema?: string;
  tableName?: string;
}

interface ModelLike {
  meta?: ModelMetaLike;
  qualifiedName?: string;
  tableName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isModelLike(value: unknown): value is ModelLike {
  if (!isRecord(value) || !isRecord(value.meta)) {
    return false;
  }
  return Array.isArray(value.meta.primaryKey);
}

function collectModels(input: unknown, found: ModelLike[]): void {
  if (!input || typeof input !== "object") {
    return;
  }
  if (isModelLike(input)) {
    found.push(input);
    return;
  }
  if (!isRecord(input)) {
    return;
  }
  if (isRecord(input.models)) {
    collectModels(input.models, found);
    return;
  }
  if (isRecord(input.schemas)) {
    collectModels(input.schemas, found);
    return;
  }
  for (const value of Object.values(input)) {
    collectModels(value, found);
  }
}

function physicalTable(meta: ModelMetaLike, model: ModelLike): {
  schema?: string;
  table: string;
} {
  const tableName =
    (typeof model.tableName === "string" && model.tableName.trim()) ||
    (typeof meta.tableName === "string" && meta.tableName.trim()) ||
    (typeof meta.model === "string" && meta.model.trim()) ||
    "";
  const qualified =
    (typeof model.qualifiedName === "string" && model.qualifiedName.trim()) ||
    tableName;
  const schemaFromMeta =
    typeof meta.schema === "string" && meta.schema.trim()
      ? meta.schema.trim()
      : undefined;
  const dot = qualified.lastIndexOf(".");
  if (dot > 0) {
    const schema = qualified.slice(0, dot);
    const table = qualified.slice(dot + 1);
    return { schema: schemaFromMeta ?? schema, table };
  }
  return { schema: schemaFromMeta, table: qualified };
}

function columnNames(meta: ModelMetaLike): Set<string> {
  const columns = new Set<string>();
  if (meta.columns) {
    for (const [key, value] of Object.entries(meta.columns)) {
      if (!value || typeof value !== "object") {
        columns.add(key);
        continue;
      }
      const columnName = (value as { columnName?: unknown }).columnName;
      columns.add(
        typeof columnName === "string" && columnName.trim()
          ? columnName.trim()
          : key
      );
      columns.add(key);
    }
  }
  if (Array.isArray(meta.primaryKey)) {
    for (const key of meta.primaryKey) {
      if (typeof key === "string" && key.trim()) {
        columns.add(key.trim());
      }
    }
  }
  return columns;
}

function toDescriptor(model: ModelLike): AthenaRuntimeModelDescriptor {
  const meta = model.meta ?? {};
  const { schema, table } = physicalTable(meta, model);
  const canonicalResource = schema ? `${schema}.${table}` : table;
  const primaryKey = Array.isArray(meta.primaryKey)
    ? meta.primaryKey.filter(
        (key): key is string => typeof key === "string" && key.trim().length > 0
      )
    : [];
  const relations = new Map<string, ModelRelationMetadata>();
  if (meta.relations) {
    for (const [name, relation] of Object.entries(meta.relations)) {
      if (relation) {
        relations.set(name, relation);
      }
    }
  }
  return {
    canonicalResource,
    columns: columnNames(meta),
    primaryKey: primaryKey.length > 0 ? primaryKey : undefined,
    relations,
    schema,
    table,
    uniqueKeys: primaryKey.length > 0 ? [primaryKey] : [],
  };
}

function invalidRegistry(message: string): AthenaConfigurationError {
  return new AthenaConfigurationError(
    "ATHENA_RUNTIME_CONFIG_INVALID",
    `ATHENA_MODEL_INVALID_REGISTRY: ${message}`,
    "db"
  );
}

export function buildAthenaRuntimeModelIndex(
  models: unknown,
  enforcement: AthenaRuntimeModelEnforcement
): AthenaRuntimeModelIndex {
  const collected: ModelLike[] = [];
  collectModels(models, collected);
  const byAlias = new Map<string, AthenaRuntimeModelDescriptor>();
  const descriptors: AthenaRuntimeModelDescriptor[] = [];
  const claimedCanonical = new Set<string>();

  for (const model of collected) {
    const descriptor = toDescriptor(model);
    if (!descriptor.table) {
      throw invalidRegistry("model is missing a table name");
    }
    if (claimedCanonical.has(descriptor.canonicalResource)) {
      throw invalidRegistry(
        `duplicate resource mapping for ${descriptor.canonicalResource}`
      );
    }
    claimedCanonical.add(descriptor.canonicalResource);
    descriptors.push(descriptor);
    const aliases = new Set<string>([
      descriptor.canonicalResource,
      descriptor.table,
    ]);
    if (descriptor.schema) {
      aliases.add(`${descriptor.schema}.${descriptor.table}`);
    }
    for (const alias of aliases) {
      const existing = byAlias.get(alias);
      if (
        existing &&
        existing.canonicalResource !== descriptor.canonicalResource
      ) {
        throw invalidRegistry(`ambiguous resource alias ${alias}`);
      }
      byAlias.set(alias, descriptor);
    }
  }

  return {
    descriptors,
    enforcement,
    get(resource: string) {
      const trimmed = resource.trim();
      if (!trimmed) {
        return undefined;
      }
      return byAlias.get(trimmed);
    },
  };
}

export function resolveModelEnforcement(options: {
  explicit?: AthenaRuntimeModelEnforcement;
  hasModels: boolean;
  securityMode: "trusted" | "authenticated" | "policy";
}): AthenaRuntimeModelEnforcement {
  if (options.explicit) {
    return options.explicit;
  }
  if (options.securityMode === "policy" && options.hasModels) {
    return "strict";
  }
  return "off";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function resourceNameFromPayload(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }
  const table =
    typeof record.table_name === "string" ? record.table_name.trim() : "";
  const view =
    typeof record.view_name === "string" ? record.view_name.trim() : "";
  return table || view || undefined;
}

function pushSelectTokens(target: string[], columns: unknown): void {
  if (typeof columns === "string") {
    for (const part of columns.split(",")) {
      const token = part.trim();
      if (token && token !== "*") {
        target.push(token.split(/\s+as\s+/i)[0]?.trim() ?? token);
      }
    }
    return;
  }
  if (Array.isArray(columns)) {
    for (const part of columns) {
      if (typeof part === "string" && part.trim() && part.trim() !== "*") {
        target.push(part.trim());
      }
    }
  }
}

export function referencedFields(payload: unknown): readonly string[] {
  const record = asRecord(payload);
  if (!record) {
    return [];
  }
  const fields: string[] = [];
  pushSelectTokens(fields, record.columns);
  if (typeof record.select === "string") {
    pushSelectTokens(fields, record.select);
  } else if (isRecord(record.select)) {
    for (const [key, value] of Object.entries(record.select)) {
      if (value === true || value === 1) {
        fields.push(key);
      }
    }
  }
  if (Array.isArray(record.conditions)) {
    for (const condition of record.conditions) {
      if (!isRecord(condition)) {
        continue;
      }
      if (typeof condition.column === "string") {
        fields.push(condition.column);
      }
      if (typeof condition.eq_column === "string") {
        fields.push(condition.eq_column);
      }
    }
  }
  if (isRecord(record.sort_by) && typeof record.sort_by.field === "string") {
    fields.push(record.sort_by.field);
  }
  if (typeof record.aggregation_column === "string") {
    fields.push(record.aggregation_column);
  }
  if (typeof record.group_by === "string") {
    fields.push(record.group_by);
  }
  const bodies = [record.insert_body, record.update_body];
  for (const body of bodies) {
    const rows = Array.isArray(body) ? body : [body];
    for (const row of rows) {
      if (!isRecord(row)) {
        continue;
      }
      fields.push(...Object.keys(row));
    }
  }
  return fields;
}

export function referencedRelations(payload: unknown): readonly string[] {
  const record = asRecord(payload);
  if (!record || !isRecord(record.select)) {
    return [];
  }
  return Object.keys(record.select);
}
