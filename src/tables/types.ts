/**
 * Config accepted by the table schema catalog route and {@link fetchAthenaTableCatalog}.
 *
 * Shape matches the Athena Auth UI table builder client config fields used for
 * gateway schema introspection (not the full builder experimental surface).
 */
export interface AthenaTableSchemaConfig {
  /** Registry client name (`X-Athena-Client` / `createClient({ client })`). */
  clientName: string;
  /** Logical database label returned in the catalog response. */
  gatewayDatabase: string;
  /** Athena gateway API key. */
  gatewayKey: string;
  /** Athena gateway base URL. */
  gatewayUrl: string;
  /**
   * Comma-separated PostgreSQL schema names to introspect
   * (e.g. `"public,athena"`).
   */
  schemaScope: string;
}

export interface AthenaTableCatalogColumn {
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  name: string;
}

export interface AthenaTableCatalogRelation {
  columns: AthenaTableCatalogColumn[];
  name: string;
  targetSchema: string;
  targetTable: string;
}

export interface AthenaTableCatalogTable {
  columns: AthenaTableCatalogColumn[];
  id: string;
  name: string;
  primaryKey: string[];
  relations: AthenaTableCatalogRelation[];
  schema: string;
}

export interface AthenaTableCatalogResponse {
  database: string;
  generatedAt: string;
  tables: AthenaTableCatalogTable[];
}

/** @deprecated Prefer {@link AthenaTableSchemaConfig}. */
export type AthenaTableShowcaseConfig = AthenaTableSchemaConfig;

/** @deprecated Prefer {@link AthenaTableCatalogColumn}. */
export type TableCatalogColumn = AthenaTableCatalogColumn;

/** @deprecated Prefer {@link AthenaTableCatalogRelation}. */
export type TableCatalogRelation = AthenaTableCatalogRelation;

/** @deprecated Prefer {@link AthenaTableCatalogTable}. */
export type TableCatalogTable = AthenaTableCatalogTable;

/** @deprecated Prefer {@link AthenaTableCatalogResponse}. */
export type TableCatalogResponse = AthenaTableCatalogResponse;
