const SIMPLE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const COMPOSITE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/
const ALIAS_PATTERN = /^([A-Za-z_][A-Za-z0-9_.]*)\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*)$/i

function quoteIdentifierSegment(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

export function quoteQualifiedIdentifier(identifier: string): string {
  return identifier
    .split('.')
    .map(segment => quoteIdentifierSegment(segment))
    .join('.')
}

function quoteSelectToken(token: string): string {
  if (token === '*') return token
  if (COMPOSITE_IDENTIFIER_PATTERN.test(token)) {
    return quoteQualifiedIdentifier(token)
  }

  const aliasMatch = ALIAS_PATTERN.exec(token)
  if (aliasMatch) {
    const [, baseIdentifier, aliasIdentifier] = aliasMatch
    if (COMPOSITE_IDENTIFIER_PATTERN.test(baseIdentifier) && SIMPLE_IDENTIFIER_PATTERN.test(aliasIdentifier)) {
      return `${quoteQualifiedIdentifier(baseIdentifier)} AS ${quoteIdentifierSegment(aliasIdentifier)}`
    }
  }

  return token
}

/**
 * Quotes identifier lists while preserving raw SQL expressions.
 * `*`, function calls, or already complex expressions are passed through.
 */
export function quoteSelectColumnsExpression(columns: string): string {
  const trimmed = columns.trim()
  if (!trimmed || trimmed === '*') return trimmed || '*'
  if (!trimmed.includes(',')) {
    return quoteSelectToken(trimmed)
  }

  return trimmed
    .split(',')
    .map(part => quoteSelectToken(part.trim()))
    .join(', ')
}

export interface SqlIdentifier {
  readonly segments: string[]
  toSql(): string
  toString(): string
}

export function identifier(...segments: string[]): SqlIdentifier {
  const expandedSegments = segments
    .flatMap(segment => segment.split('.'))
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)

  const toSql = () => expandedSegments.map(quoteIdentifierSegment).join('.')

  return {
    segments: expandedSegments,
    toSql,
    toString() {
      return toSql()
    },
  }
}

