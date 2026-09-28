/** Schema object identities and source locations for migration analysis. */

/** Shape of serialized `MigrationAnalysis` (fields, kinds), not analyzer semantics. */
export const ANALYSIS_IR_VERSION = 1;
/**
 * Name-resolution / dependency-extraction algorithm. Bump when query-deps,
 * CTE scope, function search_path, or equivalent verifier inputs change.
 */
export const ANALYZER_SEMANTICS_VERSION = 4;
export const ANALYZER_ID = `athena-migration-analyzer@${ANALYZER_SEMANTICS_VERSION}`;
export const PARSER_ID = "pgsql-parser@18.2.6";

export interface SqlPosition {
  column: number;
  line: number;
}

export interface SqlSourceLocation {
  end: SqlPosition;
  filename: string;
  start: SqlPosition;
}

export type SchemaObjectKind =
  | "schema"
  | "table"
  | "column"
  | "function"
  | "procedure"
  | "type"
  | "view"
  | "materialized_view"
  | "sequence"
  | "constraint"
  | "index"
  | "trigger"
  | "extension"
  | "policy"
  | "domain"
  | "enum";

export interface SchemaRef {
  kind: "schema";
  name: string;
}

export interface TableRef {
  kind: "table";
  name: string;
  schema: string;
}

export interface ColumnRef {
  kind: "column";
  name: string;
  schema: string;
  table: string;
}

export interface FunctionRef {
  identityArguments?: string[];
  kind: "function" | "procedure";
  name: string;
  schema: string;
}

export interface TypeRef {
  kind: "type" | "domain" | "enum";
  name: string;
  schema: string;
}

export interface ViewRef {
  kind: "view" | "materialized_view";
  name: string;
  schema: string;
}

export interface SequenceRef {
  kind: "sequence";
  name: string;
  schema: string;
}

export interface ConstraintRef {
  kind: "constraint";
  name: string;
  schema: string;
  table: string;
}

export interface IndexRef {
  kind: "index";
  name: string;
  schema: string;
  table?: string;
}

export interface TriggerRef {
  kind: "trigger";
  name: string;
  schema: string;
  table: string;
}

export interface ExtensionRef {
  kind: "extension";
  name: string;
}

export interface PolicyRef {
  kind: "policy";
  name: string;
  schema: string;
  table: string;
}

export type SchemaObjectRef =
  | SchemaRef
  | TableRef
  | ColumnRef
  | FunctionRef
  | TypeRef
  | ViewRef
  | SequenceRef
  | ConstraintRef
  | IndexRef
  | TriggerRef
  | ExtensionRef
  | PolicyRef;

export function objectKey(ref: SchemaObjectRef): string {
  switch (ref.kind) {
    case "schema":
    case "extension":
      return `${ref.kind}:${ref.name}`;
    case "column":
    case "constraint":
    case "trigger":
    case "policy":
      return `${ref.kind}:${ref.schema}.${ref.table}.${ref.name}`;
    case "index":
      return ref.table
        ? `${ref.kind}:${ref.schema}.${ref.table}.${ref.name}`
        : `${ref.kind}:${ref.schema}.${ref.name}`;
    case "function":
    case "procedure": {
      const args = ref.identityArguments?.length
        ? `(${ref.identityArguments.join(",")})`
        : "";
      if (!ref.schema) {
        return `${ref.kind}:${ref.name}${args}`;
      }
      return `${ref.kind}:${ref.schema}.${ref.name}${args}`;
    }
    default:
      if (!("schema" in ref && ref.schema)) {
        return `${ref.kind}:${ref.name}`;
      }
      return `${ref.kind}:${ref.schema}.${ref.name}`;
  }
}

export function formatObjectRef(ref: SchemaObjectRef): string {
  switch (ref.kind) {
    case "schema":
    case "extension":
      return ref.name;
    case "column":
      return `${ref.schema}.${ref.table}.${ref.name}`;
    case "constraint":
    case "trigger":
    case "policy":
      return `${ref.schema}.${ref.table}.${ref.name}`;
    case "index":
      return ref.table
        ? `${ref.schema}.${ref.table}.${ref.name}`
        : `${ref.schema}.${ref.name}`;
    case "function":
    case "procedure": {
      const args = ref.identityArguments?.length
        ? `(${ref.identityArguments.join(",")})`
        : "";
      if (!ref.schema) {
        return `${ref.name}${args}`;
      }
      return `${ref.schema}.${ref.name}${args}`;
    }
    default:
      if (!("schema" in ref && ref.schema)) {
        return ref.name;
      }
      return `${ref.schema}.${ref.name}`;
  }
}

export function offsetToPosition(sql: string, offset: number): SqlPosition {
  let line = 1;
  let column = 1;
  const end = Math.max(0, Math.min(offset, sql.length));
  for (let index = 0; index < end; index += 1) {
    if (sql[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { column, line };
}

export function locationFromOffset(
  filename: string,
  sql: string,
  startOffset: number,
  length = 0
): SqlSourceLocation {
  return {
    end: offsetToPosition(sql, startOffset + Math.max(0, length)),
    filename,
    start: offsetToPosition(sql, startOffset),
  };
}
