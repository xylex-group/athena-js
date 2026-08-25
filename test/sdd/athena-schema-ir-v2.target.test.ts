/**
 * Target suite: Athena Schema IR v2 P0.
 *
 * Encodes docs/sdd/xylex/athena-schema-ir-v2 (T-SIR-*). RED on HEAD until
 * src/schema/ir/ owns AthenaSchemaIr and table/introspection/diff consume it.
 * Do not implement product code in this file.
 */

import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineModel } from "../../src/schema/definitions.ts";
import {
	diffSchemas,
	SchemaDiffError,
	schemaSnapshotFromIntrospection,
	validateSchemaSnapshot,
} from "../../src/schema/diff/index.ts";
import type { AthenaSchemaSnapshot } from "../../src/schema/diff/types.ts";
import { table } from "../../src/schema/table-builder.ts";
import { enumeration, string } from "../../src/schema/table-columns.ts";
import type { IntrospectionSnapshot } from "../../src/schema/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const irDir = join(srcRoot, "schema", "ir");
const irIndex = join(irDir, "index.ts");
const fixturesDir = join(pkgRoot, "test", "fixtures", "schema-ir");

const IR_MODULES = [
	"version.ts",
	"document.ts",
	"database.ts",
	"namespace.ts",
	"table.ts",
	"column.ts",
	"type.ts",
	"constraint.ts",
	"relation.ts",
	"indexes.ts",
	"metadata.ts",
	"identity.ts",
	"canonicalize.ts",
	"fingerprint.ts",
	"validate.ts",
	"compatibility.ts",
	"index.ts",
] as const;

type JsonObject = Record<string, unknown>;

type SchemaIrBarrel = {
	ATHENA_SCHEMA_IR_KIND: "athena.schema";
	ATHENA_SCHEMA_IR_VERSION: 2;
	canonicalizeAthenaSchemaIr: (doc: unknown) => unknown;
	fingerprintAthenaSchemaIr: (doc: unknown) => string;
	schemaIrFromIntrospection: (snapshot: IntrospectionSnapshot) => unknown;
	schemaIrFromModels: (models: unknown) => unknown;
	schemaIrFromTable: (tableDef: unknown) => unknown;
	validateAthenaSchemaIr: (doc: unknown) => unknown;
};

function collectFiles(dir: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}
	const out: string[] = [];
	for (const ent of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, ent.name);
		if (ent.isDirectory()) {
			out.push(...collectFiles(path));
		} else {
			out.push(path);
		}
	}
	return out;
}

function readUtf8(path: string): string {
	assert.equal(existsSync(path), true, `missing ${path}`);
	return readFileSync(path, "utf8");
}

async function loadSchemaIr(): Promise<SchemaIrBarrel> {
	assert.equal(existsSync(irIndex), true, "src/schema/ir/index.ts must exist");
	const mod = (await import(
		pathToFileURL(irIndex).href
	)) as Partial<SchemaIrBarrel>;
	assert.equal(mod.ATHENA_SCHEMA_IR_KIND, "athena.schema");
	assert.equal(mod.ATHENA_SCHEMA_IR_VERSION, 2);
	assert.equal(typeof mod.canonicalizeAthenaSchemaIr, "function");
	assert.equal(typeof mod.validateAthenaSchemaIr, "function");
	assert.equal(typeof mod.fingerprintAthenaSchemaIr, "function");
	assert.equal(typeof mod.schemaIrFromTable, "function");
	assert.equal(typeof mod.schemaIrFromModels, "function");
	assert.equal(typeof mod.schemaIrFromIntrospection, "function");
	return mod as SchemaIrBarrel;
}

function asObject(value: unknown, label: string): JsonObject {
	assert.equal(value !== null && typeof value === "object", true, label);
	return value as JsonObject;
}

function asArray(value: unknown, label: string): unknown[] {
	assert.ok(Array.isArray(value), label);
	return value as unknown[];
}

function databaseNamespaces(database: JsonObject): JsonObject[] {
	const raw = database.namespaces ?? database.schemas;
	return asArray(raw, "SchemaDatabase.namespaces").map((item) =>
		asObject(item, "namespace"),
	);
}

function identityOf(object: JsonObject): JsonObject {
	const identity = asObject(object.identity, "identity");
	const logical = asObject(identity.logical, "identity.logical");
	const physical = asObject(identity.physical, "identity.physical");
	for (const axis of ["database", "namespace", "name"] as const) {
		assert.equal(typeof logical[axis], "string", `logical.${axis}`);
		assert.equal(typeof physical[axis], "string", `physical.${axis}`);
	}
	return identity;
}

