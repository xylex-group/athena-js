import type {
  AthenaConditionArrayValue,
  AthenaConditionOperator,
  AthenaConditionValue,
  AthenaGatewayCondition,
  AthenaJsonValue,
  AthenaSortBy,
} from "./gateway/types.ts";
import type {
  AnyModelDef,
  DatabaseDef,
  ModelDef,
  ModelRelationMetadata,
  RegistryDef,
  RowOf,
  SchemaDef,
} from "./schema/types.ts";
import type {
  AthenaColumnKey,
  HasKnownSelectColumns,
} from "./select-column-types.ts";

type AthenaRowShape = Record<string, AthenaJsonValue | undefined>;
type FilterColumnKey<Row> = Extract<keyof NonNullable<Row>, string>;
type ResolvedFilterColumnKey<Row> = [FilterColumnKey<Row>] extends [never]
  ? string
  : FilterColumnKey<Row>;
type KnownSelectColumnKey<Row> = AthenaColumnKey<Row>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AthenaFilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "is"
  | "in"
  | "contains"
  | "containedBy";

type AthenaWherePrimitive = AthenaConditionValue;

export interface AthenaWhereOperatorInput {
  containedBy?: AthenaConditionArrayValue;
  contains?: AthenaConditionArrayValue;
  eq?: AthenaConditionValue;
  gt?: AthenaConditionValue;
  gte?: AthenaConditionValue;
  ilike?: AthenaConditionValue;
  in?: AthenaConditionArrayValue;
  is?: AthenaConditionValue;
  like?: AthenaConditionValue;
  lt?: AthenaConditionValue;
  lte?: AthenaConditionValue;
  neq?: AthenaConditionValue;
}

export type AthenaRelationWhereInput<Row = AthenaRowShape> = {
  every?: AthenaWhere<Row>;
  exists?: true | Record<string, never>;
  is?: AthenaWhere<Row> | null;
  isNot?: AthenaWhere<Row> | null;
  none?: AthenaWhere<Row>;
  some?: AthenaWhere<Row>;
};

type AthenaWhereColumnInput<Row = AthenaRowShape> = Partial<
  Record<
    ResolvedFilterColumnKey<Row>,
    AthenaWherePrimitive | AthenaWhereOperatorInput | AthenaRelationWhereInput
  >
>;

type AthenaBooleanSafeOperator = Exclude<
  AthenaFilterOperator,
  "in" | "contains" | "containedBy"
>;

type AthenaWhereBooleanSafeOperatorInput = Partial<
  Record<AthenaBooleanSafeOperator, AthenaConditionValue>
>;

type AthenaWhereBooleanNotOperatorInput = {
  [K in AthenaBooleanSafeOperator]: {
    [P in K]: AthenaConditionValue;
  } & Partial<Record<Exclude<AthenaBooleanSafeOperator, K>, never>>;
}[AthenaBooleanSafeOperator];

type AthenaStrictBooleanOperand<Keys extends string, Value> = {
  [K in Keys]: {
    [P in K]: Value;
  } & Partial<Record<Exclude<Keys, K>, never>>;
}[Keys];

type AthenaNonEmptyArray<T> = [T, ...T[]];

export type AthenaWhereBooleanOperand<Row = AthenaRowShape> =
  string extends ResolvedFilterColumnKey<Row>
    ? AthenaWhereColumnInput<Row>
    : AthenaStrictBooleanOperand<
        ResolvedFilterColumnKey<Row>,
        AthenaWherePrimitive | AthenaWhereBooleanSafeOperatorInput
      >;

type AthenaWhereNotOperand<Row = AthenaRowShape> =
  string extends ResolvedFilterColumnKey<Row>
    ? AthenaWhereColumnInput<Row>
    : AthenaStrictBooleanOperand<
        ResolvedFilterColumnKey<Row>,
        AthenaWherePrimitive | AthenaWhereBooleanNotOperatorInput
      >;

