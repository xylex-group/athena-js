import {
  formatObjectRef,
  locationFromOffset,
  type SchemaObjectRef,
  type SequenceRef,
  type TableRef,
} from "./ast.ts";
import { type PgAstNode, pgNameList, pgString } from "./parser.ts";
import { isProceduralName, type PlpgsqlBindings } from "./plpgsql-bindings.ts";
import type {
  DependencyCategory,
  DependencyConfidence,
  NameResolution,
  SemanticDependency,
} from "./semantic-ir.ts";

const QUERY_KINDS = new Set([
  "SelectStmt",
  "InsertStmt",
  "UpdateStmt",
  "DeleteStmt",
]);

const POSTGRES_SYSTEM_COLUMNS = new Set([
  "tableoid",
  "xmin",
  "cmin",
  "xmax",
  "cmax",
  "ctid",
]);

function isPostgresSystemColumn(name: string): boolean {
  return POSTGRES_SYSTEM_COLUMNS.has(name.toLowerCase());
}

interface QueryScope {
  aliases: Map<string, { kind: "cte" | "relation"; table?: TableRef }>;
  ctes: Set<string>;
  parent?: QueryScope;
}

export interface QueryDepContext {
  baseOffset: number;
  filename: string;
  proceduralBindings?: PlpgsqlBindings;
  sql: string;
}

function asRecord(value: unknown): PgAstNode | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as PgAstNode;
  }
}

function unwrap(node: unknown, kind: string): PgAstNode | undefined {
  const record = asRecord(node);
  if (!record) {
    return;
  }
  const inner = asRecord(record[kind]);
  return inner ?? record;
}

function snippetAt(sql: string, offset: number, length = 48): string {
  const start = Math.max(0, offset);
  return sql
    .slice(start, start + length)
    .replace(/\s+/g, " ")
    .trim();
}

function dep(
  category: DependencyCategory,
  object: SchemaObjectRef,
  confidence: DependencyConfidence,
  ctx: QueryDepContext,
  locationOffset: number,
  resolution: NameResolution,
  explicitlyQualified: boolean,
  snippet?: string
): SemanticDependency {
  return {
    category,
    confidence,
    explicitlyQualified,
    location: locationFromOffset(
      ctx.filename,
      ctx.sql,
      ctx.baseOffset + locationOffset
    ),
    object,
    resolution,
    snippet: snippet ?? snippetAt(ctx.sql, ctx.baseOffset + locationOffset),
  };
}

function emptyScope(parent?: QueryScope): QueryScope {
  return {
    aliases: new Map(parent?.aliases),
    ctes: new Set(parent?.ctes),
    parent,
  };
}

