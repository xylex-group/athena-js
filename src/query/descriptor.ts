import type { AthenaGatewayCondition, AthenaSortBy } from "../gateway/types.ts";
import type { AthenaModelTarget } from "../schema/types.ts";
import { hashAthenaValue } from "./canonicalize.ts";

export const ATHENA_EXECUTABLE = Symbol.for("@xylex-group/athena/executable");

export type AthenaQueryOperation =
  | "select"
  | "findMany"
  | "single"
  | "maybeSingle"
  | "count"
  | "insert"
  | "update"
  | "upsert"
  | "delete";

export type AthenaProjectionKind =
  | "full-model"
  | "partial-model"
  | "aggregate"
  | "expression"
  | "unknown";

export type AthenaQueryFieldDependencyKind =
  | "filter"
  | "order"
  | "projection"
  | "identity";

export interface AthenaQueryTarget {
  database?: string;
  model?: string;
  schema?: string;
  table: string;
}

/**
 * Access-envelope identity for cache / entity graph isolation.
 * `accessScope` should be an opaque, non-secret fingerprint from Auth/Gateway.
 */
export interface AthenaCacheScope {
  accessScope?: string;
  organizationId?: string;
  policyRevision?: string;
  userId?: string;
}

/** @deprecated Use {@link AthenaCacheScope}. */
export type AthenaCacheContextDescriptor = AthenaCacheScope;

export type AthenaPredicateNode =
  | {
      kind: "compare";
      column?: string;
      operator: string;
      value?: unknown;
    }
  | {
      kind: "and" | "or";
      nodes: readonly AthenaPredicateNode[];
    }
  | {
      kind: "not";
      node: AthenaPredicateNode;
    };

export interface AthenaSelectionNode {
  columns?: readonly string[];
  name: string;
  star?: boolean;
  targetModel?: string;
  targetSchema?: string;
}

export interface AthenaPagination {
  currentPage?: number;
  limit?: number;
  offset?: number;
  pageSize?: number;
}

export interface AthenaProjectionDescriptor {
  columns?: readonly string[];
  kind: AthenaProjectionKind;
  star?: boolean;
}

export interface AthenaFilterDescriptor {
  column?: string;
  operator: string;
  value?: unknown;
}

export interface AthenaOrderDescriptor {
  ascending: boolean;
  column: string;
}

export interface AthenaRangeDescriptor {
  currentPage?: number;
  limit?: number;
  offset?: number;
  pageSize?: number;
}

export interface AthenaRelationDescriptor {
  columns?: readonly string[];
  name: string;
  sourceColumns?: readonly string[];
  star?: boolean;
  targetColumns?: readonly string[];
  targetModel?: string;
  targetSchema?: string;
  via?: string;
}

export interface AthenaModelDependency {
  database?: string;
  model?: string;
  schema?: string;
  table: string;
}

export interface AthenaFieldDependency {
  column: string;
  roles: readonly AthenaQueryFieldDependencyKind[];
  table: string;
}

export interface AthenaQueryDependencyDescriptor {
  fields: readonly AthenaFieldDependency[];
  models: readonly AthenaModelDependency[];
  relations: readonly AthenaRelationDependency[];
}

export interface AthenaRelationDependency {
  name: string;
  targetModel?: string;
  targetSchema?: string;
}

export interface AthenaQueryDescriptor {
  changedFields?: readonly string[];
  context?: AthenaCacheScope;
  dependency: AthenaQueryDependencyDescriptor;
  filters?: readonly AthenaFilterDescriptor[];
  modelFingerprint?: string;
  modelScopeKey: readonly unknown[];
  operation: AthenaQueryOperation;
  order?: readonly AthenaOrderDescriptor[];
  pagination?: AthenaPagination;
  predicate?: AthenaPredicateNode;
  projection?: AthenaProjectionDescriptor;
  queryKey: readonly unknown[];
  range?: AthenaRangeDescriptor;
  relations?: readonly AthenaRelationDescriptor[];
  schemaRevision?: string;
  scope?: AthenaCacheScope;
  selection?: readonly AthenaSelectionNode[];
  target: AthenaQueryTarget;
  version: 1 | 2;
}

