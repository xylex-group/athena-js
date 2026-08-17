import type { AthenaGatewayClient } from "../../gateway/client.ts";
import { AthenaGatewayError } from "../../gateway/errors.ts";
import { resolveMutationAffectedRows } from "../../result/mutation-meta.ts";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionOptions,
  AthenaGatewayConnectionResult,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaQueryPayload,
  AthenaRpcCallOptions,
  AthenaRpcPayload,
  AthenaUpdatePayload,
} from "../../gateway/types.ts";
import type { D1DatabaseLike } from "../types.ts";
import { CLOUDFLARE_EDGE_BASE_URL } from "../types.ts";
import {
  type D1RunnerBatchResult,
  type D1RunnerQueryResult,
  executeD1Batch,
  executeD1Query,
} from "./runner.ts";
import {
  compileD1StructuredFetch,
  needsD1AstPipeline,
} from "./compile-fetch.ts";
import {
  compileD1Count,
  compileD1Delete,
  compileD1Fetch,
  compileD1Insert,
  compileD1Update,
  type D1CompiledSql,
  type D1CompileOptions,
  D1SqlCompileError,
  extractAthenaCount,
} from "./sql.ts";
import { rewritePostgresSqlForSqlite } from "./sql-rewrite.ts";
import { createD1TransactionTransport } from "./transaction.ts";

/** Narrow failure message without relying on dts-time discriminant collapse. */
function d1ErrorMessage(
  result: D1RunnerQueryResult | D1RunnerBatchResult
): string {
  return result.ok ? "unknown error" : result.message;
}

export interface CloudflareD1TransportOptions {
  d1: D1DatabaseLike;
  /** Default D1 session mode when headers omit session mode. */
  defaultSessionMode?: string | null;
  relationCatalog?: import("../../query/engine/relations.ts").AthenaRelationCatalog;
}

function hasPaginationBounds(payload: {
  limit?: number;
  offset?: number;
  current_page?: number;
  page_size?: number;
}): boolean {
  return (
    payload.limit !== undefined ||
    payload.offset !== undefined ||
    payload.page_size !== undefined ||
    payload.current_page !== undefined
  );
}

