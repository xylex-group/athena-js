import type {
  AthenaFetchPayload,
  AthenaGatewayCondition,
  AthenaJsonArray,
  AthenaJsonObject,
  AthenaJsonValue,
  AthenaSortBy,
} from './types.ts'

const IDENTIFIER_SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function isIdentifierPath(value: string): boolean {
  const segments = value.split('.').map(segment => segment.trim())
  return segments.length > 1 && segments.every(segment => IDENTIFIER_SEGMENT_PATTERN.test(segment))
}

function extractRelationHead(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  const aliasIndex = trimmed.indexOf(':')
  const withoutAlias = aliasIndex >= 0 ? trimmed.slice(aliasIndex + 1).trim() : trimmed
  const modifierIndex = withoutAlias.indexOf('!')
  return (modifierIndex >= 0 ? withoutAlias.slice(0, modifierIndex) : withoutAlias).trim()
}

function hasSchemaQualifiedRelationToken(select: string): boolean {
  let singleQuoted = false
  let doubleQuoted = false
  let tokenStart = 0

  for (let index = 0; index < select.length; index += 1) {
    const char = select[index]
    const next = index + 1 < select.length ? select[index + 1] : ''

    if (singleQuoted) {
      if (char === "'" && next === "'") {
        index += 1
        continue
      }
      if (char === "'") {
        singleQuoted = false
      }
      continue
    }

    if (doubleQuoted) {
      if (char === '"' && next === '"') {
        index += 1
        continue
      }
      if (char === '"') {
        doubleQuoted = false
      }
      continue
    }

    if (char === "'") {
      singleQuoted = true
      continue
    }

    if (char === '"') {
      doubleQuoted = true
      continue
    }

    if (char === '(') {
      const relationHead = extractRelationHead(select.slice(tokenStart, index))
      if (isIdentifierPath(relationHead)) {
        return true
      }
      tokenStart = index + 1
      continue
    }

    if (char === ',' || char === ')') {
      tokenStart = index + 1
    }
  }

  return false
}

function toStructuredSelectString(columns: string | string[]): string {
  return Array.isArray(columns) ? columns.join(',') : columns
}

type StructuredWhereOperand =
  | AthenaJsonValue
  | AthenaJsonArray
  | AthenaJsonObject

function buildStructuredWhere(
  conditions: AthenaGatewayCondition[] | undefined,
): AthenaJsonObject | null | undefined {
  if (!conditions?.length) return undefined

  const where: AthenaJsonObject = {}

  for (const condition of conditions) {
    if (!condition.column) {
      return null
    }
    if (condition.value_cast !== undefined) {
      return null
    }

    const operand = condition.value as StructuredWhereOperand | undefined
    const operator = condition.operator
    if (operator === 'eq') {
      if (operand === undefined) return null
    } else if (operator === 'neq' || operator === 'gt' || operator === 'lt') {
      if (operand === undefined) return null
    } else if (operator === 'in') {
      if (!Array.isArray(operand)) return null
    } else {
      return null
    }

    const existing = where[condition.column]
    if (existing !== undefined && (typeof existing !== 'object' || existing === null || Array.isArray(existing))) {
      return null
    }

    const next = (existing as AthenaJsonObject | undefined) ?? {}
    if (Object.prototype.hasOwnProperty.call(next, operator)) {
      return null
    }
    next[operator] = operand as AthenaJsonValue | AthenaJsonArray
    where[condition.column] = next
  }

  return where
}

function buildStructuredOrderBy(order: AthenaSortBy | undefined): AthenaJsonObject | undefined {
  if (!order?.field) return undefined
  return {
    [order.field]: order.direction === 'descending' ? 'desc' : 'asc',
  }
}

export interface StructuredSelectTransportInput {
  tableName: string
  columns: string | string[]
  conditions?: AthenaGatewayCondition[]
  limit?: number
  offset?: number
  order?: AthenaSortBy
  stripNulls: boolean
  count?: 'exact' | 'planned' | 'estimated'
  head?: boolean
}

export interface StructuredSelectTransportResult {
  payload: AthenaFetchPayload
  select: string
}

export function buildStructuredSelectTransport(
  input: StructuredSelectTransportInput,
): StructuredSelectTransportResult | null | { error: string } {
  const select = toStructuredSelectString(input.columns).trim()
  if (!select || select === '*') {
    return null
  }

  if (!hasSchemaQualifiedRelationToken(select)) {
    return null
  }

  if (input.count !== undefined || input.head !== undefined) {
    return {
      error:
        'Schema-qualified nested select strings require structured select transport, which does not support count/head options in athena-js yet.',
    }
  }

  const where = buildStructuredWhere(input.conditions)
  if (where === null) {
    return {
      error:
        'Schema-qualified nested select strings only support eq, neq, gt, lt, and in filters in athena-js structured select transport.',
    }
  }

  return {
    select,
    payload: {
      table_name: input.tableName,
      select,
      where,
      orderBy: buildStructuredOrderBy(input.order),
      limit: input.limit,
      offset: input.offset,
      strip_nulls: input.stripNulls,
    },
  }
}
