import type {
  AthenaGeneratorConfig,
  GeneratedArtifact,
  GeneratedArtifacts,
  NormalizedAthenaGeneratorConfig,
} from './types.ts'
import type {
  IntrospectionColumn,
  IntrospectionSnapshot,
} from '../schema/types.ts'
import {
  escapeStringLiteral,
  escapeTypePropertyName,
  toSafeIdentifier,
} from './naming.ts'
import { resolvePostgresColumnType } from './postgres-type-mapping.ts'
import { normalizeGeneratorConfig } from './config.ts'
import {
  composeGeneratorArtifacts,
  renderObjectKey,
  renderRelationLiteral,
  resolveOutputPath,
  type ModelArtifactDescriptorBase,
} from './render-shared.ts'

type ModelRenderDescriptor = ModelArtifactDescriptorBase & {
  rowTypeName: string
  insertTypeName: string
  updateTypeName: string
  formValuesTypeName: string
  tableConstName: string
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

function normalizeTypeLabel(column: IntrospectionColumn): string {
  const preferred = (column.udtName || column.dataType).toLowerCase().trim()
  if (column.arrayDimensions > 0 && preferred.startsWith('_')) {
    return preferred.slice(1)
  }
  return preferred
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
  .map(([relationKey, relationValue]) => `    ${renderObjectKey(relationKey)}: ${renderRelationLiteral(relationValue)}`)
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
  ${descriptor.table.primaryKey.length > 0
    ? `.primaryKey(${descriptor.table.primaryKey.map(value => escapeStringLiteral(value)).join(', ')})`
    : '.withoutPrimaryKey()'}
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

export function generateTableBuilderArtifactsFromSnapshot(
  snapshot: IntrospectionSnapshot,
  config: AthenaGeneratorConfig | NormalizedAthenaGeneratorConfig,
): GeneratedArtifacts {
  const normalizedConfig = 'internal' in config
    ? config as NormalizedAthenaGeneratorConfig
    : normalizeGeneratorConfig(config as AthenaGeneratorConfig)
  return composeGeneratorArtifacts({
    snapshot,
    config: normalizedConfig,
    createModelDescriptor({ providerName, databaseName, schemaName, tableName, table }) {
      const tableConstName = toSafeIdentifier(tableName, 'preserve', 'table')
      return {
        schemaName,
        tableName,
        filePath: resolveOutputPath(
          normalizedConfig.output.targets.model,
          {
            provider: providerName,
            kind: 'model',
            database: databaseName,
            schema: schemaName,
            model: tableName,
          },
          normalizedConfig,
        ),
        rowTypeName: `${toSafeIdentifier(`${schemaName} ${tableName}`, normalizedConfig.naming.modelType, 'Model')}Row`,
        insertTypeName: `${toSafeIdentifier(`${schemaName} ${tableName}`, normalizedConfig.naming.modelType, 'Model')}Insert`,
        updateTypeName: `${toSafeIdentifier(`${schemaName} ${tableName}`, normalizedConfig.naming.modelType, 'Model')}Update`,
        formValuesTypeName: `${toSafeIdentifier(`${schemaName} ${tableName}`, normalizedConfig.naming.modelType, 'Model')}FormValues`,
        tableConstName,
        exportConstName: tableConstName,
        table,
      }
    },
    renderModelArtifact: descriptor => renderModelArtifact(descriptor, normalizedConfig),
  })
}
