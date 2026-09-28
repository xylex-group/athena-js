/**
 * Pure D1 execution helpers shared by edge-local SDK transport and (later)
 * apps/cloudflare-d1-proxy.
 */

import type {
  D1DatabaseLike,
  D1ExecResultLike,
  D1ResultLike,
  D1SessionLike,
} from "../types.ts";
export {
  sqlContainsKeywordOutsideLiterals,
  sqlFirstKeywordOutsideLiterals,
  sqlLeadStatementKeyword,
  sqlTerminalKeywordAfterWith,
  statementExpectsResultRows,
} from "./statement-classifier.ts";
import { statementExpectsResultRows } from "./statement-classifier.ts";

export interface D1RunnerSessionInput {
  bookmark?: string | null;
  sessionMode?: string | null;
}

export type D1QueryInput = D1RunnerSessionInput & {
  query: string;
  params?: unknown[];
};

export interface D1BatchStatementInput {
  params?: unknown[];
  query: string;
}

export type D1BatchInput = D1RunnerSessionInput & {
  statements: D1BatchStatementInput[];
};

export interface D1RunnerQuerySuccess {
  bookmark: string | null;
  columns: string[];
  count: number;
  durationMs?: number;
  meta: Record<string, unknown>;
  ok: true;
  rows: unknown[];
  statementCount?: number;
}

export interface D1RunnerQueryFailure {
  error: string;
  message: string;
  ok: false;
}

export type D1RunnerQueryResult = D1RunnerQuerySuccess | D1RunnerQueryFailure;

export interface D1RunnerBatchSuccess {
  bookmark: string | null;
  ok: true;
  results: D1ResultLike<unknown>[];
}

export type D1RunnerBatchResult = D1RunnerBatchSuccess | D1RunnerQueryFailure;

function resultColumns(rows: unknown[]): string[] {
  const first = rows.find(
    (value) => value && typeof value === "object" && !Array.isArray(value)
  );
  if (!first) {
    return [];
  }
  return Object.keys(first as Record<string, unknown>);
}

/** Flatten D1 batch statement results into a single row array for client.query. */
function collectRowsFromBatchResults(
  results: D1ResultLike<unknown>[]
): unknown[] {
  const rows: unknown[] = [];
  for (const item of results) {
    if (Array.isArray(item.results) && item.results.length > 0) {
      rows.push(...item.results);
    }
  }
  return rows;
}

/** Sum D1 `meta.changes` across batch items; fall back to statement count. */
function sumBatchAffectedRows(
  results: D1ResultLike<unknown>[],
  statementCount: number
): number {
  let sum = 0;
  let sawChanges = false;
  for (const item of results) {
    const changes = item.meta?.changes;
    if (typeof changes === "number") {
      sum += changes;
      sawChanges = true;
    }
  }
  return sawChanges ? sum : statementCount;
}

/** Word-boundary keyword match at `index` (ASCII identifiers / SQL keywords). */
function matchSqlKeywordAt(
  query: string,
  index: number,
  keyword: string
): number | null {
  const len = keyword.length;
  if (index + len > query.length) {
    return null;
  }
  const slice = query.slice(index, index + len);
  if (slice.toLowerCase() !== keyword.toLowerCase()) {
    return null;
  }
  const before = index === 0 ? "" : query[index - 1]!;
  const after = index + len >= query.length ? "" : query[index + len]!;
  const isIdent = (c: string) => /[A-Za-z0-9_]/.test(c);
  if (before && isIdent(before)) {
    return null;
  }
  if (after && isIdent(after)) {
    return null;
  }
  return len;
}

/**
 * Split SQL into statements without treating `;` inside string literals,
 * quoted identifiers, comments, or SQLite trigger bodies as separators.
 *
 * Trigger DDL (`CREATE TRIGGER ... BEGIN ...; ...; END`) keeps the body as one
 * statement. Nested `CASE ... END` inside the body does not close the trigger.
 * Bare transaction `BEGIN` / `BEGIN TRANSACTION` is not treated as a body opener.
 */
