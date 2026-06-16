import { posix } from 'path'
import type {
  AthenaGeneratorConfig,
  GeneratedArtifact,
  GeneratedArtifacts,
  NormalizedAthenaGeneratorConfig,
} from './types.ts'
import type {
  IntrospectionColumn,
  IntrospectionRelation,
  IntrospectionSnapshot,
  IntrospectionTable,
} from '../schema/types.ts'
import {
  escapeStringLiteral,
  escapeTypePropertyName,
  toSafeIdentifier,
} from './naming.ts'
import { renderOutputPath } from './placeholders.ts'
import { resolvePostgresColumnType } from './postgres-type-mapping.ts'
import { normalizeGeneratorConfig } from './config.ts'

type ModelRenderDescriptor = {
  schemaName: string
  tableName: string
  filePath: string
  rowTypeName: string
  insertTypeName: string
  updateTypeName: string
  formValuesTypeName: string
  tableConstName: string
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

const SAFE_NUMBER_TYPES = new Set([
  'int2',
  'int4',
  'float4',
  'float8',
  'smallint',
  'integer',
  'real',
  'double precision',
])

const JSON_TYPES = new Set(['json', 'jsonb'])
const BOOLEAN_TYPES = new Set(['bool', 'boolean'])
const STRING_TYPES = new Set([
  'int8',
  'bigint',
  'serial8',
  'bigserial',
  'numeric',
  'decimal',
  'money',
  'bytea',
])

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
  return escapeTypePropertyName(key)
}

function normalizeTypeLabel(column: IntrospectionColumn): string {
  const preferred = (column.udtName || column.dataType).toLowerCase().trim()
  if (column.arrayDimensions > 0 && preferred.startsWith('_')) {
    return preferred.slice(1)
  }
  return preferred
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

function renderColumnBuilder(column: IntrospectionColumn): {
  helper: 'boolean' | 'number' | 'string' | 'json' | 'enumeration'
  expression: string
} {
  const label = normalizeTypeLabel(column)
  let helper: 'boolean' | 'number' | 'string' | 'json' | 'enumeration'
  let expression: string

  if (column.typeKind === 'enum' && column.enumValues && column.enumValues.length > 0) {
    helper = 'enumeration'
    expression = `enumeration([${column.enumValues.map(value => escapeStringLiteral(value)).join(', ')}] as const)`
  } else if (column.arrayDimensions > 0 || JSON_TYPES.has(label) || column.typeKind === 'composite') {
    helper = 'json'
    expression = `json<${resolvePostgresColumnType(column)}>()`
  } else if (BOOLEAN_TYPES.has(label)) {
    helper = 'boolean'
    expression = 'boolean()'
  } else if (SAFE_NUMBER_TYPES.has(label)) {
    helper = 'number'
    expression = 'number()'
  } else if (STRING_TYPES.has(label)) {
    helper = 'string'
    expression = 'string()'
  } else {
    helper = 'string'
    expression = 'string()'
  }

  if (column.isNullable) {
    expression = `${expression}.optional()`
  }
  if (column.hasDefault) {
    expression = `${expression}.defaulted()`
  }
  if (column.isGenerated) {
    expression = `${expression}.generated()`
  }

  return { helper, expression }
}

function renderModelArtifact(
  descriptor: ModelRenderDescriptor,
  config: NormalizedAthenaGeneratorConfig,
): GeneratedArtifact {
  const helperImports = new Set<string>(['table'])
  const columnLines = Object.entries(descriptor.table.columns)
    .map(([columnName, column]) => {
      const propertyName = escapeTypePropertyName(columnName)
      const rendered = renderColumnBuilder(column)
      helperImports.add(rendered.helper)
      return `    ${propertyName}: ${rendered.expression}`
    })
    .join(',\n')

  const helperImportLine = Array.from(helperImports).sort().join(', ')
  const rowSchemaConstName = `${descriptor.tableConstName}_row_schema`
  const insertSchemaConstName = `${descriptor.tableConstName}_insert_schema`
  const updateSchemaConstName = `${descriptor.tableConstName}_update_schema`
  const formSchemaConstName = `${descriptor.tableConstName}_form_schema`

  const relationEntries = Object.entries(descriptor.table.relations)
  const relationsAssignment = config.features.emitRelations && relationEntries.length > 0
    ? `
Object.assign(${descriptor.tableConstName}.meta, {
  relations: {
${relationEntries
  .map(([relationKey, relationValue]) => `    ${renderObjectKey(relationKey)}: ${renderRelation(relationValue)}`)
  .join(',\n')}
  }
})
`
    : ''

  const content = `import { ${helperImportLine} } from '@xylex-group/athena'
import type { FormValuesOf, InsertOf, RowOf, UpdateOf } from '@xylex-group/athena'

export const ${descriptor.tableConstName} = table(${escapeStringLiteral(descriptor.tableName)})
  .schema(${escapeStringLiteral(descriptor.schemaName)})
  .columns({
${columnLines}
  })
  .primaryKey(${descriptor.table.primaryKey.map(value => escapeStringLiteral(value)).join(', ')})
${relationsAssignment ? `${relationsAssignment}` : ''}
export type ${descriptor.rowTypeName} = RowOf<typeof ${descriptor.tableConstName}>
export type ${descriptor.insertTypeName} = InsertOf<typeof ${descriptor.tableConstName}>
export type ${descriptor.updateTypeName} = UpdateOf<typeof ${descriptor.tableConstName}>
export type ${descriptor.formValuesTypeName} = FormValuesOf<typeof ${descriptor.tableConstName}>

export const ${rowSchemaConstName} = ${descriptor.tableConstName}.schemas.row
export const ${insertSchemaConstName} = ${descriptor.tableConstName}.schemas.insert
export const ${updateSchemaConstName} = ${descriptor.tableConstName}.schemas.update
export const ${formSchemaConstName} = ${descriptor.tableConstName}.schemas.form
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
      return `import { ${modelDescriptor.tableConstName} } from '${importPath}'`
    })
    .join('\n')

  const modelEntries = descriptor.models
    .map(modelDescriptor => `  ${renderObjectKey(modelDescriptor.tableName)}: ${modelDescriptor.tableConstName}`)
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
  const schemaSegment = schemaName.replace(/[^A-Za-z0-9_-]+/g, '-')
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

class TableArtifactComposer {
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
        const formValuesTypeName = `${toSafeIdentifier(`${schemaName} ${tableName}`, this.config.naming.modelType, 'Model')}FormValues`
        const tableConstName = toSafeIdentifier(tableName, 'preserve', 'table')

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
          formValuesTypeName,
          tableConstName,
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
      files.push(renderModelArtifact(modelDescriptor, this.config))
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

export function generateTableBuilderArtifactsFromSnapshot(
  snapshot: IntrospectionSnapshot,
  config: AthenaGeneratorConfig | NormalizedAthenaGeneratorConfig,
): GeneratedArtifacts {
  const normalizedConfig = 'internal' in config
    ? config as NormalizedAthenaGeneratorConfig
    : normalizeGeneratorConfig(config as AthenaGeneratorConfig)
  return new TableArtifactComposer(snapshot, normalizedConfig).compose()
}