export type AthenaWhere<Row = AthenaRowShape> = AthenaWhereColumnInput<Row> & {
  or?: string extends ResolvedFilterColumnKey<Row>
    ? AthenaWhereColumnInput<Row>[]
    : AthenaNonEmptyArray<AthenaWhereBooleanOperand<Row>>;
  not?: AthenaWhereNotOperand<Row>;
};

export interface AthenaRelationSelectNode<
  TSelect extends AthenaSelectShape = AthenaSelectShape,
> {
  as?: string;
  limit?: number;
  offset?: number;
  orderBy?: AthenaOrderBy;
  schema?: string;
  select: TSelect;
  via?: string;
  where?: AthenaWhere;
}

export type AthenaSelectShape = Record<
  string,
  true | AthenaRelationSelectNode<AthenaSelectShape>
>;

type AthenaAllowedRelationSelectNodeKey =
  | "select"
  | "as"
  | "via"
  | "schema"
  | "where"
  | "orderBy"
  | "limit"
  | "offset";

/**
 * Structural validation only (relation node shape). Nested relation target rows
 * are not model-checked here unless a richer context path is wired later.
 */
type AthenaStructuralValidatedSelectShape<TSelect> = {
  [K in keyof TSelect]: TSelect[K] extends true
    ? true
    : AthenaValidatedRelationSelectNode<TSelect[K]>;
};

type AthenaValidatedRelationSelectNode<TNode> = TNode extends {
  select: infer TChild;
}
  ? Exclude<keyof TNode, AthenaAllowedRelationSelectNodeKey> extends never
    ? TNode extends { schema: string; via: string }
      ? never
      : TChild extends Record<string, unknown>
        ? {
            [K in keyof TNode]: K extends "select"
              ? AthenaStructuralValidatedSelectShape<TChild>
              : K extends AthenaAllowedRelationSelectNodeKey
                ? TNode[K]
                : never;
          }
        : never
    : never
  : never;

/**
 * Compile-time validation for `findMany({ select })`.
 *
 * - When `Row` has known model keys: scalar `true` entries must use those keys.
 * - Relation nodes (`{ select: ... }`) keep structural validation and may use
 *   non-row keys (relation names are not row columns).
 * - When `Row` is untyped: free-form keys (same as pre-model behavior).
 */
export type AthenaValidatedSelectShape<Row, TSelect> =
  HasKnownSelectColumns<Row> extends true
    ? {
        [K in keyof TSelect]: TSelect[K] extends true
          ? K extends KnownSelectColumnKey<Row>
            ? true
            : never
          : AthenaValidatedRelationSelectNode<TSelect[K]>;
      }
    : AthenaStructuralValidatedSelectShape<TSelect>;

type GenericRegistryDef = RegistryDef<
  Record<
    string,
    DatabaseDef<Record<string, SchemaDef<Record<string, AnyModelDef>>>>
  >
>;

type AthenaOrderByDirectionInput =
  | "asc"
  | "desc"
  | "ascending"
  | "descending"
  | boolean
  | {
      ascending?: boolean;
    };

export type AthenaOrderBy<Row = AthenaRowShape> =
  | {
      column: ResolvedFilterColumnKey<Row>;
      ascending?: boolean;
    }
  | Partial<Record<ResolvedFilterColumnKey<Row>, AthenaOrderByDirectionInput>>;

export interface AthenaFindManyOptions<
  Row = AthenaRowShape,
  TSelect extends AthenaSelectShape = AthenaSelectShape,
> {
  limit?: number;
  orderBy?: AthenaOrderBy<Row>;
  /**
   * Object select tree. Callers should pass through `findMany(...)`, which
   * intersects this with `AthenaValidatedSelectShape<Row, TSelect>` so model
   * column keys are checked after `TSelect` is inferred from the literal.
   */
  select: TSelect;
  where?: AthenaWhere<Row>;
}

interface AthenaModelContext<
  TRegistry extends GenericRegistryDef = GenericRegistryDef,
  TDatabase extends string = string,
  TSchema extends string = string,
  TModel extends AnyModelDef = AnyModelDef,
> {
  database: TDatabase;
  model: TModel;
  registry: TRegistry;
  schema: TSchema;
}

type Simplify<T> = {
  [K in keyof T]: T[K];
} & {};

