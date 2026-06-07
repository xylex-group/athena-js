const BOOLEAN_TRUE_TOKENS = new Set(['true', '1', 'yes', 'y', 'on'])
const BOOLEAN_FALSE_TOKENS = new Set(['false', '0', 'no', 'n', 'off'])

function parseBooleanToken(value: string): boolean | null {
  const normalized = value.trim().toLowerCase()
  if (BOOLEAN_TRUE_TOKENS.has(normalized)) return true
  if (BOOLEAN_FALSE_TOKENS.has(normalized)) return false
  return null
}

export function asString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    return parseBooleanToken(value) ?? false
  }

  return false
}

export function asBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    return parseBooleanToken(value)
  }

  return null
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export function asIdentifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  return asString(value)
}

export function firstString(
  record: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): string | null {
  if (!record) return null
  for (const key of keys) {
    const value = asString(record[key])
    if (value) return value
  }
  return null
}

export function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(entry => entry.length > 0)
}
