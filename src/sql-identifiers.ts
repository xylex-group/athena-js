const SIMPLE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COMPOSITE_IDENTIFIER_PATTERN =
  /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const SQL_ALIAS_PATTERN =
  /^([A-Za-z_][A-Za-z0-9_.]*)\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*)$/i;
const RESPONSE_ALIAS_PATTERN =
  /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_.]*)$/i;

function quoteIdentifierSegment(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function parseAliasedIdentifierToken(
  token: string
): { baseIdentifier: string; aliasIdentifier: string } | null {
  const responseAliasMatch = RESPONSE_ALIAS_PATTERN.exec(token);
  if (responseAliasMatch) {
    const [, aliasIdentifier, baseIdentifier] = responseAliasMatch;
    if (
      COMPOSITE_IDENTIFIER_PATTERN.test(baseIdentifier) &&
      SIMPLE_IDENTIFIER_PATTERN.test(aliasIdentifier)
    ) {
      return { aliasIdentifier, baseIdentifier };
    }
  }

  const sqlAliasMatch = SQL_ALIAS_PATTERN.exec(token);
  if (!sqlAliasMatch) {
    return null;
  }

  const [, baseIdentifier, aliasIdentifier] = sqlAliasMatch;
  if (
    !(
      COMPOSITE_IDENTIFIER_PATTERN.test(baseIdentifier) &&
      SIMPLE_IDENTIFIER_PATTERN.test(aliasIdentifier)
    )
  ) {
    return null;
  }

  return { aliasIdentifier, baseIdentifier };
}

/**
 * Quotes a `schema.table.column`-style identifier path safely for SQL.
 */
export function quoteQualifiedIdentifier(identifier: string): string {
  return identifier
    .split(".")
    .map((segment) => quoteIdentifierSegment(segment))
    .join(".");
}

function quoteSelectToken(token: string): string {
  if (token === "*") {
    return token;
  }
  if (COMPOSITE_IDENTIFIER_PATTERN.test(token)) {
    return quoteQualifiedIdentifier(token);
  }

  const aliasedIdentifier = parseAliasedIdentifierToken(token);
  if (!aliasedIdentifier) {
    return token;
  }
  const { baseIdentifier, aliasIdentifier } = aliasedIdentifier;
  return `${quoteQualifiedIdentifier(baseIdentifier)} AS ${quoteIdentifierSegment(aliasIdentifier)}`;
}

export function quoteSelectColumnToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed || trimmed === "*") {
    return trimmed || "*";
  }

  const responseAliasMatch = RESPONSE_ALIAS_PATTERN.exec(trimmed);
  if (responseAliasMatch) {
    const [, aliasIdentifier, baseIdentifier] = responseAliasMatch;
    return `${quoteQualifiedIdentifier(baseIdentifier)} AS ${quoteIdentifierSegment(aliasIdentifier)}`;
  }

  return quoteQualifiedIdentifier(trimmed);
}

function canAutoQuoteToken(token: string): boolean {
  if (token === "*") {
    return true;
  }
  if (COMPOSITE_IDENTIFIER_PATTERN.test(token)) {
    return true;
  }
  return parseAliasedIdentifierToken(token) !== null;
}

function splitTopLevelCommaSeparated(input: string): string[] | null {
  const parts: string[] = [];
  let buffer = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  let depth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = index + 1 < input.length ? input[index + 1] : "";

    if (singleQuoted) {
      buffer += char;
      if (char === "'" && next === "'") {
        buffer += next;
        index += 1;
        continue;
      }
      if (char === "'") {
        singleQuoted = false;
      }
      continue;
    }

    if (doubleQuoted) {
      buffer += char;
      if (char === '"' && next === '"') {
        buffer += next;
        index += 1;
        continue;
      }
      if (char === '"') {
        doubleQuoted = false;
      }
      continue;
    }

    if (char === "'") {
      singleQuoted = true;
      buffer += char;
      continue;
    }
    if (char === '"') {
      doubleQuoted = true;
      buffer += char;
      continue;
    }

    if (char === "(") {
      depth += 1;
      buffer += char;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth < 0) {
        return null;
      }
      buffer += char;
      continue;
    }

    if (char === "," && depth === 0) {
      parts.push(buffer.trim());
      buffer = "";
      continue;
    }

    buffer += char;
  }

  if (singleQuoted || doubleQuoted || depth !== 0) {
    return null;
  }

  if (buffer.trim().length > 0) {
    parts.push(buffer.trim());
  }

  return parts;
}

/**
 * Quotes identifier lists while preserving raw SQL expressions.
 *
 * Examples:
 * - `"table, user"` -> `"\"table\", \"user\""`
 * - `concat(name, ',') as label, id` -> unchanged
 */
export function quoteSelectColumnsExpression(columns: string): string {
  const trimmed = columns.trim();
  if (!trimmed || trimmed === "*") {
    return trimmed || "*";
  }

  const tokens = splitTopLevelCommaSeparated(trimmed);
  if (!tokens || tokens.length === 0) {
    return trimmed;
  }

  if (!tokens.every(canAutoQuoteToken)) {
    return trimmed;
  }

  return tokens.map(quoteSelectToken).join(", ");
}

/**
 * Immutable identifier object with consistent SQL rendering.
 */
export interface SqlIdentifier {
  readonly segments: string[];
  toSql: () => string;
  toString: () => string;
}

class SqlIdentifierPath implements SqlIdentifier {
  readonly segments: string[];

  constructor(segments: string[]) {
    this.segments = segments;
  }

  toSql(): string {
    return this.segments.map(quoteIdentifierSegment).join(".");
  }

  toString(): string {
    return this.toSql();
  }
}

/**
 * Creates a quoted identifier object from segment or dotted inputs.
 */
export function identifier(...segments: string[]): SqlIdentifier {
  const expandedSegments = segments
    .flatMap((segment) => segment.split("."))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return new SqlIdentifierPath(expandedSegments);
}