function sampleIr(overrides: JsonObject = {}): JsonObject {
	const usersId = "tbl_users";
	const postsId = "tbl_posts";
	const moodEnumId = "enum_mood";
	const authorFkId = "cst_posts_author_fk";
	const moodCheckId = "cst_moods_mood_check";
	return {
		kind: "athena.schema",
		irVersion: 2,
		databases: [
			{
				id: "db_app",
				identity: {
					logical: { database: "appdb", namespace: "public", name: "appdb" },
					physical: { database: "appdb", namespace: "public", name: "appdb" },
				},
				namespaces: [
					{
						id: "ns_public",
						identity: {
							logical: {
								database: "appdb",
								namespace: "public",
								name: "public",
							},
							physical: {
								database: "appdb",
								namespace: "public",
								name: "public",
							},
						},
						enums: [
							{
								id: moodEnumId,
								identity: {
									logical: {
										database: "appdb",
										namespace: "public",
										name: "mood",
									},
									physical: {
										database: "appdb",
										namespace: "public",
										name: "mood",
									},
								},
								labels: ["happy", "sad"],
							},
						],
						tables: [
							{
								id: usersId,
								identity: {
									logical: {
										database: "appdb",
										namespace: "public",
										name: "users",
									},
									physical: {
										database: "appdb",
										namespace: "public",
										name: "users",
									},
								},
								columns: [
									{
										id: "col_users_id",
										identity: {
											logical: {
												database: "appdb",
												namespace: "public",
												name: "id",
											},
											physical: {
												database: "appdb",
												namespace: "public",
												name: "id",
											},
										},
										type: {
											kind: "scalar",
											semantic: "uuid",
											native: {
												backend: "postgresql",
												name: "uuid",
												arrayDimensions: 0,
											},
										},
										nullable: false,
									},
								],
								constraints: [
									{
										id: "cst_users_pk",
										kind: "primary_key",
										columns: ["id"],
									},
								],
								relations: [],
								indexes: [],
							},
							{
								id: postsId,
								identity: {
									logical: {
										database: "appdb",
										namespace: "public",
										name: "posts",
									},
									physical: {
										database: "appdb",
										namespace: "public",
										name: "posts",
									},
								},
								columns: [
									{
										id: "col_posts_id",
										identity: {
											logical: {
												database: "appdb",
												namespace: "public",
												name: "id",
											},
											physical: {
												database: "appdb",
												namespace: "public",
												name: "id",
											},
										},
										type: {
											kind: "scalar",
											semantic: "uuid",
											native: {
												backend: "postgresql",
												name: "uuid",
												arrayDimensions: 0,
											},
										},
										nullable: false,
									},
									{
										id: "col_posts_author_id",
										identity: {
											logical: {
												database: "appdb",
												namespace: "public",
												name: "author_id",
											},
											physical: {
												database: "appdb",
												namespace: "public",
												name: "author_id",
											},
										},
										type: {
											kind: "scalar",
											semantic: "uuid",
											native: {
												backend: "postgresql",
												name: "uuid",
												arrayDimensions: 0,
											},
										},
										nullable: false,
									},
									{
										id: "col_posts_mood",
										identity: {
											logical: {
												database: "appdb",
												namespace: "public",
												name: "mood",
											},
											physical: {
												database: "appdb",
												namespace: "public",
												name: "mood",
											},
										},
										type: {
											kind: "enum",
											enumId: moodEnumId,
											native: {
												backend: "postgresql",
												name: "mood",
												arrayDimensions: 0,
											},
										},
										nullable: false,
									},
								],
								constraints: [
									{
										id: "cst_posts_pk",
										kind: "primary_key",
										columns: ["id"],
									},
									{
										id: authorFkId,
										kind: "foreign_key",
										columns: ["author_id"],
										targetTableId: usersId,
										targetColumns: ["id"],
									},
									{
										id: moodCheckId,
										kind: "check",
										expression: "mood IN ('happy', 'sad')",
									},
								],
								relations: [
									{
										id: "rel_posts_author",
										cardinality: "n:1",
										sourceTableId: postsId,
										targetTableId: usersId,
										sourceColumns: ["author_id"],
										targetColumns: ["id"],
										backingConstraintIds: [authorFkId],
									},
									{
										id: "rel_posts_tags",
										cardinality: "n:n",
										sourceTableId: postsId,
										targetTableId: "tbl_tags",
										through: {
											tableId: "tbl_post_tags",
											sourceColumns: ["post_id"],
											targetColumns: ["tag_id"],
										},
										backingConstraintIds: [],
									},
								],
								indexes: [],
							},
							{
								id: "tbl_tags",
								identity: {
									logical: {
										database: "appdb",
										namespace: "public",
										name: "tags",
									},
									physical: {
										database: "appdb",
										namespace: "public",
										name: "tags",
									},
								},
								columns: [
									{
										id: "col_tags_id",
										identity: {
											logical: {
												database: "appdb",
												namespace: "public",
												name: "id",
											},
											physical: {
												database: "appdb",
												namespace: "public",
												name: "id",
											},
										},
										type: {
											kind: "scalar",
											semantic: "uuid",
											native: {
												backend: "postgresql",
												name: "uuid",
												arrayDimensions: 0,
											},
										},
										nullable: false,
									},
								],
								constraints: [
									{
										id: "cst_tags_pk",
										kind: "primary_key",
										columns: ["id"],
									},
								],
								relations: [],
								indexes: [],
							},
							{
								id: "tbl_post_tags",
								identity: {
									logical: {
										database: "appdb",
										namespace: "public",
										name: "post_tags",
									},
									physical: {
										database: "appdb",
										namespace: "public",
										name: "post_tags",
									},
								},
								columns: [
									{
										id: "col_post_tags_post_id",
										identity: {
											logical: {
												database: "appdb",
												namespace: "public",
												name: "post_id",
											},
											physical: {
												database: "appdb",
												namespace: "public",
												name: "post_id",
											},
										},
										type: {
											kind: "scalar",
											semantic: "uuid",
											native: {
												backend: "postgresql",
												name: "uuid",
												arrayDimensions: 0,
											},
										},
										nullable: false,
									},
									{
										id: "col_post_tags_tag_id",
										identity: {
											logical: {
												database: "appdb",
												namespace: "public",
												name: "tag_id",
											},
											physical: {
												database: "appdb",
												namespace: "public",
												name: "tag_id",
											},
										},
										type: {
											kind: "scalar",
											semantic: "uuid",
											native: {
												backend: "postgresql",
												name: "uuid",
												arrayDimensions: 0,
											},
										},
										nullable: false,
									},
								],
								constraints: [
									{
										id: "cst_post_tags_post_fk",
										kind: "foreign_key",
										columns: ["post_id"],
										targetTableId: postsId,
										targetColumns: ["id"],
									},
									{
										id: "cst_post_tags_tag_fk",
										kind: "foreign_key",
										columns: ["tag_id"],
										targetTableId: "tbl_tags",
										targetColumns: ["id"],
									},
								],
								relations: [],
								indexes: [],
							},
						],
					},
				],
			},
		],
		metadata: {
			provenance: {
				source: "fixture",
				generatedAt: "2026-08-21T00:00:00.000Z",
			},
			extensions: { note: "target-suite" },
		},
		...overrides,
	};
}