function hasCte(scope: QueryScope, name: string): boolean {
  let current: QueryScope | undefined = scope;
  while (current) {
    if (current.ctes.has(name)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function cteEntries(
  withClause: unknown
): Array<{ name: string; query: unknown }> {
  const clause = unwrap(withClause, "WithClause") ?? asRecord(withClause);
  if (!clause) {
    return [];
  }
  const ctes = Array.isArray(clause.ctes) ? clause.ctes : [];
  const entries: Array<{ name: string; query: unknown }> = [];
  for (const item of ctes) {
    const cte = unwrap(item, "CommonTableExpr") ?? asRecord(item);
    if (!cte || typeof cte.ctename !== "string") {
      continue;
    }
    entries.push({ name: cte.ctename, query: cte.ctequery });
  }
  return entries;
}

function isRecursiveWith(withClause: unknown): boolean {
  const clause = unwrap(withClause, "WithClause") ?? asRecord(withClause);
  return Boolean(clause?.recursive);
}

function constString(node: unknown): string | undefined {
  const direct = pgString(node);
  if (direct) {
    return direct;
  }
  const record = asRecord(node);
  if (!record) {
    return;
  }
  const aConst = unwrap(record, "A_Const") ?? record;
  const fromSval = pgString(aConst.sval) ?? pgString(aConst);
  if (fromSval) {
    return fromSval;
  }
  const cast = unwrap(record, "TypeCast") ?? asRecord(record.TypeCast);
  if (cast) {
    return constString(cast.arg);
  }
}

function firstFuncArg(node: PgAstNode): unknown {
  if (Array.isArray(node.args) && node.args.length > 0) {
    return node.args[0];
  }
}

function sequenceRefFromLiteral(raw: string): SequenceRef {
  const trimmed = raw.replaceAll('"', "").trim();
  const parts = trimmed.split(".").filter((part) => part.length > 0);
  if (parts.length >= 2) {
    return {
      kind: "sequence",
      name: parts[parts.length - 1],
      schema: parts[0],
    };
  }
  return { kind: "sequence", name: trimmed, schema: "" };
}

function emitRangeVar(
  value: PgAstNode,
  scope: QueryScope,
  ctx: QueryDepContext,
  into: SemanticDependency[]
): void {
  const relname = typeof value.relname === "string" ? value.relname : undefined;
  if (!relname) {
    return;
  }
  const explicitlyQualified = typeof value.schemaname === "string";
  const aliasNode =
    asRecord(asRecord(value.alias)?.Alias) ?? asRecord(value.alias);
  const alias =
    (aliasNode && typeof aliasNode.aliasname === "string"
      ? aliasNode.aliasname
      : relname) ?? relname;
  const location = typeof value.location === "number" ? value.location : 0;
  if (!explicitlyQualified && hasCte(scope, relname)) {
    scope.aliases.set(alias, { kind: "cte" });
    scope.aliases.set(relname, { kind: "cte" });
    return;
  }
  if (
    !explicitlyQualified &&
    isProceduralName(ctx.proceduralBindings, relname)
  ) {
    return;
  }
  const schema = explicitlyQualified ? String(value.schemaname) : "";
  const table: TableRef = { kind: "table", name: relname, schema };
  scope.aliases.set(alias, { kind: "relation", table });
  scope.aliases.set(relname, { kind: "relation", table });
  if (schema) {
    scope.aliases.set(`${schema}.${relname}`, { kind: "relation", table });
  }
  const resolution: NameResolution = explicitlyQualified
    ? "exact"
    : "search_path";
  const confidence: DependencyConfidence = explicitlyQualified
    ? "certain"
    : "probable";
  into.push(
    dep(
      "REQUIRES_TABLE",
      table,
      confidence,
      ctx,
      location,
      resolution,
      explicitlyQualified
    )
  );
  into.push(
    dep(
      "READS",
      table,
      confidence,
      ctx,
      location,
      resolution,
      explicitlyQualified
    )
  );
  if (schema && schema !== "pg_catalog") {
    into.push(
      dep(
        "REQUIRES_SCHEMA",
        { kind: "schema", name: schema },
        "certain",
        ctx,
        location,
        "exact",
        true
      )
    );
  }
}

function emitFuncCall(
  value: PgAstNode,
  scope: QueryScope,
  ctx: QueryDepContext,
  into: SemanticDependency[]
): void {
  const names = pgNameList(value.funcname);
  if (names.length === 0) {
    return;
  }
  const qualified = names.length > 1;
  const schema = qualified ? names[0] : "";
  const name = names[names.length - 1];
  const location = typeof value.location === "number" ? value.location : 0;
  if (name === "nextval" || name === "setval") {
    const literal = constString(firstFuncArg(value));
    if (literal) {
      const sequence = sequenceRefFromLiteral(literal);
      into.push(
        dep(
          "REQUIRES_SEQUENCE",
          sequence,
          sequence.schema ? "certain" : "probable",
          ctx,
          location,
          sequence.schema ? "exact" : "search_path",
          Boolean(sequence.schema)
        )
      );
    }
  }
  if (name === "format") {
    return;
  }
  const resolution: NameResolution = qualified
    ? schema === "pg_catalog"
      ? "catalog_builtin"
      : "exact"
    : "search_path";
  const confidence: DependencyConfidence = qualified ? "certain" : "probable";
  const object: SchemaObjectRef = { kind: "function", name, schema };
  into.push(
    dep("INVOKES", object, confidence, ctx, location, resolution, qualified)
  );
  into.push(
    dep(
      "REQUIRES_FUNCTION",
      object,
      confidence,
      ctx,
      location,
      resolution,
      qualified
    )
  );
  void scope;
}

function emitColumnRef(
  value: PgAstNode,
  scope: QueryScope,
  ctx: QueryDepContext,
  into: SemanticDependency[]
): void {
  const fields = Array.isArray(value.fields) ? value.fields : [];
  const names = fields
    .map((field) => pgString(field))
    .filter((item): item is string => Boolean(item));
  if (names.length < 2) {
    return;
  }
  const column = names[names.length - 1];
  if (isPostgresSystemColumn(column)) {
    return;
  }
  const alias = names[names.length - 2];
  const binding = scope.aliases.get(alias);
  if (!binding || binding.kind === "cte" || !binding.table) {
    return;
  }
  const location = typeof value.location === "number" ? value.location : 0;
  into.push(
    dep(
      "REQUIRES_COLUMN",
      {
        kind: "column",
        name: column,
        schema: binding.table.schema,
        table: binding.table.name,
      },
      binding.table.schema ? "certain" : "probable",
      ctx,
      location,
      binding.table.schema ? "exact" : "search_path",
      Boolean(binding.table.schema)
    )
  );
}

function analyzeQueryStmt(
  stmt: PgAstNode,
  parent: QueryScope,
  ctx: QueryDepContext,
  into: SemanticDependency[]
): void {
  const scope = emptyScope(parent);
  const withClause = stmt.withClause;
  const entries = cteEntries(withClause);
  const recursive = isRecursiveWith(withClause);
  for (const cte of entries) {
    if (recursive) {
      scope.ctes.add(cte.name);
    }
    walkNode(cte.query, scope, ctx, into);
    scope.ctes.add(cte.name);
    scope.aliases.set(cte.name, { kind: "cte" });
  }
  const rest: PgAstNode = { ...stmt };
  delete rest.withClause;
  walkNode(rest.relation, scope, ctx, into);
  walkNode(rest.fromClause, scope, ctx, into);
  const remainder: PgAstNode = { ...rest };
  delete remainder.relation;
  delete remainder.fromClause;
  walkNode(remainder, scope, ctx, into);
}

function walkNode(
  node: unknown,
  scope: QueryScope,
  ctx: QueryDepContext,
  into: SemanticDependency[]
): void {
  if (!node) {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walkNode(item, scope, ctx, into);
    }
    return;
  }
  const record = asRecord(node);
  if (!record) {
    return;
  }
  const keys = Object.keys(record);
  if (keys.length === 1 && asRecord(record[keys[0]])) {
    const kind = keys[0];
    const inner = asRecord(record[kind]);
    if (!inner) {
      return;
    }
    if (QUERY_KINDS.has(kind)) {
      analyzeQueryStmt(inner, scope, ctx, into);
      return;
    }
    if (kind === "RangeVar") {
      emitRangeVar(inner, scope, ctx, into);
      return;
    }
    if (kind === "FuncCall") {
      emitFuncCall(inner, scope, ctx, into);
      walkNode(inner.args, scope, ctx, into);
      return;
    }
    if (kind === "ColumnRef") {
      emitColumnRef(inner, scope, ctx, into);
      return;
    }
    if (kind === "Alias") {
      return;
    }
    walkNode(inner, scope, ctx, into);
    return;
  }
  if (
    typeof record.relname === "string" &&
    record.funcname == null &&
    !Array.isArray(record.tableElts) &&
    !Array.isArray(record.targetList) &&
    !Array.isArray(record.cmds)
  ) {
    emitRangeVar(record, scope, ctx, into);
    return;
  }
  if (Array.isArray(record.funcname)) {
    emitFuncCall(record, scope, ctx, into);
    walkNode(record.args, scope, ctx, into);
    return;
  }
  if (Array.isArray(record.fields) && record.relname == null) {
    emitColumnRef(record, scope, ctx, into);
    return;
  }
  for (const value of Object.values(record)) {
    walkNode(value, scope, ctx, into);
  }
}

function looksLikeQueryStmt(record: PgAstNode): boolean {
  return (
    Array.isArray(record.fromClause) ||
    Array.isArray(record.targetList) ||
    record.withClause != null ||
    record.selectStmt != null ||
    record.valuesLists != null ||
    (record.relation != null &&
      (record.cols != null ||
        record.targetList != null ||
        record.whereClause != null ||
        record.returningList != null ||
        record.fromClause != null))
  );
}

export function extractQueryDependencies(
  node: unknown,
  filename: string,
  sql: string,
  baseOffset: number,
  options?: { proceduralBindings?: PlpgsqlBindings }
): SemanticDependency[] {
  const into: SemanticDependency[] = [];
  const ctx: QueryDepContext = {
    baseOffset,
    filename,
    proceduralBindings: options?.proceduralBindings,
    sql,
  };
  const record = asRecord(node);
  if (record && looksLikeQueryStmt(record)) {
    analyzeQueryStmt(record, emptyScope(), ctx, into);
    return uniqueDeps(into);
  }
  walkNode(node, emptyScope(), ctx, into);
  return uniqueDeps(into);
}

export function writeTargetFromNode(node: unknown):
  | {
    explicitlyQualified: boolean;
    table: TableRef;
  }
  | undefined {
  const record = asRecord(node);
  const rel =
    unwrap(record?.relation, "RangeVar") ??
    asRecord(asRecord(record?.relation)?.RangeVar) ??
    asRecord(record?.relation);
  if (!rel || typeof rel.relname !== "string") {
    return;
  }
  const explicitlyQualified = typeof rel.schemaname === "string";
  return {
    explicitlyQualified,
    table: {
      kind: "table",
      name: rel.relname,
      schema: explicitlyQualified ? String(rel.schemaname) : "",
    },
  };
}

export function uniqueDeps(
  dependencies: SemanticDependency[]
): SemanticDependency[] {
  const seen = new Set<string>();
  const result: SemanticDependency[] = [];
  for (const item of dependencies) {
    const key = `${item.statementIndex ?? ""}:${item.category}:${item.confidence}:${item.resolution ?? ""}:${formatObjectRef(item.object)}:${item.object.kind}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}
