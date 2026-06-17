import type {
  AthenaGeneratorConfig,
  GeneratedArtifact,
  GeneratedArtifacts,
  NormalizedAthenaGeneratorConfig,
} from './types.ts'
import type {
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
import { generateTableBuilderArtifactsFromSnapshot } from './table-builder-renderer.ts'

type ModelRenderDescriptor = ModelArtifactDescriptorBase & {
  rowTypeName: string
  insertTypeName: string
  updateTypeName: string
  modelConstName: string
}

function renderModelArtifact(
  databaseName: string,
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
  .map(([relationKey, relationValue]) => `      ${renderObjectKey(relationKey)}: ${renderRelationLiteral(relationValue)}`)
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
    database: ${escapeStringLiteral(databaseName)},
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
  return composeGeneratorArtifacts({
    snapshot,
    config: normalizedConfig,
    createModelDescriptor({ providerName, databaseName, schemaName, tableName, table }) {
      const modelConstName = toSafeIdentifier(
        `${schemaName} ${tableName} model`,
        normalizedConfig.naming.modelConst,
        'model',
      )
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
        modelConstName,
        exportConstName: modelConstName,
        table,
      }
    },
    renderModelArtifact: descriptor => renderModelArtifact(snapshot.database, descriptor, normalizedConfig),
  })
}
