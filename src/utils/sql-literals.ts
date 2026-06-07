interface CryptoLike {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T
}

function getRandomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  const cryptoApi = (globalThis as { crypto?: CryptoLike }).crypto
  if (cryptoApi?.getRandomValues) {
    return cryptoApi.getRandomValues(bytes)
  }

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

function createDollarQuoteTag(value: string): string {
  let tag = `s${bytesToHex(getRandomBytes(6))}`
  while (value.includes(`$${tag}$`)) {
    tag = `${tag}_`
  }
  return tag
}

/**
 * Wraps a string in a PostgreSQL dollar-quoted literal.
 *
 * Use this for SQL values, not identifiers. Pair with `identifier(...)`
 * for table/column names.
 */
export function sqlText(value: string): string {
  const tag = createDollarQuoteTag(value)
  return `$${tag}$${value}$${tag}$`
}

/**
 * Escapes `%`, `_`, and `\` for SQL `LIKE` / `ILIKE` patterns.
 */
export function escapeLikePatternValue(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
}

/**
 * Wraps a string in a single-quoted SQL string literal.
 *
 * Prefer `sqlText(...)` for arbitrary raw SQL values when possible.
 */
export function quoteSqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Returns a dollar-quoted literal for strings, or the SQL keyword `NULL`
 * for nullish values.
 */
export function sqlNullableText(value: string | null | undefined): string {
  if (value == null) return 'NULL'
  return sqlText(value)
}

/**
 * Serializes a value and casts the result to `jsonb`.
 */
export function sqlJsonbLiteral(value: unknown): string {
  return `${sqlText(JSON.stringify(value ?? null))}::jsonb`
}

/**
 * Renders an explicit `bigint` SQL literal.
 */
export function sqlBigInt(value: bigint | number): string {
  return `${BigInt(value).toString()}::bigint`
}
