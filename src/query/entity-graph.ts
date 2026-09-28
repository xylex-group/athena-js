import type {
  AthenaQueryDescriptor,
  AthenaQueryFieldDependencyKind,
} from "./descriptor.ts";

export interface AthenaEntityNode {
  data: Record<string, unknown>;
  keyToken: string;
  updatedAt: number;
}

export function isPlainRow(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function extractResultRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(isPlainRow);
  }
  if (!isPlainRow(data)) {
    return [];
  }
  if ("data" in data) {
    if (Array.isArray(data.data)) {
      return data.data.filter(isPlainRow);
    }
    if (isPlainRow(data.data)) {
      return [data.data];
    }
    return [];
  }
  return [data];
}

export function mapResultRows(
  data: unknown,
  mapper: (row: Record<string, unknown>) => Record<string, unknown>
): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => (isPlainRow(item) ? mapper(item) : item));
  }
  if (!isPlainRow(data)) {
    return data;
  }
  if (Array.isArray(data.data)) {
    return {
      ...data,
      data: data.data.map((item) => (isPlainRow(item) ? mapper(item) : item)),
    };
  }
  if (isPlainRow(data.data)) {
    return { ...data, data: mapper(data.data) };
  }
  return mapper(data);
}

export function removeResultRows(
  data: unknown,
  predicate: (row: Record<string, unknown>) => boolean
): unknown {
  if (Array.isArray(data)) {
    return data.filter((item) => !(isPlainRow(item) && predicate(item)));
  }
  if (!isPlainRow(data)) {
    return data;
  }
  if (Array.isArray(data.data)) {
    return {
      ...data,
      data: data.data.filter((item) => !(isPlainRow(item) && predicate(item))),
    };
  }
  if (isPlainRow(data.data) && predicate(data.data)) {
    return { ...data, data: null };
  }
  return data;
}

export function mergeEntityRow(
  current: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  return { ...(current ?? {}), ...incoming };
}

export function descriptorFieldColumns(
  descriptor: AthenaQueryDescriptor,
  role: AthenaQueryFieldDependencyKind
): string[] {
  return descriptor.dependency.fields
    .filter((field) => field.roles.includes(role))
    .map((field) => field.column);
}

export function mutationTouchesQueryMembership(
  query: AthenaQueryDescriptor,
  changedFields: readonly string[]
): boolean {
  if (changedFields.length === 0) {
    return false;
  }
  const watched = new Set([
    ...descriptorFieldColumns(query, "filter"),
    ...descriptorFieldColumns(query, "order"),
  ]);
  return changedFields.some((field) => watched.has(field));
}

export function sameModelTarget(
  left: AthenaQueryDescriptor,
  right: AthenaQueryDescriptor
): boolean {
  return (
    left.target.table === right.target.table &&
    (left.target.schema ?? "") === (right.target.schema ?? "") &&
    (left.target.database ?? "") === (right.target.database ?? "")
  );
}

export function sameCacheContext(
  left: AthenaQueryDescriptor["context"],
  right: AthenaQueryDescriptor["context"]
): boolean {
  return (
    (left?.organizationId ?? "") === (right?.organizationId ?? "") &&
    (left?.userId ?? "") === (right?.userId ?? "") &&
    (left?.accessScope ?? "") === (right?.accessScope ?? "") &&
    (left?.policyRevision ?? "") === (right?.policyRevision ?? "")
  );
}

export function queryDependsOnRelationTarget(
  query: AthenaQueryDescriptor,
  mutation: AthenaQueryDescriptor
): boolean {
  const mutationModel = mutation.target.model ?? mutation.target.table;
  return query.dependency.relations.some(
    (relation) =>
      relation.targetModel === mutationModel ||
      relation.targetModel === mutation.target.table
  );
}

export type AthenaQueryEnvelopeKind =
  | "array"
  | "data-array"
  | "data-single"
  | "row";

export interface AthenaNormalizedQueryPage {
  entities: readonly string[];
  envelope: AthenaQueryEnvelopeKind;
  extras?: Record<string, unknown>;
}

export function describeQueryEnvelope(data: unknown): {
  envelope: AthenaQueryEnvelopeKind;
  extras?: Record<string, unknown>;
} {
  if (Array.isArray(data)) {
    return { envelope: "array" };
  }
  if (isPlainRow(data) && "data" in data) {
    const { data: _rows, ...extras } = data;
    return {
      envelope: Array.isArray(data.data) ? "data-array" : "data-single",
      extras: Object.keys(extras).length > 0 ? extras : undefined,
    };
  }
  return { envelope: "row" };
}

export function materializeNormalizedQueryPage(
  page: AthenaNormalizedQueryPage,
  resolve: (token: string) => Record<string, unknown> | undefined
): unknown {
  const rows = page.entities
    .map((token) => resolve(token))
    .filter((row): row is Record<string, unknown> => Boolean(row));
  if (page.envelope === "array") {
    return rows;
  }
  if (page.envelope === "data-array") {
    return { ...(page.extras ?? {}), data: rows };
  }
  if (page.envelope === "data-single") {
    return { ...(page.extras ?? {}), data: rows[0] ?? null };
  }
  return rows[0];
}

export function isCollectionOperation(
  operation: AthenaQueryDescriptor["operation"]
): boolean {
  return operation === "select" || operation === "findMany";
}
