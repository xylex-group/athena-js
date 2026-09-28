import { parse } from "pgsql-parser";

import { PARSER_ID } from "./ast.ts";

export { PARSER_ID };

export type PgAstNode = Record<string, unknown>;

export interface ParsedStatement {
  kind: string;
  length: number;
  location: number;
  node: PgAstNode;
}

export interface ParseSqlResult {
  parserId: string;
  statements: ParsedStatement[];
  version: number;
}

function asRecord(value: unknown): PgAstNode | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as PgAstNode;
  }
}

function unwrapStmt(wrapped: unknown): ParsedStatement | undefined {
  const wrapper = asRecord(wrapped);
  if (!wrapper) {
    return;
  }
  const stmt = asRecord(wrapper.stmt) ?? wrapper;
  const keys = Object.keys(stmt);
  const kind = keys[0] ?? "Unknown";
  const node = asRecord(stmt[kind]) ?? stmt;
  return {
    kind,
    length: typeof wrapper.stmt_len === "number" ? wrapper.stmt_len : 0,
    location:
      typeof wrapper.stmt_location === "number" ? wrapper.stmt_location : 0,
    node,
  };
}

/**
 * Parse PostgreSQL SQL with libpg-query (pgsql-parser). Not a regex scanner.
 */
export async function parsePostgresSql(sql: string): Promise<ParseSqlResult> {
  const result = (await parse(sql)) as {
    stmts?: unknown[];
    version?: number;
  };
  const statements: ParsedStatement[] = [];
  for (const wrapped of result.stmts ?? []) {
    const parsed = unwrapStmt(wrapped);
    if (parsed) {
      statements.push(parsed);
    }
  }
  return {
    parserId: PARSER_ID,
    statements,
    version: result.version ?? 0,
  };
}

export function pgString(node: unknown): string | undefined {
  const record = asRecord(node);
  if (!record) {
    return;
  }
  const inner = asRecord(record.String);
  if (inner && typeof inner.sval === "string") {
    return inner.sval;
  }
  if (typeof record.sval === "string") {
    return record.sval;
  }
  if (typeof record.str === "string") {
    return record.str;
  }
}

export function pgNameList(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) {
    return [];
  }
  return nodes
    .map((item) => pgString(item))
    .filter((item): item is string => Boolean(item));
}

export function walkAst(
  node: unknown,
  visit: (
    kind: string,
    value: PgAstNode,
    parent: PgAstNode | undefined
  ) => void,
  parent?: PgAstNode
): void {
  if (!node) {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walkAst(item, visit, parent);
    }
    return;
  }
  const record = asRecord(node);
  if (!record) {
    return;
  }
  const keys = Object.keys(record);
  if (keys.length === 1 && asRecord(record[keys[0]])) {
    visit(keys[0], asRecord(record[keys[0]]) as PgAstNode, parent);
    walkAst(record[keys[0]], visit, asRecord(record[keys[0]]));
    return;
  }
  for (const value of Object.values(record)) {
    walkAst(value, visit, record);
  }
}
