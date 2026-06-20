import { posix } from 'path'
import type {
  GeneratedArtifact,
  GeneratedArtifacts,
  NormalizedAthenaGeneratorConfig,
} from './types.ts'
import type {
  IntrospectionRelation,
  IntrospectionSnapshot,
  IntrospectionTable,
} from '../schema/types.ts'
import {
  applyNamingStyle,
  escapeStringLiteral,
  escapeTypePropertyName,
  toSafeIdentifier,
} from './naming.ts'
import { renderOutputPath } from './placeholders.ts'

type OutputPathKind = 'model' | 'schema' | 'database' | 'registry'

type OutputPathTokens = {
  provider: string
  kind: OutputPathKind
  database: string
  schema: string
  model: string
}

type SchemaScopedPathDescriptor = {
  schemaName: string
  filePath: string
}

type DatabaseArtifactDescriptor<TSchema extends SchemaArtifactDescriptor = SchemaArtifactDescriptor> = {
  filePath: string
  databaseConstName: string
  schemas: TSchema[]
}

type ComposeGeneratorArtifactsInput<TModel extends ModelArtifactDescriptorBase> = {
  snapshot: IntrospectionSnapshot
  config: NormalizedAthenaGeneratorConfig
  createModelDescriptor: (input: {
    providerName: string
    databaseName: string
    schemaName: string
    tableName: string
    table: IntrospectionTable
  }) => TModel
  renderModelArtifact: (descriptor: TModel) => GeneratedArtifact
}

export interface ModelArtifactDescriptorBase extends SchemaScopedPathDescriptor {
  tableName: string
  exportConstName: string
  table: IntrospectionTable
}

export interface SchemaArtifactDescriptor<
  TModel extends ModelArtifactDescriptorBase = ModelArtifactDescriptorBase,
> extends SchemaScopedPathDescriptor {
  schemaConstName: string
  models: TModel[]
}

export function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/')
}

function withoutTypeScriptExtension(pathValue: string): string {
  return pathValue.replace(/\.tsx?$/i, '')
}