type ContextRegistry<TContext> =
  TContext extends AthenaModelContext<
    infer TRegistry,
    string,
    string,
    AnyModelDef
  >
    ? TRegistry
    : never;

type ContextDatabase<TContext> =
  TContext extends AthenaModelContext<
    GenericRegistryDef,
    infer TDatabase,
    string,
    AnyModelDef
  >
    ? TDatabase
    : never;

type ContextModel<TContext> =
  TContext extends AthenaModelContext<
    GenericRegistryDef,
    string,
    string,
    infer TModel
  >
    ? TModel
    : never;

type ModelMetaOf<TContext> =
  ContextModel<TContext> extends ModelDef<
    unknown,
    unknown,
    unknown,
    infer TMeta
  >
    ? TMeta
    : never;

type ModelRelationsOf<TContext> = NonNullable<
  ModelMetaOf<TContext>["relations"]
>;

type SelectedResultKey<TKey extends string, TValue> = TValue extends {
  as: infer TAlias extends string;
}
  ? TAlias
  : TKey;

type ScalarSelectionResult<Row, TSelect extends AthenaSelectShape> = {
  [TKey in Extract<keyof TSelect, string> as TSelect[TKey] extends true
    ? TKey
    : never]-?: TKey extends keyof NonNullable<Row>
    ? NonNullable<Row>[TKey]
    : unknown;
};

type RelationByKey<
  TContext,
  TKey extends string,
> = TKey extends keyof ModelRelationsOf<TContext>
  ? ModelRelationsOf<TContext>[TKey]
  : never;

type RelationByVia<TContext, TVia extends string> = {
  [TKey in keyof ModelRelationsOf<TContext>]: ModelRelationsOf<TContext>[TKey] extends infer TRelation
    ? TRelation extends ModelRelationMetadata
      ? TVia extends TRelation["sourceColumns"][number]
        ? TRelation
        : never
      : never
    : never;
}[keyof ModelRelationsOf<TContext>];

type ResolvedRelation<TContext, TKey extends string, TValue> =
  RelationByKey<TContext, TKey> extends never
    ? TValue extends { via: infer TVia extends string }
      ? RelationByVia<TContext, TVia>
      : never
    : RelationByKey<TContext, TKey>;

type TargetDatabaseName<
  TContext,
  TRelation extends ModelRelationMetadata,
> = TRelation["targetDatabase"] extends string
  ? TRelation["targetDatabase"]
  : ContextDatabase<TContext>;

type ResolveTargetModel<TContext, TRelation extends ModelRelationMetadata> =
  ContextRegistry<TContext> extends infer TRegistry
    ? TRegistry extends GenericRegistryDef
      ? TargetDatabaseName<TContext, TRelation> extends keyof TRegistry & string
        ? TRelation["targetSchema"] extends keyof TRegistry[TargetDatabaseName<
            TContext,
            TRelation
          >]["schemas"] &
            string
          ? TRelation["targetModel"] extends keyof TRegistry[TargetDatabaseName<
              TContext,
              TRelation
            >]["schemas"][TRelation["targetSchema"]]["models"] &
              string
            ? TRegistry[TargetDatabaseName<
                TContext,
                TRelation
              >]["schemas"][TRelation["targetSchema"]]["models"][TRelation["targetModel"]]
            : never
          : never
        : never
      : never
    : never;

type RelationResultValue<
  TRelation extends ModelRelationMetadata,
  TValue,
  TContext,
> =
  TValue extends AthenaRelationSelectNode<infer TChildSelect>
    ? ResolveTargetModel<TContext, TRelation> extends infer TTargetModel
      ? TTargetModel extends AnyModelDef
        ? TRelation["kind"] extends "one-to-many" | "many-to-many"
          ? AthenaFindManyResult<
              RowOf<TTargetModel>,
              TChildSelect,
              AthenaModelContext<
                ContextRegistry<TContext>,
                TargetDatabaseName<TContext, TRelation>,
                TRelation["targetSchema"],
                TTargetModel
              >
            >[]
          : AthenaFindManyResult<
              RowOf<TTargetModel>,
              TChildSelect,
              AthenaModelContext<
                ContextRegistry<TContext>,
                TargetDatabaseName<TContext, TRelation>,
                TRelation["targetSchema"],
                TTargetModel
              >
            > | null
        : unknown
      : unknown
    : never;

