import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { createPostgresIntrospectionProvider } from "../src/index.ts";

type QueryResultRow = Record<string, unknown>;

function createMockQueryImplementation() {
	return async (sqlText: string) => {
		if (sqlText.includes("FROM pg_attribute")) {
			const rows: QueryResultRow[] = [
				{
					array_dimensions: 0,
					column_name: "id",
					data_type: "uuid",
					has_default: false,
					is_generated: false,
					is_nullable: false,
					schema_name: "public",
					table_name: "users",
					type_kind_code: "b",
					type_oid: 1,
					udt_name: "uuid",
				},
				{
					array_dimensions: 0,
					column_name: "email",
					data_type: "text",
					has_default: false,
					is_generated: false,
					is_nullable: false,
					schema_name: "public",
					table_name: "users",
					type_kind_code: "b",
					type_oid: 2,
					udt_name: "text",
				},
				{
					array_dimensions: 0,
					column_name: "user_id",
					data_type: "uuid",
					has_default: false,
					is_generated: false,
					is_nullable: false,
					schema_name: "public",
					table_name: "profiles",
					type_kind_code: "b",
					type_oid: 1,
					udt_name: "uuid",
				},
				{
					array_dimensions: 0,
					column_name: "id",
					data_type: "bigint",
					has_default: true,
					is_generated: false,
					is_nullable: false,
					schema_name: "public",
					table_name: "projects",
					type_kind_code: "b",
					type_oid: 3,
					udt_name: "int8",
				},
				{
					array_dimensions: 0,
					column_name: "owner_id",
					data_type: "uuid",
					has_default: false,
					is_generated: false,
					is_nullable: false,
					schema_name: "public",
					table_name: "projects",
					type_kind_code: "b",
					type_oid: 1,
					udt_name: "uuid",
				},
				{
					array_dimensions: 0,
					column_name: "id",
					data_type: "bigint",
					has_default: true,
					is_generated: false,
					is_nullable: false,
					schema_name: "public",
					table_name: "tags",
					type_kind_code: "b",
					type_oid: 3,
					udt_name: "int8",
				},
				{
					array_dimensions: 0,
					column_name: "project_id",
					data_type: "bigint",
					has_default: false,
					is_generated: false,
					is_nullable: false,
					schema_name: "public",
					table_name: "project_tags",
					type_kind_code: "b",
					type_oid: 3,
					udt_name: "int8",
				},
				{
					array_dimensions: 0,
					column_name: "tag_id",
					data_type: "bigint",
					has_default: false,
					is_generated: false,
					is_nullable: false,
					schema_name: "public",
					table_name: "project_tags",
					type_kind_code: "b",
					type_oid: 3,
					udt_name: "int8",
				},
				{
					array_dimensions: 0,
					column_name: "mood",
					data_type: "public.mood",
					has_default: false,
					is_generated: false,
					is_nullable: true,
					schema_name: "public",
					table_name: "type_lab",
					type_kind_code: "e",
					type_oid: 9000,
					udt_name: "mood",
				},
				{
					array_dimensions: 0,
					column_name: "id",
					data_type: "bigint",
					has_default: true,
					is_generated: false,
					is_nullable: false,
					schema_name: "analytics",
					table_name: "users",
					type_kind_code: "b",
					type_oid: 3,
					udt_name: "int8",
				},
			];
			return { rows };
		}

		if (
			sqlText.includes("FROM pg_type t") &&
			sqlText.includes("JOIN pg_enum")
		) {
			return {
				rows: [
					{ enum_label: "happy", type_oid: 9000 },
					{ enum_label: "sad", type_oid: 9000 },
				],
			};
		}

		if (sqlText.includes("WHERE con.contype = 'p'")) {
			return {
				rows: [
					{ columns: ["id"], schema_name: "public", table_name: "users" },
					{
						columns: ["user_id"],
						schema_name: "public",
						table_name: "profiles",
					},
					{ columns: ["id"], schema_name: "public", table_name: "projects" },
					{ columns: ["id"], schema_name: "public", table_name: "tags" },
					{
						columns: ["project_id", "tag_id"],
						schema_name: "public",
						table_name: "project_tags",
					},
					{ columns: ["id"], schema_name: "analytics", table_name: "users" },
				],
			};
		}

		if (sqlText.includes("WHERE con.contype = 'f'")) {
			return {
				rows: [
					{
						constraint_name: "profile_user_fk",
						source_columns: ["user_id"],
						source_is_unique: true,
						source_schema: "public",
						source_table: "profiles",
						target_columns: ["id"],
						target_schema: "public",
						target_table: "users",
					},
					{
						constraint_name: "owner",
						source_columns: ["owner_id"],
						source_is_unique: false,
						source_schema: "public",
						source_table: "projects",
						target_columns: ["id"],
						target_schema: "public",
						target_table: "users",
					},
					{
						constraint_name: "project_fk",
						source_columns: ["project_id"],
						source_is_unique: false,
						source_schema: "public",
						source_table: "project_tags",
						target_columns: ["id"],
						target_schema: "public",
						target_table: "projects",
					},
					{
						constraint_name: "tag_fk",
						source_columns: ["tag_id"],
						source_is_unique: false,
						source_schema: "public",
						source_table: "project_tags",
						target_columns: ["id"],
						target_schema: "public",
						target_table: "tags",
					},
				],
			};
		}

		if (sqlText.includes("con.contype = 'u'")) {
			return {
				rows: [
					{
						columns: ["email"],
						constraint_name: "users_email_key",
						schema_name: "public",
						table_name: "users",
					},
				],
			};
		}

		if (sqlText.includes("FROM pg_index")) {
			return {
				rows: [
					{
						columns: ["owner_id"],
						index_name: "projects_owner_id_idx",
						is_unique: false,
						method: "btree",
						predicate: null,
						schema_name: "public",
						table_name: "projects",
					},
				],
			};
		}

		throw new Error(
			`Unexpected SQL in mock introspection: ${sqlText.slice(0, 80)}...`,
		);
	};
}