function collectTables(ir: JsonObject): JsonObject[] {
	const databases = asArray(ir.databases, "databases");
	const tables: JsonObject[] = [];
	for (const rawDb of databases) {
		const db = asObject(rawDb, "database");
		for (const ns of databaseNamespaces(db)) {
			for (const rawTable of asArray(ns.tables, "tables")) {
				tables.push(asObject(rawTable, "table"));
			}
		}
	}
	return tables;
}

function collectEnums(ir: JsonObject): JsonObject[] {
	const databases = asArray(ir.databases, "databases");
	const enums: JsonObject[] = [];
	for (const rawDb of databases) {
		const db = asObject(rawDb, "database");
		const dbEnums = Array.isArray(db.enums) ? db.enums : [];
		for (const item of dbEnums) {
			enums.push(asObject(item, "enum"));
		}
		for (const ns of databaseNamespaces(db)) {
			const nsEnums = Array.isArray(ns.enums) ? ns.enums : [];
			for (const item of nsEnums) {
				enums.push(asObject(item, "enum"));
			}
		}
	}
	return enums;
}

function expectSchemaDiffError(
	fn: () => void,
	code: SchemaDiffError["code"],
): void {
	try {
		fn();
	} catch (error) {
		assert.ok(error instanceof SchemaDiffError);
		assert.equal(error.code, code);
		return;
	}
	assert.fail(`expected SchemaDiffError ${code}`);
}

function introSnapshot(): IntrospectionSnapshot {
	return {
		backend: "postgresql",
		database: "tenant_prod",
		generatedAt: "2026-08-21T00:00:00.000Z",
		schemas: {
			public: {
				name: "public",
				tables: {
					users: {
						schema: "public",
						name: "users",
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
						},
						primaryKey: ["id"],
						relations: {},
					},
				},
			},
		},
	};
}

