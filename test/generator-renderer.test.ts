import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
	defineAthenaConfig,
	generateArtifactsFromSnapshot,
} from "../src/generator/index.ts";
import type { IntrospectionSnapshot } from "../src/schema/index.ts";

const snapshot: IntrospectionSnapshot = {
	backend: "postgresql",
	database: "app_db",
	generatedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
	schemas: {
		public: {
			name: "public",
			tables: {
				users: {
					columns: {
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
						mood: {
							arrayDimensions: 0,
							dataType: "public.mood",
							enumValues: ["happy", "sad"],
							hasDefault: false,
							isGenerated: false,
							isNullable: true,
							isPrimaryKey: false,
							name: "mood",
							typeKind: "enum",
							udtName: "mood",
						},
						"space name": {
							arrayDimensions: 0,
							dataType: "text",
							hasDefault: false,
							isGenerated: false,
							isNullable: true,
							isPrimaryKey: false,
							name: "space name",
							typeKind: "scalar",
							udtName: "text",
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

const multiSchemaSnapshot: IntrospectionSnapshot = {
	...snapshot,
	schemas: {
		athena: {
			name: "athena",
			tables: {
				users: {
					columns: {
						event_name: {
							arrayDimensions: 0,
							dataType: "text",
							hasDefault: false,
							isGenerated: false,
							isNullable: false,
							isPrimaryKey: false,
							name: "event_name",
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
					},
					name: "users",
					primaryKey: ["id"],
					relations: {},
					schema: "athena",
				},
			},
		},
		public: snapshot.schemas.public,
	},
};

test("generateArtifactsFromSnapshot renders model/schema/database/registry outputs with placeholder paths", () => {
	const config = defineAthenaConfig({
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
			targets: {
				database: "src/generated/{database_kebab}/index.ts",
				model:
					"src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts",
				registry: "src/generated/index.ts",
				schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
			},
		},
		provider: {
			connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
		},
	});

	const artifacts = generateArtifactsFromSnapshot(snapshot, config);

	assert.equal(artifacts.files.length, 4);
	const paths = artifacts.files.map((file) => file.path);
	assert.equal(
		paths.includes("src/generated/app-db/public/users.model.ts"),
		true,
	);
	assert.equal(paths.includes("src/generated/app-db/public/index.ts"), true);
	assert.equal(paths.includes("src/generated/app-db/index.ts"), true);
	assert.equal(paths.includes("src/generated/index.ts"), true);

	const modelFile = artifacts.files.find((file) => file.kind === "model");
	const registryFile = artifacts.files.find((file) => file.kind === "registry");
	assert.ok(modelFile);
	assert.ok(registryFile);
	assert.equal(
		modelFile.content.includes("export const users = table('users')"),
		true,
	);
	assert.equal(
		modelFile.content.includes("'space name': string().optional()"),
		true,
	);
	assert.equal(
		modelFile.content.includes(
			"mood: enumeration(['happy', 'sad'] as const).optional()",
		),
		true,
	);
	assert.equal(modelFile.content.includes("Object.assign(users.meta, {"), true);
	assert.equal(
		registryFile.content.includes("export const __athena_schema_meta = {"),
		true,
	);
	assert.equal(registryFile.content.includes("schemaVersion: 1"), true);
	assert.equal(
		registryFile.content.includes("outputPreset: 'athena-direct'"),
		true,
	);
});

test("generateArtifactsFromSnapshot can disable registry emission with feature flags", () => {
	const config = defineAthenaConfig({
		features: {
			emitRegistry: false,
		},
		output: {
			targets: {
				database: "src/generated/{database}/index.ts",
				model: "src/generated/{database}/{schema}/{model}.ts",
				registry: "src/generated/index.ts",
				schema: "src/generated/{database}/{schema}/index.ts",
			},
		},
		provider: {
			connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
		},
	});

	const artifacts = generateArtifactsFromSnapshot(snapshot, config);
	assert.equal(
		artifacts.files.some((file) => file.kind === "registry"),
		false,
	);
});

test("generateArtifactsFromSnapshot default targets are safe for multiple schemas with shared table names", () => {
	const config = defineAthenaConfig({
		output: {},
		provider: {
			connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
			schemas: ["public", "athena"],
		},
	});

	const artifacts = generateArtifactsFromSnapshot(multiSchemaSnapshot, config);
	const paths = artifacts.files.map((file) => file.path);

	assert.equal(
		paths.includes("src/lib/athena/generated/models/public/users.ts"),
		true,
	);
	assert.equal(
		paths.includes("src/lib/athena/generated/models/athena/users.ts"),
		true,
	);
	assert.equal(
		paths.includes("src/lib/athena/generated/schema/public.ts"),
		true,
	);
	assert.equal(
		paths.includes("src/lib/athena/generated/schema/athena.ts"),
		true,
	);
	assert.equal(paths.includes("src/lib/athena/generated/relations.ts"), true);
	assert.equal(paths.includes("src/lib/athena/generated/registry.ts"), true);
});

test("generateArtifactsFromSnapshot auto-scopes colliding multi-schema output paths", () => {
	const config = defineAthenaConfig({
		output: {
			targets: {
				database: "src/lib/athena/generated/relations.ts",
				model: "src/lib/athena/generated/models/{model_kebab}.ts",
				registry: "athena/config.ts",
				schema: "athena/schema.ts",
			},
		},
		provider: {
			connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
			schemas: ["public", "athena"],
		},
	});

	const artifacts = generateArtifactsFromSnapshot(multiSchemaSnapshot, config);
	const paths = artifacts.files.map((file) => file.path);

	assert.equal(
		paths.includes("src/lib/athena/generated/models/public/users.ts"),
		true,
	);
	assert.equal(
		paths.includes("src/lib/athena/generated/models/athena/users.ts"),
		true,
	);
	assert.equal(paths.includes("athena/public/schema.ts"), true);
	assert.equal(paths.includes("athena/athena/schema.ts"), true);
});

test("generateArtifactsFromSnapshot keeps built-in placeholders stable when placeholderMap redefines schema/model keys", () => {
	const config = defineAthenaConfig({
		output: {
			placeholderMap: {
				model: "model",
				namespace: "athena",
				schema: "schema",
			},
			targets: {
				database: "athena/{schema}/relations.ts",
				model: "src/lib/athena/generated/models/{schema}/{model_kebab}.ts",
				registry: "athena/{schema}/config.ts",
				schema: "athena/{schema}/schema.ts",
			},
		},
		provider: {
			connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
			schemas: ["public", "athena"],
		},
	});

	const artifacts = generateArtifactsFromSnapshot(multiSchemaSnapshot, config);
	const paths = artifacts.files.map((file) => file.path);

	assert.equal(
		paths.includes("src/lib/athena/generated/models/public/users.ts"),
		true,
	);
	assert.equal(
		paths.includes("src/lib/athena/generated/models/athena/users.ts"),
		true,
	);
	assert.equal(paths.includes("athena/public/schema.ts"), true);
	assert.equal(paths.includes("athena/athena/schema.ts"), true);
	assert.equal(
		paths.some((path) =>
			path.startsWith("src/lib/athena/generated/models/schema/"),
		),
		false,
	);
});

test("generateArtifactsFromSnapshot can render the zero-style table builder format", () => {
	const config = defineAthenaConfig({
		features: {
			emitRegistry: true,
			emitRelations: true,
		},
		output: {
			format: "table-builder",
			targets: {
				database: "src/generated/{database_kebab}/index.ts",
				model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.ts",
				registry: "src/generated/index.ts",
				schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
			},
		},
		provider: {
			connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
			schemas: ["public"],
		},
	});

	const artifacts = generateArtifactsFromSnapshot(snapshot, config);
	const modelFile = artifacts.files.find((file) => file.kind === "model");
	const registryFile = artifacts.files.find((file) => file.kind === "registry");
	assert.ok(modelFile);
	assert.ok(registryFile);
	assert.equal(
		modelFile.content.includes("export const users = table('users')"),
		true,
	);
	assert.equal(modelFile.content.includes(".schema('public')"), true);
	assert.equal(
		modelFile.content.includes("'space name': string().optional()"),
		true,
	);
	assert.equal(
		modelFile.content.includes(
			"mood: enumeration(['happy', 'sad'] as const).optional()",
		),
		true,
	);
	assert.equal(modelFile.content.includes("Object.assign(users.meta, {"), true);
	assert.equal(
		modelFile.content.includes(
			"export const users_row_schema = users.schemas.row",
		),
		true,
	);
	assert.equal(
		modelFile.content.includes(
			"export type PublicUsersFormValues = FormValuesOf<typeof users>",
		),
		true,
	);
	assert.equal(
		registryFile.content.includes("outputPreset: 'athena-direct'"),
		true,
	);
	assert.equal(
		registryFile.content.includes("outputFormat: 'table-builder'"),
		true,
	);
});

test("generateArtifactsFromSnapshot renders withoutPrimaryKey for tables without a primary key", () => {
	const config = defineAthenaConfig({
		output: {
			format: "table-builder",
			targets: {
				database: "src/generated/{database_kebab}/index.ts",
				model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.ts",
				registry: "src/generated/index.ts",
				schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
			},
		},
		provider: {
			connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
			schemas: ["athena"],
		},
	});

	const noPrimaryKeySnapshot: IntrospectionSnapshot = {
		backend: "postgresql",
		database: "app_db",
		generatedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
		schemas: {
			athena: {
				name: "athena",
				tables: {
					account: {
						columns: {
							id: {
								arrayDimensions: 0,
								dataType: "text",
								hasDefault: false,
								isGenerated: false,
								isNullable: false,
								isPrimaryKey: false,
								name: "id",
								typeKind: "scalar",
								udtName: "text",
							},
							user_id: {
								arrayDimensions: 0,
								dataType: "text",
								hasDefault: false,
								isGenerated: false,
								isNullable: false,
								isPrimaryKey: false,
								name: "user_id",
								typeKind: "scalar",
								udtName: "text",
							},
						},
						name: "account",
						primaryKey: [],
						relations: {},
						schema: "athena",
					},
				},
			},
		},
	};

	const artifacts = generateArtifactsFromSnapshot(noPrimaryKeySnapshot, config);
	const modelFile = artifacts.files.find((file) => file.kind === "model");
	assert.ok(modelFile);
	assert.equal(modelFile.content.includes(".withoutPrimaryKey()"), true);
});

test("generateArtifactsFromSnapshot table-builder maps column helpers and modifiers", () => {
	const config = defineAthenaConfig({
		output: {
			format: "table-builder",
			targets: {
				database: "src/generated/{database_kebab}/index.ts",
				model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.ts",
				registry: "src/generated/index.ts",
				schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
			},
		},
		provider: {
			connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
			schemas: ["public"],
		},
	});

	const matrixSnapshot: IntrospectionSnapshot = {
		backend: "postgresql",
		database: "app_db",
		generatedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
		schemas: {
			public: {
				name: "public",
				tables: {
					samples: {
						columns: {
							count: {
								arrayDimensions: 0,
								dataType: "integer",
								hasDefault: false,
								isGenerated: false,
								isNullable: false,
								isPrimaryKey: false,
								name: "count",
								typeKind: "scalar",
								udtName: "int4",
							},
							full_name: {
								arrayDimensions: 0,
								dataType: "text",
								hasDefault: false,
								isGenerated: true,
								isNullable: false,
								isPrimaryKey: false,
								name: "full_name",
								typeKind: "scalar",
								udtName: "text",
							},
							id: {
								arrayDimensions: 0,
								dataType: "uuid",
								hasDefault: true,
								isGenerated: false,
								isNullable: false,
								isPrimaryKey: true,
								name: "id",
								typeKind: "scalar",
								udtName: "uuid",
							},
							is_active: {
								arrayDimensions: 0,
								dataType: "boolean",
								hasDefault: true,
								isGenerated: false,
								isNullable: false,
								isPrimaryKey: false,
								name: "is_active",
								typeKind: "scalar",
								udtName: "bool",
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
							mood: {
								arrayDimensions: 0,
								dataType: "public.mood",
								enumValues: ["happy", "sad"],
								hasDefault: false,
								isGenerated: false,
								isNullable: true,
								isPrimaryKey: false,
								name: "mood",
								typeKind: "enum",
								udtName: "mood",
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
						name: "samples",
						primaryKey: ["id"],
						relations: {},
						schema: "public",
					},
				},
			},
		},
	};

	const artifacts = generateArtifactsFromSnapshot(matrixSnapshot, config);
	const modelFile = artifacts.files.find((file) => file.kind === "model");
	assert.ok(modelFile);

	assert.equal(
		modelFile.content.includes("export const samples = table('samples')"),
		true,
	);
	assert.equal(modelFile.content.includes("id: string().defaulted()"), true);
	assert.equal(modelFile.content.includes("count: number()"), true);
	assert.equal(
		modelFile.content.includes("is_active: boolean().defaulted()"),
		true,
	);
	assert.equal(
		modelFile.content.includes(
			"metrics: json<Record<string, unknown>>().optional()",
		),
		true,
	);
	assert.equal(
		modelFile.content.includes("tags: json<Array<string>>().optional()"),
		true,
	);
	assert.equal(
		modelFile.content.includes("full_name: string().generated()"),
		true,
	);
	assert.equal(
		modelFile.content.includes(
			"mood: enumeration(['happy', 'sad'] as const).optional()",
		),
		true,
	);
	assert.equal(modelFile.content.includes("table: string()"), true);
	assert.equal(
		modelFile.content.includes(
			"import { boolean, enumeration, json, number, string, table } from",
		),
		true,
	);
});

test("generateArtifactsFromSnapshot define-model format emits interfaces and defineModel metadata", () => {
	const config = defineAthenaConfig({
		features: {
			emitRegistry: true,
			emitRelations: true,
		},
		output: {
			format: "define-model",
			targets: {
				database: "src/generated/{database_kebab}/index.ts",
				model:
					"src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts",
				registry: "src/generated/index.ts",
				schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
			},
		},
		provider: {
			connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
			schemas: ["public"],
		},
	});

	const defineModelSnapshot: IntrospectionSnapshot = {
		backend: "postgresql",
		database: "app_db",
		generatedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
		schemas: {
			public: {
				name: "public",
				tables: {
					users: {
						columns: {
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

	const artifacts = generateArtifactsFromSnapshot(defineModelSnapshot, config);
	const modelFile = artifacts.files.find((file) => file.kind === "model");
	const registryFile = artifacts.files.find((file) => file.kind === "registry");
	assert.ok(modelFile);
	assert.ok(registryFile);

	assert.equal(
		modelFile.content.includes(
			"import { defineModel } from '@xylex-group/athena'",
		),
		true,
	);
	assert.equal(
		modelFile.content.includes("export interface PublicUsersRow {"),
		true,
	);
	assert.equal(modelFile.content.includes("id: string"), true);
	assert.equal(
		modelFile.content.includes("metrics?: Record<string, unknown> | null"),
		true,
	);
	assert.equal(modelFile.content.includes("table: string"), true);
	assert.equal(
		modelFile.content.includes("export const publicUsersModel = defineModel<"),
		true,
	);
	assert.equal(modelFile.content.includes("relations:"), true);
	assert.equal(
		registryFile.content.includes("outputFormat: 'define-model'"),
		true,
	);
	assert.equal(
		modelFile.content.includes("export const users = table('users')"),
		false,
	);
});

test("generateArtifactsFromSnapshot wires schema, database, and registry assembly graph", () => {
	const config = defineAthenaConfig({
		output: {
			format: "table-builder",
			preset: "athena-direct",
		},
		provider: {
			connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
			schemas: ["public"],
		},
	});

	const artifacts = generateArtifactsFromSnapshot(snapshot, config);
	const modelFile = artifacts.files.find((file) => file.kind === "model");
	const schemaFile = artifacts.files.find((file) => file.kind === "schema");
	const databaseFile = artifacts.files.find((file) => file.kind === "database");
	const registryFile = artifacts.files.find((file) => file.kind === "registry");

	assert.ok(modelFile);
	assert.ok(schemaFile);
	assert.ok(databaseFile);
	assert.ok(registryFile);

	assert.equal(
		modelFile.path,
		"src/lib/athena/generated/models/public/users.ts",
	);
	assert.equal(schemaFile.path, "src/lib/athena/generated/schema/public.ts");
	assert.equal(databaseFile.path, "src/lib/athena/generated/relations.ts");
	assert.equal(registryFile.path, "src/lib/athena/generated/registry.ts");

	assert.equal(
		schemaFile.content.includes(
			"import { users } from '../models/public/users'",
		),
		true,
	);
	assert.equal(
		schemaFile.content.includes("export const publicSchema = defineSchema({"),
		true,
	);
	assert.equal(schemaFile.content.includes("  users,"), true);
	assert.equal(schemaFile.content.includes("  users: users"), false);

	assert.equal(
		databaseFile.content.includes(
			"import { publicSchema } from './schema/public'",
		),
		true,
	);
	assert.equal(
		databaseFile.content.includes(
			"export const appDbDatabase = defineDatabase({",
		),
		true,
	);
	assert.equal(databaseFile.content.includes("  public: publicSchema"), true);
	assert.equal(databaseFile.content.includes("'public':"), false);

	assert.equal(
		registryFile.content.includes(
			"import { appDbDatabase } from './relations'",
		),
		true,
	);
	assert.equal(
		registryFile.content.includes("export const registry = defineRegistry({"),
		true,
	);
	assert.equal(registryFile.content.includes("  app_db: appDbDatabase"), true);
	assert.equal(
		registryFile.content.includes("outputPreset: 'athena-direct'"),
		true,
	);
	assert.equal(
		registryFile.content.includes("outputFormat: 'table-builder'"),
		true,
	);
});

test("generateArtifactsFromSnapshot renders composite primary keys and stacked column modifiers", () => {
	const config = defineAthenaConfig({
		output: {
			format: "table-builder",
			targets: {
				database: "src/generated/{database_kebab}/index.ts",
				model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.ts",
				registry: "src/generated/index.ts",
				schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
			},
		},
		provider: {
			connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
			schemas: ["public"],
		},
	});

	const compositeSnapshot: IntrospectionSnapshot = {
		backend: "postgresql",
		database: "app_db",
		generatedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
		schemas: {
			public: {
				name: "public",
				tables: {
					memberships: {
						columns: {
							display_name: {
								arrayDimensions: 0,
								dataType: "text",
								hasDefault: false,
								isGenerated: true,
								isNullable: true,
								isPrimaryKey: false,
								name: "display_name",
								typeKind: "scalar",
								udtName: "text",
							},
							external_id: {
								arrayDimensions: 0,
								dataType: "bigint",
								hasDefault: true,
								isGenerated: false,
								isNullable: true,
								isPrimaryKey: false,
								name: "external_id",
								typeKind: "scalar",
								udtName: "int8",
							},
							org_id: {
								arrayDimensions: 0,
								dataType: "uuid",
								hasDefault: false,
								isGenerated: false,
								isNullable: false,
								isPrimaryKey: true,
								name: "org_id",
								typeKind: "scalar",
								udtName: "uuid",
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
						name: "memberships",
						primaryKey: ["org_id", "user_id"],
						relations: {},
						schema: "public",
					},
				},
			},
		},
	};

	const artifacts = generateArtifactsFromSnapshot(compositeSnapshot, config);
	const modelFile = artifacts.files.find((file) => file.kind === "model");
	assert.ok(modelFile);

	assert.equal(
		modelFile.content.includes(".primaryKey('org_id', 'user_id')"),
		true,
	);
	// bigint maps to string helper, not number
	assert.equal(
		modelFile.content.includes("external_id: string().optional().defaulted()"),
		true,
	);
	assert.equal(
		modelFile.content.includes("display_name: string().optional().generated()"),
		true,
	);
	assert.equal(modelFile.content.includes("external_id: number()"), false);
});

test("generateArtifactsFromSnapshot legacy preset writes N-1 root athena/* layout", () => {
	const config = defineAthenaConfig({
		output: {
			format: "table-builder",
			preset: "legacy",
		},
		provider: {
			connectionString: "postgres://127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
			schemas: ["public"],
		},
	});

	const artifacts = generateArtifactsFromSnapshot(snapshot, config);
	const paths = artifacts.files.map((file) => file.path);
	const registryFile = artifacts.files.find((file) => file.kind === "registry");

	assert.equal(paths.includes("athena/models/public/users.ts"), true);
	assert.equal(paths.includes("athena/schemas/public.ts"), true);
	assert.equal(paths.includes("athena/relations.ts"), true);
	assert.equal(paths.includes("athena/registry.generated.ts"), true);
	assert.equal(paths.includes("src/lib/athena/generated/registry.ts"), false);
	assert.ok(registryFile);
	assert.equal(registryFile.content.includes("outputPreset: 'legacy'"), true);
	assert.equal(registryFile.content.includes("@generated"), true);
	assert.equal(registryFile.content.includes("Generated by Athena"), true);
	assert.equal(
		registryFile.content.split("Generated by Athena").length - 1,
		1
	);
});

test("generateArtifactsFromSnapshot applies naming styles to generated type and const identifiers", () => {
	const tableBuilderConfig = defineAthenaConfig({
		naming: {
			databaseConst: "snake",
			modelType: "snake",
			registryConst: "snake",
			schemaConst: "snake",
		},
		output: {
			format: "table-builder",
			targets: {
				database: "src/generated/{database_kebab}/index.ts",
				model: "src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.ts",
				registry: "src/generated/index.ts",
				schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
			},
		},
		provider: {
			connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
			schemas: ["public"],
		},
	});

	const tableBuilderArtifacts = generateArtifactsFromSnapshot(
		snapshot,
		tableBuilderConfig,
	);
	const tableBuilderModel = tableBuilderArtifacts.files.find(
		(file) => file.kind === "model",
	);
	const tableBuilderSchema = tableBuilderArtifacts.files.find(
		(file) => file.kind === "schema",
	);
	const tableBuilderDatabase = tableBuilderArtifacts.files.find(
		(file) => file.kind === "database",
	);
	const tableBuilderRegistry = tableBuilderArtifacts.files.find(
		(file) => file.kind === "registry",
	);
	assert.ok(tableBuilderModel);
	assert.ok(tableBuilderSchema);
	assert.ok(tableBuilderDatabase);
	assert.ok(tableBuilderRegistry);

	// table() const stays table-name based; exported types follow modelType
	assert.equal(
		tableBuilderModel.content.includes(
			"export type public_usersRow = RowOf<typeof users>",
		),
		true,
	);
	assert.equal(
		tableBuilderModel.content.includes("export type PublicUsersRow ="),
		false,
	);
	assert.equal(
		tableBuilderSchema.content.includes(
			"export const public_schema = defineSchema({",
		),
		true,
	);
	assert.equal(
		tableBuilderDatabase.content.includes(
			"export const app_db_database = defineDatabase({",
		),
		true,
	);
	// registry const is always derived from the literal "registry" + naming style
	assert.equal(
		tableBuilderRegistry.content.includes(
			"export const registry = defineRegistry({",
		),
		true,
	);

	const defineModelConfig = defineAthenaConfig({
		naming: {
			modelConst: "snake",
			modelType: "snake",
		},
		output: {
			format: "define-model",
			targets: {
				database: "src/generated/{database_kebab}/index.ts",
				model:
					"src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts",
				registry: "src/generated/index.ts",
				schema: "src/generated/{database_kebab}/{schema_kebab}/index.ts",
			},
		},
		provider: {
			connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
			database: "app_db",
			kind: "postgres",
			mode: "direct",
			schemas: ["public"],
		},
	});

	const defineModelArtifacts = generateArtifactsFromSnapshot(
		snapshot,
		defineModelConfig,
	);
	const defineModelFile = defineModelArtifacts.files.find(
		(file) => file.kind === "model",
	);
	assert.ok(defineModelFile);
	assert.equal(
		defineModelFile.content.includes("export interface public_usersRow {"),
		true,
	);
	assert.equal(
		defineModelFile.content.includes(
			"export const public_users_model = defineModel<",
		),
		true,
	);
});