export function splitSqlStatements(query: string): string[] {
  const statements: string[] = [];
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBracket = false;
  let inLineComment = false;
  let inBlockComment = false;
  let segmentStart = 0;
  let segmentHasContent = false;

  /** After `CREATE TRIGGER`, wait for the body-opening `BEGIN`. */
  let awaitTriggerBegin = false;
  /** Depth of open `CREATE TRIGGER ... BEGIN` bodies (normally 0 or 1). */
  let triggerBodyDepth = 0;
  /** Nested `CASE` expressions so their `END` does not close a trigger body. */
  let caseDepth = 0;

  const flushSegment = (end: number) => {
    if (!segmentHasContent) {
      segmentStart = end + 1;
      return;
    }
    const sql = query.slice(segmentStart, end).trim();
    if (sql) {
      statements.push(sql);
    }
    segmentHasContent = false;
    segmentStart = end + 1;
    awaitTriggerBegin = false;
    triggerBodyDepth = 0;
    caseDepth = 0;
  };

  for (let i = 0; i < query.length; i += 1) {
    const ch = query[i]!;
    const next = query[i + 1];

    if (inLineComment) {
      if (ch === "\n" || ch === "\r") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inSingle) {
      if (ch === "'" && next === "'") {
        i += 1;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (ch === '"' && next === '"') {
        i += 1;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      continue;
    }

    // SQLite also allows `backtick` and [bracket] identifiers.
    if (inBacktick) {
      if (ch === "`" && next === "`") {
        i += 1;
        continue;
      }
      if (ch === "`") {
        inBacktick = false;
      }
      continue;
    }

    if (inBracket) {
      if (ch === "]") {
        inBracket = false;
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      segmentHasContent = true;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      segmentHasContent = true;
      continue;
    }

    if (ch === "`") {
      inBacktick = true;
      segmentHasContent = true;
      continue;
    }

    if (ch === "[") {
      inBracket = true;
      segmentHasContent = true;
      continue;
    }

    // Structural keywords that affect statement boundaries (trigger bodies / CASE).
    if (/[A-Za-z_]/.test(ch)) {
      const createLen = matchSqlKeywordAt(query, i, "CREATE");
      if (createLen !== null) {
        // CREATE [TEMP|TEMPORARY] TRIGGER [IF NOT EXISTS] …
        // SQLite allows whitespace and comments between these keywords.
        let j = i + createLen;
        const skipWsAndComments = () => {
          while (j < query.length) {
            const c = query[j]!;
            const n = query[j + 1];
            if (/\s/.test(c)) {
              j += 1;
              continue;
            }
            if (c === "-" && n === "-") {
              j += 2;
              while (
                j < query.length &&
                query[j] !== "\n" &&
                query[j] !== "\r"
              ) {
                j += 1;
              }
              continue;
            }
            if (c === "/" && n === "*") {
              j += 2;
              while (j < query.length) {
                if (query[j] === "*" && query[j + 1] === "/") {
                  j += 2;
                  break;
                }
                j += 1;
              }
              continue;
            }
            break;
          }
        };
        skipWsAndComments();
        const tempLen =
          matchSqlKeywordAt(query, j, "TEMPORARY") ??
          matchSqlKeywordAt(query, j, "TEMP");
        if (tempLen !== null) {
          j += tempLen;
          skipWsAndComments();
        }
        const triggerLen = matchSqlKeywordAt(query, j, "TRIGGER");
        if (triggerLen !== null) {
          awaitTriggerBegin = true;
          segmentHasContent = true;
          i += createLen - 1;
          continue;
        }
        segmentHasContent = true;
        i += createLen - 1;
        continue;
      }

      const caseLen = matchSqlKeywordAt(query, i, "CASE");
      if (caseLen !== null) {
        caseDepth += 1;
        segmentHasContent = true;
        i += caseLen - 1;
        continue;
      }

      const beginLen = matchSqlKeywordAt(query, i, "BEGIN");
      if (beginLen !== null) {
        if (awaitTriggerBegin) {
          triggerBodyDepth += 1;
          awaitTriggerBegin = false;
        }
        segmentHasContent = true;
        i += beginLen - 1;
        continue;
      }

      const endLen = matchSqlKeywordAt(query, i, "END");
      if (endLen !== null) {
        if (caseDepth > 0) {
          caseDepth -= 1;
        } else if (triggerBodyDepth > 0) {
          triggerBodyDepth -= 1;
        }
        segmentHasContent = true;
        i += endLen - 1;
        continue;
      }

      // Consume the rest of this identifier so we do not re-scan mid-token.
      let j = i + 1;
      while (j < query.length && /[A-Za-z0-9_]/.test(query[j]!)) {
        j += 1;
      }
      segmentHasContent = true;
      i = j - 1;
      continue;
    }

    if (ch === ";") {
      // Keep trigger bodies (and any nested CASE) as a single statement.
      if (triggerBodyDepth > 0 || caseDepth > 0) {
        segmentHasContent = true;
        continue;
      }
      flushSegment(i);
      continue;
    }

    if (!/\s/.test(ch)) {
      segmentHasContent = true;
    }
  }

  flushSegment(query.length);
  return statements;
}

/**
 * Detect multiple SQL statements without treating `;` inside string literals,
 * quoted identifiers, comments, or trigger bodies as separators.
 */
export function isMultiStatement(query: string): boolean {
  return splitSqlStatements(query).length > 1;
}

function resolveSessionTarget(
  db: D1DatabaseLike,
  input: D1RunnerSessionInput
): { target: D1DatabaseLike | D1SessionLike; session: D1SessionLike | null } {
  const sessionValue = input.bookmark?.trim() || input.sessionMode?.trim();
  if (!sessionValue) {
    return { session: null, target: db };
  }
  if (typeof db.withSession !== "function") {
    throw new Error(
      "D1 session mode/bookmark requested but withSession is not available"
    );
  }
  const session = db.withSession(sessionValue);
  return { session, target: session };
}

/**
 * D1 prepared-statement bind rejects JS booleans (parameter-type error).
 * Map true→1 / false→0 so .eq('pending', true) and insert bodies work.
 */
function normalizeD1BindParams(params: unknown[]): unknown[] {
  return params.map((value) => {
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    return value;
  });
}

/**
 * Execute a single query (or multi-statement `exec`) against a D1 binding.
 */
export async function executeD1Query(
  db: D1DatabaseLike,
  input: D1QueryInput
): Promise<D1RunnerQueryResult> {
  const query = input.query?.trim();
  if (!query) {
    return { error: "invalid_query", message: "query is required", ok: false };
  }

  const params = normalizeD1BindParams(
    Array.isArray(input.params) ? input.params : []
  );
  const { target, session } = resolveSessionTarget(db, input);

  if (isMultiStatement(query)) {
    if (params.length > 0) {
      return {
        error: "invalid_query",
        message: "params are only supported for single prepared statements",
        ok: false,
      };
    }
    const resolveBookmark = (): string | null => session?.getBookmark() ?? null;
    const parts = splitSqlStatements(query);
    // Prefer batch over exec so row-producing statements (SELECT …) surface
    // results — D1 exec() only returns statement counts, not result sets.
    // Sessions also lack exec(); batch(prepare) works on both targets.
    if (typeof target.batch === "function") {
      const prepared = parts.map((part) => target.prepare(part));
      const results = await target.batch(prepared);
      const rows = collectRowsFromBatchResults(results);
      return {
        bookmark: resolveBookmark(),
        columns: resultColumns(rows),
        // Prefer returned rows; otherwise sum mutation meta.changes (not statement count).
        count:
          rows.length > 0
            ? rows.length
            : sumBatchAffectedRows(results, parts.length),
        meta: { results, statementCount: parts.length },
        ok: true,
        rows,
        statementCount: parts.length,
      };
    }
    const canExec =
      typeof (target as D1DatabaseLike).exec === "function" && !session;
    if (canExec) {
      const execResult: D1ExecResultLike = await (
        target as D1DatabaseLike
      ).exec?.(query);
      return {
        bookmark: resolveBookmark(),
        columns: [],
        count: execResult.count,
        durationMs: execResult.duration,
        meta: { statementCount: execResult.count },
        ok: true,
        rows: [],
        statementCount: execResult.count,
      };
    }
    return {
      error: "invalid_query",
      message: "multi-statement query requires D1 batch() or exec() support",
      ok: false,
    };
  }

  let statement = target.prepare(query);
  if (params.length > 0) {
    statement = statement.bind(...params);
  }

  // Prefer .all() when the statement returns rows. Real D1 bindings only expose
  // RETURNING result sets via all()/first() — run() is metadata-oriented and can
  // yield empty results for INSERT/UPDATE/DELETE … RETURNING.
  // Skip leading comments and detect RETURNING only outside literals/comments.
  const expectsRows = statementExpectsResultRows(query);
  const result = expectsRows ? await statement.all() : await statement.run();
  if (result.success === false) {
    const errorField = (result as { error?: unknown }).error;
    const message =
      typeof errorField === "string" && errorField.trim()
        ? errorField
        : "D1 query failed";
    return {
      error: "query_failed",
      message,
      ok: false,
    };
  }
  const rows = Array.isArray(result.results) ? result.results : [];
  const bookmark = session?.getBookmark() ?? null;
  const meta = (result.meta ?? {}) as Record<string, unknown>;
  const changes =
    typeof meta.changes === "number"
      ? meta.changes
      : typeof result.meta?.changes === "number"
        ? result.meta.changes
        : undefined;

  return {
    bookmark,
    columns: resultColumns(rows),
    count: expectsRows ? rows.length : (changes ?? rows.length),
    durationMs:
      typeof result.meta?.duration === "number"
        ? result.meta.duration
        : undefined,
    meta,
    ok: true,
    rows,
  };
}

/**
 * Execute a batch of prepared statements against a D1 binding.
 */
export async function executeD1Batch(
  db: D1DatabaseLike,
  input: D1BatchInput
): Promise<D1RunnerBatchResult> {
  const statements = Array.isArray(input.statements) ? input.statements : [];
  if (statements.length === 0) {
    return {
      error: "invalid_batch",
      message: "statements must contain at least one item",
      ok: false,
    };
  }

  const { target, session } = resolveSessionTarget(db, input);
  const prepared = statements.map((item) => {
    const query = item.query?.trim();
    if (!query) {
      throw new Error("statements[].query is required");
    }
    const params = normalizeD1BindParams(
      Array.isArray(item.params) ? item.params : []
    );
    let statement = target.prepare(query);
    if (params.length > 0) {
      statement = statement.bind(...params);
    }
    return statement;
  });

  const results = await target.batch(prepared);
  const bookmark = session?.getBookmark() ?? null;
  return {
    bookmark,
    ok: true,
    results,
  };
}