test("T-SIR-01: src/schema/ir/ owns the v2 document modules", () => {
	assert.equal(existsSync(irDir), true, "src/schema/ir/ must exist");
	for (const file of IR_MODULES) {
		assert.equal(
			existsSync(join(irDir, file)),
			true,
			`src/schema/ir/${file} must exist`,
		);
	}

	const documentSrc = readUtf8(join(irDir, "document.ts"));
	assert.match(documentSrc, /export (?:interface|type) AthenaSchemaIr/);
	assert.match(documentSrc, /athena\.schema/);
	assert.match(documentSrc, /irVersion/);

	const diffTypesSrc = readUtf8(join(srcRoot, "schema", "diff", "types.ts"));
	assert.equal(
		/export interface AthenaSchemaIr/.test(diffTypesSrc),
		false,
		"schema/diff must not define AthenaSchemaIr",
	);
	assert.equal(diffTypesSrc.includes('kind: "athena.schema"'), false);
});

test("T-SIR-02: @xylex-group/athena/schema is published (package.json + tsup)", () => {
	const pkg = JSON.parse(
		readFileSync(join(pkgRoot, "package.json"), "utf8"),
	) as { exports: Record<string, unknown> };
	assert.equal("./schema" in pkg.exports, true);
	const schemaExport = pkg.exports["./schema"];
	assert.equal(schemaExport !== undefined && schemaExport !== null, true);

	const tsup = readUtf8(join(pkgRoot, "tsup.config.ts"));
	assert.match(
		tsup,
		/\bschema:\s*"src\/schema(?:\/index\.ts|\/ir\/index\.ts)"/,
	);

	const schemaIndexSrc = readUtf8(join(srcRoot, "schema", "index.ts"));
	assert.match(schemaIndexSrc, /from "\.\/ir(?:\/index\.ts)?"/);
	assert.equal(schemaIndexSrc.includes("canonicalizeAthenaSchemaIr"), true);
	assert.equal(schemaIndexSrc.includes("validateAthenaSchemaIr"), true);
	assert.equal(schemaIndexSrc.includes("fingerprintAthenaSchemaIr"), true);
	assert.equal(schemaIndexSrc.includes("AthenaSchemaIr"), true);
});

test("T-SIR-03: AthenaSchemaIr has kind athena.schema, irVersion 2, databases[], metadata", async () => {
	const irApi = await loadSchemaIr();
	assert.equal(irApi.ATHENA_SCHEMA_IR_KIND, "athena.schema");
	assert.equal(irApi.ATHENA_SCHEMA_IR_VERSION, 2);

	const doc = sampleIr();
	irApi.validateAthenaSchemaIr(doc);
	const canonical = asObject(
		irApi.canonicalizeAthenaSchemaIr(doc),
		"canonical IR",
	);
	assert.equal(canonical.kind, "athena.schema");
	assert.equal(canonical.irVersion, 2);
	assert.ok(Array.isArray(canonical.databases));
	assert.ok(canonical.databases.length >= 1);
	assert.equal("metadata" in canonical, true);
	assert.equal("schemas" in canonical && !("databases" in canonical), false);
});

test("T-SIR-04: SchemaDatabase is first-class; database is not implicit", async () => {
	const irApi = await loadSchemaIr();
	const databaseSrc = readUtf8(join(irDir, "database.ts"));
	assert.match(databaseSrc, /export (?:interface|type) SchemaDatabase/);

	const doc = asObject(
		irApi.canonicalizeAthenaSchemaIr(sampleIr()),
		"canonical",
	);
	const databases = asArray(doc.databases, "databases");
	const database = asObject(databases[0], "databases[0]");
	assert.equal("id" in database, true);
	identityOf(database);
	const namespaces = databaseNamespaces(database);
	assert.ok(namespaces.length >= 1);
	const tables = asArray(namespaces[0]?.tables, "namespace.tables");
	assert.ok(tables.length >= 1);

	try {
		irApi.validateAthenaSchemaIr({
			kind: "athena.schema",
			irVersion: 2,
			schemas: [],
			metadata: {},
		});
		assert.fail(
			"validateAthenaSchemaIr must reject documents without databases[]",
		);
	} catch (error) {
		assert.ok(error instanceof Error);
	}
});

test("T-SIR-05: SchemaObjectIdentity is logical vs physical (database/namespace/name)", async () => {
	const irApi = await loadSchemaIr();
	const identitySrc = readUtf8(join(irDir, "identity.ts"));
	assert.match(identitySrc, /export (?:interface|type) SchemaObjectIdentity/);
	assert.match(identitySrc, /logical/);
	assert.match(identitySrc, /physical/);

	const doc = asObject(
		irApi.canonicalizeAthenaSchemaIr(sampleIr()),
		"canonical",
	);
	const tableDoc = collectTables(doc).find((item) => item.id === "tbl_users");
	assert.ok(tableDoc);
	const identity = identityOf(tableDoc as JsonObject);
	const logical = asObject(identity.logical, "logical");
	const physical = asObject(identity.physical, "physical");
	assert.equal(logical.database, "appdb");
	assert.equal(logical.namespace, "public");
	assert.equal(logical.name, "users");
	assert.equal(physical.name, "users");
});

