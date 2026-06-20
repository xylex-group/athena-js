import type {
  AnyModelDef,
  DatabaseDef,
  ModelDef,
  ModelMetadata,
  RegistryDef,
  SchemaDef,
} from './types.ts'

/**
 * @deprecated Prefer `table(...).schema(...).columns(...).primaryKey(...)` for
 * new model contracts. `defineModel(...)` is retained for legacy compatibility,
 * manual low-level contracts, and legacy generator output.
 *
 * Declares a model contract with explicit metadata and typed row/insert/update shapes.
 */
export function defineModel<
  Row,
  Insert = Partial<Row>,
  Update = Partial<Insert>,
  Meta extends ModelMetadata<Row> = ModelMetadata<Row>,
>(input: { meta: Meta }): ModelDef<Row, Insert, Update, Meta> {
  return input
}

/**
 * Declares a schema-level model map.
 */
export function defineSchema<
  Models extends Record<string, AnyModelDef>,
>(models: Models): SchemaDef<Models> {
  return { models }
}

/**
 * Declares a database-level schema map.
 */
export function defineDatabase<
  Schemas extends Record<string, SchemaDef<Record<string, AnyModelDef>>>,
>(schemas: Schemas): DatabaseDef<Schemas> {
  return { schemas }
}

/**
 * Declares a top-level multi-database registry.
 */
export function defineRegistry<
  Databases extends Record<string, DatabaseDef<Record<string, SchemaDef<Record<string, AnyModelDef>>>>>,
>(databases: Databases): RegistryDef<Databases> {
  return databases
}