type RelationSelectionResult<TContext, TSelect extends AthenaSelectShape> = {
  [TKey in Extract<
    keyof TSelect,
    string
  > as TSelect[TKey] extends AthenaRelationSelectNode<AthenaSelectShape>
    ? SelectedResultKey<TKey, TSelect[TKey]>
    : never]-?: ResolvedRelation<
    TContext,
    TKey,
    TSelect[TKey]
  > extends infer TRelation
    ? TRelation extends ModelRelationMetadata
      ? RelationResultValue<TRelation, TSelect[TKey], TContext>
      : unknown
    : unknown;
};

export type AthenaFindManyResult<
  Row,
  TSelect extends AthenaSelectShape,
  TContext = unknown,
> = Simplify<
  ScalarSelectionResult<Row, TSelect> &
    RelationSelectionResult<TContext, TSelect>
>;

const FILTER_OPERATORS = new Set<AthenaFilterOperator>([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "contains",
  "containedBy",
]);

const BOOLEAN_SAFE_OPERATORS = new Set<AthenaBooleanSafeOperator>([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuidString(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

function isUuidIdentifierColumn(column: string): boolean {
  return (
    column === "id" ||
    /(?:^|_)uuid(?:_|$)/i.test(column) ||
    /_id$/i.test(column)
  );
}

export function shouldUseUuidTextComparison(
  column: string,
  value: AthenaConditionValue
): boolean {
  return (
    typeof value === "string" &&
    isUuidString(value) &&
    isUuidIdentifierColumn(column)
  );
}

function isRelationSelectNode(
  value: unknown
): value is AthenaRelationSelectNode {
  return isRecord(value) && isRecord(value.select);
}

function normalizeIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return normalized;
}

function stringifyFilterValue(
  value: AthenaConditionValue | AthenaConditionArrayValue | string
): string {
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return String(value);
}

function buildGatewayCondition(
  operator: AthenaConditionOperator,
  column?: string,
  value?: AthenaConditionValue | AthenaConditionArrayValue | string
): AthenaGatewayCondition {
  const condition: AthenaGatewayCondition = { operator };
  if (column) {
    condition.column = column;
    if (operator === "eq") {
      condition.eq_column = column;
    }
  }
  if (value !== undefined) {
    condition.value = value;
    if (operator === "eq") {
      condition.eq_value = value;
    }
  }
  if (
    operator === "eq" &&
    column &&
    value !== undefined &&
    shouldUseUuidTextComparison(column, value as AthenaConditionValue)
  ) {
    condition.column_cast = "text";
    condition.eq_column_cast = "text";
  }
  return condition;
}

function compileRelationToken(
  key: string,
  node: AthenaRelationSelectNode
): string {
  const nested = compileSelectShape(node.select);
  const propertyKey = normalizeIdentifier(key, "select relation key");
  if (node.schema && node.via) {
    throw new Error(
      `findMany relation "${propertyKey}" cannot combine schema and via yet; use schema with the relation key, or use via without schema`
    );
  }

  const relationTokenBase = normalizeIdentifier(
    node.via ?? propertyKey,
    "select relation token"
  );
  if (node.schema && relationTokenBase.includes(".")) {
    throw new Error(
      `findMany relation "${propertyKey}" already resolves to a qualified relation token; do not also set schema`
    );
  }

  const relationSchema = node.schema?.trim();
  const relationToken = relationSchema
    ? `${normalizeIdentifier(relationSchema, "select relation schema")}.${relationTokenBase}`
    : relationTokenBase;
  const alias =
    node.as?.trim() || (relationToken === propertyKey ? "" : propertyKey);
  const prefix = alias ? `${alias}:` : "";
  return `${prefix}${relationToken}(${nested})`;
}

export function compileSelectShape(select: AthenaSelectShape): string {
  if (!isRecord(select)) {
    throw new Error("findMany select must be an object");
  }

  // Emit scalar columns before relation tokens so gateway select lists stay
  // stable regardless of object key insertion order (relations often declared first).
  const columns: string[] = [];
  const relations: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(select)) {
    if (rawValue === undefined) {
      continue;
    }

    if (rawValue === true) {
      columns.push(normalizeIdentifier(rawKey, "select column"));
      continue;
    }

    if (isRelationSelectNode(rawValue)) {
      relations.push(compileRelationToken(rawKey, rawValue));
      continue;
    }

    throw new Error(`Unsupported select node for "${rawKey}"`);
  }

  const tokens = [...columns, ...relations];
  if (tokens.length === 0) {
    throw new Error("findMany select requires at least one field");
  }

  return tokens.join(",");
}

export function selectShapeUsesRelationSchema(
  select: AthenaSelectShape
): boolean {
  if (!isRecord(select)) {
    return false;
  }

  for (const rawValue of Object.values(select)) {
    if (!isRelationSelectNode(rawValue)) {
      continue;
    }
    if (
      typeof rawValue.schema === "string" &&
      rawValue.schema.trim().length > 0
    ) {
      return true;
    }
    if (selectShapeUsesRelationSchema(rawValue.select)) {
      return true;
    }
  }

  return false;
}

export function selectShapeHasNestedQueryModifiers(
  select: AthenaSelectShape
): boolean {
  if (!isRecord(select)) {
    return false;
  }

  for (const rawValue of Object.values(select)) {
    if (!isRelationSelectNode(rawValue)) {
      continue;
    }
    if (
      rawValue.where !== undefined ||
      rawValue.orderBy !== undefined ||
      rawValue.limit !== undefined ||
      rawValue.offset !== undefined
    ) {
      return true;
    }
    if (selectShapeHasNestedQueryModifiers(rawValue.select)) {
      return true;
    }
  }

  return false;
}

function compileColumnWhere(
  column: string,
  input: AthenaWherePrimitive | AthenaWhereOperatorInput
): AthenaGatewayCondition[] {
  const normalizedColumn = normalizeIdentifier(column, "where column");
  if (!isRecord(input)) {
    return [
      buildGatewayCondition(
        "eq",
        normalizedColumn,
        input as AthenaConditionValue | AthenaConditionArrayValue | undefined
      ),
    ];
  }

  const conditions: AthenaGatewayCondition[] = [];
  for (const [rawOperator, rawValue] of Object.entries(input)) {
    if (rawValue === undefined) {
      continue;
    }
    if (!FILTER_OPERATORS.has(rawOperator as AthenaFilterOperator)) {
      throw new Error(
        `Unsupported where operator "${rawOperator}" on "${normalizedColumn}"`
      );
    }
    if (
      (rawOperator === "in" ||
        rawOperator === "contains" ||
        rawOperator === "containedBy") &&
      !Array.isArray(rawValue)
    ) {
      throw new Error(
        `where.${normalizedColumn}.${rawOperator} requires an array value`
      );
    }
    conditions.push(
      buildGatewayCondition(
        rawOperator as AthenaFilterOperator,
        normalizedColumn,
        rawValue as AthenaConditionValue | AthenaConditionArrayValue
      )
    );
  }

  if (conditions.length === 0) {
    throw new Error(`where.${normalizedColumn} requires at least one operator`);
  }

  return conditions;
}

function compileBooleanExpressionTerms(
  clause: AthenaWhereBooleanOperand,
  label: "or" | "not"
): string[] {
  if (!isRecord(clause)) {
    throw new Error(`findMany where.${label} clauses must be objects`);
  }

  const entries = Object.entries(clause).filter(
    ([, value]) => value !== undefined
  );
  if (entries.length !== 1) {
    throw new Error(
      `findMany where.${label} clauses must target exactly one column`
    );
  }

  const [rawColumn, rawValue] = entries[0];
  const column = normalizeIdentifier(rawColumn, `where.${label} column`);

  if (!isRecord(rawValue)) {
    return [
      `${column}.eq.${stringifyFilterValue(rawValue as AthenaConditionValue)}`,
    ];
  }

  const operatorEntries = Object.entries(rawValue).filter(
    ([, value]) => value !== undefined
  );
  if (operatorEntries.length === 0) {
    throw new Error(
      `findMany where.${label}.${column} requires at least one operator`
    );
  }

  if (label === "not" && operatorEntries.length > 1) {
    throw new Error(
      "findMany where.not only supports a single lossless operator expression"
    );
  }

  return operatorEntries.map(([rawOperator, rawOperand]) => {
    if (!BOOLEAN_SAFE_OPERATORS.has(rawOperator as AthenaBooleanSafeOperator)) {
      throw new Error(
        `findMany where.${label} only supports lossless scalar operators`
      );
    }
    if (Array.isArray(rawOperand)) {
      throw new Error(
        `findMany where.${label} does not support array-valued operators`
      );
    }
    return `${column}.${rawOperator}.${stringifyFilterValue(rawOperand as AthenaConditionValue)}`;
  });
}

export function compileWhere(
  where?: AthenaWhere
): AthenaGatewayCondition[] | undefined {
  if (where === undefined) {
    return;
  }
  if (!isRecord(where)) {
    throw new Error("findMany where must be an object");
  }

  const conditions: AthenaGatewayCondition[] = [];
  for (const [rawKey, rawValue] of Object.entries(where)) {
    if (rawValue === undefined) {
      continue;
    }

    if (rawKey === "or") {
      if (!Array.isArray(rawValue) || rawValue.length === 0) {
        throw new Error("findMany where.or must be a non-empty array");
      }
      const expressions = rawValue.flatMap((value) =>
        compileBooleanExpressionTerms(value as AthenaWhereBooleanOperand, "or")
      );
      conditions.push(
        buildGatewayCondition("or", undefined, expressions.join(","))
      );
      continue;
    }

    if (rawKey === "not") {
      const expressions = compileBooleanExpressionTerms(
        rawValue as AthenaWhereBooleanOperand,
        "not"
      );
      if (expressions.length !== 1) {
        throw new Error(
          "findMany where.not must compile to exactly one lossless expression"
        );
      }
      conditions.push(buildGatewayCondition("not", undefined, expressions[0]));
      continue;
    }

    conditions.push(
      ...compileColumnWhere(
        rawKey,
        rawValue as AthenaWherePrimitive | AthenaWhereOperatorInput
      )
    );
  }

  return conditions.length > 0 ? conditions : undefined;
}

function resolveOrderDirection(
  input: AthenaOrderByDirectionInput
): AthenaSortBy["direction"] {
  if (typeof input === "boolean") {
    return input === false ? "descending" : "ascending";
  }
  if (typeof input === "string") {
    const normalized = input.trim().toLowerCase();
    if (normalized === "asc" || normalized === "ascending") {
      return "ascending";
    }
    if (normalized === "desc" || normalized === "descending") {
      return "descending";
    }
    throw new Error(`Unsupported orderBy direction "${input}"`);
  }
  return input.ascending === false ? "descending" : "ascending";
}

export function compileOrderBy<Row = AthenaRowShape>(
  orderBy?: AthenaOrderBy<Row>
): AthenaSortBy | undefined {
  if (orderBy === undefined) {
    return;
  }
  if (!isRecord(orderBy)) {
    throw new Error("findMany orderBy must be an object");
  }

  if ("column" in orderBy) {
    return {
      direction: orderBy.ascending === false ? "descending" : "ascending",
      field: normalizeIdentifier(String(orderBy.column), "orderBy column"),
    };
  }

  const entries = Object.entries(orderBy).filter(
    ([, value]) => value !== undefined
  );
  if (entries.length === 0) {
    return;
  }
  if (entries.length > 1) {
    throw new Error("findMany orderBy only supports a single column in v1");
  }

  const [column, input] = entries[0];
  return {
    direction: resolveOrderDirection(input as AthenaOrderByDirectionInput),
    field: normalizeIdentifier(column, "orderBy column"),
  };
}
