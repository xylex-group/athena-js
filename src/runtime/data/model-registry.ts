import { AthenaConfigurationError } from "../../config/errors.ts";
import {
  type AthenaResolvedResource,
  athenaResourceKeys,
  parseAthenaResourceRef,
  resolvedAthenaResource,
} from "../../schema/resource.ts";
import type { ModelRelationMetadata } from "../../schema/types.ts";
import type { AthenaRuntimeModelEnforcement } from "./types.ts";

export interface AthenaRuntimeModelDescriptor extends AthenaResolvedResource {
  readonly columnIdentities: ReadonlyMap<
    string,
    AthenaRuntimeModelColumnIdentity
  >;
  readonly columns: ReadonlySet<string>;
  readonly primaryKey?: readonly string[];
  readonly relations: ReadonlyMap<string, ModelRelationMetadata>;
  readonly uniqueKeys: readonly (readonly string[])[];
}

export interface AthenaRuntimeModelColumnIdentity {
  readonly logical: string;
  readonly physical: string;
}

export interface AthenaRuntimeModelIndex {
  readonly descriptors: readonly AthenaRuntimeModelDescriptor[];
  readonly enforcement: AthenaRuntimeModelEnforcement;
  get(resource: string): AthenaRuntimeModelDescriptor | undefined;
}

interface ModelMetaLike {
  columns?: Partial<Record<string, unknown>>;
  database?: string;
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
  if (!(isRecord(value) && isRecord(value.meta))) {
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

function physicalTable(
  meta: ModelMetaLike,
  model: ModelLike
): {
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
  const parsed = parseAthenaResourceRef(qualified);
  return {
    schema: schemaFromMeta ?? parsed.schema,
    table: parsed.table,
  };
}

function columnIdentities(
  meta: ModelMetaLike
): Map<string, AthenaRuntimeModelColumnIdentity> {
  const identities = new Map<string, AthenaRuntimeModelColumnIdentity>();
  const add = (
    alias: string,
    identity: AthenaRuntimeModelColumnIdentity
  ) => {
    const existing = identities.get(alias);
    if (
      existing &&
      (existing.logical !== identity.logical ||
        existing.physical !== identity.physical)
    ) {
      throw invalidRegistry(
        `ambiguous column alias "${alias}" maps to both "${existing.physical}" and "${identity.physical}"`
      );
    }
    identities.set(alias, identity);
  };
  if (meta.columns) {
    for (const [key, value] of Object.entries(meta.columns)) {
      const physical =
        value && typeof value === "object"
          ? (value as { columnName?: unknown }).columnName
          : undefined;
      const identity = Object.freeze({
        logical: key,
        physical:
          typeof physical === "string" && physical.trim()
            ? physical.trim()
            : key,
      });
      add(identity.logical, identity);
      add(identity.physical, identity);
    }
  }
  if (Array.isArray(meta.primaryKey)) {
    for (const key of meta.primaryKey) {
      if (typeof key !== "string" || !key.trim()) {
        continue;
      }
      const token = key.trim();
      if (!identities.has(token)) {
        add(token, Object.freeze({ logical: token, physical: token }));
      }
    }
  }
  return identities;
}

function columnNames(
  identities: ReadonlyMap<string, AthenaRuntimeModelColumnIdentity>
): Set<string> {
  const columns = new Set<string>();
  for (const identity of identities.values()) {
    columns.add(identity.logical);
    columns.add(identity.physical);
  }
  return columns;
}

function toDescriptor(model: ModelLike): AthenaRuntimeModelDescriptor {
  const meta = model.meta ?? {};
  const { schema, table } = physicalTable(meta, model);
  const identities = columnIdentities(meta);
  const parsedQualified = parseAthenaResourceRef(
    (typeof model.qualifiedName === "string" && model.qualifiedName.trim()) ||
      (typeof meta.tableName === "string" && meta.tableName.trim()) ||
      ""
  );
  const database =
    (typeof meta.database === "string" && meta.database.trim()
      ? meta.database.trim()
      : undefined) ?? parsedQualified.database;
  const modelName =
    typeof meta.model === "string" && meta.model.trim()
      ? meta.model.trim()
      : undefined;
  const resolved = resolvedAthenaResource({
    ...(database ? { database } : {}),
    ...(schema ? { schema } : {}),
    ...(modelName ? { model: modelName } : {}),
    table,
  });
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
    ...resolved,
    columnIdentities: identities,
    columns: columnNames(identities),
    primaryKey: primaryKey.length > 0 ? primaryKey : undefined,
    relations,
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
  const ambiguous = Symbol("ambiguous");
  const byAlias = new Map<
    string,
    AthenaRuntimeModelDescriptor | typeof ambiguous
  >();
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
      ...athenaResourceKeys(descriptor),
    ]);
    for (const alias of aliases) {
      const existing = byAlias.get(alias);
      if (existing === ambiguous) {
        continue;
      }
      if (
        existing &&
        existing.canonicalResource !== descriptor.canonicalResource
      ) {
        byAlias.set(alias, ambiguous);
        continue;
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
        return;
      }
      const found = byAlias.get(trimmed);
      return found === ambiguous ? undefined : found;
    },
  };
}

export function resolveModelEnforcement(options: {
  explicit?: AthenaRuntimeModelEnforcement;
  hasModels: boolean;
  http?: boolean;
  securityMode: "trusted" | "authenticated" | "policy";
}): AthenaRuntimeModelEnforcement {
  if (options.explicit) {
    return options.explicit;
  }
  if (options.securityMode === "policy" && options.hasModels) {
    return "strict";
  }
  if (
    options.http === true &&
    options.hasModels &&
    options.securityMode !== "trusted"
  ) {
    return "known-only";
  }
  return "off";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function resourceNameFromPayload(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) {
    return;
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
  if (!(record && isRecord(record.select))) {
    return [];
  }
  return Object.keys(record.select);
}
