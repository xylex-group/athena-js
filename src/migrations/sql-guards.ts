import { MigrationError } from "./types.ts";

/**
 * Transaction-control forms that would terminate the runner's outer transaction
 * if executed inside migration SQL. Plain PL/pgSQL `BEGIN`/`END` blocks are
 * intentionally allowed.
 */
const TRANSACTION_CONTROL_RE =
  /\b(?:COMMIT(?:\s+(?:WORK|TRANSACTION))?|ROLLBACK(?:\s+(?:WORK|TRANSACTION))?|ABORT(?:\s+(?:WORK|TRANSACTION))?|START\s+TRANSACTION|BEGIN\s+(?:WORK|TRANSACTION)|END\s+TRANSACTION|PREPARE\s+TRANSACTION)\b/i;

/**
 * Strips SQL comments and quoted literals so keyword scans avoid false positives
 * inside strings or comments. Not a full SQL parser.
 */
export function stripSqlCommentsAndLiterals(sql: string): string {
  let output = "";
  let index = 0;

  while (index < sql.length) {
    const ch = sql[index];
    const next = sql[index + 1];

    // Line comment
    if (ch === "-" && next === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n") {
        index += 1;
      }
      output += " ";
      continue;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      index += 2;
      while (index < sql.length) {
        if (sql[index] === "*" && sql[index + 1] === "/") {
          index += 2;
          break;
        }
        index += 1;
      }
      output += " ";
      continue;
    }

    // Single-quoted string ('' escapes)
    if (ch === "'") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'") {
          if (sql[index + 1] === "'") {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      output += " ";
      continue;
    }

    // Dollar-quoted string: $tag$ ... $tag$
    if (ch === "$") {
      const rest = sql.slice(index);
      const tagMatch = rest.match(/^\$([A-Za-z_][\w]*)?\$/);
      if (tagMatch) {
        const opener = tagMatch[0];
        index += opener.length;
        const closer = opener;
        const closeAt = sql.indexOf(closer, index);
        if (closeAt === -1) {
          // Unterminated: drop remainder
          break;
        }
        index = closeAt + closer.length;
        output += " ";
        continue;
      }
    }

    output += ch;
    index += 1;
  }

  return output;
}

/**
 * Returns the matched transaction-control keyword if present in executable SQL.
 */
export function findTransactionControlStatement(sql: string): string | undefined {
  const scanned = stripSqlCommentsAndLiterals(sql);
  const match = TRANSACTION_CONTROL_RE.exec(scanned);
  if (!match) {
    return undefined;
  }
  return match[0]?.replace(/\s+/g, " ").toUpperCase();
}

/**
 * Fail closed when migration SQL could end the runner-owned transaction.
 */
export function assertMigrationSqlAllowsOuterTransaction(
  sql: string,
  filename?: string
): void {
  const found = findTransactionControlStatement(sql);
  if (!found) {
    return;
  }

  const where = filename ? ` in ${filename}` : "";
  throw new MigrationError(
    "DISCOVERY",
    [
      "Migration error:",
      `Transaction control statement ${found} is not allowed${where}.`,
      "",
      "athena-js migrate wraps each migration in its own transaction and writes",
      "the ledger row in that same transaction. COMMIT/ROLLBACK/START TRANSACTION",
      "(and similar) would break that atomicity.",
      "",
      "Remove transaction control from the migration SQL. PL/pgSQL BEGIN/END blocks",
      "inside functions remain allowed.",
    ].join("\n")
  );
}