test("postgres introspection provider assembles relations and enum metadata from catalog rows", async () => {
	const originalQuery = Pool.prototype.query;
	const originalEnd = Pool.prototype.end;
	(Pool.prototype.query as unknown as (
		sql: string,
	) => Promise<{ rows: QueryResultRow[] }>) = createMockQueryImplementation();
	(Pool.prototype.end as unknown as () => Promise<void>) = async () =>
		undefined;

	try {
		const provider = createPostgresIntrospectionProvider({
			connectionString: "postgres://unused",
			database: "athena_js",
		});
		const snapshot = await provider.inspect({
			schemas: ["public", "analytics"],
		});

		assert.equal(snapshot.backend, "postgresql");
		assert.equal(snapshot.database, "athena_js");
		assert.ok(snapshot.generatedAt.length > 0);

		const publicSchema = snapshot.schemas.public;
		assert.ok(publicSchema);

		const users = publicSchema.tables.users;
		assert.deepEqual(users.primaryKey, ["id"]);
		assert.equal(users.relations.projects.kind, "one-to-many");
		assert.equal(users.relations.profiles.kind, "one-to-one");

		const projects = publicSchema.tables.projects;
		const ownerRelation = Object.values(projects.relations).find(
			(relation) =>
				relation.targetModel === "users" && relation.kind === "many-to-one",
		);
		assert.ok(ownerRelation);
		assert.equal(ownerRelation.kind, "many-to-one");

		const tagsRelation = projects.relations.tags;
		assert.equal(tagsRelation.kind, "many-to-many");
		assert.equal(tagsRelation.through?.model, "project_tags");

		const tags = publicSchema.tables.tags;
		assert.equal(tags.relations.projects.kind, "many-to-many");

		const typeLab = publicSchema.tables.type_lab;
		assert.equal(typeLab.columns.mood.typeKind, "enum");
		assert.deepEqual(typeLab.columns.mood.enumValues, ["happy", "sad"]);

		const analyticsUsers = snapshot.schemas.analytics.tables.users;
		assert.deepEqual(analyticsUsers.primaryKey, ["id"]);
	} finally {
		Pool.prototype.query = originalQuery;
		Pool.prototype.end = originalEnd;
	}
});
