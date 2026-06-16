import type { AthenaModelTarget } from './types.ts'

interface ResolveAthenaModelTargetTableNameOptions {
  fallbackSchema?: string
  fallbackModel?: string
}

function normalizeOptionalName(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

export function isAthenaModelTarget(value: unknown): value is AthenaModelTarget {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as { meta?: { primaryKey?: unknown } }
  return Boolean(candidate.meta && Array.isArray(candidate.meta.primaryKey))
}

export function resolveAthenaModelTargetTableName(
  target: AthenaModelTarget,
  options: ResolveAthenaModelTargetTableNameOptions = {},
): string {
  const explicitTableName = normalizeOptionalName(target.meta.tableName)
  if (explicitTableName) {
    return explicitTableName
  }

  const schemaName = normalizeOptionalName(target.meta.schema ?? options.fallbackSchema)
  const modelName = normalizeOptionalName(target.meta.model ?? options.fallbackModel)

  if (!modelName) {
    throw new Error(
      'Athena model target is missing meta.model or meta.tableName. Provide one of those before calling from(model).',
    )
  }

  return schemaName ? `${schemaName}.${modelName}` : modelName
}