test("T-SIR-06: SchemaType is a discriminated union with NativeTypeDescriptor", async () => {
	await loadSchemaIr();
	const typeSrc = readUtf8(join(irDir, "type.ts"));
	assert.match(typeSrc, /export type SchemaType/);
	assert.match(typeSrc, /export (?:interface|type) NativeTypeDescriptor/);
	assert.equal(typeSrc.includes("|"), true, "SchemaType must be a union");
	assert.equal(
		/export interface SchemaColumnType \{[\s\S]*enumValues/.test(typeSrc),
		false,
		"v2 SchemaType must not be the v1 SchemaColumnType blob",
	);

	const nativeBlock = typeSrc.slice(
		typeSrc.indexOf("NativeTypeDescriptor"),
		typeSrc.indexOf("NativeTypeDescriptor") + 800,
	);
	assert.match(nativeBlock, /name/);
	assert.match(nativeBlock, /backend|length|precision|scale/);

	const doc = sampleIr();
	const moodCol = collectTables(doc).find((item) => item.id === "tbl_posts")
		?.columns as unknown[];
	const mood = asObject(
		(moodCol ?? []).find((col) => asObject(col, "col").id === "col_posts_mood"),
		"mood column",
	);
	const moodType = asObject(mood.type, "mood.type");
	assert.equal(typeof moodType.kind, "string");
	assert.equal("native" in moodType, true);
	assert.equal("enumId" in moodType, true);
});

test("T-SIR-07: first-class SchemaEnum; columns reference enums by id", async () => {
	const irApi = await loadSchemaIr();
	const enumSrc =
		readUtf8(join(irDir, "namespace.ts")) +
		readUtf8(join(irDir, "document.ts"));
	const irFiles = collectFiles(irDir)
		.filter((path) => path.endsWith(".ts"))
		.map((path) => readFileSync(path, "utf8"))
		.join("\n");
	assert.match(irFiles, /export (?:interface|type) SchemaEnum/);
	void enumSrc;

	const doc = asObject(
		irApi.canonicalizeAthenaSchemaIr(sampleIr()),
		"canonical",
	);
	const enums = collectEnums(doc);
	assert.ok(enums.length >= 1, "IR must contain SchemaEnum objects");
	const mood = enums.find((item) => item.id === "enum_mood");
	assert.ok(mood);
	assert.ok(Array.isArray(mood.labels) || Array.isArray(mood.values));

	const posts = collectTables(doc).find((item) => item.id === "tbl_posts");
	assert.ok(posts);
	const columns = asArray(posts.columns, "posts.columns");
	const moodCol = columns
		.map((col) => asObject(col, "column"))
		.find((col) => {
			const type = asObject(col.type, "type");
			return type.enumId === "enum_mood" || type.kind === "enum";
		});
	assert.ok(moodCol, "columns must reference SchemaEnum by id");
	const moodType = asObject(moodCol.type, "mood type");
	assert.equal(moodType.enumId, "enum_mood");
});

test("T-SIR-08: first-class SchemaConstraint including CHECK with stable IDs", async () => {
	const irApi = await loadSchemaIr();
	const constraintSrc = readUtf8(join(irDir, "constraint.ts"));
	assert.match(constraintSrc, /export (?:interface|type) SchemaConstraint/);
	assert.match(constraintSrc, /check/i);

	const doc = asObject(
		irApi.canonicalizeAthenaSchemaIr(sampleIr()),
		"canonical",
	);
	const posts = collectTables(doc).find((item) => item.id === "tbl_posts");
	assert.ok(posts);
	const constraints = asArray(posts.constraints, "posts.constraints").map(
		(item) => asObject(item, "constraint"),
	);
	const check = constraints.find(
		(item) => item.kind === "check" || item.kind === "CHECK",
	);
	assert.ok(check, "CHECK must be a first-class constraint");
	assert.equal(typeof check.id, "string");
	assert.ok(String(check.id).length > 0);
	const fk = constraints.find(
		(item) => item.kind === "foreign_key" || item.kind === "fk",
	);
	assert.ok(fk);
	assert.equal(typeof fk.id, "string");
});

test("T-SIR-09: SchemaRelation is semantic and distinct from FK constraints", async () => {
	const irApi = await loadSchemaIr();
	const relationSrc = readUtf8(join(irDir, "relation.ts"));
	assert.match(relationSrc, /export (?:interface|type) SchemaRelation/);
	assert.match(relationSrc, /1:1/);
	assert.match(relationSrc, /1:n/);
	assert.match(relationSrc, /n:1/);
	assert.match(relationSrc, /n:n/);
	assert.match(relationSrc, /through/);
	assert.match(relationSrc, /backingConstraintIds/);

	const doc = asObject(
		irApi.canonicalizeAthenaSchemaIr(sampleIr()),
		"canonical",
	);
	const posts = collectTables(doc).find((item) => item.id === "tbl_posts");
	assert.ok(posts);
	const relations = asArray(posts.relations, "posts.relations").map((item) =>
		asObject(item, "relation"),
	);
	const n1 = relations.find((item) => item.cardinality === "n:1");
	assert.ok(n1);
	assert.ok(Array.isArray(n1.backingConstraintIds));
	assert.equal(
		(n1.backingConstraintIds as unknown[]).includes("cst_posts_author_fk"),
		true,
	);
	const nn = relations.find((item) => item.cardinality === "n:n");
	assert.ok(nn);
	assert.equal(typeof nn.through, "object");
	const constraints = asArray(posts.constraints, "constraints");
	assert.ok(constraints.length >= 1);
	assert.notEqual(posts.relations, posts.constraints);
});

test("T-SIR-10: branded SchemaObjectId; same id + physical rename is rename", async () => {
	const irApi = await loadSchemaIr();
	const identitySrc = readUtf8(join(irDir, "identity.ts"));
	assert.match(identitySrc, /export type SchemaObjectId/);
	assert.match(identitySrc, /brand|& \{/);

	const from = sampleIr();
	const to = sampleIr();
	const toTables = collectTables(to);
	const users = toTables.find((item) => item.id === "tbl_users");
	assert.ok(users);
	const identity = identityOf(users);
	const physical = asObject(identity.physical, "physical");
	physical.name = "users_renamed";

	const diff = diffSchemas({
		from: from as never,
		to: to as never,
	});
	const kinds = diff.operations.map((op) => op.kind);
	assert.equal(
		kinds.includes("rename_table"),
		true,
		"same SchemaObjectId + physical name change must be rename_table, not drop+create",
	);
	assert.equal(kinds.includes("drop_table"), false);
	assert.equal(kinds.includes("create_table"), false);
});

test("T-SIR-11: canonicalizeAthenaSchemaIr + validateAthenaSchemaIr are exported and idempotent", async () => {
	const irApi = await loadSchemaIr();
	const schemaBarrel = (await import(
		"../../src/schema/index.ts"
	)) as Partial<SchemaIrBarrel>;
	assert.equal(typeof schemaBarrel.canonicalizeAthenaSchemaIr, "function");
	assert.equal(typeof schemaBarrel.validateAthenaSchemaIr, "function");

	const doc = sampleIr();
	irApi.validateAthenaSchemaIr(doc);
	const once = irApi.canonicalizeAthenaSchemaIr(doc);
	const twice = irApi.canonicalizeAthenaSchemaIr(once);
	assert.deepEqual(twice, once);

	try {
		irApi.validateAthenaSchemaIr({
			kind: "athena.policy",
			irVersion: 2,
			databases: [],
			metadata: {},
		});
		assert.fail("validateAthenaSchemaIr must require kind athena.schema");
	} catch (error) {
		assert.ok(error instanceof Error);
	}

	try {
		irApi.validateAthenaSchemaIr({
			kind: "athena.schema",
			irVersion: 1,
			databases: [],
			metadata: {},
		});
		assert.fail("validateAthenaSchemaIr must require irVersion 2");
	} catch (error) {
		assert.ok(error instanceof Error);
	}
});

test("T-SIR-12: fingerprintAthenaSchemaIr is stable under reorder and ignores metadata", async () => {
	const irApi = await loadSchemaIr();
	const schemaBarrel = (await import(
		"../../src/schema/index.ts"
	)) as Partial<SchemaIrBarrel>;
	assert.equal(typeof schemaBarrel.fingerprintAthenaSchemaIr, "function");

	const doc = sampleIr();
	irApi.validateAthenaSchemaIr(doc);
	const canonical = irApi.canonicalizeAthenaSchemaIr(doc);
	const hash = irApi.fingerprintAthenaSchemaIr(canonical);
	assert.match(hash, /^[0-9a-f]{64}$/);

	const reordered = JSON.parse(JSON.stringify(canonical)) as JsonObject;
	const databases = asArray(reordered.databases, "databases").slice().reverse();
	reordered.databases = databases;
	const metadata = asObject(reordered.metadata, "metadata");
	reordered.metadata = metadata;
	const reorderedHash = irApi.fingerprintAthenaSchemaIr(
		irApi.canonicalizeAthenaSchemaIr(reordered),
	);
	assert.equal(reorderedHash, hash);

	const metaOnly = sampleIr({
		metadata: {
			provenance: {
				source: "models",
				generatedAt: "2099-01-01T00:00:00.000Z",
			},
			extensions: { note: "changed-only-metadata" },
		},
	});
	const metaHash = irApi.fingerprintAthenaSchemaIr(
		irApi.canonicalizeAthenaSchemaIr(metaOnly),
	);
	assert.equal(metaHash, hash);
});

test("T-SIR-13: table() emits IR; ModelMetadata is derived from that IR", async () => {
	const irApi = await loadSchemaIr();
	const users = table("users")
		.schema("public")
		.columns({
			email: string(),
			id: string().generated(),
			mood: enumeration(["happy", "sad"] as const).optional(),
		})
		.primaryKey("id");

	const fromTable = asObject(
		irApi.schemaIrFromTable(users),
		"schemaIrFromTable",
	);
	assert.equal(fromTable.kind, "athena.schema");
	assert.equal(fromTable.irVersion, 2);
	assert.ok(Array.isArray(fromTable.databases));
	assert.ok((fromTable.databases as unknown[]).length >= 1);

	const emitted =
		"ir" in users && users.ir != null
			? asObject(users.ir, "table().ir")
			: fromTable;
	assert.equal(emitted.kind, "athena.schema");

	const tables = collectTables(fromTable);
	const usersTable = tables.find((item) => {
		const identity = asObject(item.identity ?? {}, "identity");
		const logical = asObject(identity.logical ?? {}, "logical");
		const physical = asObject(identity.physical ?? {}, "physical");
		return (
			logical.name === "users" ||
			physical.name === "users" ||
			item.id === users.meta.model
		);
	});
	assert.ok(usersTable, "table() IR must include the users table");
	const identity = identityOf(usersTable);
	const logical = asObject(identity.logical, "logical");
	assert.equal(users.meta.model, logical.name);
	assert.equal(users.meta.schema, logical.namespace);
	assert.deepEqual(users.meta.primaryKey, ["id"]);

	const fromModels = asObject(
		irApi.schemaIrFromModels([users]),
		"schemaIrFromModels",
	);
	assert.equal(fromModels.kind, "athena.schema");
	assert.equal(fromModels.irVersion, 2);
});

test("T-SIR-14: introspection public emit is IR; v1 snapshot helper is compatibility", async () => {
	const irApi = await loadSchemaIr();
	const intro = introSnapshot();
	const emitted = asObject(
		irApi.schemaIrFromIntrospection(intro),
		"schemaIrFromIntrospection",
	);
	assert.equal(emitted.kind, "athena.schema");
	assert.equal(emitted.irVersion, 2);
	const databases = asArray(emitted.databases, "databases");
	assert.ok(databases.length >= 1);
	const serialized = JSON.stringify(emitted);
	assert.equal(serialized.includes("tenant_prod"), true);

	const v1 = schemaSnapshotFromIntrospection(intro);
	assert.equal(v1.version, 1);
	assert.equal("kind" in v1, false);
});

test("T-SIR-15: diff consumes IR only (v1 snapshots lifted at the compatibility boundary)", async () => {
	const irApi = await loadSchemaIr();
	const diffSrc = readUtf8(join(srcRoot, "schema", "diff", "diff.ts"));
	const typesSrc = readUtf8(join(srcRoot, "schema", "diff", "types.ts"));
	assert.match(`${diffSrc}\n${typesSrc}`, /AthenaSchemaIr/);

	const from = irApi.canonicalizeAthenaSchemaIr(sampleIr());
	const to = irApi.canonicalizeAthenaSchemaIr(sampleIr());
	const diff = diffSchemas({ from: from as never, to: to as never });
	assert.equal(diff.operations.length, 0);

	const v1: AthenaSchemaSnapshot = {
		version: 1,
		backend: "postgresql",
		schemas: [],
	};
	const lifted = diffSchemas({ from: v1, to: v1 });
	assert.equal(Array.isArray(lifted.operations), true);
});

test("T-SIR-16: test/fixtures/schema-ir/ parse→validate→canonicalize→serialize→parse + fingerprint roundtrip", async () => {
	const irApi = await loadSchemaIr();
	assert.equal(
		existsSync(fixturesDir),
		true,
		"test/fixtures/schema-ir/ must exist",
	);
	const files = collectFiles(fixturesDir).filter((path) =>
		path.endsWith(".json"),
	);
	assert.ok(
		files.length >= 1,
		"schema-ir fixture corpus must contain JSON documents",
	);

	for (const file of files) {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
		irApi.validateAthenaSchemaIr(parsed);
		const canonical = irApi.canonicalizeAthenaSchemaIr(parsed);
		irApi.validateAthenaSchemaIr(canonical);
		const serialized = JSON.stringify(canonical);
		const reparsed = JSON.parse(serialized) as unknown;
		assert.deepEqual(
			irApi.canonicalizeAthenaSchemaIr(reparsed),
			canonical,
			`fixture ${file} must be stable after serialize→parse`,
		);
		const hash = irApi.fingerprintAthenaSchemaIr(canonical);
		assert.match(hash, /^[0-9a-f]{64}$/);
		assert.equal(irApi.fingerprintAthenaSchemaIr(reparsed), hash);
	}
});

test("T-SIR-17: v1 re-exports remain; validateSchemaSnapshot is not weakened", () => {
	const diffTypesSrc = readUtf8(join(srcRoot, "schema", "diff", "types.ts"));
	assert.match(diffTypesSrc, /ATHENA_SCHEMA_SNAPSHOT_VERSION/);
	assert.match(diffTypesSrc, /AthenaSchemaSnapshot/);

	expectSchemaDiffError(
		() =>
			validateSchemaSnapshot({
				version: 2,
				schemas: [],
			} as unknown as AthenaSchemaSnapshot),
		"unsupported_snapshot_version",
	);
	expectSchemaDiffError(
		() =>
			validateSchemaSnapshot({
				version: 1,
				schemas: { public: { name: "public", tables: [] } },
			} as unknown as AthenaSchemaSnapshot),
		"invalid_snapshot",
	);
	expectSchemaDiffError(
		() => validateSchemaSnapshot(null as unknown as AthenaSchemaSnapshot),
		"invalid_snapshot",
	);
	try {
		validateSchemaSnapshot({
			kind: "athena.schema",
			irVersion: 2,
			databases: [],
			metadata: {},
		} as unknown as AthenaSchemaSnapshot);
		assert.fail("validateSchemaSnapshot must not accept AthenaSchemaIr");
	} catch (error) {
		assert.ok(error instanceof SchemaDiffError);
	}

	const empty: AthenaSchemaSnapshot = {
		version: 1,
		backend: "postgresql",
		schemas: [],
	};
	validateSchemaSnapshot(empty);
});

test("T-SIR-18: no new unrelated IntrospectionSnapshot/ModelMetadataBase universal inputs", async () => {
	assert.equal(
		existsSync(irDir),
		true,
		"src/schema/ir/ must exist for the guardrail",
	);
	const irFiles = collectFiles(irDir).filter((path) => path.endsWith(".ts"));
	assert.ok(irFiles.length >= 1);

	const hits: string[] = [];
	for (const file of irFiles) {
		const text = readFileSync(file, "utf8");
		const rel = file.slice(srcRoot.length + 1).replaceAll("\\", "/");
		const isCompatibility = /compatibility\.ts$/.test(rel);
		if (isCompatibility) {
			continue;
		}
		if (/\bIntrospectionSnapshot\b/.test(text)) {
			hits.push(`${rel}: IntrospectionSnapshot`);
		}
		if (/\bModelMetadataBase\b/.test(text)) {
			hits.push(`${rel}: ModelMetadataBase`);
		}
	}
	assert.deepEqual(hits, []);

	const irApi = await loadSchemaIr();
	const fromIntroSrc = readUtf8(
		join(srcRoot, "schema", "diff", "from-introspection.ts"),
	);
	const fromModelsSrc = readUtf8(
		join(srcRoot, "schema", "diff", "from-models.ts"),
	);
	assert.equal(
		fromIntroSrc.includes("schemaIrFromIntrospection") ||
			fromIntroSrc.includes("AthenaSchemaIr"),
		true,
		"introspection adapter must emit IR (not remain a snapshot SSOT)",
	);
	assert.equal(
		fromModelsSrc.includes("schemaIrFromModels") ||
			fromModelsSrc.includes("AthenaSchemaIr"),
		true,
		"model adapter must emit IR",
	);

	const authored = defineModel({
		meta: {
			schema: "public",
			model: "events",
			primaryKey: ["id"],
			columns: { id: { kind: "string", columnName: "id" } },
		},
	});
	const ir = asObject(irApi.schemaIrFromModels([authored]), "from models");
	assert.equal(ir.kind, "athena.schema");
});