/** Normalize SQLite collation names for equality comparison. */
function normalizeSqliteCollation(name: string | null | undefined): string {
  const raw = String(name ?? "")
    .trim()
    .replace(/^["'`[]|["'`\]]$/g, "");
  if (!raw) {
    return "BINARY";
  }
  return raw.toUpperCase();
}

/**
 * Locate the opening `(` of a CREATE TABLE column list.
 * Returns the index of `(` or -1 when not found.
 */
function findCreateTableColumnListOpen(createSql: string): number {
  // CREATE [TEMP|TEMPORARY|VIRTUAL] TABLE [IF NOT EXISTS] name (
  const m =
    /\bCREATE\s+(?:(?:TEMP|TEMPORARY|VIRTUAL)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(
      createSql
    );
  if (!m) {
    return -1;
  }
  let i = m.index + m[0].length;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBracket = false;
  while (i < createSql.length) {
    const ch = createSql[i]!;
    if (inSingle) {
      if (ch === "'" && createSql[i + 1] === "'") {
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      }
      i++;
      continue;
    }
    if (inBacktick) {
      if (ch === "`") {
        inBacktick = false;
      }
      i++;
      continue;
    }
    if (inBracket) {
      if (ch === "]") {
        inBracket = false;
      }
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i++;
      continue;
    }
    if (ch === "`") {
      inBacktick = true;
      i++;
      continue;
    }
    if (ch === "[") {
      inBracket = true;
      i++;
      continue;
    }
    if (ch === "(") {
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Parse a column's COLLATE clause from CREATE TABLE SQL.
 * Returns null when the column has no explicit collation (defaults to BINARY).
 *
 * Type modifiers may contain parentheses and commas (`VARCHAR(255)`,
 * `NUMERIC(10, 2)`). A simple `[^,)]` scan stops at the first `)` and misses
 * `name VARCHAR(255) COLLATE NOCASE`, so we scan the column definition with
 * balanced parentheses before locating COLLATE.
 *
 * Column-name matching is anchored inside the CREATE TABLE `(…)` list so a
 * table whose name equals a column (e.g. `CREATE TABLE name (…, name TEXT …)`)
 * does not steal the first unanchored match.
 */
function parseColumnCollationFromCreateSql(
  createSql: string,
  columnName: string
): string | null {
  if (!(createSql && columnName)) {
    return null;
  }
  const listOpen = findCreateTableColumnListOpen(createSql);
  if (listOpen < 0) {
    return null;
  }
  // Search only inside the top-level column list (depth starts at 1 after `(`).
  const listStart = listOpen + 1;
  const escaped = columnName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameRe = new RegExp(
    `(?:^|[^\\w])(?:"${escaped}"|\`${escaped}\`|\\[${escaped}\\]|${escaped})\\s+`,
    "i"
  );
  const listSlice = createSql.slice(listStart);
  // Walk top-level segments so UNIQUE(name COLLATE …) does not match as a column.
  // Capture match text length in a plain number so TS control-flow analysis does not
  // collapse the closure-assigned RegExpExecArray to `never` when reading `[0].length`.
  let nameMatchAbs = -1;
  let nameMatchLen = 0;
  {
    let i = 0;
    let depth = 1;
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let inBracket = false;
    let segmentStart = 0;
    const trySegment = (from: number, to: number) => {
      if (nameMatchAbs >= 0) {
        return undefined;
      }
      const segment = listSlice.slice(from, to);
      const m = nameRe.exec(segment);
      if (!m) {
        return undefined;
      }
      // Column defs start at segment start (optional whitespace); reject mid-segment
      // matches inside expressions that are not leading column names.
      const leading = segment.slice(0, m.index).trim();
      if (leading.length > 0) {
        return undefined;
      }
      nameMatchAbs = listStart + from + m.index;
      nameMatchLen = m[0].length;
    };
    while (i < listSlice.length && depth > 0) {
      const ch = listSlice[i]!;
      if (inSingle) {
        if (ch === "'" && listSlice[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (ch === "'") {
          inSingle = false;
        }
        i++;
        continue;
      }
      if (inDouble) {
        if (ch === '"') {
          inDouble = false;
        }
        i++;
        continue;
      }
      if (inBacktick) {
        if (ch === "`") {
          inBacktick = false;
        }
        i++;
        continue;
      }
      if (inBracket) {
        if (ch === "]") {
          inBracket = false;
        }
        i++;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        i++;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        i++;
        continue;
      }
      if (ch === "`") {
        inBacktick = true;
        i++;
        continue;
      }
      if (ch === "[") {
        inBracket = true;
        i++;
        continue;
      }
      if (ch === "(") {
        depth++;
        i++;
        continue;
      }
      if (ch === ")") {
        depth--;
        if (depth === 0) {
          trySegment(segmentStart, i);
          break;
        }
        i++;
        continue;
      }
      if (ch === "," && depth === 1) {
        trySegment(segmentStart, i);
        segmentStart = i + 1;
        i++;
        continue;
      }
      i++;
    }
  }
  if (nameMatchAbs < 0 || nameMatchLen <= 0) {
    return null;
  }

  const start = nameMatchAbs + nameMatchLen;
  let i = start;
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBracket = false;

  while (i < createSql.length) {
    const ch = createSql[i]!;

    if (inSingle) {
      if (ch === "'" && createSql[i + 1] === "'") {
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      }
      i++;
      continue;
    }
    if (inBacktick) {
      if (ch === "`") {
        inBacktick = false;
      }
      i++;
      continue;
    }
    if (inBracket) {
      if (ch === "]") {
        inBracket = false;
      }
      i++;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i++;
      continue;
    }
    if (ch === "`") {
      inBacktick = true;
      i++;
      continue;
    }
    if (ch === "[") {
      inBracket = true;
      i++;
      continue;
    }

    if (ch === "(") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")") {
      if (depth === 0) {
        // End of the CREATE TABLE column list.
        break;
      }
      depth--;
      i++;
      continue;
    }
    if (ch === "," && depth === 0) {
      // Next column or table constraint.
      break;
    }
    i++;
  }

  const colDef = createSql.slice(start, i);
  const collRe =
    /\bCOLLATE\s+("([^"]+)"|'([^']+)'|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][\w$]*))/i;
  const match = collRe.exec(colDef);
  if (!match) {
    return null;
  }
  return (
    match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? match[1] ?? null
  );
}

/**
 * True when the unique index's key collation matches the column's declared
 * collation (or both default to BINARY). Mismatch means
 * `col IN (SELECT col … LIMIT n)` can match more rows than the unique index
 * guarantees (e.g. NOCASE column + BINARY unique index).
 */
async function indexCollationMatchesColumn(
  d1: D1DatabaseLike,
  table: string,
  tableSafe: string,
  indexSafe: string,
  columnName: string,
  session?: { bookmark?: string | null; sessionMode?: string | null }
): Promise<boolean> {
  interface IndexXInfoRow {
    cid?: number | null;
    coll?: string | null;
    key?: number | boolean | null;
    name?: string | null;
  }

  const xinfo = await executeD1Query(d1, {
    params: [],
    query: `PRAGMA index_xinfo("${indexSafe}")`,
    ...session,
  });
  if (!xinfo.ok) {
    // Without index_xinfo we cannot prove collation safety — reject the index.
    return false;
  }

  const xRows = (xinfo.rows as IndexXInfoRow[]) ?? [];
  const keyRows = xRows.filter((row) => {
    const isKey = row.key === 1 || row.key === true || Number(row.key) === 1;
    if (!isKey) {
      return false;
    }
    return typeof row.name === "string" && row.name === columnName;
  });
  if (keyRows.length === 0) {
    // Some drivers omit key flags; fall back to first named match.
    const byName = xRows.find(
      (row) => typeof row.name === "string" && row.name === columnName
    );
    if (!byName) {
      return false;
    }
    keyRows.push(byName);
  }

  const indexColl = normalizeSqliteCollation(keyRows[0]?.coll);

  const master = await executeD1Query(d1, {
    params: [table],
    query: `SELECT sql AS create_sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
    ...session,
  });
  let createSql = "";
  if (master.ok && Array.isArray(master.rows) && master.rows.length > 0) {
    createSql = String(
      (master.rows[0] as { create_sql?: string | null })?.create_sql ?? ""
    );
  }
  // tableSafe unused for query (bound param uses table); silence unused if needed
  void tableSafe;

  const columnCollRaw = parseColumnCollationFromCreateSql(
    createSql,
    columnName
  );
  const columnColl = normalizeSqliteCollation(columnCollRaw);

  return indexColl === columnColl;
}

/**
 * Resolve a single-column unique identity for bounded mutations from live D1
 * schema (PRAGMA table_info + index_list). Prefer PRIMARY KEY; else a single-
 * column UNIQUE index. Multi-column keys are rejected as unsafe for IN-subquery.
 */
export async function resolveD1BoundedIdentityColumn(
  d1: D1DatabaseLike,
  tableName: string,
  session?: { bookmark?: string | null; sessionMode?: string | null }
): Promise<string> {
  const table = tableName.trim();
  if (!table) {
    throw new D1SqlCompileError(
      "missing_table",
      "table_name is required for bounded mutation"
    );
  }
  // Quote via double-quote after escaping; PRAGMA does not take bound params for table name.
  const safe = table.replace(/"/g, '""');

  const info = await executeD1Query(d1, {
    params: [],
    query: `PRAGMA table_info("${safe}")`,
    ...session,
  });
  if (!info.ok) {
    throw new D1SqlCompileError(
      "bounded_mutation_no_unique_identity",
      `Unable to introspect table "${table}" for bounded mutation identity: ${d1ErrorMessage(info)}`
    );
  }

  interface PragmaCol {
    name?: string;
    notnull?: number | boolean;
    pk?: number;
    type?: string;
  }
  const cols = (info.rows as PragmaCol[]).filter(
    (row) => typeof row?.name === "string" && row.name.length > 0
  );
  const colByName = new Map(cols.map((col) => [col.name!, col]));
  const isNotNullColumn = (name: string): boolean => {
    const col = colByName.get(name);
    if (!col) {
      return false;
    }
    return (
      col.notnull === 1 || col.notnull === true || Number(col.notnull) === 1
    );
  };
  /**
   * Candidate SQLite rowid alias: single-column PRIMARY KEY declared as INTEGER.
   * PRAGMA table_info still reports notnull=0 for true rowid aliases. The
   * INTEGER PRIMARY KEY DESC exception is NOT a rowid alias (nullable, non-
   * unique); detect it via a separate origin='pk' index or CREATE TABLE SQL.
   */
  const isIntegerPrimaryKeyType = (col: PragmaCol): boolean => {
    if (typeof col.pk !== "number" || col.pk <= 0) {
      return false;
    }
    const declared = String(col.type ?? "")
      .trim()
      .toUpperCase();
    return declared === "INTEGER";
  };

  interface IndexRow {
    name?: string;
    /** SQLite: 'c' | 'u' | 'pk' */
    origin?: string;
    /** SQLite: 1 when the index has a WHERE clause (partial). */
    partial?: number | boolean;
    unique?: number | boolean;
  }

  const loadIndexList = async (): Promise<IndexRow[] | null> => {
    const indexList = await executeD1Query(d1, {
      params: [],
      query: `PRAGMA index_list("${safe}")`,
      ...session,
    });
    if (!indexList.ok) {
      return null;
    }
    return indexList.rows as IndexRow[];
  };

  /**
   * True when the INTEGER PRIMARY KEY is NOT a rowid alias (DESC exception).
   * True rowid aliases have no origin='pk' index; DESC creates one. When origin
   * is omitted by the driver, parse sqlite_master CREATE TABLE for DESC.
   */
  const isDescendingIntegerPrimaryKeyException = async (
    colName: string,
    indexes: IndexRow[] | null
  ): Promise<boolean> => {
    if (indexes) {
      const hasPkOrigin = indexes.some(
        (index) => String(index.origin ?? "").toLowerCase() === "pk"
      );
      if (hasPkOrigin) {
        return true;
      }
      // Empty list or origins present without 'pk' ⇒ true rowid alias.
      const originReported = indexes.some(
        (index) =>
          index.origin !== undefined &&
          index.origin !== null &&
          String(index.origin).length > 0
      );
      if (indexes.length === 0 || originReported) {
        return false;
      }
    }

    // Fallback when index_list failed or origin is unavailable on rows.
    const master = await executeD1Query(d1, {
      params: [table],
      query: `SELECT sql AS create_sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
      ...session,
    });
    if (
      !(master.ok && Array.isArray(master.rows)) ||
      master.rows.length === 0
    ) {
      return false;
    }
    const createSql = String(
      (master.rows[0] as { create_sql?: string | null })?.create_sql ?? ""
    );
    if (!createSql) {
      return false;
    }
    const escaped = colName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Inline: id INTEGER PRIMARY KEY DESC
    const inlineDesc = new RegExp(
      `(?:^|[^\\w])(?:"${escaped}"|${escaped})\\s+INTEGER\\s+PRIMARY\\s+KEY\\s+DESC\\b`,
      "i"
    );
    // Table-level: PRIMARY KEY (id DESC) or PRIMARY KEY("id" DESC)
    const tableDesc = new RegExp(
      `PRIMARY\\s+KEY\\s*\\(\\s*(?:"${escaped}"|${escaped})\\s+DESC\\b`,
      "i"
    );
    return inlineDesc.test(createSql) || tableDesc.test(createSql);
  };

  const pkCols = cols
    .filter((row) => typeof row.pk === "number" && row.pk > 0)
    .sort((a, b) => (a.pk ?? 0) - (b.pk ?? 0));

  // Load index_list once when needed for PK validation or unique-index scan.
  let indexRows: IndexRow[] | null | undefined;

  if (pkCols.length === 1 && pkCols[0]?.name) {
    // SQLite WITHOUT ROWID requires NOT NULL on PK; ordinary rowid tables allow
    // NULL in a TEXT PRIMARY KEY (multiple NULLs). NULL IN (NULL) is unknown, so
    // bounded mutations must not use a nullable PK as the identity column —
    // except INTEGER PRIMARY KEY rowid alias (notnull may be 0, no pk index).
    //
    // Non-rowid PKs must also pass the same collation check as UNIQUE indexes:
    // `name TEXT COLLATE NOCASE NOT NULL, PRIMARY KEY(name COLLATE BINARY)` allows
    // both `a` and `A`, but outer `name IN (SELECT name …)` uses column NOCASE.
    if (isIntegerPrimaryKeyType(pkCols[0])) {
      indexRows = await loadIndexList();
      const isDescException = await isDescendingIntegerPrimaryKeyException(
        pkCols[0].name,
        indexRows
      );
      if (!isDescException) {
        return pkCols[0].name;
      }
      // Fall through: DESC INTEGER PK is nullable / non-rowid; try UNIQUE indexes.
    } else if (isNotNullColumn(pkCols[0].name)) {
      indexRows = await loadIndexList();
      const pkIndex = (indexRows ?? []).find(
        (index) => String(index.origin ?? "").toLowerCase() === "pk"
      );
      if (pkIndex && typeof pkIndex.name === "string" && pkIndex.name) {
        const indexSafe = pkIndex.name.replace(/"/g, '""');
        const collMatch = await indexCollationMatchesColumn(
          d1,
          table,
          safe,
          indexSafe,
          pkCols[0].name,
          session
        );
        if (collMatch) {
          return pkCols[0].name;
        }
        // Collation mismatch — do not use this PK; try UNIQUE indexes.
      }
      // No origin='pk' index to prove collation safety — fall through.
    }
    // Fall through to UNIQUE indexes / rejection.
  }
  // Composite PK: cannot use multi-column identity for IN-subquery, but a
  // separate single-column UNIQUE NOT NULL index may still qualify — fall through.

  // No usable single-column PK. Scan full-table, non-partial, NOT NULL unique indexes.
  if (indexRows === undefined) {
    indexRows = await loadIndexList();
  }
  if (indexRows) {
    for (const index of indexRows) {
      const unique =
        index.unique === 1 ||
        index.unique === true ||
        Number(index.unique) === 1;
      if (!unique || typeof index.name !== "string" || !index.name) {
        continue;
      }
      const isPartial =
        index.partial === 1 ||
        index.partial === true ||
        Number(index.partial) === 1;
      if (isPartial) {
        // Partial UNIQUE (e.g. WHERE active = 1) allows duplicate values outside
        // the predicate; using that column for `IN (SELECT … LIMIT n)` can mutate
        // more rows than the requested page.
        continue;
      }
      const indexSafe = index.name.replace(/"/g, '""');
      const indexInfo = await executeD1Query(d1, {
        params: [],
        query: `PRAGMA index_info("${indexSafe}")`,
        ...session,
      });
      if (!indexInfo.ok) {
        continue;
      }
      interface IndexInfoRow {
        cid?: number | null;
        name?: string | null;
      }
      const rawIndexCols = (indexInfo.rows as IndexInfoRow[]) ?? [];
      // Expression index terms report null name (and often cid < 0). Filtering
      // them out would shrink UNIQUE(tenant_id, lower(email)) to a false
      // single-column identity — reject the whole index instead.
      const hasExpressionTerm = rawIndexCols.some((row) => {
        const nameOk = typeof row?.name === "string" && row.name.length > 0;
        if (!nameOk) {
          return true;
        }
        if (typeof row.cid === "number" && row.cid < 0) {
          return true;
        }
        return false;
      });
      if (hasExpressionTerm || rawIndexCols.length === 0) {
        continue;
      }
      const indexCols = rawIndexCols.filter(
        (row): row is IndexInfoRow & { name: string } =>
          typeof row?.name === "string" && row.name.length > 0
      );
      if (indexCols.length === 1 && indexCols[0]?.name) {
        const identity = indexCols[0].name;
        // SQLite UNIQUE allows multiple NULLs; `col IN (SELECT col …)` never
        // matches NULL, so a null identity page can under- or over-mutate.
        if (!isNotNullColumn(identity)) {
          continue;
        }
        // Reject when the unique index collation differs from the column's
        // declared collation: `identity IN (SELECT identity … LIMIT n)` uses
        // column equality, which can match more rows than the unique index
        // (e.g. TEXT COLLATE NOCASE column + UNIQUE COLLATE BINARY index).
        const collMatch = await indexCollationMatchesColumn(
          d1,
          table,
          safe,
          indexSafe,
          identity,
          session
        );
        if (!collMatch) {
          continue;
        }
        return identity;
      }
    }
  }

  throw new D1SqlCompileError(
    "bounded_mutation_no_unique_identity",
    `Bounded update/delete on "${table}" requires a proven single-column PRIMARY KEY or UNIQUE index`
  );
}

async function compileOptionsForBoundedMutation(
  d1: D1DatabaseLike,
  payload: {
    table_name?: string;
    limit?: number;
    offset?: number;
    current_page?: number;
    page_size?: number;
    sort_by?: unknown;
  },
  session?: { bookmark?: string | null; sessionMode?: string | null }
): Promise<D1CompileOptions | undefined> {
  if (!(hasPaginationBounds(payload) || payload.sort_by)) {
    return undefined;
  }
  if (!hasPaginationBounds(payload)) {
    // order_without_bounds is raised by the compiler
    return undefined;
  }
  const identityColumn = await resolveD1BoundedIdentityColumn(
    d1,
    payload.table_name ?? "",
    session
  );
  return { identityColumn };
}

function headerValue(
  options: AthenaGatewayCallOptions | undefined,
  name: string
): string | undefined {
  const headers = options?.headers;
  if (!headers) {
    return undefined;
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && value?.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function sessionFromOptions(
  options: AthenaGatewayCallOptions | undefined,
  defaults: CloudflareD1TransportOptions
): { bookmark?: string | null; sessionMode?: string | null } {
  return {
    bookmark: headerValue(options, "x-athena-d1-bookmark") ?? null,
    sessionMode:
      headerValue(options, "x-athena-d1-session-mode") ??
      defaults.defaultSessionMode ??
      null,
  };
}

/**
 * Gateway default is stripNulls: true (omit null-valued keys from row objects).
 * Edge must match so feature flags / UI code relying on absent keys work on D1.
 */
function resolveStripNulls(
  payloadStrip: boolean | undefined,
  callOptions: AthenaGatewayCallOptions | undefined,
  defaultValue = true
): boolean {
  if (typeof payloadStrip === "boolean") {
    return payloadStrip;
  }
  if (typeof callOptions?.stripNulls === "boolean") {
    return callOptions.stripNulls;
  }
  return defaultValue;
}

function stripNullPropertiesFromRows(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return row;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (value !== null) {
        out[key] = value;
      }
    }
    return out;
  });
}

function maybeStripNullRows(rows: unknown[], strip: boolean): unknown[] {
  return strip ? stripNullPropertiesFromRows(rows) : rows;
}

function successResponse<T>(
  data: T,
  count: number | null | undefined,
  raw: unknown,
  bookmark: string | null,
  endpoint?: string
): AthenaGatewayResponse<T> {
  const affectedRows = resolveMutationAffectedRows({
    count,
    endpoint,
    raw,
  });
  const response: AthenaGatewayResponse<T> = {
    ...(affectedRows !== undefined ? { affectedRows } : {}),
    count: count ?? null,
    data,
    error: undefined,
    errorDetails: null,
    ok: true,
    raw,
    status: 200,
    statusText: "OK",
  };
  // Surface bookmark for callers that inspect raw
  if (bookmark && raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rawRecord = raw as Record<string, unknown>;
    rawRecord.bookmark = bookmark;
  }
  return response;
}

function errorResponse<T>(
  status: number,
  code:
    | "HTTP_ERROR"
    | "UNKNOWN_ERROR"
    | "INVALID_JSON"
    | "NETWORK_ERROR"
    | "INVALID_URL",
  message: string,
  endpoint: string,
  method: string,
  hint?: string
): AthenaGatewayResponse<T> {
  const error = new AthenaGatewayError({
    code,
    endpoint: endpoint as never,
    hint,
    message,
    method: method as never,
    status,
  });
  return {
    data: null,
    error: error.message,
    errorDetails: error.toDetails(),
    ok: false,
    raw: { code, error: message },
    status,
    statusText: null,
  };
}

function compileErrorResponse<T>(
  error: unknown,
  endpoint: string,
  method: string
): AthenaGatewayResponse<T> {
  if (error instanceof D1SqlCompileError) {
    return errorResponse(
      400,
      "HTTP_ERROR",
      error.message,
      endpoint,
      method,
      `D1 SQL compile failed (${error.code})`
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return errorResponse(500, "UNKNOWN_ERROR", message, endpoint, method);
}

/**
 * Gateway-shaped transport that executes against a Worker D1 binding.
 */
export function createCloudflareD1GatewayTransport(
  options: CloudflareD1TransportOptions
): AthenaGatewayClient {
  const { d1 } = options;

  async function runCompiled<T>(
    compiled: D1CompiledSql,
    callOptions: AthenaGatewayCallOptions | undefined,
    endpoint: string,
    method: string,
    mapResult?: (
      rows: unknown[],
      count: number
    ) => { data: T; count: number | null },
    stripNulls = true
  ): Promise<AthenaGatewayResponse<T>> {
    try {
      const session = sessionFromOptions(callOptions, options);
      if (compiled.statements && compiled.statements.length > 1) {
        const batch = await executeD1Batch(d1, {
          statements: compiled.statements.map((statement) => ({
            params: statement.params,
            query: statement.sql,
          })),
          ...session,
        });
        if (!batch.ok) {
          return errorResponse(
            400,
            "HTTP_ERROR",
            d1ErrorMessage(batch),
            endpoint,
            method
          );
        }
        // Sparse multi-row inserts without RETURNING yield empty `results` arrays;
        // each D1 result still reports affected rows on `meta.changes`.
        const rows = maybeStripNullRows(
          batch.results.flatMap((item) =>
            Array.isArray(item.results) ? item.results : []
          ),
          stripNulls
        );
        const changes = batch.results.reduce((sum, item) => {
          const meta = item?.meta;
          const n =
            meta && typeof meta === "object" && typeof meta.changes === "number"
              ? meta.changes
              : 0;
          return sum + n;
        }, 0);
        const count = rows.length > 0 ? rows.length : changes;
        const mapped = mapResult?.(rows, count) ?? {
          count,
          data: rows as T,
        };
        return successResponse(
          mapped.data,
          mapped.count,
          batch,
          batch.bookmark,
          endpoint
        );
      }

      const result = await executeD1Query(d1, {
        params: compiled.params,
        query: compiled.sql,
        ...session,
      });
      if (!result.ok) {
        return errorResponse(
          400,
          "HTTP_ERROR",
          d1ErrorMessage(result),
          endpoint,
          method
        );
      }
      const rows = maybeStripNullRows(result.rows, stripNulls);
      const mapped = mapResult?.(rows, result.count) ?? {
        count: result.count,
        data: rows as T,
      };
      return successResponse(
        mapped.data,
        mapped.count,
        result,
        result.bookmark,
        endpoint
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(500, "UNKNOWN_ERROR", message, endpoint, method);
    }
  }

  const transactions = createD1TransactionTransport({
    compileOptionsForBoundedMutation(payload, callOptions) {
      return compileOptionsForBoundedMutation(
        d1,
        payload,
        sessionFromOptions(callOptions, options)
      );
    },
    d1,
    sessionFromOptions(callOptions) {
      return sessionFromOptions(callOptions, options);
    },
  });

  return {
    baseUrl: CLOUDFLARE_EDGE_BASE_URL,
    buildHeaders(callOptions) {
      return { ...(callOptions?.headers ?? {}) };
    },
    transactions,
    async deleteGateway<T>(
      payload: AthenaDeletePayload,
      callOptions?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      try {
        const session = sessionFromOptions(callOptions, options);
        const compileOptions = await compileOptionsForBoundedMutation(
          d1,
          payload,
          session
        );
        const compiled = compileD1Delete(payload, compileOptions);
        const stripNulls = resolveStripNulls(undefined, callOptions, true);
        return runCompiled(
          compiled,
          callOptions,
          "/gateway/delete",
          "DELETE",
          undefined,
          stripNulls
        );
      } catch (error) {
        return compileErrorResponse(error, "/gateway/delete", "DELETE");
      }
    },
    async fetchGateway<T>(
      payload: AthenaFetchPayload | Record<string, unknown>,
      callOptions?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      try {
        if (callOptions?.signal?.aborted) {
          throw new Error("The operation was aborted.");
        }
        const fetchPayload = payload as AthenaFetchPayload;
        const compiled = needsD1AstPipeline(payload)
          ? await compileD1StructuredFetch(payload, d1, {
              catalog: options.relationCatalog,
            })
          : compileD1Fetch(fetchPayload);
        const stripNulls = resolveStripNulls(
          fetchPayload.strip_nulls,
          callOptions,
          true
        );
        if (fetchPayload.head === true) {
          return runCompiled(
            compiled,
            callOptions,
            "/gateway/fetch",
            "POST",
            (rows) => ({ count: extractAthenaCount(rows), data: [] as T }),
            // COUNT rows are meta, not user-facing object rows
            false
          );
        }

        // exact/planned/estimated: total matches independent of LIMIT/OFFSET page size
        const wantsTotalCount =
          fetchPayload.count === "exact" ||
          fetchPayload.count === "planned" ||
          fetchPayload.count === "estimated";
        if (wantsTotalCount) {
          // Page + COUNT must share one D1 session so bookmarks and sequential
          // consistency cover both observations (not two independent withSession calls).
          const session = sessionFromOptions(callOptions, options);
          const countCompiled = compileD1Count(fetchPayload);
          const batch = await executeD1Batch(d1, {
            statements: [
              {
                params: compiled.params,
                query: compiled.sql,
              },
              {
                params: countCompiled.params,
                query: countCompiled.sql,
              },
            ],
            ...session,
          });
          if (!batch.ok) {
            return errorResponse(
              400,
              "HTTP_ERROR",
              d1ErrorMessage(batch),
              "/gateway/fetch",
              "POST"
            );
          }
          const dataItem = batch.results[0];
          const countItem = batch.results[1];
          if (!dataItem || dataItem.success === false) {
            const message =
              dataItem &&
              typeof (dataItem as { error?: unknown }).error === "string" &&
              (dataItem as { error: string }).error.trim()
                ? (dataItem as { error: string }).error
                : "D1 page query failed";
            return errorResponse(
              400,
              "HTTP_ERROR",
              message,
              "/gateway/fetch",
              "POST"
            );
          }
          // Do not fall back to page length: callers asked for an exact/planned/
          // estimated total, so a failed COUNT must surface as an error.
          if (!countItem || countItem.success === false) {
            const message =
              countItem &&
              typeof (countItem as { error?: unknown }).error === "string" &&
              (countItem as { error: string }).error.trim()
                ? (countItem as { error: string }).error
                : "D1 count query failed";
            return errorResponse(
              400,
              "HTTP_ERROR",
              message,
              "/gateway/fetch",
              "POST"
            );
          }
          const dataRows = Array.isArray(dataItem.results)
            ? dataItem.results
            : [];
          const countRows = Array.isArray(countItem.results)
            ? countItem.results
            : [];
          const total = extractAthenaCount(countRows);
          const rows = maybeStripNullRows(dataRows, stripNulls);
          return successResponse(
            rows as T,
            total,
            { batch, count: countItem, data: dataItem },
            batch.bookmark,
            "/gateway/fetch"
          );
        }

        return runCompiled(
          compiled,
          callOptions,
          "/gateway/fetch",
          "POST",
          undefined,
          stripNulls
        );
      } catch (error) {
        return compileErrorResponse(error, "/gateway/fetch", "POST");
      }
    },
    async insertGateway<T>(
      payload: AthenaInsertPayload,
      callOptions?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      try {
        const compiled = compileD1Insert(payload);
        const stripNulls = resolveStripNulls(undefined, callOptions, true);
        return runCompiled(
          compiled,
          callOptions,
          "/gateway/insert",
          "PUT",
          undefined,
          stripNulls
        );
      } catch (error) {
        return compileErrorResponse(error, "/gateway/insert", "PUT");
      }
    },
    async queryGateway<T>(
      payload: AthenaQueryPayload,
      callOptions?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      try {
        const params = payload.params ?? callOptions?.params;
        const session = sessionFromOptions(callOptions, options);
        // Shared SDK typed planners may emit Postgres casts (::text) for UUID eq;
        // rewrite to SQLite-safe SQL before D1 execution.
        const query = rewritePostgresSqlForSqlite(payload.query);
        const result = await executeD1Query(d1, {
          params: Array.isArray(params) ? params : [],
          query,
          ...session,
        });
        if (!result.ok) {
          return errorResponse(
            400,
            "HTTP_ERROR",
            d1ErrorMessage(result),
            "/gateway/query",
            "POST"
          );
        }
        const stripNulls = resolveStripNulls(undefined, callOptions, true);
        const rows = maybeStripNullRows(result.rows, stripNulls);
        return successResponse(
          rows as T,
          result.count,
          { ...result, query },
          result.bookmark,
          "/gateway/query"
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResponse(
          500,
          "UNKNOWN_ERROR",
          message,
          "/gateway/query",
          "POST"
        );
      }
    },
    async resolveCallOptions(callOptions) {
      return callOptions;
    },
    async rpcGateway<T>(
      payload: AthenaRpcPayload,
      callOptions?: AthenaRpcCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      void payload;
      void callOptions;
      return errorResponse(
        400,
        "HTTP_ERROR",
        "RPC is unsupported on D1 edge-local mode",
        "/gateway/rpc",
        "POST",
        "Use flat CRUD or raw query SQL instead"
      );
    },
    async updateGateway<T>(
      payload: AthenaUpdatePayload,
      callOptions?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      try {
        const session = sessionFromOptions(callOptions, options);
        const compileOptions = await compileOptionsForBoundedMutation(
          d1,
          payload,
          session
        );
        const compiled = compileD1Update(payload, compileOptions);
        const stripNulls = resolveStripNulls(
          payload.strip_nulls,
          callOptions,
          true
        );
        return runCompiled(
          compiled,
          callOptions,
          "/gateway/update",
          "POST",
          undefined,
          stripNulls
        );
      } catch (error) {
        return compileErrorResponse(error, "/gateway/update", "POST");
      }
    },
    async verifyConnection(
      connectionOptions?: AthenaGatewayConnectionOptions
    ): Promise<AthenaGatewayConnectionResult> {
      void connectionOptions;
      const baseUrl = CLOUDFLARE_EDGE_BASE_URL;
      try {
        const result = await executeD1Query(d1, { query: "SELECT 1 AS ok" });
        if (!result.ok) {
          return {
            baseUrl,
            error: d1ErrorMessage(result),
            errorDetails: null,
            ok: false,
            raw: result,
            reachable: false,
            status: 500,
            statusText: null,
            url: `${baseUrl}/d1`,
          };
        }
        return {
          baseUrl,
          error: undefined,
          errorDetails: null,
          ok: true,
          raw: result,
          reachable: true,
          status: 200,
          statusText: "OK",
          url: `${baseUrl}/d1`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          baseUrl,
          error: message,
          errorDetails: null,
          ok: false,
          raw: null,
          reachable: false,
          status: 0,
          statusText: null,
          url: `${baseUrl}/d1`,
        };
      }
    },
  } as AthenaGatewayClient;
}
