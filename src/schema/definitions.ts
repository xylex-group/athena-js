import type {
  DatabaseDef,
  ModelDef,
  ModelMetadata,
  RegistryDef,
  SchemaDef,
} from './types.ts'

export function defineModel<
  Row,
  Insert = Partial<Row>,
  Update = Partial<Insert>,
  Meta extends ModelMetadata<Row> = ModelMetadata<Row>,
>(input: { meta: Meta }): ModelDef<Row, Insert, Update, Meta> {
  return input
}

export function defineSchema<
  Models extends Record<string, ModelDef<any, any, any, ModelMetadata<any>>>,
>(models: Models): SchemaDef<Models> {
  return { models }
}

export function defineDatabase<
  Schemas extends Record<string, SchemaDef<Record<string, ModelDef<any, any, any, ModelMetadata<any>>>>>,
>(schemas: Schemas): DatabaseDef<Schemas> {
  return { schemas }
}

export function defineRegistry<
  Databases extends Record<string, DatabaseDef<Record<string, SchemaDef<Record<string, ModelDef<any, any, any, ModelMetadata<any>>>>>>>,
>(databases: Databases): RegistryDef<Databases> {
  return databases
}
