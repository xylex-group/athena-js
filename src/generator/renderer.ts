import { posix } from 'path'
import type {
  AthenaGeneratorConfig,
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
import { resolvePostgresColumnType } from './postgres-type-mapping.ts'
import { normalizeGeneratorConfig } from './config.ts'
import { generateTableBuilderArtifactsFromSnapshot } from './table-builder-renderer.ts'

type ModelRenderDescriptor = {
  schemaName: string
  tableName: string
  filePath: string
  rowTypeName: string
  insertTypeName: string
  updateTypeName: string
  modelConstName: string
  table: IntrospectionTable
}

type SchemaRenderDescriptor = {
  schemaName: string
  filePath: string
  schemaConstName: string
  models: ModelRenderDescriptor[]
}

type DatabaseRenderDescriptor = {
  filePath: string
  databaseConstName: string
  schemas: SchemaRenderDescriptor[]
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/')
}

function withoutTypeScriptExtension(pathValue: string): string {
  return pathValue.replace(/\.tsx?$/i, '')
}

function toModuleImportPath(fromFile: string, targetFile: string): string {
  const relativePath = withoutTypeScriptExtension(
    normalizePath(posix.relative(posix.dirname(fromFile), targetFile)),
  )
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`
}

function renderObjectKey(key: string): string {
  const escaped = escapeTypePropertyName(key)
  return escaped.startsWith("'") ? escaped : escaped
}

function renderRelation(relation: IntrospectionRelation): string {
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

function renderModelArtifact(
  snapshot: IntrospectionSnapshot,
  descriptor: ModelRenderDescriptor,
  config: NormalizedAthenaGeneratorConfig,
): GeneratedArtifact {
  const columnLines = Object.values(descriptor.table.columns)
    .map(column => {
      const propertyName = escapeTypePropertyName(column.name)
      const baseType = resolvePostgresColumnType(column)
      const isOptional = column.isNullable
      const typeWithNullability = column.isNullable ? `${baseType} | null` : baseType
      return `  ${propertyName}${isOptional ? '?' : ''}: ${typeWithNullability}`
    })
    .join('\n')

  const nullableLines = Object.values(descriptor.table.columns)
    .map(column => `      ${renderObjectKey(column.name)}: ${column.isNullable ? 'true' : 'false'}`)
    .join(',\n')

  const relationEntries = Object.entries(descriptor.table.relations)
  const relationBlock = config.features.emitRelations && relationEntries.length > 0
    ? `,
    relations: {
${relationEntries
  .map(([relationKey, relationValue]) => `      ${renderObjectKey(relationKey)}: ${renderRelation(relationValue)}`)
  .join(',\n')}
    }`
    : ''

  const content = `import { defineModel } from '@xylex-group/athena'

export interface ${descriptor.rowTypeName} {
${columnLines}
}

export type ${descriptor.insertTypeName} = Partial<${descriptor.rowTypeName}>
export type ${descriptor.updateTypeName} = Partial<${descriptor.insertTypeName}>

export const ${descriptor.modelConstName} = defineModel<${descriptor.rowTypeName}, ${descriptor.insertTypeName}, ${descriptor.updateTypeName}>({
  meta: {
    database: ${escapeStringLiteral(snapshot.database)},
    schema: ${escapeStringLiteral(descriptor.schemaName)},
    model: ${escapeStringLiteral(descriptor.tableName)},
    tableName: ${escapeStringLiteral(`${descriptor.schemaName}.${descriptor.tableName}`)},
    primaryKey: [${descriptor.table.primaryKey.map(value => escapeStringLiteral(value)).join(', ')}],
    nullable: {
${nullableLines}
    }${relationBlock}
  }
})
`

  return {
    kind: 'model',
    path: descriptor.filePath,
    content,
  }
}

function renderSchemaArtifact(descriptor: SchemaRenderDescriptor): GeneratedArtifact {
  const importLines = descriptor.models
    .map(modelDescriptor => {
      const importPath = toModuleImportPath(descriptor.filePath, modelDescriptor.filePath)
      return `import { ${modelDescriptor.modelConstName} } from '${importPath}'`
    })
    .join('\n')

  const modelEntries = descriptor.models
    .map(modelDescriptor => `  ${renderObjectKey(modelDescriptor.tableName)}: ${modelDescriptor.modelConstName}`)
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

function renderDatabaseArtifact(descriptor: DatabaseRenderDescriptor): GeneratedArtifact {
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

function renderRegistryArtifact(
  registryPath: string,
  databasePath: string,
  databaseConstName: string,
  registryConstName: string,
  databaseName: string,
  generatedAt: string,
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

type SchemaScopedPathDescriptor = {
  schemaName: string
  filePath: string
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

function scopeDuplicateDescriptorPathsBySchema<
  TDescriptor extends SchemaScopedPathDescriptor,
>(
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

class ArtifactComposer {
  constructor(
    private readonly snapshot: IntrospectionSnapshot,
    private readonly config: NormalizedAthenaGeneratorConfig,
  ) {}

  compose(): GeneratedArtifacts {
    const providerName = this.snapshot.backend
    const databaseName = this.snapshot.database
    const modelDescriptors: ModelRenderDescriptor[] = []

    for (const schemaName of Object.keys(this.snapshot.schemas).sort()) {
      const schema = this.snapshot.schemas[schemaName]
      for (const tableName of Object.keys(schema.tables).sort()) {
        const table = schema.tables[tableName]
        const rowTypeName = `${toSafeIdentifier(`${schemaName} ${tableName}`, this.config.naming.modelType, 'Model')}Row`
        const insertTypeName = `${toSafeIdentifier(`${schemaName} ${tableName}`, this.config.naming.modelType, 'Model')}Insert`
        const updateTypeName = `${toSafeIdentifier(`${schemaName} ${tableName}`, this.config.naming.modelType, 'Model')}Update`
        const modelConstName = `${toSafeIdentifier(`${schemaName} ${tableName} model`, this.config.naming.modelConst, 'model')}`

        const modelPath = normalizePath(
          renderOutputPath(this.config.output.targets.model, {
            provider: providerName,
            kind: 'model',
            database: databaseName,
            schema: schemaName,
            model: tableName,
          }, this.config.output),
        )

        modelDescriptors.push({
          schemaName,
          tableName,
          filePath: modelPath,
          rowTypeName,
          insertTypeName,
          updateTypeName,
          modelConstName,
          table,
        })
      }
    }

    const scopedModelDescriptors = scopeDuplicateDescriptorPathsBySchema(modelDescriptors)

    let schemaDescriptors: SchemaRenderDescriptor[] = Object.keys(this.snapshot.schemas)
      .sort()
      .map(schemaName => {
        const schemaPath = normalizePath(
          renderOutputPath(this.config.output.targets.schema, {
            provider: providerName,
            kind: 'schema',
            database: databaseName,
            schema: schemaName,
            model: 'index',
          }, this.config.output),
        )

        return {
          schemaName,
          filePath: schemaPath,
          schemaConstName: toSafeIdentifier(
            `${schemaName} schema`,
            this.config.naming.schemaConst,
            'schema',
          ),
          models: scopedModelDescriptors.filter(model => model.schemaName === schemaName),
        }
      })

    schemaDescriptors = scopeDuplicateDescriptorPathsBySchema(schemaDescriptors)

    const databasePath = normalizePath(
      renderOutputPath(this.config.output.targets.database, {
        provider: providerName,
        kind: 'database',
        database: databaseName,
        schema: 'index',
        model: 'index',
      }, this.config.output),
    )

    const databaseDescriptor: DatabaseRenderDescriptor = {
      filePath: databasePath,
      databaseConstName: toSafeIdentifier(
        `${databaseName} database`,
        this.config.naming.databaseConst,
        'database',
      ),
      schemas: schemaDescriptors,
    }

    const files: GeneratedArtifact[] = []

    for (const modelDescriptor of scopedModelDescriptors) {
      files.push(renderModelArtifact(this.snapshot, modelDescriptor, this.config))
    }

    for (const schemaDescriptor of schemaDescriptors) {
      files.push(renderSchemaArtifact(schemaDescriptor))
    }

    files.push(renderDatabaseArtifact(databaseDescriptor))

    if (this.config.features.emitRegistry) {
      const registryPath = normalizePath(
        renderOutputPath(this.config.output.targets.registry, {
          provider: providerName,
          kind: 'registry',
          database: databaseName,
          schema: 'index',
          model: 'index',
        }, this.config.output),
      )
      files.push(
        renderRegistryArtifact(
          registryPath,
          databaseDescriptor.filePath,
          databaseDescriptor.databaseConstName,
          toSafeIdentifier('registry', this.config.naming.registryConst, 'registry'),
          databaseName,
          this.snapshot.generatedAt,
          this.config.output.format,
          this.config.internal.schemaVersion,
        ),
      )
    }

    assertNoDuplicatePaths(files)

    return {
      snapshot: this.snapshot,
      files,
    }
  }
}

/**
 * Generates model/schema/database/registry source artifacts from an introspection snapshot.
 */
export function generateArtifactsFromSnapshot(
  snapshot: IntrospectionSnapshot,
  config: AthenaGeneratorConfig | NormalizedAthenaGeneratorConfig,
): GeneratedArtifacts {
  const normalizedConfig = 'internal' in config
    ? config as NormalizedAthenaGeneratorConfig
    : normalizeGeneratorConfig(config as AthenaGeneratorConfig)
  if (normalizedConfig.output.format === 'table-builder') {
    return generateTableBuilderArtifactsFromSnapshot(snapshot, normalizedConfig)
  }
  return new ArtifactComposer(snapshot, normalizedConfig).compose()
}