export interface AthenaExecuteOptions {
  signal?: AbortSignal;
}

export interface AthenaExecutable<TResult> {
  capture(): AthenaExecutable<TResult>;
  execute(options?: AthenaExecuteOptions): Promise<TResult>;
  getDescriptor(): AthenaQueryDescriptor;
  readonly model?: AthenaModelTarget;
}

export interface AthenaQueryDescriptorCompileInput {
  changedFields?: readonly string[];
  conditions?: readonly AthenaGatewayCondition[];
  context?: AthenaCacheScope;
  currentPage?: number;
  limit?: number;
  model?: AthenaModelTarget;
  offset?: number;
  operation: AthenaQueryOperation;
  order?: AthenaSortBy;
  pageSize?: number;
  projection?: string | readonly string[] | null;
  /** Relations actually consumed by this query — not the model's full graph. */
  relations?: readonly AthenaRelationDescriptor[];
  schemaRevision?: string;
  tableName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableHash(value: unknown): string {
  return hashAthenaValue(value);
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseQualifiedTable(tableName: string): {
  schema?: string;
  table: string;
} {
  const trimmed = tableName.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) {
    return { table: trimmed };
  }
  return {
    schema: trimmed.slice(0, dot),
    table: trimmed.slice(dot + 1),
  };
}

export function resolveAthenaQueryTarget(
  tableName: string,
  model?: AthenaModelTarget
): AthenaQueryTarget {
  const parsed = parseQualifiedTable(tableName);
  const meta = model?.meta;
  const schema = normalizeOptional(meta?.schema) ?? parsed.schema;
  const table =
    normalizeOptional(meta?.tableName)?.split(".").at(-1) ?? parsed.table;
  return {
    database: normalizeOptional(meta?.database),
    model: normalizeOptional(meta?.model),
    schema,
    table,
  };
}

function looksAggregate(column: string): boolean {
  return /\b(?:avg|count|max|min|sum)\s*\(/i.test(column);
}

function looksExpression(column: string): boolean {
  return /[(:]| as /i.test(column);
}

function compileProjection(
  projection: string | readonly string[] | null | undefined,
  model?: AthenaModelTarget
): AthenaProjectionDescriptor {
  const modelColumns = model?.meta.columns
    ? Object.keys(model.meta.columns)
    : [];

  const classifyColumns = (
    columns: readonly string[]
  ): AthenaProjectionKind => {
    if (columns.some((column) => looksAggregate(column))) {
      return "aggregate";
    }
    if (columns.some((column) => looksExpression(column))) {
      return "expression";
    }
    if (!model) {
      return "unknown";
    }
    const known = new Set([...modelColumns, ...(model.meta.primaryKey ?? [])]);
    if (columns.every((column) => known.has(column))) {
      return columns.length === modelColumns.length &&
        modelColumns.every((column) => columns.includes(column))
        ? "full-model"
        : "partial-model";
    }
    return "unknown";
  };

  if (projection === undefined || projection === null) {
    return { kind: model ? "full-model" : "unknown", star: true };
  }
  if (typeof projection === "string") {
    const trimmed = projection.trim();
    if (!trimmed || trimmed === "*") {
      return { kind: model ? "full-model" : "unknown", star: true };
    }
    return { columns: [trimmed], kind: classifyColumns([trimmed]) };
  }
  const columns = projection.map((column) => column.trim()).filter(Boolean);
  if (columns.length === 0 || columns.includes("*")) {
    return { kind: model ? "full-model" : "unknown", star: true };
  }
  const sorted = [...columns].sort((left, right) => left.localeCompare(right));
  return { columns: sorted, kind: classifyColumns(sorted) };
}

function compileFilters(
  conditions: readonly AthenaGatewayCondition[] | undefined
): AthenaFilterDescriptor[] {
  if (!conditions?.length) {
    return [];
  }
  return conditions
    .map((condition) => ({
      column: condition.column ?? condition.eq_column,
      operator: condition.operator,
      value: condition.value ?? condition.eq_value,
    }))
    .sort((left, right) => {
      const columnCompare = (left.column ?? "").localeCompare(
        right.column ?? ""
      );
      if (columnCompare !== 0) {
        return columnCompare;
      }
      const operatorCompare = left.operator.localeCompare(right.operator);
      if (operatorCompare !== 0) {
        return operatorCompare;
      }
      return stableHash(left.value).localeCompare(stableHash(right.value));
    });
}

function compileOrder(
  order: AthenaSortBy | undefined
): AthenaOrderDescriptor[] {
  if (!order?.field) {
    return [];
  }
  return [
    {
      ascending: order.direction !== "descending",
      column: order.field,
    },
  ];
}

function compileRange(
  input: AthenaQueryDescriptorCompileInput
): AthenaRangeDescriptor | undefined {
  if (
    input.limit === undefined &&
    input.offset === undefined &&
    input.currentPage === undefined &&
    input.pageSize === undefined
  ) {
    return;
  }
  return {
    currentPage: input.currentPage,
    limit: input.limit,
    offset: input.offset,
    pageSize: input.pageSize,
  };
}

function compileRelations(
  input: AthenaQueryDescriptorCompileInput
): AthenaRelationDescriptor[] {
  const requested = input.relations;
  if (!requested?.length) {
    return [];
  }
  const modelRelations = input.model?.meta.relations;
  return [...requested]
    .map((relation) => {
      const meta = modelRelations?.[relation.name];
      return {
        columns: relation.columns,
        name: relation.name,
        sourceColumns: relation.sourceColumns ?? meta?.sourceColumns,
        star: relation.star ?? !relation.columns?.length,
        targetColumns: relation.targetColumns ?? meta?.targetColumns,
        targetModel: relation.targetModel ?? meta?.targetModel,
        targetSchema: relation.targetSchema ?? meta?.targetSchema,
        via: relation.via ?? meta?.targetModel,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function compileContext(
  context: AthenaCacheScope | undefined
): AthenaCacheScope | undefined {
  if (!context) {
    return;
  }
  const organizationId = normalizeOptional(context.organizationId);
  const userId = normalizeOptional(context.userId);
  const accessScope = normalizeOptional(context.accessScope);
  const policyRevision = normalizeOptional(context.policyRevision);
  if (!(organizationId || userId || accessScope || policyRevision)) {
    return;
  }
  return {
    ...(accessScope ? { accessScope } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(policyRevision ? { policyRevision } : {}),
    ...(userId ? { userId } : {}),
  };
}

function compilePredicate(
  filters: readonly AthenaFilterDescriptor[]
): AthenaPredicateNode | undefined {
  if (filters.length === 0) {
    return;
  }
  const nodes: AthenaPredicateNode[] = filters.map((filter) => ({
    column: filter.column,
    kind: "compare",
    operator: filter.operator,
    value: filter.value,
  }));
  if (nodes.length === 1) {
    return nodes[0];
  }
  return { kind: "and", nodes };
}

function compileSelection(
  target: AthenaQueryTarget,
  projection: AthenaProjectionDescriptor,
  relations: readonly AthenaRelationDescriptor[]
): AthenaSelectionNode[] {
  const root: AthenaSelectionNode = {
    columns: projection.columns,
    name: target.model ?? target.table,
    star: projection.star,
    targetModel: target.model,
    targetSchema: target.schema,
  };
  const nested = relations.map((relation) => ({
    columns: relation.columns,
    name: relation.name,
    star: relation.star,
    targetModel: relation.targetModel,
    targetSchema: relation.targetSchema,
  }));
  return [root, ...nested];
}

function compileDependencies(
  target: AthenaQueryTarget,
  filters: readonly AthenaFilterDescriptor[],
  order: readonly AthenaOrderDescriptor[],
  projection: AthenaProjectionDescriptor,
  relations: readonly AthenaRelationDescriptor[],
  model?: AthenaModelTarget
): AthenaQueryDependencyDescriptor {
  const fields = new Map<string, AthenaFieldDependency>();
  const addField = (
    column: string | undefined,
    role: AthenaQueryFieldDependencyKind
  ) => {
    if (!column) {
      return;
    }
    const key = `${target.table}.${column}`;
    const existing = fields.get(key);
    if (existing) {
      if (!existing.roles.includes(role)) {
        fields.set(key, {
          column,
          roles: [...existing.roles, role],
          table: target.table,
        });
      }
      return;
    }
    fields.set(key, { column, roles: [role], table: target.table });
  };

  for (const filter of filters) {
    addField(filter.column, "filter");
  }
  for (const entry of order) {
    addField(entry.column, "order");
  }
  if (!projection.star) {
    for (const column of projection.columns ?? []) {
      addField(column, "projection");
    }
  }
  for (const column of model?.meta.primaryKey ?? []) {
    addField(column, "identity");
  }

  const models: AthenaModelDependency[] = [
    {
      database: target.database,
      model: target.model,
      schema: target.schema,
      table: target.table,
    },
  ];
  for (const relation of relations) {
    if (relation.targetModel) {
      models.push({
        model: relation.targetModel,
        schema: relation.targetSchema,
        table: relation.targetModel,
      });
    }
  }

  return {
    fields: [...fields.values()].sort((left, right) =>
      `${left.table}.${left.column}`.localeCompare(
        `${right.table}.${right.column}`
      )
    ),
    models,
    relations: relations.map((relation) => ({
      name: relation.name,
      targetModel: relation.targetModel,
      targetSchema: relation.targetSchema,
    })),
  };
}

export function buildAthenaModelScopeKey(
  target: AthenaQueryTarget,
  context?: AthenaCacheContextDescriptor
): readonly unknown[] {
  const qualified = target.schema
    ? `${target.schema}.${target.table}`
    : target.table;
  return ["athena", "model", context ?? null, qualified];
}

export function buildAthenaQueryKey(
  modelScopeKey: readonly unknown[],
  operation: AthenaQueryOperation,
  hashes: {
    filters: string;
    order: string;
    projection: string;
    range: string;
    relations: string;
  }
): readonly unknown[] {
  return [
    ...modelScopeKey,
    operation,
    hashes.projection,
    hashes.filters,
    hashes.relations,
    hashes.order,
    hashes.range,
  ];
}

export function compileAthenaQueryDescriptor(
  input: AthenaQueryDescriptorCompileInput
): AthenaQueryDescriptor {
  const target = resolveAthenaQueryTarget(input.tableName, input.model);
  const context = compileContext(input.context);
  const projection = compileProjection(input.projection, input.model);
  const filters = compileFilters(input.conditions);
  const order = compileOrder(input.order);
  const range = compileRange(input);
  const relations = compileRelations(input);
  const dependency = compileDependencies(
    target,
    filters,
    order,
    projection,
    relations,
    input.model
  );
  const predicate = compilePredicate(filters);
  const selection = compileSelection(target, projection, relations);
  const modelScopeKey = buildAthenaModelScopeKey(target, context);
  const modelFingerprint = hashAthenaValue({
    model: target.model ?? null,
    schema: target.schema ?? null,
    table: target.table,
  });
  const queryKey = buildAthenaQueryKey(modelScopeKey, input.operation, {
    filters: stableHash(filters),
    order: stableHash(order),
    projection: stableHash({
      columns: projection.columns ?? null,
      star: Boolean(projection.star),
    }),
    range: stableHash(range ?? null),
    relations: stableHash(relations),
  });

  return freezeAthenaQueryDescriptor({
    changedFields: input.changedFields?.length
      ? [...input.changedFields].sort((left, right) =>
          left.localeCompare(right)
        )
      : undefined,
    context,
    dependency,
    filters: filters.length > 0 ? filters : undefined,
    modelFingerprint,
    modelScopeKey,
    operation: input.operation,
    order: order.length > 0 ? order : undefined,
    pagination: range,
    predicate,
    projection,
    queryKey,
    range,
    relations: relations.length > 0 ? relations : undefined,
    schemaRevision: input.schemaRevision,
    scope: context,
    selection,
    target,
    version: 2,
  });
}

function freezeAthenaQueryDescriptor(
  descriptor: AthenaQueryDescriptor
): AthenaQueryDescriptor {
  freezeDeep(descriptor.dependency.fields);
  freezeDeep(descriptor.dependency.models);
  freezeDeep(descriptor.dependency.relations);
  freezeDeep(descriptor.dependency);
  if (descriptor.filters) {
    freezeDeep(descriptor.filters);
  }
  if (descriptor.order) {
    freezeDeep(descriptor.order);
  }
  if (descriptor.projection) {
    freezeDeep(descriptor.projection);
  }
  if (descriptor.range) {
    freezeDeep(descriptor.range);
  }
  if (descriptor.relations) {
    freezeDeep(descriptor.relations);
  }
  if (descriptor.context) {
    freezeDeep(descriptor.context);
  }
  if (descriptor.scope) {
    freezeDeep(descriptor.scope);
  }
  if (descriptor.selection) {
    freezeDeep(descriptor.selection);
  }
  if (descriptor.predicate) {
    freezeDeep(descriptor.predicate);
  }
  freezeDeep(descriptor.target);
  freezeDeep(descriptor.modelScopeKey);
  freezeDeep(descriptor.queryKey);
  if (descriptor.changedFields) {
    freezeDeep(descriptor.changedFields);
  }
  return Object.freeze(descriptor);
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      freezeDeep(item);
    }
  } else {
    for (const key of Object.keys(value as object)) {
      freezeDeep((value as Record<string, unknown>)[key]);
    }
  }
  return Object.freeze(value);
}

export function createCapturedAthenaExecutable<TResult>(input: {
  descriptor: AthenaQueryDescriptor;
  execute: (options?: AthenaExecuteOptions) => Promise<TResult>;
  model?: AthenaModelTarget;
}): AthenaExecutable<TResult> {
  const captured: AthenaExecutable<TResult> = {
    capture() {
      return captured;
    },
    execute: (options) => input.execute(options),
    getDescriptor() {
      return input.descriptor;
    },
    model: input.model,
  };
  return captured;
}

export function isAthenaExecutable(
  value: unknown
): value is AthenaExecutable<unknown> {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.getDescriptor === "function" &&
    typeof value.execute === "function" &&
    typeof value.capture === "function"
  );
}

export function peekSyncCacheContext(
  resolve:
    | (() =>
        | {
            accessScope?: string | null;
            organizationId?: string | null;
            policyRevision?: string | null;
            userId?: string | null;
          }
        | undefined
        | Promise<unknown>)
    | undefined
): AthenaCacheScope | undefined {
  if (!resolve) {
    return;
  }
  const resolved = resolve();
  if (
    resolved &&
    typeof resolved === "object" &&
    "then" in resolved &&
    typeof resolved.then === "function"
  ) {
    return;
  }
  if (!resolved || typeof resolved !== "object") {
    return;
  }
  const record = resolved as {
    accessScope?: string | null;
    organizationId?: string | null;
    policyRevision?: string | null;
    userId?: string | null;
  };
  return compileContext({
    accessScope: record.accessScope ?? undefined,
    organizationId: record.organizationId ?? undefined,
    policyRevision: record.policyRevision ?? undefined,
    userId: record.userId ?? undefined,
  });
}
