import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type AthenaGeneratorConfig,
	defineGeneratorConfig,
	findGeneratorConfigPath,
	generateArtifactsFromSnapshot,
	type LoadedGeneratorConfig,
	loadGeneratorConfig,
	normalizeGeneratorConfig,
	type RunGeneratorResult,
	resolveGeneratorProvider,
	resolvePostgresColumnType,
	runSchemaGenerator,
} from "../../../src/generator/index.ts";
import type {
	IntrospectionColumn,
	IntrospectionInspectOptions,
	IntrospectionSnapshot,
	SchemaIntrospectionProvider,
} from "../../../src/schema/index.ts";

export interface ExampleWorkspace {
	cwd: string;
}

export type TypeMappingShowcase = Array<{
	source: Pick<
		IntrospectionColumn,
		"dataType" | "udtName" | "typeKind" | "arrayDimensions" | "enumValues"
	>;
	mappedType: string;
}>;

const DEFAULT_TARGETS = {
	database: "src/generated/{database_kebab}/index.ts",
	model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts",
	registry: "src/generated/index.ts",
	schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
};

function createSchemaProvider(
	snapshot: IntrospectionSnapshot,
): SchemaIntrospectionProvider {
	return {
		backend: snapshot.backend,
		async inspect(
			_options?: IntrospectionInspectOptions,
		): Promise<IntrospectionSnapshot> {
			return snapshot;
		},
	};
}

export function createDirectGeneratorConfig(
	connectionString: string,
): AthenaGeneratorConfig {
	return defineGeneratorConfig({
		experimental: {
			postgresGatewayIntrospection: false,
			scyllaProviderContracts: true,
		},
		features: {
			emitRegistry: true,
			emitRelations: true,
		},
		naming: {
			databaseConst: "camel",
			modelConst: "camel",
			modelType: "pascal",
			registryConst: "camel",
			schemaConst: "camel",
		},
		output: {
			placeholderMap: {
				namespace: "{database_kebab}/{schema_kebab}",
			},
			targets: { ...DEFAULT_TARGETS },
		},
		provider: {
			connectionString,
			database: "app_db",
			kind: "postgres",
			mode: "direct",
			schemas: ["public", "athena"],
		},
	});
}

export function createGatewayOnlyGeneratorConfig(
	gatewayUrl: string,
	apiKey: string,
): AthenaGeneratorConfig {
	return defineGeneratorConfig({
		experimental: {
			postgresGatewayIntrospection: false,
			scyllaProviderContracts: true,
		},
		features: {
			emitRegistry: true,
			emitRelations: true,
		},
		naming: {
			databaseConst: "camel",
			modelConst: "camel",
			modelType: "pascal",
			registryConst: "camel",
			schemaConst: "camel",
		},
		output: {
			placeholderMap: {
				namespace: "{database_kebab}/{schema_kebab}",
			},
			targets: { ...DEFAULT_TARGETS },
		},
		provider: {
			apiKey,
			backend: "postgresql",
			database: "app_db",
			gatewayUrl,
			kind: "postgres",
			mode: "gateway",
			schemas: ["public", "athena"],
		},
	});
}

export function createFullFeatureSnapshot(): IntrospectionSnapshot {
	return {
		backend: "postgresql",
		database: "app_db",
		generatedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
		schemas: {
			athena: {
				name: "athena",
				tables: {
					users: {
						columns: {
							id: {
								arrayDimensions: 0,
								dataType: "bigint",
								hasDefault: true,
								isGenerated: false,
								isNullable: false,
								isPrimaryKey: true,
								name: "id",
								typeKind: "scalar",
								udtName: "int8",
							},
							metrics: {
								arrayDimensions: 0,
								dataType: "jsonb",
								hasDefault: false,
								isGenerated: false,
								isNullable: true,
								isPrimaryKey: false,
								name: "metrics",
								typeKind: "scalar",
								udtName: "jsonb",
							},
						},
						name: "users",
						primaryKey: ["id"],
						relations: {},
						schema: "athena",
					},
				},
			},
			public: {
				name: "public",
				tables: {
					profiles: {
						columns: {
							mood: {
								arrayDimensions: 0,
								dataType: "public.mood",
								enumValues: ["happy", "sad", "neutral"],
								hasDefault: false,
								isGenerated: false,
								isNullable: true,
								isPrimaryKey: false,
								name: "mood",
								typeKind: "enum",
								udtName: "mood",
							},
							user_id: {
								arrayDimensions: 0,
								dataType: "uuid",
								hasDefault: false,
								isGenerated: false,
								isNullable: false,
								isPrimaryKey: true,
								name: "user_id",
								typeKind: "scalar",
								udtName: "uuid",
							},
						},
						name: "profiles",
						primaryKey: ["user_id"],
						relations: {
							users: {
								kind: "many-to-one",
								name: "profiles_users_fk",
								sourceColumns: ["user_id"],
								targetColumns: ["id"],
								targetModel: "users",
								targetSchema: "public",
							},
						},
						schema: "public",
					},
					users: {
						columns: {
							email: {
								arrayDimensions: 0,
								dataType: "text",
								hasDefault: false,
								isGenerated: false,
								isNullable: false,
								isPrimaryKey: false,
								name: "email",
								typeKind: "scalar",
								udtName: "text",
							},
							id: {
								arrayDimensions: 0,
								dataType: "uuid",
								hasDefault: false,
								isGenerated: false,
								isNullable: false,
								isPrimaryKey: true,
								name: "id",
								typeKind: "scalar",
								udtName: "uuid",
							},
							table: {
								arrayDimensions: 0,
								dataType: "text",
								hasDefault: false,
								isGenerated: false,
								isNullable: false,
								isPrimaryKey: false,
								name: "table",
								typeKind: "scalar",
								udtName: "text",
							},
							tags: {
								arrayDimensions: 1,
								dataType: "text[]",
								hasDefault: false,
								isGenerated: false,
								isNullable: true,
								isPrimaryKey: false,
								name: "tags",
								typeKind: "scalar",
								udtName: "_text",
							},
						},
						name: "users",
						primaryKey: ["id"],
						relations: {
							profile: {
								kind: "one-to-one",
								name: "profile_user_fk",
								sourceColumns: ["id"],
								targetColumns: ["user_id"],
								targetModel: "profiles",
								targetSchema: "public",
							},
						},
						schema: "public",
					},
				},
			},
		},
	};
}

