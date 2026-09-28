function isIdentChar(ch: string | undefined): boolean {
  if (!ch) {
    return false;
  }
  return /[A-Za-z0-9_]/.test(ch);
}

function scanSqlKeywordsOutsideLiterals(
  sql: string,
  onKeyword: (keyword: string, index: number) => boolean | undefined
): void {
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

    if (!isIdentChar(ch) || isIdentChar(sql[i - 1])) {
      continue;
    }

    let end = i + 1;
    while (end < sql.length && isIdentChar(sql[end])) {
      end += 1;
    }
    const keyword = sql.slice(i, end);
    if (onKeyword(keyword, i)) {
      return;
    }
    i = end - 1;
  }
}

export function sqlContainsKeywordOutsideLiterals(
  sql: string,
  keyword: string
): boolean {
  const target = keyword.toUpperCase();
  let found = false;
  scanSqlKeywordsOutsideLiterals(sql, (token) => {
    if (token.toUpperCase() === target) {
      found = true;
      return true;
    }
    return false;
  });
  return found;
}

export function sqlFirstKeywordOutsideLiterals(sql: string): string | null {
  let first: string | null = null;
  scanSqlKeywordsOutsideLiterals(sql, (token) => {
    first = token;
    return true;
  });
  return first;
}

const ROW_PRODUCING_LEAD_KEYWORDS = new Set([
  "SELECT",
  "PRAGMA",
  "EXPLAIN",
  "VALUES",
]);
const MUTATION_LEAD_KEYWORDS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "REPLACE",
]);
const WITH_TERMINAL_KEYWORDS = new Set([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "REPLACE",
  "VALUES",
  "PRAGMA",
  "EXPLAIN",
]);

export function sqlTerminalKeywordAfterWith(sql: string): string | null {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBracket = false;
  let inLineComment = false;
  let inBlockComment = false;
  let depth = 0;
  let sawWith = false;

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
      if (depth > 0) {
        depth -= 1;
      }
      continue;
    }

    if (depth !== 0 || !isIdentChar(ch) || isIdentChar(sql[i - 1])) {
      continue;
    }

    let end = i + 1;
    while (end < sql.length && isIdentChar(sql[end])) {
      end += 1;
    }
    const keyword = sql.slice(i, end);
    const upper = keyword.toUpperCase();

    if (!sawWith) {
      if (upper === "WITH") {
        sawWith = true;
      }
      i = end - 1;
      continue;
    }

    if (WITH_TERMINAL_KEYWORDS.has(upper)) {
      return keyword;
    }
    i = end - 1;
  }
  return null;
}

export function sqlLeadStatementKeyword(sql: string): string | null {
  const first = sqlFirstKeywordOutsideLiterals(sql);
  if (!first) {
    return null;
  }
  if (first.toUpperCase() !== "WITH") {
    return first;
  }
  return sqlTerminalKeywordAfterWith(sql) ?? first;
}

export function statementExpectsResultRows(sql: string): boolean {
  const lead = sqlLeadStatementKeyword(sql);
  if (lead) {
    const upper = lead.toUpperCase();
    if (ROW_PRODUCING_LEAD_KEYWORDS.has(upper)) {
      return true;
    }
    if (MUTATION_LEAD_KEYWORDS.has(upper)) {
      return sqlContainsKeywordOutsideLiterals(sql, "RETURNING");
    }
  }
  return sqlContainsKeywordOutsideLiterals(sql, "RETURNING");
}
