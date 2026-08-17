/**
 * Rewrite PostgreSQL-oriented SQL (from shared SDK typed planners) for SQLite/D1.
 */

const PG_CAST_TYPES =
  "text|uuid|citext|varchar|bpchar|char|integer|int4|int8|bigint|smallint|boolean|bool|jsonb|json|numeric|decimal|real|float|double precision|timestamptz|timestamp|date|bytea";

/**
 * Apply a transform only outside SQL string/identifier literals and comments.
 * Prevents corrupting values like `'value::text'` or `` `a;b` ``.
 */
function mapSqlOutsideLiterals(
  sql: string,
  transform: (chunk: string) => string
): string {
  let out = "";
  let buffer = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBracket = false;
  let inLineComment = false;
  let inBlockComment = false;

  const flushCode = () => {
    if (buffer) {
      out += transform(buffer);
      buffer = "";
    }
  };

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (inLineComment) {
      out += ch;
      if (ch === "\n" || ch === "\r") {
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next;
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle) {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i += 1;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === '"' && next === '"') {
        out += next;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inBacktick) {
      out += ch;
      if (ch === "`" && next === "`") {
        out += next;
        i += 1;
        continue;
      }
      if (ch === "`") {
        inBacktick = false;
      }
      continue;
    }
    if (inBracket) {
      out += ch;
      if (ch === "]") {
        inBracket = false;
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      flushCode();
      out += ch;
      out += next;
      i += 1;
      inLineComment = true;
      continue;
    }
    if (ch === "/" && next === "*") {
      flushCode();
      out += ch;
      out += next;
      i += 1;
      inBlockComment = true;
      continue;
    }
    if (ch === "'") {
      flushCode();
      out += ch;
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      flushCode();
      out += ch;
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      flushCode();
      out += ch;
      inBacktick = true;
      continue;
    }
    if (ch === "[") {
      flushCode();
      out += ch;
      inBracket = true;
      continue;
    }

    buffer += ch;
  }

  flushCode();
  return out;
}

interface SqlKeywordHit {
  /** Parenthesis nesting depth at the keyword. */
  depth: number;
  kind: "limit" | "offset";
  /** Start index of the keyword in the full SQL string. */
  start: number;
  /**
   * Top-level statement index (increments on `;` at depth 0).
   * Prevents a LIMIT in statement N from “covering” a bare OFFSET in statement N+1.
   */
  statement: number;
}

function isIdentChar(ch: string | undefined): boolean {
  if (!ch) {
    return false;
  }
  return /[A-Za-z0-9_]/.test(ch);
}

/**
 * Collect LIMIT / OFFSET keyword positions outside literals/comments, with paren depth.
 */
function collectLimitOffsetKeywords(sql: string): SqlKeywordHit[] {
  const hits: SqlKeywordHit[] = [];
  let depth = 0;
  let statement = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBracket = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === "\n" || ch === "\r") {
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        i += 1;
        inBlockComment = false;
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
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inBacktick = true;
      continue;
    }
    if (ch === "[") {
      inBracket = true;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    // Top-level statement separator (outside strings/comments/parens).
    if (ch === ";" && depth === 0) {
      statement += 1;
      continue;
    }

    // Keyword scan only at identifier boundaries.
    if (!isIdentChar(ch) || isIdentChar(sql[i - 1])) {
      continue;
    }

    const rest = sql.slice(i);
    if (/^LIMIT\b/i.test(rest)) {
      hits.push({ depth, kind: "limit", start: i, statement });
      i += 4; // advance to last char of LIMIT; loop +1
      continue;
    }
    if (/^OFFSET\b/i.test(rest)) {
      hits.push({ depth, kind: "offset", start: i, statement });
      i += 5;
    }
  }

  return hits;
}

/**
 * SQLite requires LIMIT when OFFSET is present. Inject `LIMIT -1` before each bare
 * OFFSET, considering the full SQL (across comments/literals) and paren depth so
 * nested LIMITs do not suppress outer bare OFFSET, and comments between LIMIT and
 * OFFSET do not produce double LIMIT.
 */
export function injectLimitBeforeBareOffsets(sql: string): string {
  const hits = collectLimitOffsetKeywords(sql);
  if (hits.length === 0) {
    return sql;
  }

  const injectAt: number[] = [];
  for (const hit of hits) {
    if (hit.kind !== "offset") {
      continue;
    }
    let hasLimit = false;
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      const prev = hits[i]!;
      if (prev.start >= hit.start) {
        continue;
      }
      // Only a LIMIT in the same top-level statement and paren depth counts.
      if (prev.statement !== hit.statement) {
        continue;
      }
      if (prev.depth !== hit.depth) {
        continue;
      }
      if (prev.kind === "limit") {
        hasLimit = true;
        break;
      }
      if (prev.kind === "offset") {
        // Prior OFFSET at same depth/statement without a LIMIT between is still bare.
        break;
      }
    }
    if (!hasLimit) {
      injectAt.push(hit.start);
    }
  }

  if (injectAt.length === 0) {
    return sql;
  }

  // Insert from the end so earlier indices stay valid.
  let out = sql;
  for (let i = injectAt.length - 1; i >= 0; i -= 1) {
    const at = injectAt[i]!;
    out = `${out.slice(0, at)}LIMIT -1 ${out.slice(at)}`;
  }
  return out;
}

/**
 * Strip Postgres cast suffixes and normalize a few operators so UUID equality
 * plans like `"id"::text = '…'::text` execute on D1.
 * String/identifier literals are left unchanged.
 */
export function rewritePostgresSqlForSqlite(sql: string): string {
  const castPattern = new RegExp(`::(?:${PG_CAST_TYPES})\\b`, "gi");
  const withoutCastsAndIlike = mapSqlOutsideLiterals(sql, (chunk) => {
    let rewritten = chunk.replace(castPattern, "");
    // ILIKE is Postgres-only; NOCASE is the D1/SQLite approximation used by L1 compiler.
    rewritten = rewritten.replace(/\bILIKE\b/gi, "LIKE");
    return rewritten;
  });
  // OFFSET rewrite must see the full statement (LIMIT may be separated by comments).
  return injectLimitBeforeBareOffsets(withoutCastsAndIlike);
}
