import { applyNamingStyle } from './naming.ts'
import type { GeneratorArtifactKind, GeneratorOutputConfig } from './types.ts'

export interface PlaceholderContext {
  provider: string
  kind: GeneratorArtifactKind
  database: string
  schema: string
  model: string
}

function createStyleTokens(prefix: string, value: string): Record<string, string> {
  return {
    [prefix]: value,
    [`${prefix}_camel`]: applyNamingStyle(value, 'camel'),
    [`${prefix}_pascal`]: applyNamingStyle(value, 'pascal'),
    [`${prefix}_snake`]: applyNamingStyle(value, 'snake'),
    [`${prefix}_kebab`]: applyNamingStyle(value, 'kebab'),
  }
}

function renderTemplate(template: string, tokenMap: Record<string, string>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, token) => {
    if (!(token in tokenMap)) {
      throw new Error(`Unknown placeholder token "${token}" in template "${template}"`)
    }
    return tokenMap[token]
  })
}

function resolvePlaceholderMap(
  baseTokens: Record<string, string>,
  outputConfig: GeneratorOutputConfig,
): Record<string, string> {
  const resolved: Record<string, string> = {
    ...baseTokens,
  }
  const reservedTokenKeys = new Set(Object.keys(baseTokens))

  const entries = Object.entries(outputConfig.placeholderMap ?? {})
  for (let index = 0; index < entries.length; index += 1) {
    const [key, value] = entries[index]
    if (reservedTokenKeys.has(key)) {
      continue
    }

    let current = value
    for (let depth = 0; depth < 8; depth += 1) {
      const next = renderTemplate(current, resolved)
      if (next === current) {
        break
      }
      current = next
    }
    resolved[key] = current
  }

  return resolved
}

export function renderOutputPath(
  template: string,
  context: PlaceholderContext,
  outputConfig: GeneratorOutputConfig,
): string {
  const baseTokens: Record<string, string> = {
    provider: context.provider,
    kind: context.kind,
    ...createStyleTokens('database', context.database),
    ...createStyleTokens('schema', context.schema),
    ...createStyleTokens('model', context.model),
  }

  const tokens = resolvePlaceholderMap(baseTokens, outputConfig)
  return renderTemplate(template, tokens)
}
