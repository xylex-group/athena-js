import type { GeneratorProviderConfig, GeneratorSchemaSelection } from './types.ts'

export const DEFAULT_POSTGRES_SCHEMAS = ['public'] as const

function collectSchemaNames(input: GeneratorSchemaSelection | undefined): string[] {
  if (!input) {
    return []
  }

  const values = typeof input === 'string' ? [input] : input
  return values.flatMap(value => String(value).split(','))
}

/**
 * Normalizes schema selection from config or env-backed strings into a stable,
 * deduplicated list. Empty selections fall back to PostgreSQL's public schema.
 */
export function normalizeSchemaSelection(
  input: GeneratorSchemaSelection | undefined,
): string[] {
  const schemas: string[] = []
  const seen = new Set<string>()

  for (const value of collectSchemaNames(input)) {
    const schema = value.trim()
    if (!schema || seen.has(schema)) {
      continue
    }
    seen.add(schema)
    schemas.push(schema)
  }

  return schemas.length > 0 ? schemas : [...DEFAULT_POSTGRES_SCHEMAS]
}

/**
 * Resolves the effective schema list for provider-backed generator runs.
 */
export function resolveProviderSchemas(providerConfig: GeneratorProviderConfig): string[] {
  if (providerConfig.kind === 'postgres') {
    return normalizeSchemaSelection(providerConfig.schemas)
  }

  return [...DEFAULT_POSTGRES_SCHEMAS]
}