export function toModuleImportPath(fromFile: string, targetFile: string): string {
  const relativePath = withoutTypeScriptExtension(
    normalizePath(posix.relative(posix.dirname(fromFile), targetFile)),
  )
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`
}

export function resolveOutputPath(
  target: string,
  tokens: OutputPathTokens,
  config: NormalizedAthenaGeneratorConfig,
): string {
  return normalizePath(renderOutputPath(target, tokens, config.output))
}

export function renderObjectKey(key: string): string {
  return escapeTypePropertyName(key)
}

export function renderRelationLiteral(relation: IntrospectionRelation): string {
  const through = relation.through
    ? `,
      through: {
        schema: ${escapeStringLiteral(relation.through.schema)},
        model: ${escapeStringLiteral(relation.through.model)},
        sourceColumns: [${relation.through.sourceColumns.map(value => escapeStringLiteral(value)).join(', ')}],
        targetColumns: [${relation.through.targetColumns.map(value => escapeStringLiteral(value)).join(', ')}],
      }`
    : ''

  return `{
      kind: ${escapeStringLiteral(relation.kind)},
      sourceColumns: [${relation.sourceColumns.map(value => escapeStringLiteral(value)).join(', ')}],
      targetSchema: ${escapeStringLiteral(relation.targetSchema)},
      targetModel: ${escapeStringLiteral(relation.targetModel)},
      targetColumns: [${relation.targetColumns.map(value => escapeStringLiteral(value)).join(', ')}]${through}
    }`
}

export function renderSchemaArtifact<TModel extends ModelArtifactDescriptorBase>(
  descriptor: SchemaArtifactDescriptor<TModel>,
): GeneratedArtifact {
  const importLines = descriptor.models
    .map(modelDescriptor => {
      const importPath = toModuleImportPath(descriptor.filePath, modelDescriptor.filePath)
      return `import { ${modelDescriptor.exportConstName} } from '${importPath}'`
    })
    .join('\n')

  const modelEntries = descriptor.models
    .map(modelDescriptor => `  ${renderObjectKey(modelDescriptor.tableName)}: ${modelDescriptor.exportConstName}`)
    .join(',\n')

  const content = `import { defineSchema } from '@xylex-group/athena'
${importLines ? `\n${importLines}\n` : '\n'}
export const ${descriptor.schemaConstName} = defineSchema({
${modelEntries}
})
`

  return {
    kind: 'schema',
    path: descriptor.filePath,
    content,
  }
}

export function renderDatabaseArtifact<TSchema extends SchemaArtifactDescriptor>(
  descriptor: DatabaseArtifactDescriptor<TSchema>,
): GeneratedArtifact {
  const importLines = descriptor.schemas
    .map(schemaDescriptor => {
      const importPath = toModuleImportPath(descriptor.filePath, schemaDescriptor.filePath)
      return `import { ${schemaDescriptor.schemaConstName} } from '${importPath}'`
    })
    .join('\n')

  const schemaEntries = descriptor.schemas
    .map(schemaDescriptor => `  ${renderObjectKey(schemaDescriptor.schemaName)}: ${schemaDescriptor.schemaConstName}`)
    .join(',\n')

  const content = `import { defineDatabase } from '@xylex-group/athena'
${importLines ? `\n${importLines}\n` : '\n'}
export const ${descriptor.databaseConstName} = defineDatabase({
${schemaEntries}
})
`

  return {
    kind: 'database',
    path: descriptor.filePath,
    content,
  }
}

export function renderRegistryArtifact(
  registryPath: string,
  databasePath: string,
  databaseConstName: string,
  registryConstName: string,
  databaseName: string,
  generatedAt: string,
  outputPreset: NormalizedAthenaGeneratorConfig['output']['preset'],
  outputFormat: NormalizedAthenaGeneratorConfig['output']['format'],
  schemaVersion: number,
): GeneratedArtifact {
  const databaseImportPath = toModuleImportPath(registryPath, databasePath)
  const content = `import { defineRegistry } from '@xylex-group/athena'
import { ${databaseConstName} } from '${databaseImportPath}'

export const __athena_schema_meta = {
  schemaVersion: ${schemaVersion},
  generatedAt: ${escapeStringLiteral(generatedAt)},
  database: ${escapeStringLiteral(databaseName)},
  outputPreset: ${escapeStringLiteral(outputPreset)},
  outputFormat: ${escapeStringLiteral(outputFormat)},
} as const

export const ${registryConstName} = defineRegistry({
  ${renderObjectKey(databaseName)}: ${databaseConstName}
})
`

  return {
    kind: 'registry',
    path: registryPath,
    content,
  }
}

function assertNoDuplicatePaths(files: GeneratedArtifact[]) {
  const seen = new Map<string, GeneratedArtifact>()
  for (const file of files) {
    const existing = seen.get(file.path)
    if (existing) {
      throw new Error(
        [
          `Generator output collision detected for path: ${file.path}`,
          `Collision: ${existing.kind} and ${file.kind}.`,
          'Use explicit placeholders such as {model}, {model_kebab}, {schema}, or {schema_kebab} in output targets so each artifact resolves to a unique path.',
        ].join(' '),
      )
    }
    seen.set(file.path, file)
  }
}

function addSchemaSegmentToPath(pathValue: string, schemaName: string): string {
  const normalizedPath = normalizePath(pathValue)
  const parsedPath = posix.parse(normalizedPath)
  const schemaSegment = applyNamingStyle(schemaName, 'kebab')
  if (!schemaSegment) {
    return normalizedPath
  }

  const dir = parsedPath.dir.length > 0 ? `${parsedPath.dir}/${schemaSegment}` : schemaSegment
  return normalizePath(posix.join(dir, parsedPath.base))
}

function scopeDuplicateDescriptorPathsBySchema<TDescriptor extends SchemaScopedPathDescriptor>(
  descriptors: TDescriptor[],
): TDescriptor[] {
  const nextDescriptors = descriptors.map(descriptor => ({ ...descriptor }))
  const duplicates = new Map<string, number[]>()

  for (let index = 0; index < nextDescriptors.length; index += 1) {
    const descriptor = nextDescriptors[index]
    const indexes = duplicates.get(descriptor.filePath) ?? []
    indexes.push(index)
    duplicates.set(descriptor.filePath, indexes)
  }

  let appliedSchemaScoping = false
  for (const indexes of duplicates.values()) {
    if (indexes.length <= 1) {
      continue
    }

    const schemaNames = new Set(indexes.map(index => nextDescriptors[index].schemaName))
    if (schemaNames.size <= 1) {
      continue
    }

    for (const index of indexes) {
      const descriptor = nextDescriptors[index]
      descriptor.filePath = addSchemaSegmentToPath(descriptor.filePath, descriptor.schemaName)
    }
    appliedSchemaScoping = true
  }

  if (!appliedSchemaScoping) {
    return nextDescriptors
  }

  const normalizedPaths = new Set<string>()
  for (const descriptor of nextDescriptors) {
    if (normalizedPaths.has(descriptor.filePath)) {
      throw new Error(
        [
          `Generator output collision detected for path: ${descriptor.filePath}`,
          'Automatic schema path scoping was applied but collisions remain.',
          'Add explicit placeholders such as {model}, {model_kebab}, {schema}, or {schema_kebab} to your output targets.',
        ].join(' '),
      )
    }
    normalizedPaths.add(descriptor.filePath)
  }

  return nextDescriptors
}

export function composeGeneratorArtifacts<TModel extends ModelArtifactDescriptorBase>(
  input: ComposeGeneratorArtifactsInput<TModel>,
): GeneratedArtifacts {
  const { snapshot, config, createModelDescriptor, renderModelArtifact } = input
  const providerName = snapshot.backend
  const databaseName = snapshot.database
  const modelDescriptors: TModel[] = []

  for (const schemaName of Object.keys(snapshot.schemas).sort()) {
    const schema = snapshot.schemas[schemaName]
    for (const tableName of Object.keys(schema.tables).sort()) {
      modelDescriptors.push(
        createModelDescriptor({
          providerName,
          databaseName,
          schemaName,
          tableName,
          table: schema.tables[tableName],
        }),
      )
    }
  }

  const scopedModelDescriptors = scopeDuplicateDescriptorPathsBySchema(modelDescriptors)

  let schemaDescriptors: SchemaArtifactDescriptor<TModel>[] = Object.keys(snapshot.schemas)
    .sort()
    .map(schemaName => ({
      schemaName,
      filePath: resolveOutputPath(
        config.output.targets.schema,
        {
          provider: providerName,
          kind: 'schema',
          database: databaseName,
          schema: schemaName,
          model: 'index',
        },
        config,
      ),
      schemaConstName: toSafeIdentifier(
        `${schemaName} schema`,
        config.naming.schemaConst,
        'schema',
      ),
      models: scopedModelDescriptors.filter(model => model.schemaName === schemaName),
    }))

  schemaDescriptors = scopeDuplicateDescriptorPathsBySchema(schemaDescriptors)

  const databaseDescriptor: DatabaseArtifactDescriptor<SchemaArtifactDescriptor<TModel>> = {
    filePath: resolveOutputPath(
      config.output.targets.database,
      {
        provider: providerName,
        kind: 'database',
        database: databaseName,
        schema: 'index',
        model: 'index',
      },
      config,
    ),
    databaseConstName: toSafeIdentifier(
      `${databaseName} database`,
      config.naming.databaseConst,
      'database',
    ),
    schemas: schemaDescriptors,
  }

  const files: GeneratedArtifact[] = []

  for (const modelDescriptor of scopedModelDescriptors) {
    files.push(renderModelArtifact(modelDescriptor))
  }

  for (const schemaDescriptor of schemaDescriptors) {
    files.push(renderSchemaArtifact(schemaDescriptor))
  }

  files.push(renderDatabaseArtifact(databaseDescriptor))

  if (config.features.emitRegistry) {
    const registryPath = resolveOutputPath(
      config.output.targets.registry,
      {
        provider: providerName,
        kind: 'registry',
        database: databaseName,
        schema: 'index',
        model: 'index',
      },
      config,
    )
    files.push(
      renderRegistryArtifact(
        registryPath,
        databaseDescriptor.filePath,
        databaseDescriptor.databaseConstName,
        toSafeIdentifier('registry', config.naming.registryConst, 'registry'),
        databaseName,
        snapshot.generatedAt,
        config.output.preset,
        config.output.format,
        config.internal.schemaVersion,
      ),
    )
  }

  assertNoDuplicatePaths(files)

  return {
    snapshot,
    files,
  }
}