export async function writeGeneratorConfigFile(
	workspace: ExampleWorkspace,
	config: AthenaGeneratorConfig,
): Promise<string> {
	const configPath = join(workspace.cwd, "athena.config.ts");
	const moduleText = `export default ${JSON.stringify(config, null, 2)}\n`;
	await writeFile(configPath, moduleText, "utf8");
	return configPath;
}

export async function runGeneratorDryRunWithSnapshot(
	workspace: ExampleWorkspace,
	config: AthenaGeneratorConfig,
	snapshot: IntrospectionSnapshot,
): Promise<RunGeneratorResult> {
	await writeGeneratorConfigFile(workspace, config);
	return runSchemaGenerator({
		cwd: workspace.cwd,
		dryRun: true,
		provider: createSchemaProvider(snapshot),
	});
}

export async function runGeneratorWriteWithSnapshot(
	workspace: ExampleWorkspace,
	config: AthenaGeneratorConfig,
	snapshot: IntrospectionSnapshot,
): Promise<RunGeneratorResult> {
	await writeGeneratorConfigFile(workspace, config);
	return runSchemaGenerator({
		cwd: workspace.cwd,
		provider: createSchemaProvider(snapshot),
	});
}

export async function loadResolvedExampleConfig(
	workspace: ExampleWorkspace,
): Promise<LoadedGeneratorConfig> {
	const configPath = findGeneratorConfigPath(workspace.cwd);
	if (!configPath) {
		throw new Error("Example config file was not found in workspace");
	}
	return loadGeneratorConfig({ configPath, cwd: workspace.cwd });
}

export function renderArtifactsFromExampleSnapshot(
	config: AthenaGeneratorConfig,
	snapshot: IntrospectionSnapshot,
) {
	return generateArtifactsFromSnapshot(
		snapshot,
		normalizeGeneratorConfig(config),
	);
}

export async function runDirectProviderInspect(
	connectionString: string,
): Promise<IntrospectionSnapshot> {
	const provider = resolveGeneratorProvider(
		createDirectGeneratorConfig(connectionString).provider,
		{
			postgresGatewayIntrospection: false,
			scyllaProviderContracts: true,
		},
	);
	return provider.inspect();
}

export async function runGatewayProviderInspect(
	gatewayUrl: string,
	apiKey: string,
): Promise<IntrospectionSnapshot> {
	const provider = resolveGeneratorProvider(
		createGatewayOnlyGeneratorConfig(gatewayUrl, apiKey).provider,
		{
			postgresGatewayIntrospection: false,
			scyllaProviderContracts: true,
		},
	);
	return provider.inspect();
}

export async function ensureWorkspace(
	workspace: ExampleWorkspace,
): Promise<void> {
	await mkdir(dirname(join(workspace.cwd, "athena.config.ts")), {
		recursive: true,
	});
}

export function collectTypeMappingShowcase(): TypeMappingShowcase {
	const exampleColumns: IntrospectionColumn[] = [
		{
			arrayDimensions: 0,
			dataType: "bigint",
			hasDefault: false,
			isGenerated: false,
			isNullable: false,
			isPrimaryKey: false,
			name: "id",
			typeKind: "scalar",
			udtName: "int8",
		},
		{
			arrayDimensions: 0,
			dataType: "jsonb",
			hasDefault: false,
			isGenerated: false,
			isNullable: false,
			isPrimaryKey: false,
			name: "settings",
			typeKind: "scalar",
			udtName: "jsonb",
		},
		{
			arrayDimensions: 0,
			dataType: "mood",
			enumValues: ["happy", "sad"],
			hasDefault: false,
			isGenerated: false,
			isNullable: true,
			isPrimaryKey: false,
			name: "mood",
			typeKind: "enum",
			udtName: "mood",
		},
		{
			arrayDimensions: 1,
			dataType: "text[]",
			hasDefault: false,
			isGenerated: false,
			isNullable: true,
			isPrimaryKey: false,
			name: "labels",
			typeKind: "scalar",
			udtName: "_text",
		},
	];

	return exampleColumns.map((column) => ({
		mappedType: resolvePostgresColumnType(column),
		source: {
			arrayDimensions: column.arrayDimensions,
			dataType: column.dataType,
			enumValues: column.enumValues,
			typeKind: column.typeKind,
			udtName: column.udtName,
		},
	}));
}
