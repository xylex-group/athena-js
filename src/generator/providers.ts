import {
  buildGatewayCatalogQueries,
  type ColumnQueryRow,
  type EnumQueryRow,
  type ForeignKeyQueryRow,
  type IndexQueryRow,
  PostgresCatalogSnapshotAssembler,
  type PrimaryKeyQueryRow,
  type UniqueConstraintQueryRow,
} from "../schema/postgres-introspection-core.ts";
import { createPostgresIntrospectionProvider } from "../schema/postgres-provider.ts";
import type {
  IntrospectionInspectOptions,
  IntrospectionSnapshot,
  SchemaIntrospectionProvider,
} from "../schema/types.ts";
import { type AthenaClient, createClient } from "../v3-client.ts";
import { normalizeSchemaSelection } from "./schema-selection.ts";
import type {
  GeneratorExperimentalFlags,
  GeneratorProviderConfig,
  PostgresDirectProviderConfig,
  PostgresGatewayProviderConfig,
  ScyllaDirectProviderConfig,
} from "./types.ts";

class AthenaGatewayCatalogClient {
  constructor(private readonly client: AthenaClient) {}

  async queryRows<T>(query: string): Promise<T[]> {
    const result = await this.client.query<T & Record<string, unknown>>(query);
    if (result.error || result.status < 200 || result.status >= 300) {
      throw new Error(
        result.error?.message ??
          `Gateway query failed with status ${result.status}`
      );
    }
    return (result.data ?? []) as T[];
  }

  async queryColumns(query: string): Promise<ColumnQueryRow[]> {
    return this.queryRows<ColumnQueryRow>(query);
  }

  async queryEnums(query: string): Promise<Map<number, string[]>> {
    const rows = await this.queryRows<EnumQueryRow>(query);
    const enumMap = new Map<number, string[]>();
    for (const row of rows) {
      const existing = enumMap.get(row.type_oid) ?? [];
      existing.push(row.enum_label);
      enumMap.set(row.type_oid, existing);
    }
    return enumMap;
  }

  async queryPrimaryKeys(query: string): Promise<PrimaryKeyQueryRow[]> {
    return this.queryRows<PrimaryKeyQueryRow>(query);
  }

  async queryForeignKeys(query: string): Promise<ForeignKeyQueryRow[]> {
    return this.queryRows<ForeignKeyQueryRow>(query);
  }
}

class AthenaGatewayPostgresIntrospectionProvider
  implements SchemaIntrospectionProvider
{
  readonly backend = "postgresql" as const;

  private readonly client: AthenaClient;
  private readonly schemas: string[];

  constructor(private readonly config: PostgresGatewayProviderConfig) {
    // Set unified `url` as well as `db.url` so root/chatWs resolution uses the
    // configured gateway and is not poisoned by ambient invalid ATHENA_URL env
    // placeholders (e.g. unexpanded `${ATHENA_URL}`).
    // Cast through unknown: createClient generics overflow TS depth (TS2589).
    this.client = (
      createClient as unknown as (config: unknown) => AthenaClient
    )({
      backend: {
        type: this.config.backend ?? "postgresql",
      },
      // Multi-tenant gateways reject DEFAULT_CLIENT; prefer explicit config.
      // Also pass process.env so ATHENA_CLIENT / ATHENA_GATEWAY_CLIENT still resolve
      // when the field was not normalized into provider config.
      client: this.config.client,
      db: { url: this.config.gatewayUrl },
      env: typeof process === "undefined" ? undefined : process.env,
      key: this.config.apiKey,
      url: this.config.gatewayUrl,
    });
    this.schemas = normalizeSchemaSelection(this.config.schemas);
  }

  async inspect(
    options?: IntrospectionInspectOptions
  ): Promise<IntrospectionSnapshot> {
    const schemas =
      options?.schemas && options.schemas.length > 0
        ? normalizeSchemaSelection(options.schemas)
        : this.schemas;

    const catalogClient = new AthenaGatewayCatalogClient(this.client);
    const queries = buildGatewayCatalogQueries(schemas);

    const [
      columnRows,
      enumMap,
      primaryKeyRows,
      foreignKeyRows,
      uniqueConstraintRows,
      indexRows,
    ] = await Promise.all([
      catalogClient.queryColumns(queries.columns),
      catalogClient.queryEnums(queries.enums),
      catalogClient.queryPrimaryKeys(queries.primaryKeys),
      catalogClient.queryForeignKeys(queries.foreignKeys),
      catalogClient.queryRows<UniqueConstraintQueryRow>(
        queries.uniqueConstraints
      ),
      catalogClient.queryRows<IndexQueryRow>(queries.indexes),
    ]);

    const assembler = new PostgresCatalogSnapshotAssembler();
    assembler.addColumnRows(columnRows, enumMap);
    assembler.addPrimaryKeyRows(primaryKeyRows);
    assembler.addForeignKeyRows(foreignKeyRows);
    assembler.addUniqueConstraintRows(uniqueConstraintRows);
    assembler.addIndexRows(indexRows);
    assembler.addManyToManyRows(foreignKeyRows);

    return {
      backend: "postgresql",
      database: this.config.database,
      generatedAt: new Date().toISOString(),
      schemas: assembler.toSchemas(),
    };
  }
}

class ScyllaIntrospectionProvider implements SchemaIntrospectionProvider {
  readonly backend = "scylladb" as const;

  constructor(private readonly config: ScyllaDirectProviderConfig) {}

  async inspect(): Promise<IntrospectionSnapshot> {
    throw new Error(
      `Scylla introspection provider is not implemented yet for keyspace ${this.config.keyspace}.`
    );
  }
}

function createPostgresProvider(
  config: PostgresDirectProviderConfig
): SchemaIntrospectionProvider {
  return createPostgresIntrospectionProvider({
    connectionString: config.connectionString,
    database: config.database,
    schemas: normalizeSchemaSelection(config.schemas),
  });
}

/**
 * Resolves a runtime introspection provider from generator config.
 */
export function resolveGeneratorProvider(
  providerConfig: GeneratorProviderConfig,
  experimentalFlags: GeneratorExperimentalFlags
): SchemaIntrospectionProvider {
  if (providerConfig.kind === "postgres" && providerConfig.mode === "direct") {
    return createPostgresProvider(providerConfig);
  }

  if (providerConfig.kind === "postgres" && providerConfig.mode === "gateway") {
    return new AthenaGatewayPostgresIntrospectionProvider(providerConfig);
  }

  if (providerConfig.kind === "scylla") {
    if (!experimentalFlags.scyllaProviderContracts) {
      throw new Error(
        "Scylla provider contracts are disabled. Set experimental.scyllaProviderContracts=true to enable placeholders."
      );
    }
    return new ScyllaIntrospectionProvider(providerConfig);
  }

  throw new Error(
    `Unsupported generator provider kind: ${(providerConfig as { kind?: string }).kind ?? "unknown"}`
  );
}
