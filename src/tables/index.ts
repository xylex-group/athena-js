export {
  type AthenaTableCatalogQueryClient,
  buildAthenaTableCatalogQueries,
  type FetchAthenaTableCatalogOptions,
  fetchAthenaTableCatalog,
  fetchTableCatalog,
  hasAthenaTableSchemaCredentials,
  isAthenaTableSchemaConfig,
  parseAthenaTableSchemaScope,
} from "./catalog.ts";

export {
  ATHENA_TABLE_SCHEMA_ROUTE,
  type AthenaTableSchemaHandlerOptions,
  createAthenaTableSchemaHandlers,
  handleAthenaTableSchemaPost,
} from "./schema-handlers.ts";

export type {
  AthenaTableCatalogColumn,
  AthenaTableCatalogRelation,
  AthenaTableCatalogResponse,
  AthenaTableCatalogTable,
  AthenaTableSchemaConfig,
  AthenaTableShowcaseConfig,
  TableCatalogColumn,
  TableCatalogRelation,
  TableCatalogResponse,
  TableCatalogTable,
} from "./types.ts";
