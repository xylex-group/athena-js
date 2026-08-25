/**
 * PR #696 review-comment regressions. Each title is `P?: <exact subject>`.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { emitAuthEmail } from "../../src/auth/email/emit.ts";
import { validateAttachmentTarget } from "../../src/auth/email/attachments.ts";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { handleAdminRoute } from "../../src/auth/local/admin-routes.ts";
import { handleAdminEmailRoutes } from "../../src/auth/local/email/routes.ts";
import { MemoryAuthEmailStore } from "../../src/auth/local/email/store.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import type { AuthSessionRow, AuthUserRow } from "../../src/auth/local/models.ts";
import { createMemoryAuthMutationTransaction } from "../../src/auth/local/mutation-transaction.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { assertAthenaEmailProviderRuntime } from "../../src/email/capabilities.ts";
import { createEmailDeliveryPort } from "../../src/email/delivery-port.ts";
import {
	ATHENA_EMAIL_DELIVERY_FAILED,
	ATHENA_EMAIL_MESSAGE_INVALID,
	ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME,
	AthenaEmailError,
} from "../../src/email/errors.ts";
import { createEmailModule } from "../../src/email/module.ts";
import { defineAthenaEmailProvider } from "../../src/email/provider.ts";
import { consoleEmailProvider } from "../../src/email/providers/console.ts";
import { httpEmailProvider } from "../../src/email/providers/http.ts";
import { resend } from "../../src/email/providers/resend.ts";
import type {
	AthenaEmailDeliveryPort,
	AthenaResolvedEmailMessage,
} from "../../src/email/types.ts";
import { buildSmtpMime } from "../../src/email-node/mime.ts";
import { createMemorySmtpTransport, smtp } from "../../src/email-node/smtp.ts";
import {
	type AthenaSmtpReply,
	type AthenaSmtpTransport,
	createNodeSmtpTransport,
} from "../../src/email-node/transport.ts";
import { modelIdentity } from "../../src/query/model-identity.ts";
import { defineModel } from "../../src/schema/definitions.ts";
import { diffSchemas, schemaSnapshotFromIntrospection } from "../../src/schema/diff/index.ts";
import { normalizeSchemaSnapshot } from "../../src/schema/diff/normalize.ts";
import { ATHENA_SCHEMA_SNAPSHOT_VERSION } from "../../src/schema/diff/types.ts";
import { string, table } from "../../src/schema/index.ts";
import {
	ATHENA_SCHEMA_IR_KIND,
	ATHENA_SCHEMA_IR_VERSION,
	type AthenaSchemaIr,
	asSchemaObjectId,
	canonicalizeAthenaSchemaIr,
	fingerprintAthenaSchemaIr,
	schemaIrFromIntrospection,
	schemaIrFromModels,
	schemaIrFromSnapshot,
	schemaSnapshotFromIr,
	validateAthenaSchemaIr,
} from "../../src/schema/ir/index.ts";
import type { IntrospectionSnapshot } from "../../src/schema/types.ts";

const identity = (database: string, namespace: string, name: string) => ({
	logical: { database, namespace, name },
	physical: { database, namespace, name },
});

function schemaIrFixture(value: object): AthenaSchemaIr {
	return value as unknown as AthenaSchemaIr;
}

function schemaId(id: string) {
	return asSchemaObjectId(id);
}

const scalarUuid = {
	kind: "scalar" as const,
	semantic: "uuid",
	native: {
		backend: "postgresql",
		name: "uuid",
		arrayDimensions: 0,
	},
};

function authoredEvents(tableName: string, database = "default") {
	return defineModel<{ id: string }>({
		meta: {
			database,
			schema: "public",
			model: "events",
			tableName,
			primaryKey: ["id"],
			columns: { id: { kind: "string", columnName: "id" } },
		},
	});
}

test("P1: Reject malformed nested IR objects", () => {
	const malformed = {
		kind: "athena.schema",
		irVersion: 2,
		databases: [
			{
				id: "db_app",
				identity: identity("appdb", "public", "appdb"),
				namespaces: [
					{
						id: "ns_public",
						identity: identity("appdb", "public", "public"),
						tables: [{}],
					},
				],
			},
		],
		metadata: {},
	};

	assert.throws(
		() => validateAthenaSchemaIr(malformed),
		/SchemaTable|identity|id/,
		"empty nested table objects must fail closed instead of becoming AthenaSchemaIr",
	);

	const malformedColumns = {
		kind: "athena.schema",
		irVersion: 2,
		databases: [
			{
				id: "db_app",
				identity: identity("appdb", "public", "appdb"),
				namespaces: [
					{
						id: "ns_public",
						identity: identity("appdb", "public", "public"),
						tables: [
							{
								id: "tbl_users",
								identity: identity("appdb", "public", "users"),
								columns: [{}],
								constraints: [],
								relations: [],
								indexes: [],
							},
						],
					},
				],
			},
		],
		metadata: {},
	};

	assert.throws(
		() => validateAthenaSchemaIr(malformedColumns),
		/SchemaColumn|identity|id/,
		"malformed nested columns must fail closed",
	);
});

test("P1: Emit column renames when stable IDs match", () => {
	const emailColumn = (physicalName: string) => ({
		id: schemaId("col_users_email"),
		identity: {
			logical: { database: "appdb", namespace: "public", name: "email" },
			physical: {
				database: "appdb",
				namespace: "public",
				name: physicalName,
			},
		},
		type: scalarUuid,
		nullable: false,
	});
	const doc = (physicalName: string) =>
		schemaIrFixture({
			kind: ATHENA_SCHEMA_IR_KIND,
			irVersion: ATHENA_SCHEMA_IR_VERSION,
			databases: [
				{
					id: schemaId("db_app"),
					identity: identity("appdb", "public", "appdb"),
					namespaces: [
						{
							id: schemaId("ns_public"),
							identity: identity("appdb", "public", "public"),
							tables: [
								{
									id: schemaId("tbl_users"),
									identity: identity("appdb", "public", "users"),
									columns: [emailColumn(physicalName)],
									constraints: [],
									relations: [],
									indexes: [],
								},
							],
						},
					],
				},
			],
			metadata: {},
		});
	const from = doc("email");
	const to = doc("email_address");

	const diff = diffSchemas({
		from: schemaIrFixture(from),
		to: schemaIrFixture(to),
	});
	const kinds = diff.operations.map((op) => op.kind);
	assert.equal(
		kinds.includes("rename_column"),
		true,
		"same SchemaObjectId + physical column name change must be rename_column",
	);
	assert.equal(kinds.includes("drop_column"), false);
	assert.equal(kinds.includes("add_column"), false);
	const rename = diff.operations.find((op) => op.kind === "rename_column");
	assert.ok(rename && rename.kind === "rename_column");
	assert.equal(rename.from, "email");
	assert.equal(rename.to, "email_address");
});

test("P1: Derive authored table IDs from logical identity", () => {
	const fromIr = schemaIrFromModels([authoredEvents("evt")]);
	const toIr = schemaIrFromModels([authoredEvents("events")]);

	const fromTable = fromIr.databases[0]?.namespaces[0]?.tables[0];
	const toTable = toIr.databases[0]?.namespaces[0]?.tables[0];
	assert.ok(fromTable);
	assert.ok(toTable);
	assert.equal(
		String(fromTable.id),
		String(toTable.id),
		"authored table SchemaObjectId must stay on logical model name across physical tableName changes",
	);
	assert.equal(fromTable.identity.logical.name, "events");
	assert.equal(fromTable.identity.physical.name, "evt");
	assert.equal(toTable.identity.physical.name, "events");

	const diff = diffSchemas({ from: fromIr, to: toIr });
	const kinds = diff.operations.map((op) => op.kind);
	assert.equal(
		kinds.includes("rename_table"),
		true,
		"same logical table id + physical tableName change must be rename_table, not drop+create",
	);
	assert.equal(kinds.includes("drop_table"), false);
	assert.equal(kinds.includes("create_table"), false);
});

test("P2: Partition authored models by database", () => {
	const ir = schemaIrFromModels([
		authoredEvents("evt", "analytics"),
		defineModel<{ id: string }>({
			meta: {
				database: "app",
				schema: "public",
				model: "users",
				primaryKey: ["id"],
				columns: { id: { kind: "string", columnName: "id" } },
			},
		}),
	]);

	assert.equal(
		ir.databases.length,
		2,
		"models with distinct meta.database must emit one SchemaDatabase per group",
	);
	const dbIds = ir.databases.map((db) => String(db.id)).sort();
	assert.deepEqual(dbIds, ["db:analytics", "db:app"]);

	const tables = ir.databases.flatMap((db) =>
		db.namespaces.flatMap((ns) =>
			ns.tables.map((table) => ({
				dbId: String(db.id),
				dbPhysical: db.identity.physical.database,
				tableDb: table.identity.physical.database,
				logical: table.identity.logical.name,
			})),
		),
	);
	const events = tables.find((row) => row.logical === "events");
	const users = tables.find((row) => row.logical === "users");
	assert.ok(events);
	assert.ok(users);
	assert.equal(events.dbId, "db:analytics");
	assert.equal(events.dbPhysical, "analytics");
	assert.equal(events.tableDb, "analytics");
	assert.equal(users.dbId, "db:app");
	assert.equal(users.dbPhysical, "app");
	assert.equal(users.tableDb, "app");
});

function introPhysicalEvents(physicalName: string): IntrospectionSnapshot {
	return {
		backend: "postgresql",
		database: "default",
		generatedAt: "2026-01-01T00:00:00.000Z",
		schemas: {
			public: {
				name: "public",
				tables: {
					[physicalName]: {
						name: physicalName,
						schema: "public",
						primaryKey: ["id"],
						relations: {},
						columns: {
							id: {
								name: "id",
								dataType: "text",
								udtName: "text",
								arrayDimensions: 0,
								hasDefault: false,
								isGenerated: false,
								isNullable: false,
								isPrimaryKey: true,
								typeKind: "scalar",
							},
						},
					},
				},
			},
		},
	};
}

function enumStatusModel(model: string) {
	return defineModel<{ id: string; status: string }>({
		meta: {
			schema: "public",
			model,
			primaryKey: ["id"],
			columns: {
				id: { kind: "string", columnName: "id" },
				status: {
					kind: "enumeration",
					columnName: "status",
					enumValues: ["open", "closed"],
				},
			},
		},
	});
}

test("P1: Reconcile physical tables before dropping unmatched IDs", () => {
	const from = schemaIrFromIntrospection(introPhysicalEvents("evt"));
	const to = schemaIrFromModels([authoredEvents("evt")]);
	const fromId = String(from.databases[0]?.namespaces[0]?.tables[0]?.id);
	const toId = String(to.databases[0]?.namespaces[0]?.tables[0]?.id);
	assert.notEqual(
		fromId,
		toId,
		"found case: introspection tbl:….evt vs authored tbl:….events",
	);

	const diff = diffSchemas({
		from: schemaIrFixture(from),
		to: schemaIrFixture(to),
	});
	const kinds = diff.operations.map((op) => op.kind);
	assert.equal(
		kinds.includes("drop_table"),
		false,
		"physical evt must not be dropped when the desired model maps to the same table",
	);
	assert.equal(
		kinds.includes("create_table"),
		false,
		"physical evt must not be recreated when it already exists",
	);
});

test("P1: Scope authored enum IDs to their tables", () => {
	const ir = schemaIrFromModels([
		enumStatusModel("orders"),
		enumStatusModel("tickets"),
	]);
	assert.doesNotThrow(() => validateAthenaSchemaIr(ir));
	const enums = ir.databases.flatMap((db) =>
		db.namespaces.flatMap((ns) => ns.enums ?? []),
	);
	const ids = enums.map((item) => String(item.id));
	assert.equal(ids.length, 2);
	assert.equal(
		new Set(ids).size,
		2,
		"status enums on distinct tables must not share enum:public.status",
	);
});

test("P2: Scope stable object IDs by database", () => {
	const ir = schemaIrFromModels([
		authoredEvents("events", "analytics"),
		authoredEvents("events", "app"),
	]);
	assert.doesNotThrow(() => validateAthenaSchemaIr(ir));
	const tables = ir.databases.flatMap((db) =>
		db.namespaces.flatMap((ns) => ns.tables),
	);
	assert.equal(tables.length, 2);
	const ids = tables.map((table) => String(table.id));
	assert.equal(
		new Set(ids).size,
		2,
		"same logical public.events in two databases must not share tbl:public.events",
	);
	assert.ok(ids.some((id) => id.includes("analytics")));
	assert.ok(ids.some((id) => id.includes("app")));
});

test("P2: Disambiguate foreign keys that share source columns", () => {
	const orgs = defineModel<{ id: string }>({
		meta: {
			schema: "public",
			model: "orgs",
			primaryKey: ["id"],
			columns: { id: { kind: "string", columnName: "id" } },
		},
	});
	const teams = defineModel<{ id: string }>({
		meta: {
			schema: "public",
			model: "teams",
			primaryKey: ["id"],
			columns: { id: { kind: "string", columnName: "id" } },
		},
	});
	const memberships = defineModel<{ id: string; owner_id: string }>({
		meta: {
			schema: "public",
			model: "memberships",
			primaryKey: ["id"],
			columns: {
				id: { kind: "string", columnName: "id" },
				owner_id: { kind: "string", columnName: "owner_id" },
			},
			relations: {
				org: {
					kind: "many-to-one",
					sourceColumns: ["owner_id"],
					targetColumns: ["id"],
					targetSchema: "public",
					targetModel: "orgs",
				},
				team: {
					kind: "many-to-one",
					sourceColumns: ["owner_id"],
					targetColumns: ["id"],
					targetSchema: "public",
					targetModel: "teams",
				},
			},
		},
	});

	const ir = schemaIrFromModels([orgs, teams, memberships]);
	assert.doesNotThrow(() => validateAthenaSchemaIr(ir));
	const table = ir.databases
		.flatMap((db) => db.namespaces.flatMap((ns) => ns.tables))
		.find((item) => item.identity.logical.name === "memberships");
	assert.ok(table);
	const fks = table.constraints.filter((c) => c.kind === "foreign_key");
	assert.equal(fks.length, 2);
	assert.equal(
		new Set(fks.map((fk) => String(fk.id))).size,
		2,
		"two FKs sharing owner_id must not share cst:…:fk:owner_id",
	);
});

test("P2: Include empty namespaces in schema operations", () => {
	const from = schemaIrFixture({
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: [
			{
				id: schemaId("db_app"),
				identity: identity("appdb", "public", "appdb"),
				namespaces: [
					{
						id: schemaId("ns_public"),
						identity: identity("appdb", "public", "public"),
						tables: [],
					},
				],
			},
		],
		metadata: {},
	});
	const to = schemaIrFixture({
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: [
			{
				id: schemaId("db_app"),
				identity: identity("appdb", "public", "appdb"),
				namespaces: [
					{
						id: schemaId("ns_public"),
						identity: identity("appdb", "public", "public"),
						tables: [],
					},
					{
						id: schemaId("ns_analytics"),
						identity: identity("appdb", "analytics", "analytics"),
						tables: [],
					},
				],
			},
		],
		metadata: {},
	});

	const diff = diffSchemas({ from, to });
	const created = diff.operations.filter((op) => op.kind === "create_schema");
	assert.equal(
		created.some(
			(op) => op.kind === "create_schema" && op.schema === "analytics",
		),
		true,
		"empty desired namespace must emit create_schema",
	);

	const reverse = diffSchemas({ from: to, to: from });
	assert.equal(
		reverse.operations.some(
			(op) => op.kind === "drop_schema" && op.schema === "analytics",
		),
		true,
		"empty actual namespace must emit drop_schema",
	);
});

test("P2: Trigger integrity checks for lockfile-only changes", () => {
	const workflowPath = join(
		dirname(fileURLToPath(import.meta.url)),
		"../../../../.github/workflows/repository-integrity.yml",
	);
	const yaml = readFileSync(workflowPath, "utf8");
	const prBlock =
		yaml.split("pull_request:")[1]?.split("workflow_dispatch:")[0] ?? "";
	for (const lockfile of [
		"Cargo.lock",
		"pnpm-lock.yaml",
		"bun.lock",
		"package-lock.json",
	]) {
		assert.match(
			prBlock,
			new RegExp(`\\*\\*/${lockfile.replaceAll(".", "\\.")}`),
			`pull_request paths must include nested ${lockfile}`,
		);
	}
});

const mappedUsers = table("users")
	.columns({
		userId: string().from("user_id"),
	})
	.primaryKey("userId");

test("P1: Preserve logical IDs for mapped columns", () => {
	const ir = schemaIrFromModels([mappedUsers]);
	const col = ir.databases[0]?.namespaces[0]?.tables[0]?.columns[0];
	assert.ok(col);
	assert.equal(
		String(col.id),
		"col:default.public.users.userId",
		'found case: table("users").columns({ userId: string().from("user_id") }) must keep userId in the column SchemaObjectId',
	);
	assert.equal(col.identity.logical.name, "userId");
	assert.equal(col.identity.physical.name, "user_id");

	const from = schemaIrFromModels([mappedUsers]);
	const toUsers = table("users")
		.columns({
			userId: string().from("user_uuid"),
		})
		.primaryKey("userId");
	const to = schemaIrFromModels([toUsers]);
	const kinds = diffSchemas({
		from: schemaIrFixture(from),
		to: schemaIrFixture(to),
	}).operations.map((op) => op.kind);
	assert.equal(kinds.includes("rename_column"), true);
	assert.equal(kinds.includes("drop_column"), false);
	assert.equal(kinds.includes("add_column"), false);
});

test("P1: Map primary-key columns to physical names", () => {
	const ir = schemaIrFromModels([mappedUsers]);
	const tbl = ir.databases[0]?.namespaces[0]?.tables[0];
	assert.ok(tbl);
	const pk = tbl.constraints.find((c) => c.kind === "primary_key");
	assert.ok(pk && pk.kind === "primary_key");
	assert.deepEqual(
		pk.columns,
		["user_id"],
		"found case: logical PK userId mapped to user_id must not leave userId on the constraint",
	);
	assert.equal(
		tbl.columns.some((c) => c.identity.physical.name === "user_id"),
		true,
	);

	const snapshot = schemaSnapshotFromIr(ir);
	const v1 = snapshot.schemas[0]?.tables[0];
	assert.ok(v1);
	assert.deepEqual(v1.primaryKey?.columns, ["user_id"]);
	assert.equal(
		v1.columns.some((c) => c.name === "user_id"),
		true,
	);
	assert.doesNotThrow(() => diffSchemas({ from: ir, to: ir }));
});

test("P1: Reject unknown constraint kinds", () => {
	const bogus = {
		kind: "athena.schema" as const,
		irVersion: 2 as const,
		databases: [
			{
				id: "db_app",
				identity: identity("appdb", "public", "appdb"),
				namespaces: [
					{
						id: "ns_public",
						identity: identity("appdb", "public", "public"),
						tables: [
							{
								id: "tbl_users",
								identity: identity("appdb", "public", "users"),
								columns: [
									{
										id: "col_users_id",
										identity: identity("appdb", "public", "id"),
										type: scalarUuid,
										nullable: false,
									},
								],
								constraints: [
									{
										id: "cst_bogus",
										kind: "bogus",
										columns: ["id"],
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
		metadata: {},
	};

	assert.throws(
		() => validateAthenaSchemaIr(bogus),
		/kind|bogus|unsupported|primary_key|foreign_key/,
		'found case: kind: "bogus" must fail closed instead of becoming primary_key',
	);
});

test("P1: Retain database scope in diff operations", () => {
	const from = schemaIrFromModels([
		authoredEvents("events", "analytics"),
		authoredEvents("events", "app"),
	]);
	const to = schemaIrFromModels([
		authoredEvents("events", "analytics"),
		authoredEvents("events_v2", "app"),
	]);

	const diff = diffSchemas({
		from: schemaIrFixture(from),
		to: schemaIrFixture(to),
	});
	const rename = diff.operations.find((op) => op.kind === "rename_table");
	assert.ok(rename && rename.kind === "rename_table");
	assert.equal(
		rename.from.database,
		"app",
		"found case: public.events in two databases must keep database on the v1 operation identity",
	);
	assert.equal(rename.to.database, "app");
	assert.equal(rename.from.schema, "public");
	assert.equal(rename.from.name, "events");
	assert.equal(rename.to.name, "events_v2");
});

test("P1: Keep returned ModelDef primary keys logical", () => {
	assert.deepEqual(
		mappedUsers.meta.primaryKey,
		["userId"],
		"found case: mapped PK userId → user_id must stay userId on ModelDef.meta.primaryKey",
	);
	assert.deepEqual(modelIdentity(mappedUsers, { userId: "u-1" }), [
		["userId", "u-1"],
	]);
	const irPk = schemaIrFromModels([
		mappedUsers,
	]).databases[0]?.namespaces[0]?.tables[0]?.constraints.find(
		(c) => c.kind === "primary_key",
	);
	assert.ok(irPk && irPk.kind === "primary_key");
	assert.deepEqual(irPk.columns, ["user_id"]);
});

test("P1: Map authored relation keys to physical columns", () => {
	const parents = defineModel<{ parentId: string }>({
		meta: {
			schema: "public",
			model: "parents",
			primaryKey: ["parentId"],
			columns: { parentId: { kind: "string", columnName: "parent_id" } },
		},
	});
	const children = defineModel<{ childId: string; parentId: string }>({
		meta: {
			schema: "public",
			model: "children",
			primaryKey: ["childId"],
			columns: {
				childId: { kind: "string", columnName: "child_id" },
				parentId: { kind: "string", columnName: "parent_id" },
			},
			relations: {
				parent: {
					kind: "many-to-one",
					sourceColumns: ["parentId"],
					targetColumns: ["parentId"],
					targetModel: "parents",
					targetSchema: "public",
				},
			},
		},
	});

	const ir = schemaIrFromModels([parents, children]);
	const child = ir.databases[0]?.namespaces[0]?.tables.find(
		(item) => item.identity.logical.name === "children",
	);
	assert.ok(child);
	const fk = child.constraints.find((c) => c.kind === "foreign_key");
	assert.ok(fk && fk.kind === "foreign_key");
	assert.deepEqual(
		fk.columns,
		["parent_id"],
		"found case: source parentId mapped to parent_id must not emit FK on parentId",
	);
	assert.deepEqual(fk.targetColumns, ["parent_id"]);
	assert.equal(
		child.columns.some((c) => c.identity.physical.name === "parent_id"),
		true,
	);
	assert.equal(
		child.columns.some((c) => c.identity.physical.name === "parentId"),
		false,
	);
});

test("P1: Preserve the target database through FK normalization", () => {
	const users = (database: string) =>
		defineModel<{ id: string }>({
			meta: {
				database,
				schema: "public",
				model: "users",
				tableName: "users",
				primaryKey: ["id"],
				columns: { id: { kind: "string", columnName: "id" } },
			},
		});
	const orders = (targetDatabase: string) =>
		defineModel<{ id: string; userId: string }>({
			meta: {
				database: "app",
				schema: "public",
				model: "orders",
				tableName: "orders",
				primaryKey: ["id"],
				columns: {
					id: { kind: "string", columnName: "id" },
					userId: { kind: "string", columnName: "user_id" },
				},
				relations: {
					user: {
						kind: "many-to-one",
						sourceColumns: ["userId"],
						targetColumns: ["id"],
						targetDatabase,
						targetModel: "users",
						targetSchema: "public",
					},
				},
			},
		});

	const ir = schemaIrFromModels([
		users("analytics"),
		users("app"),
		orders("analytics"),
	]);
	const snapshot = schemaSnapshotFromIr(ir);
	const projectedOrders = snapshot.schemas
		.flatMap((ns) => ns.tables)
		.find((item) => item.name === "orders");
	assert.ok(projectedOrders);
	assert.equal(
		projectedOrders.foreignKeys[0]?.target.database,
		"analytics",
		"found case: projected cross-db FK must keep target.database before normalize",
	);

	const normalized = normalizeSchemaSnapshot(snapshot);
	const normalizedOrders = normalized.schemas
		.flatMap((ns) => ns.tables)
		.find((item) => item.name === "orders");
	assert.ok(normalizedOrders);
	assert.equal(
		normalizedOrders.foreignKeys[0]?.target.database,
		"analytics",
		"found case: normalizeForeignKey must retain fk.target.database",
	);

	const from = schemaIrFromModels([
		users("analytics"),
		users("app"),
		orders("analytics"),
	]);
	const to = schemaIrFromModels([
		users("analytics"),
		users("app"),
		orders("app"),
	]);
	const fkOps = diffSchemas({
		from: schemaIrFixture(from),
		to: schemaIrFixture(to),
	}).operations.filter(
		(op) =>
			op.kind === "add_foreign_key" ||
			op.kind === "drop_foreign_key" ||
			op.kind === "alter_foreign_key",
	);
	assert.equal(fkOps.length > 0, true);
	const add = fkOps.find((op) => op.kind === "add_foreign_key");
	if (add?.kind === "add_foreign_key") {
		assert.equal(add.foreignKey.target.database, "app");
	}
	const drop = fkOps.find((op) => op.kind === "drop_foreign_key");
	if (drop?.kind === "drop_foreign_key") {
		assert.equal(drop.foreignKey.target.database, "analytics");
	}
});

function smtpMessage(
	overrides: Partial<AthenaResolvedEmailMessage> = {},
): AthenaResolvedEmailMessage {
	return {
		attachmentFailureMode: "fail",
		attachments: [],
		bcc: [],
		cc: [],
		from: "no-reply@example.com",
		headers: {},
		metadata: {},
		subject: "Welcome",
		text: "Hello",
		to: ["user@example.com"],
		...overrides,
	};
}

test("P1: Reject line breaks in SMTP headers", () => {
	const injected = "Hello\nBcc: attacker@example.com";
	assert.throws(
		() => buildSmtpMime(smtpMessage({ subject: injected })),
		(error: unknown) =>
			error instanceof AthenaEmailError &&
			error.code === ATHENA_EMAIL_MESSAGE_INVALID,
	);
	assert.throws(() =>
		buildSmtpMime(
			smtpMessage({ from: "no-reply@example.com\nBcc: attacker@example.com" }),
		),
	);
	assert.throws(() =>
		buildSmtpMime(
			smtpMessage({
				replyTo: "reply@example.com\r\nBcc: attacker@example.com",
			}),
		),
	);
	assert.throws(() =>
		buildSmtpMime(
			smtpMessage({ headers: { "X-Trace": "ok\nBcc: attacker@example.com" } }),
		),
	);
});

test("P1: Omit Bcc recipients from the MIME header", () => {
	const mime = buildSmtpMime(
		smtpMessage({
			bcc: ["blind@example.com", "other-blind@example.com"],
			cc: ["cc@example.com"],
			to: ["user@example.com"],
		}),
	);
	assert.match(mime, /^To: user@example.com/m);
	assert.match(mime, /^Cc: cc@example.com/m);
	assert.doesNotMatch(
		mime,
		/^Bcc:/m,
		"found case: nonempty message.bcc must stay on the SMTP envelope, not in MIME headers",
	);
	assert.equal(mime.includes("blind@example.com"), false);
	assert.equal(mime.includes("other-blind@example.com"), false);
});

function globMatchesWorkflowPath(pattern: string, file: string): boolean {
	const regex = new RegExp(
		`^${pattern
			.replaceAll(".", "\\.")
			.replaceAll("**", "§DOUBLE§")
			.replaceAll("*", "[^/]*")
			.replaceAll("§DOUBLE§", ".*")}$`,
	);
	return regex.test(file);
}

test("P2: Trigger integrity checks for every scanned manifest", () => {
	const workflowPath = join(
		dirname(fileURLToPath(import.meta.url)),
		"../../../../.github/workflows/repository-integrity.yml",
	);
	const yaml = readFileSync(workflowPath, "utf8");
	const prBlock =
		yaml.split("pull_request:")[1]?.split("workflow_dispatch:")[0] ?? "";
	const patterns = [...prBlock.matchAll(/- "([^"]+)"/g)].map(
		(match) => match[1],
	);
	const foundCases = [
		"tools/foo/package.json",
		"tools/foo/pyproject.toml",
		"tools/foo/pnpm-workspace.yaml",
		"tools/foo/Dockerfile",
		"tools/foo/wrangler.toml",
		"tools/foo/wrangler.jsonc",
	];
	for (const path of foundCases) {
		assert.equal(
			patterns.some((pattern) => globMatchesWorkflowPath(pattern, path)),
			true,
			`pull_request paths must run topology for ${path}`,
		);
	}
});

function smtpProvider() {
	const transport = createMemorySmtpTransport();
	const provider = smtp({
		auth: { pass: "secret", user: "smtp-user" },
		host: "smtp.example.com",
		lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
		transport,
	});
	return { provider, transport };
}

test("P1: Reject line breaks before SMTP envelope commands", async () => {
	const { provider, transport } = smtpProvider();
	await assert.rejects(
		() =>
			provider.send(
				smtpMessage({
					to: ["user@example.com\nRCPT TO:<attacker@evil.com>"],
				}),
			),
		(error: unknown) =>
			error instanceof AthenaEmailError &&
			error.code === ATHENA_EMAIL_MESSAGE_INVALID,
	);
	assert.equal(
		transport.commands.some(
			(line) => line.startsWith("MAIL FROM:") || line.startsWith("RCPT TO:"),
		),
		false,
		"found case: CR/LF in to/cc/bcc must be rejected before MAIL FROM / RCPT TO",
	);
});

test("P1: Detect table moves across databases", () => {
	const from = irTablesDoc([
		{
			id: "tbl_users",
			identity: identity("app", "public", "users"),
			columns: [
				{
					id: "col_users_id",
					identity: identity("app", "public", "id"),
					type: scalarUuid,
					nullable: false,
				},
			],
			constraints: [],
			relations: [],
			indexes: [],
		},
	]);
	const to = schemaIrFixture({
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: [
			{
				id: "db_analytics",
				identity: identity("analytics", "public", "analytics"),
				namespaces: [
					{
						id: "ns_analytics_public",
						identity: identity("analytics", "public", "public"),
						tables: [
							{
								id: "tbl_users",
								identity: identity("analytics", "public", "users"),
								columns: [
									{
										id: "col_users_id",
										identity: identity("analytics", "public", "id"),
										type: scalarUuid,
										nullable: false,
									},
								],
								constraints: [],
								relations: [],
								indexes: [],
							},
						],
					},
				],
			},
		],
		metadata: {},
	});

	assert.throws(
		() =>
			diffSchemas({
				from: schemaIrFixture(from),
				to: schemaIrFixture(to),
			}),
		/database|unsupported|move/i,
		"found case: same table id + schema/name with a different physical database must not yield an empty diff",
	);
});

test("P1: Validate schema type discriminators and native fields", () => {
	const bogus = {
		kind: "athena.schema" as const,
		irVersion: 2 as const,
		databases: [
			{
				id: "db_app",
				identity: identity("appdb", "public", "appdb"),
				namespaces: [
					{
						id: "ns_public",
						identity: identity("appdb", "public", "public"),
						tables: [
							{
								id: "tbl_users",
								identity: identity("appdb", "public", "users"),
								columns: [
									{
										id: "col_users_id",
										identity: identity("appdb", "public", "id"),
										type: { kind: "bogus", native: {} },
										nullable: false,
									},
								],
								constraints: [],
								relations: [],
								indexes: [],
							},
						],
					},
				],
			},
		],
		metadata: {},
	};

	assert.throws(
		() => validateAthenaSchemaIr(bogus),
		/kind|native|bogus|unsupported|backend|semantic|enumId/,
		'found case: { kind: "bogus", native: {} } must fail closed instead of becoming a scalar',
	);
});

test("P1: Validate the database backend before canonicalizing", () => {
	const withBackend = (backend: unknown) => {
		const doc = irTablesDoc([
			{
				id: "tbl_users",
				identity: identity("app", "public", "users"),
				columns: [usersIdColumn],
				constraints: [],
				relations: [],
				indexes: [],
			},
		]);
		const database = doc.databases[0];
		assert.ok(database);
		return {
			...doc,
			databases: [{ ...database, backend }],
		};
	};
	assert.throws(
		() => validateAthenaSchemaIr(withBackend(42)),
		/SchemaDatabase\.backend|string/,
		"found case: SchemaDatabase.backend: 42 must fail closed instead of canonicalizing to \"\"",
	);
	assert.throws(
		() => canonicalizeAthenaSchemaIr(withBackend(true)),
		/SchemaDatabase\.backend|string/,
		"found case: non-string backends must not collapse to the same empty canonical fingerprint",
	);
	assert.doesNotThrow(() => validateAthenaSchemaIr(withBackend(null)));
	assert.doesNotThrow(() => validateAthenaSchemaIr(withBackend("postgresql")));
	const omitted = irTablesDoc([
		{
			id: "tbl_users",
			identity: identity("app", "public", "users"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
	]);
	assert.doesNotThrow(() => validateAthenaSchemaIr(omitted));
});

test("P2: Honor URL attachments for stored templates over SMTP", async () => {
	const { provider, transport } = smtpProvider();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		throw new Error("network must not run for skip-mode URL attachments");
	}) as typeof fetch;
	try {
		const result = await provider.send(
			smtpMessage({
				attachmentFailureMode: "skip",
				attachments: [
					{
						contentType: "application/pdf",
						fileUrl: "https://cdn.example.com/legacy.pdf",
						filename: "legacy.pdf",
					},
				],
			}),
		);
		assert.equal(result.success, true);
		assert.equal(
			transport.payloads.some((payload) => payload.includes("legacy.pdf")),
			false,
			"found case: skip mode must omit URL-only SMTP attachments instead of failing delivery",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("P2: Remove pending email records after delivery failures", async () => {
	const store = new MemoryAuthEmailStore();
	const result = await emitAuthEmail(
		{
			data: { reset_url: "https://app.example/reset?token=abc123" },
			eventType: "user.password.reset",
			recipient: "user@example.com",
		},
		{
			delivery: {
				async send() {
					return {
						accepted: [],
						provider: "smtp",
						rejected: ["user@example.com"],
						success: false,
					};
				},
			},
			store,
		},
	);
	assert.equal(result.success, false);
	const emails = await store.listEmails();
	assert.equal(
		emails.length,
		0,
		"found case: failed delivery must not leave provider=pending rows in /email/list",
	);
	const failures = await store.listFailures();
	assert.equal(failures.length, 1);
});

async function sendStoredTemplateAsAdmin(options: {
	attachmentFailureMode?: "fail" | "skip";
	delivery: AthenaEmailDeliveryPort;
	templateId?: string;
}) {
	const emailStore = new MemoryAuthEmailStore();
	const stamp = new Date().toISOString();
	const templateId = options.templateId ?? "tmpl_invoice";
	await emailStore.createTemplate({
		attachment_failure_mode: options.attachmentFailureMode ?? "fail",
		attachments: [
			{
				file_url: "https://cdn.example.com/invoice.pdf",
				filename: "invoice.pdf",
			},
		],
		created_at: stamp,
		event_type: "billing.invoice.ready",
		html_template: "<p>Invoice</p>",
		id: templateId,
		is_active: true,
		locale: "en",
		metadata: {},
		subject_template: "Invoice ready",
		template_key: "invoice_ready",
		text_template: "Invoice ready",
		updated_at: stamp,
		variable_bindings: [],
		variables: [],
	});
	const response = await handleAdminEmailRoutes(
		new Request("http://app.local/admin/email-template/send", {
			body: JSON.stringify({
				recipient_email: "user@example.com",
				template_id: templateId,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
		"/admin/email-template/send",
		"POST",
		{
			delivery: options.delivery,
			emailStore,
			headers: new Headers(),
			requireSession: async () => ({ user: { role: "admin" } }),
			stores: new MemoryAuthStores(),
		},
	);
	assert.ok(response);
	return { emailStore, response };
}

test("P2: Preserve the template attachment failure mode", async () => {
	const { provider, transport } = smtpProvider();
	const delivery = createEmailDeliveryPort(
		createEmailModule({
			attachments: { failureMode: "fail" },
			defaults: { from: "athena@localhost" },
			provider,
		}),
	);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		throw new Error("HTTP 504 timeout");
	}) as typeof fetch;
	try {
		const { response } = await sendStoredTemplateAsAdmin({
			attachmentFailureMode: "skip",
			delivery,
		});
		assert.equal(response.status, 200);
		const body = (await response.json()) as { success?: boolean };
		assert.equal(body.success, true);
		assert.equal(
			transport.payloads.some((payload) => payload.includes("invoice.pdf")),
			false,
			"found case: template skip must override global fail so a URL fetch timeout is omitted, not a failed send",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("P2: Delete failed stored-template email records", async () => {
	const failingDelivery: AthenaEmailDeliveryPort = {
		async send() {
			return {
				accepted: [],
				provider: "smtp",
				rejected: ["user@example.com"],
				success: false,
			};
		},
	};
	const { emailStore, response } = await sendStoredTemplateAsAdmin({
		delivery: failingDelivery,
	});
	assert.equal(response.status, 503);
	assert.equal(
		(await emailStore.listEmails()).length,
		0,
		"found case: success:false stored-template send must delete the pending email row",
	);
	assert.equal((await emailStore.listFailures()).length, 1);

	const throwingDelivery: AthenaEmailDeliveryPort = {
		async send() {
			throw new Error("SMTP connection reset");
		},
	};
	const thrown = await sendStoredTemplateAsAdmin({
		delivery: throwingDelivery,
		templateId: "tmpl_invoice_throw",
	});
	assert.equal(thrown.response.status, 503);
	assert.equal(
		(await thrown.emailStore.listEmails()).length,
		0,
		"found case: thrown stored-template send must delete the pending email row",
	);
	assert.equal((await thrown.emailStore.listFailures()).length, 1);
});

test("P1: Scope namespace diffs by database", () => {
	const warehouseAnalytics = {
		id: schemaId("ns_wh_analytics"),
		identity: identity("warehouse", "analytics", "analytics"),
		tables: [],
	};
	const from = schemaIrFixture({
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: [
			{
				id: schemaId("db_app"),
				identity: identity("app", "public", "app"),
				namespaces: [
					{
						id: schemaId("ns_app_analytics"),
						identity: identity("app", "analytics", "analytics"),
						tables: [],
					},
				],
			},
			{
				id: schemaId("db_warehouse"),
				identity: identity("warehouse", "public", "warehouse"),
				namespaces: [warehouseAnalytics],
			},
		],
		metadata: {},
	});
	const to = schemaIrFixture({
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: [
			{
				id: schemaId("db_app"),
				identity: identity("app", "public", "app"),
				namespaces: [],
			},
			{
				id: schemaId("db_warehouse"),
				identity: identity("warehouse", "public", "warehouse"),
				namespaces: [warehouseAnalytics],
			},
		],
		metadata: {},
	});

	const diff = diffSchemas({ from, to });
	const drops = diff.operations.filter((op) => op.kind === "drop_schema");
	assert.equal(
		drops.length,
		1,
		"found case: removing analytics from app while warehouse still has analytics must emit one drop_schema",
	);
	assert.equal(drops[0]?.kind, "drop_schema");
	if (drops[0]?.kind === "drop_schema") {
		assert.equal(drops[0].schema, "analytics");
		assert.equal(
			drops[0].database,
			"app",
			'found case: { schema: "analytics" } must carry its database',
		);
	}

	const withLogs = schemaIrFixture({
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: [
			...from.databases,
			{
				id: schemaId("db_logs"),
				identity: identity("logs", "public", "logs"),
				namespaces: [
					{
						id: schemaId("ns_logs_analytics"),
						identity: identity("logs", "analytics", "analytics"),
						tables: [],
					},
				],
			},
		],
		metadata: {},
	});
	const created = diffSchemas({ from, to: withLogs }).operations.filter(
		(op) => op.kind === "create_schema",
	);
	assert.equal(
		created.some(
			(op) =>
				op.kind === "create_schema" &&
				op.schema === "analytics" &&
				op.database === "logs",
		),
		true,
		"found case: adding analytics in a second database must emit create_schema for that database",
	);
});

test("P1: Disallow Resend in browser runtimes", () => {
	const provider = resend({
		apiKey: "re_test",
		fetchImpl: async () =>
			new Response(JSON.stringify({ id: "re_1" }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
	});
	assert.equal(
		provider.capabilities?.runtimes.includes("browser"),
		false,
		"found case: resend({ apiKey }) must not advertise the browser runtime",
	);
	assert.deepEqual(provider.capabilities?.runtimes, ["node", "edge"]);
	assert.throws(
		() => assertAthenaEmailProviderRuntime(provider, "browser"),
		(error: unknown) =>
			error instanceof AthenaEmailError &&
			error.code === ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME,
	);
});

test("P2: Persist the resolved sender identity", async () => {
	const store = new MemoryAuthEmailStore();
	const delivery = createEmailModule({
		defaults: { from: "no-reply@example.com", fromName: "Athena Mail" },
		provider: defineAthenaEmailProvider({
			id: "memory",
			async send() {
				return {
					accepted: ["user@example.com"],
					provider: "memory",
					rejected: [],
					success: true,
				};
			},
		}),
	});
	const result = await emitAuthEmail(
		{
			data: { reset_url: "https://app.example/reset?token=abc123" },
			eventType: "user.password.reset",
			recipient: "user@example.com",
		},
		{ delivery, store },
	);
	assert.equal(result.success, true);
	const emails = await store.listEmails();
	assert.equal(emails.length, 1);
	assert.equal(
		emails[0]?.from_address,
		"no-reply@example.com",
		"found case: email.defaults.from must be persisted instead of athena@localhost",
	);
	assert.equal(
		emails[0]?.from_name,
		"Athena Mail",
		"found case: email.defaults.fromName must be persisted instead of null",
	);
});

function irTableDoc(table: Record<string, unknown>): AthenaSchemaIr {
	return irTablesDoc([table]);
}

function irTablesDoc(tables: Record<string, unknown>[]): AthenaSchemaIr {
	return schemaIrFixture({
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: [
			{
				id: schemaId("db_app"),
				identity: identity("app", "public", "app"),
				namespaces: [
					{
						id: schemaId("ns_public"),
						identity: identity("app", "public", "public"),
						tables,
					},
				],
			},
		],
		metadata: {},
	});
}

const usersIdColumn = {
	id: "col_users_id",
	identity: identity("app", "public", "id"),
	type: scalarUuid,
	nullable: false,
};

test("P1: Revalidate attachment destinations at fetch time", async () => {
	const { provider } = smtpProvider();
	const originalFetch = globalThis.fetch;
	const fetched: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const hostHeader = new Headers(init?.headers).get("host");
		const logicalHost = (hostHeader ?? url.hostname).replace(/^\[|\]$/g, "");
		fetched.push(String(input));
		if (logicalHost === "cdn.example.com" && url.pathname.includes("invoice.pdf")) {
			if (init?.redirect !== "manual") {
				return globalThis.fetch("http://127.0.0.1/secret.pdf", init);
			}
			return new Response(null, {
				headers: { Location: "http://127.0.0.1/secret.pdf" },
				status: 302,
			});
		}
		return new Response("should-not-download", { status: 200 });
	}) as typeof fetch;
	try {
		await assert.rejects(
			() =>
				provider.send(
					smtpMessage({
						attachments: [
							{
								contentType: "application/pdf",
								fileUrl: "https://cdn.example.com/invoice.pdf",
								filename: "invoice.pdf",
							},
						],
					}),
				),
			(error: unknown) => error instanceof AthenaEmailError,
		);
		assert.equal(
			fetched.some((url) => url.includes("127.0.0.1")),
			false,
			"found case: a public attachment URL that redirects to loopback must not be followed",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}

	await assert.rejects(
		() =>
			provider.send(
				smtpMessage({
					attachments: [
						{
							contentType: "application/pdf",
							fileUrl: "http://127.0.0.1/secret.pdf",
							filename: "secret.pdf",
						},
					],
				}),
			),
		/loopback|private|SMTP attachment|fetch/i,
		"found case: literal loopback attachment URLs must be rejected before download",
	);
});

test("P1: Validate index definitions before canonicalizing", () => {
	const doc = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [],
		relations: [],
		indexes: [{ id: "idx", columns: [null] }],
	});
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/SchemaIndex|columns|name/,
		'found case: { id: "idx", columns: [null] } must fail closed instead of canonicalizing an empty index column',
	);
});

test("P1: Honor database IDs when lifting v1 snapshots", () => {
	const snapshot = {
		version: ATHENA_SCHEMA_SNAPSHOT_VERSION,
		backend: "postgresql" as const,
		schemas: [
			{
				name: "public",
				tables: [
					{
						schema: "public",
						name: "events",
						database: "tenant_a",
						columns: [
							{
								name: "id",
								type: { name: "uuid", arrayDimensions: 0 },
								nullable: false,
								default: null,
								isGenerated: false,
							},
						],
						primaryKey: { columns: ["id"] },
						uniqueConstraints: [],
						foreignKeys: [
							{
								columns: ["id"],
								target: {
									schema: "public",
									name: "orgs",
									database: "tenant_b",
								},
								targetColumns: ["id"],
								onDelete: "no_action" as const,
								onUpdate: "no_action" as const,
							},
						],
						indexes: [],
					},
					{
						schema: "public",
						name: "orgs",
						database: "tenant_b",
						columns: [
							{
								name: "id",
								type: { name: "uuid", arrayDimensions: 0 },
								nullable: false,
								default: null,
								isGenerated: false,
							},
						],
						primaryKey: { columns: ["id"] },
						uniqueConstraints: [],
						foreignKeys: [],
						indexes: [],
					},
					{
						schema: "public",
						name: "events",
						database: "tenant_b",
						columns: [
							{
								name: "id",
								type: { name: "uuid", arrayDimensions: 0 },
								nullable: false,
								default: null,
								isGenerated: false,
							},
						],
						primaryKey: { columns: ["id"] },
						uniqueConstraints: [],
						foreignKeys: [],
						indexes: [],
					},
				],
			},
		],
	};

	const ir = schemaIrFromSnapshot(snapshot);
	const dbIds = ir.databases.map((db) => db.identity.logical.database).sort();
	assert.deepEqual(
		dbIds,
		["tenant_a", "tenant_b"],
		"found case: tenant_a.public.events and tenant_b.public.events must not collapse onto tbl:default.public.events",
	);
	const tenantA = ir.databases.find(
		(db) => db.identity.logical.database === "tenant_a",
	);
	const table = tenantA?.namespaces[0]?.tables[0];
	assert.ok(table);
	assert.equal(String(table.id), "tbl:tenant_a.public.events");
	const fk = table.constraints.find((item) => item.kind === "foreign_key");
	assert.ok(fk && fk.kind === "foreign_key");
	assert.equal(
		String(fk.targetTableId),
		"tbl:tenant_b.public.orgs",
		"found case: fk.target.database must be preserved instead of the document-wide fallback",
	);
});

test("P1: Validate semantic relation fields", () => {
	const doc = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [],
		relations: [{ id: "rel_only" }],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/SchemaRelation|cardinality|sourceTableId|targetTableId/,
		"found case: a relation with only an ID must fail closed instead of canonicalizing empty table ids",
	);
});

test("P1: Validate enum labels before canonicalizing", () => {
	const doc = {
		kind: "athena.schema",
		irVersion: 2,
		databases: [
			{
				id: "db_app",
				identity: identity("app", "public", "app"),
				enums: [
					{
						id: "enum_status",
						identity: identity("app", "public", "status"),
						labels: [null],
					},
				],
				namespaces: [
					{
						id: "ns_public",
						identity: identity("app", "public", "public"),
						tables: [
							{
								id: "tbl_users",
								identity: identity("app", "public", "users"),
								columns: [usersIdColumn],
								constraints: [],
								relations: [],
								indexes: [],
							},
						],
					},
				],
			},
		],
		metadata: {},
	};
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/SchemaEnum|labels/,
		"found case: labels: [null] must fail closed instead of canonicalizing an empty enum label",
	);
});

test("P2: Report all SMTP envelope recipients as accepted", async () => {
	const { provider } = smtpProvider();
	const result = await provider.send(
		smtpMessage({
			bcc: ["blind@example.com"],
			cc: ["cc@example.com"],
			to: ["user@example.com"],
		}),
	);
	assert.deepEqual(
		result.accepted,
		["user@example.com", "cc@example.com", "blind@example.com"],
		"found case: SMTP delivery receipts must include Cc and Bcc envelope recipients",
	);
});

test("P1: Reject non-boolean column flags", () => {
	const quotedNullable = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [{ ...usersIdColumn, nullable: "true" }],
		constraints: [],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(quotedNullable),
		/nullable|boolean/,
		'found case: nullable: "true" must fail closed instead of canonicalizing to NOT NULL',
	);

	const omittedNullable = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			{
				id: "col_users_id",
				identity: identity("app", "public", "id"),
				type: scalarUuid,
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(omittedNullable),
		/nullable/,
		"found case: omitting nullable must fail closed",
	);
});

test("P1: Validate every constraint column entry", () => {
	const doc = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [
			{
				id: "cst_pk",
				kind: "primary_key",
				columns: [null],
			},
		],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/SchemaConstraint|columns/,
		'found case: { kind: "primary_key", columns: [null] } must fail closed instead of emitting an empty PK column',
	);
});

test("P1: Separate delivery success from audit failures", async () => {
	const store = new MemoryAuthEmailStore();
	const originalUpdate = store.updateEmail.bind(store);
	store.updateEmail = async () => {
		throw new Error("audit write failed");
	};
	let sendCount = 0;
	const result = await emitAuthEmail(
		{
			data: { reset_url: "https://app.example/reset?token=abc123" },
			eventType: "user.password.reset",
			recipient: "user@example.com",
		},
		{
			delivery: {
				async send() {
					sendCount += 1;
					return {
						accepted: ["user@example.com"],
						from: "no-reply@example.com",
						provider: "memory",
						rejected: [],
						success: true,
					};
				},
			},
			legacySend: async () => {
				throw new Error("legacy callback failed");
			},
			store,
		},
	);
	assert.equal(sendCount, 1);
	assert.equal(
		result.success,
		true,
		"found case: post-delivery audit/callback errors must not rewrite a successful send as failure",
	);
	store.updateEmail = originalUpdate;
	assert.equal(
		(await store.listEmails()).length,
		1,
		"found case: a delivered message must not be deleted when audit persistence throws",
	);
	assert.equal((await store.listFailures()).length, 0);
});

test("P2: Persist the resolved sender for stored-template sends", async () => {
	const delivery = createEmailDeliveryPort(
		createEmailModule({
			defaults: { from: "no-reply@example.com", fromName: "Athena Mail" },
			provider: defineAthenaEmailProvider({
				id: "memory",
				async send() {
					return {
						accepted: ["user@example.com"],
						provider: "memory",
						rejected: [],
						success: true,
					};
				},
			}),
		}),
	);
	const { emailStore, response } = await sendStoredTemplateAsAdmin({
		delivery,
	});
	assert.equal(response.status, 200);
	const emails = await emailStore.listEmails();
	assert.equal(emails.length, 1);
	assert.equal(
		emails[0]?.from_address,
		"no-reply@example.com",
		"found case: stored-template sends must persist email.defaults.from instead of athena@localhost",
	);
	assert.equal(
		emails[0]?.from_name,
		"Athena Mail",
		"found case: stored-template sends must persist email.defaults.fromName instead of null",
	);
});

test("P2: Include Cc and Bcc in HTTP delivery receipts", async () => {
	const httpProvider = httpEmailProvider({
		fetchImpl: async () =>
			new Response(JSON.stringify({ id: "http_1" }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		url: "https://hooks.example.com/mail",
	});
	const httpResult = await httpProvider.send(
		smtpMessage({
			bcc: ["blind@example.com"],
			cc: ["cc@example.com"],
			to: ["user@example.com"],
		}),
	);
	assert.deepEqual(
		httpResult.accepted,
		["user@example.com", "cc@example.com", "blind@example.com"],
		"found case: HTTP provider receipts must include Cc and Bcc",
	);

	const resendProvider = resend({
		apiKey: "re_test",
		fetchImpl: async () =>
			new Response(JSON.stringify({ id: "re_1" }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
	});
	const resendResult = await resendProvider.send(
		smtpMessage({
			bcc: ["blind@example.com"],
			cc: ["cc@example.com"],
			to: ["user@example.com"],
		}),
	);
	assert.deepEqual(
		resendResult.accepted,
		["user@example.com", "cc@example.com", "blind@example.com"],
		"found case: Resend provider receipts must include Cc and Bcc",
	);
});

test("P1: Run table renames before changes using the new name", () => {
	const emailColumn = {
		id: "col_users_email",
		identity: identity("app", "public", "email"),
		type: {
			kind: "scalar" as const,
			semantic: "text",
			native: {
				backend: "postgresql",
				name: "text",
				arrayDimensions: 0,
			},
		},
		nullable: true,
	};
	const from: AthenaSchemaIr = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn, emailColumn],
		constraints: [],
		relations: [],
		indexes: [],
	});
	const to: AthenaSchemaIr = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "people"),
		columns: [usersIdColumn],
		constraints: [],
		relations: [],
		indexes: [],
	});
	const diff = diffSchemas({
		from: schemaIrFixture(from),
		to: schemaIrFixture(to),
	});
	const kinds = diff.operations.map((op) => op.kind);
	const renameAt = kinds.indexOf("rename_table");
	const dropAt = kinds.indexOf("drop_column");
	assert.ok(renameAt >= 0, "expected rename_table");
	assert.ok(dropAt >= 0, "expected drop_column");
	assert.ok(
		renameAt < dropAt,
		"found case: renaming users→people while dropping a column must rename before drop_column against people",
	);
	const drop = diff.operations[dropAt];
	assert.equal(drop?.kind, "drop_column");
	if (drop?.kind === "drop_column") {
		assert.equal(drop.table.name, "people");
	}
});

test("P1: Block hexadecimal IPv4-mapped loopback literals", async () => {
	const fetched: string[] = [];
	const fetchImpl = (async (input: RequestInfo | URL) => {
		fetched.push(String(input));
		return new Response("secret", { status: 200 });
	}) as typeof fetch;
	const provider = smtp({
		auth: { pass: "secret", user: "smtp-user" },
		fetchImpl,
		host: "smtp.example.com",
		lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
		transport: createMemorySmtpTransport(),
	});

	await assert.rejects(
		() =>
			provider.send(
				smtpMessage({
					attachments: [
						{
							contentType: "application/pdf",
							fileUrl: "http://[::ffff:127.0.0.1]/secret.pdf",
							filename: "secret.pdf",
						},
					],
				}),
			),
		/private|loopback|SMTP attachment/i,
		"found case: http://[::ffff:127.0.0.1]/ must be rejected before fetch",
	);
	await assert.rejects(
		() =>
			provider.send(
				smtpMessage({
					attachments: [
						{
							contentType: "application/pdf",
							fileUrl: "http://[::ffff:7f00:1]/secret.pdf",
							filename: "secret.pdf",
						},
					],
				}),
			),
		/private|loopback|SMTP attachment/i,
		"found case: canonical ::ffff:7f00:1 mapped loopback must be rejected",
	);
	assert.equal(
		fetched.length,
		0,
		"found case: IPv4-mapped loopback attachment URLs must not be fetched",
	);
});

test("P1: Do not reuse another client's email provider", async () => {
	const sent: string[] = [];
	const port = (id: string) =>
		createEmailDeliveryPort({
			send: async () => {
				sent.push(id);
				return {
					accepted: ["reset@example.com"],
					messageId: id,
					provider: "memory",
					rejected: [],
					success: true,
				};
			},
		});
	const hasher = {
		async hash(password: string) {
			return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
		},
		needsRehash() {
			return false;
		},
		async verify() {
			return true;
		},
	};
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		delivery: port("first"),
		hasher,
	});
	const signup = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email: "reset@example.com",
				name: "User",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(signup.status, 200);
	await runtime.handle(
		new Request("http://app.local/api/auth/forget-password", {
			body: JSON.stringify({
				email: "reset@example.com",
				redirectTo: "https://app.example/reset",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	const rebind = (
		runtime as {
			setDelivery?: (next: ReturnType<typeof createEmailDeliveryPort>) => void;
		}
	).setDelivery;
	if (typeof rebind === "function") {
		rebind(port("second"));
	}
	sent.length = 0;
	await runtime.handle(
		new Request("http://app.local/api/auth/forget-password", {
			body: JSON.stringify({
				email: "reset@example.com",
				redirectTo: "https://app.example/reset",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.deepEqual(
		sent,
		["second"],
		"found case: a later client must not send through the first client's cached delivery port",
	);

	const attach = readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), "../../src/v3-client.ts"),
		"utf8",
	);
	const fn = attach.slice(attach.indexOf("function attachLocalAuthRuntime"));
	const block = fn.slice(0, fn.indexOf("const server:"));
	assert.match(
		block,
		/createEmailDeliveryPort\(client\.email\)/,
		"local Auth must take delivery from this client",
	);
	assert.match(
		block,
		/cachedAuth\.setDelivery\(delivery\)/,
		"found case: cachedAuth reuse must rebind this client's email provider",
	);
});

test("P1: Reject empty physical identity names", () => {
	const emptyTable = irTableDoc({
		id: "tbl_users",
		identity: {
			logical: { database: "app", namespace: "public", name: "users" },
			physical: { database: "app", namespace: "public", name: "" },
		},
		columns: [usersIdColumn],
		constraints: [],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(emptyTable),
		/physical\.name|non-empty/,
		'found case: identity.physical.name "" on a table must fail closed',
	);

	const emptyColumn = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			{
				...usersIdColumn,
				identity: {
					logical: { database: "app", namespace: "public", name: "id" },
					physical: { database: "app", namespace: "public", name: "" },
				},
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(emptyColumn),
		/physical\.name|non-empty/,
		'found case: identity.physical.name "" on a column must fail closed',
	);
});

test("P1: Make schema fingerprints work in supported ESM runtimes", () => {
	const fingerprintSrc = readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			"../../src/schema/ir/fingerprint.ts",
		),
		"utf8",
	);
	assert.equal(
		fingerprintSrc.includes("node-crypto"),
		false,
		"found case: ESM Node 18–20.15 has no process.getBuiltinModule and no require, so fingerprints must not load node-crypto",
	);
	const hash = fingerprintAthenaSchemaIr(
		irTableDoc({
			id: "tbl_users",
			identity: identity("app", "public", "users"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		}),
	);
	assert.match(hash, /^[0-9a-f]{64}$/);
});

test("P1: Separate stored-template audit errors from delivery failures", async () => {
	const emailStore = new MemoryAuthEmailStore();
	const originalUpdate = emailStore.updateEmail.bind(emailStore);
	emailStore.updateEmail = async () => {
		throw new Error("audit write failed");
	};
	const stamp = new Date().toISOString();
	await emailStore.createTemplate({
		attachment_failure_mode: "fail",
		attachments: [],
		created_at: stamp,
		event_type: "billing.invoice.ready",
		html_template: "<p>Invoice</p>",
		id: "tmpl_invoice_audit",
		is_active: true,
		locale: "en",
		metadata: {},
		subject_template: "Invoice ready",
		template_key: "invoice_ready",
		text_template: "Invoice ready",
		updated_at: stamp,
		variable_bindings: [],
		variables: [],
	});
	let sendCount = 0;
	const response = await handleAdminEmailRoutes(
		new Request("http://app.local/admin/email-template/send", {
			body: JSON.stringify({
				recipient_email: "user@example.com",
				template_id: "tmpl_invoice_audit",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
		"/admin/email-template/send",
		"POST",
		{
			delivery: {
				async send() {
					sendCount += 1;
					return {
						accepted: ["user@example.com"],
						from: "no-reply@example.com",
						provider: "memory",
						rejected: [],
						success: true,
					};
				},
			},
			emailStore,
			headers: new Headers(),
			requireSession: async () => ({ user: { role: "admin" } }),
			stores: new MemoryAuthStores(),
		},
	);
	assert.ok(response);
	assert.equal(sendCount, 1);
	assert.equal(
		response.status,
		200,
		"found case: post-delivery stored-template audit errors must not rewrite an accepted send as HTTP 503",
	);
	const body = (await response.json()) as { success?: boolean };
	assert.equal(body.success, true);
	emailStore.updateEmail = originalUpdate;
	assert.equal(
		(await emailStore.listEmails()).length,
		1,
		"found case: a delivered stored-template message must not be deleted when audit persistence throws",
	);
	assert.equal((await emailStore.listFailures()).length, 0);
});

test("P1: Bound remote SMTP attachment downloads", async () => {
	const { provider } = smtpProvider();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () =>
		new Response(new Uint8Array(12 * 1024 * 1024), {
			headers: { "content-type": "application/pdf" },
			status: 200,
		})) as typeof fetch;
	try {
		await assert.rejects(
			() =>
				provider.send(
					smtpMessage({
						attachments: [
							{
								contentType: "application/pdf",
								fileUrl: "https://cdn.example.com/huge.pdf",
								filename: "huge.pdf",
							},
						],
					}),
				),
			(error: unknown) =>
				error instanceof AthenaEmailError &&
				/size|limit|timeout|attachment/i.test(error.message),
			"found case: fail-mode SMTP URL downloads must not materialize an unbounded arrayBuffer()",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("P1: Reject unknown foreign-key actions", () => {
	const doc = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [
			{
				id: "cst_users_self_fk",
				kind: "foreign_key",
				columns: ["id"],
				targetTableId: "tbl_users",
				targetColumns: ["id"],
				onDelete: "casade",
			},
		],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/onDelete|referential|casade|unsupported/,
		'found case: onDelete: "casade" must fail closed instead of canonicalizing and projecting to no_action',
	);
	assert.throws(
		() => canonicalizeAthenaSchemaIr(doc),
		/onDelete|referential|casade|unsupported/,
	);
});

test("P1: Run column renames before reusing old names", () => {
	const from: AthenaSchemaIr = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			usersIdColumn,
			{
				id: "col_users_a",
				identity: identity("app", "public", "a"),
				type: scalarUuid,
				nullable: true,
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	const to: AthenaSchemaIr = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			usersIdColumn,
			{
				id: "col_users_a",
				identity: identity("app", "public", "b"),
				type: scalarUuid,
				nullable: true,
			},
			{
				id: "col_users_new_a",
				identity: identity("app", "public", "a"),
				type: scalarUuid,
				nullable: true,
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	const diff = diffSchemas({
		from: schemaIrFixture(from),
		to: schemaIrFixture(to),
	});
	const kinds = diff.operations.map((op) => op.kind);
	const renameAt = kinds.indexOf("rename_column");
	const addAt = kinds.indexOf("add_column");
	assert.ok(renameAt >= 0, "expected rename_column a → b");
	assert.ok(addAt >= 0, "expected add_column a");
	assert.ok(
		renameAt < addAt,
		"found case: renaming a→b while introducing a new column a must rename before add_column",
	);
	const rename = diff.operations[renameAt];
	const add = diff.operations[addAt];
	assert.equal(rename?.kind, "rename_column");
	assert.equal(add?.kind, "add_column");
	if (rename?.kind === "rename_column") {
		assert.equal(rename.from, "a");
		assert.equal(rename.to, "b");
	}
	if (add?.kind === "add_column") {
		assert.equal(add.column.name, "a");
	}
});

test("P1: Reject foreign keys targeting absent tables", () => {
	const postsIdColumn = {
		id: "col_posts_id",
		identity: identity("app", "public", "id"),
		type: scalarUuid,
		nullable: false,
	};
	const doc = {
		kind: "athena.schema",
		irVersion: 2,
		databases: [
			{
				id: "db_app",
				identity: identity("app", "public", "app"),
				namespaces: [
					{
						id: "ns_public",
						identity: identity("app", "public", "public"),
						tables: [
							{
								id: "tbl_users",
								identity: identity("app", "public", "users"),
								columns: [usersIdColumn],
								constraints: [],
								relations: [],
								indexes: [],
							},
							{
								id: "tbl_posts",
								identity: identity("app", "public", "posts"),
								columns: [
									postsIdColumn,
									{
										id: "col_posts_user_id",
										identity: identity("app", "public", "user_id"),
										type: scalarUuid,
										nullable: false,
									},
								],
								constraints: [
									{
										id: "cst_posts_user_fk",
										kind: "foreign_key",
										columns: ["user_id"],
										targetTableId: "tbl_missing",
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
		metadata: {},
	};
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/targetTableId|does not identify a table|tbl_missing/,
		"found case: a public IR foreign key with a typo targetTableId must raise SchemaIrError instead of skipping target-column validation",
	);
});

test("P1: Bound SMTP connection and reply waits", {
	timeout: 2000,
}, async () => {
	const hangingTransport: AthenaSmtpTransport = async () => ({
		async close() {},
		readReply() {
			return new Promise<AthenaSmtpReply>(() => {});
		},
		async startTls() {},
		async writeData() {},
		async writeLine() {},
	});
	const provider = smtp({
		auth: { pass: "secret", user: "smtp-user" },
		host: "smtp.example.com",
		timeoutMs: 50,
		transport: hangingTransport,
	});
	const started = Date.now();
	await assert.rejects(
		() => provider.send(smtpMessage()),
		(error: unknown) =>
			error instanceof AthenaEmailError &&
			/timed out|timeout/i.test(error.message),
		"found case: SMTP that accepts TCP but never greets must fail instead of hanging",
	);
	assert.ok(
		Date.now() - started < 2000,
		"found case: connect/read/write waits must be bounded",
	);
});

test("P1: Bound SMTP connect, read, and write with a socket deadline", async () => {
	const server = createServer((socket) => {
		socket.pause();
	});
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	assert.ok(address && typeof address === "object");
	const transport = createNodeSmtpTransport();
	const started = Date.now();
	try {
		await assert.rejects(
			async () => {
				const connection = await transport({
					host: "127.0.0.1",
					implicitTls: false,
					port: address.port,
					timeoutMs: 80,
				});
				try {
					await connection.readReply();
				} finally {
					await connection.close();
				}
			},
			(error: unknown) =>
				error instanceof Error && /timed out/i.test(error.message),
			"found case: SMTP accept-without-220 must not hang the auth/email request",
		);
		assert.ok(Date.now() - started < 2_000, "deadline must fire well under 2s");
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
});

test("P2: Reject relations that target missing tables", () => {
	const doc = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [],
		relations: [
			{
				id: "relation:users:ghost",
				cardinality: "1:n",
				sourceTableId: "tbl_users",
				targetTableId: "tbl:does-not-exist",
				backingConstraintIds: [],
				sourceColumns: ["id"],
				targetColumns: ["ghost"],
			},
		],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/SchemaRelation\.targetTableId|tbl:does-not-exist/,
		"found case: semantic relations must fail closed when targetTableId is not a table in the document",
	);
});

test("P2: Reject relations whose backing constraints or columns do not exist", () => {
	const postsIdColumn = {
		id: "col_posts_id",
		identity: identity("app", "public", "id"),
		type: scalarUuid,
		nullable: false,
	};
	const missingBacking = irTablesDoc([
		{
			id: "tbl_users",
			identity: identity("app", "public", "users"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_posts",
			identity: identity("app", "public", "posts"),
			columns: [postsIdColumn],
			constraints: [],
			relations: [
				{
					id: "relation:posts:author",
					cardinality: "n:1",
					sourceTableId: "tbl_posts",
					targetTableId: "tbl_users",
					backingConstraintIds: ["fk:also-does-not-exist"],
					sourceColumns: ["id"],
					targetColumns: ["id"],
				},
			],
			indexes: [],
		},
	]);
	assert.throws(
		() => validateAthenaSchemaIr(missingBacking),
		/backingConstraintIds|fk:also-does-not-exist/,
		"found case: backingConstraintIds must name constraints that exist on the document",
	);

	const missingColumn = irTablesDoc([
		{
			id: "tbl_users",
			identity: identity("app", "public", "users"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_posts",
			identity: identity("app", "public", "posts"),
			columns: [postsIdColumn],
			constraints: [],
			relations: [
				{
					id: "relation:posts:author",
					cardinality: "n:1",
					sourceTableId: "tbl_posts",
					targetTableId: "tbl_users",
					backingConstraintIds: [],
					sourceColumns: ["author_id"],
					targetColumns: ["id"],
				},
			],
			indexes: [],
		},
	]);
	assert.throws(
		() => validateAthenaSchemaIr(missingColumn),
		/sourceColumns|author_id/,
		"found case: relation sourceColumns must belong to sourceTableId",
	);
});

test("P1: Pin attachment fetches to the verified DNS result", async () => {
	const fetched: Array<{
		hostHeader: string | null;
		pinnedAddress: string | undefined;
		url: string;
	}> = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		fetched.push({
			hostHeader: new Headers(init?.headers).get("host"),
			pinnedAddress: (
				init as { dispatcher?: { pin?: { address?: string } } } | undefined
			)?.dispatcher?.pin?.address,
			url: String(input),
		});
		return new Response("%PDF-pinned", {
			headers: { "content-type": "application/pdf" },
			status: 200,
		});
	}) as typeof fetch;
	const provider = smtp({
		auth: { pass: "secret", user: "smtp-user" },
		fetchImpl,
		host: "smtp.example.com",
		lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
		transport: createMemorySmtpTransport(),
	});
	const result = await provider.send(
		smtpMessage({
			attachments: [
				{
					contentType: "application/pdf",
					fileUrl: "https://evil-rebinder.example/invoice.pdf",
					filename: "invoice.pdf",
				},
			],
		}),
	);
	assert.equal(result.success, true);
	assert.equal(fetched.length, 1);
	const first = fetched[0];
	assert.ok(first, "found case: pinned attachment must be fetched");
	assert.ok(
		first.url.includes("evil-rebinder.example"),
		"found case: TLS SNI must keep the original hostname instead of rewriting the URL to the IP",
	);
	assert.equal(
		first.url.includes("8.8.8.8"),
		false,
		"found case: attachment URL must not replace the hostname with the verified IP",
	);
	assert.equal(
		first.pinnedAddress,
		"8.8.8.8",
		"found case: fetch dispatcher must pin the connection to the looked-up public address",
	);
});

test("P1: Break column rename cycles before emitting operations", () => {
	const from = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			usersIdColumn,
			{
				id: "col_users_a",
				identity: identity("app", "public", "a"),
				type: scalarUuid,
				nullable: true,
			},
			{
				id: "col_users_b",
				identity: identity("app", "public", "b"),
				type: scalarUuid,
				nullable: true,
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	const to = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			usersIdColumn,
			{
				id: "col_users_a",
				identity: identity("app", "public", "b"),
				type: scalarUuid,
				nullable: true,
			},
			{
				id: "col_users_b",
				identity: identity("app", "public", "a"),
				type: scalarUuid,
				nullable: true,
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	const diff = diffSchemas({ from, to });
	const renames = diff.operations.filter((op) => op.kind === "rename_column");
	assert.ok(
		renames.length >= 3,
		"found case: swapping physical names a↔b must insert a temporary rename instead of a→b then b→a",
	);
	const occupied = new Set(["id", "a", "b"]);
	for (const op of renames) {
		assert.equal(op.kind, "rename_column");
		if (op.kind !== "rename_column") {
			continue;
		}
		assert.equal(
			occupied.has(op.to),
			false,
			`found case: rename ${op.from} → ${op.to} collides with a live column`,
		);
		occupied.delete(op.from);
		occupied.add(op.to);
	}
	assert.equal(occupied.has("a"), true);
	assert.equal(occupied.has("b"), true);
});

test("P1: Reject zero-column key constraints", () => {
	const emptyPk = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [
			{
				id: "cst_users_pk",
				kind: "primary_key",
				columns: [],
			},
		],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(emptyPk),
		/SchemaConstraint.columns|required|empty/,
		"found case: primary_key columns: [] must fail closed instead of projecting as a dropped PK",
	);
	const withPk = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [
			{
				id: "cst_users_pk",
				kind: "primary_key",
				columns: ["id"],
			},
		],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => diffSchemas({ from: withPk, to: emptyPk }),
		/SchemaConstraint.columns|required|empty/,
		"found case: malformed empty PK IR must not emit drop_primary_key",
	);
	const emptyUnique = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [
			{
				id: "cst_users_uq",
				kind: "unique",
				columns: [],
			},
		],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(emptyUnique),
		/SchemaConstraint.columns|required|empty/,
	);
	const emptyFk = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [
			{
				id: "cst_users_fk",
				kind: "foreign_key",
				columns: [],
				targetTableId: "tbl_users",
				targetColumns: ["id"],
			},
		],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(emptyFk),
		/SchemaConstraint.columns|required|empty/,
	);
});

test("P2: Fetch valid URL attachments in skip mode", async () => {
	const { provider, transport } = smtpProvider();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () =>
		new Response("%PDF-ok", {
			headers: { "content-type": "application/pdf" },
			status: 200,
		})) as typeof fetch;
	try {
		const result = await provider.send(
			smtpMessage({
				attachmentFailureMode: "skip",
				attachments: [
					{
						contentType: "application/pdf",
						fileUrl: "https://cdn.example.com/legacy.pdf",
						filename: "legacy.pdf",
					},
				],
			}),
		);
		assert.equal(result.success, true);
		assert.equal(
			transport.payloads.some((payload) => payload.includes("legacy.pdf")),
			true,
			"found case: skip mode must still fetch a healthy public URL attachment",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("P1: Require enum types to reference declared enums", () => {
	const doc = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			usersIdColumn,
			{
				id: "col_users_mood",
				identity: identity("app", "public", "mood"),
				type: {
					kind: "enum",
					enumId: "enum_missing",
					native: {
						arrayDimensions: 0,
						backend: "postgresql",
						name: "mood",
					},
				},
				nullable: false,
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/enum_missing|enumId|does not identify/,
		"found case: enumId enum_missing must fail closed instead of projecting without labels",
	);
	assert.throws(
		() => schemaSnapshotFromIr(doc as never),
		/enum_missing|enumId|does not identify|SchemaIrError/,
		"found case: schemaSnapshotFromIr must not silently drop enum labels for a missing enumId",
	);
});

test("P1: Reject foreign keys with mismatched column counts", () => {
	const emailColumn = {
		id: "col_users_email",
		identity: identity("app", "public", "email"),
		type: {
			kind: "scalar" as const,
			semantic: "text",
			native: {
				arrayDimensions: 0,
				backend: "postgresql",
				name: "text",
			},
		},
		nullable: true,
	};
	const mismatched = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn, emailColumn],
		constraints: [
			{
				id: "cst_users_fk",
				kind: "foreign_key",
				columns: ["id", "email"],
				targetTableId: "tbl_users",
				targetColumns: ["id"],
			},
		],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(mismatched),
		/targetColumns|column count|arity|same length/,
		"found case: FK source [id, email] → target [id] must fail closed",
	);
	assert.throws(
		() => diffSchemas({ from: irTableDoc({
			id: "tbl_users",
			identity: identity("app", "public", "users"),
			columns: [usersIdColumn, emailColumn],
			constraints: [],
			relations: [],
			indexes: [],
		}), to: mismatched }),
		/targetColumns|column count|arity|same length|SchemaIrError/,
		"found case: mismatched FK arity must not emit add_foreign_key",
	);
});

test("P1: Validate optional native type parameters", () => {
	const malformed = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			usersIdColumn,
			{
				id: "col_users_code",
				identity: identity("app", "public", "code"),
				type: {
					kind: "scalar" as const,
					semantic: "text",
					native: {
						arrayDimensions: 0,
						backend: "postgresql",
						length: "oops",
						name: "varchar",
					},
				},
				nullable: true,
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(malformed),
		/length|finite|native/,
		"found case: native length: \"oops\" must fail closed instead of becoming NaN",
	);
	assert.throws(
		() => canonicalizeAthenaSchemaIr(malformed),
		/length|finite|native|SchemaIrError/,
		"found case: canonicalization must not Number(\"oops\") into NaN",
	);
});

test("P1: Free table names before renaming into them", () => {
	const from = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "a"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_b",
			identity: identity("app", "public", "b"),
			columns: [
				{
					id: "col_b_id",
					identity: identity("app", "public", "id"),
					type: scalarUuid,
					nullable: false,
				},
			],
			constraints: [],
			relations: [],
			indexes: [],
		},
	]);
	const to = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "b"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
	]);
	const diff = diffSchemas({ from, to });
	const kinds = diff.operations.map((op) => op.kind);
	const renameAt = kinds.indexOf("rename_table");
	const dropAt = kinds.indexOf("drop_table");
	assert.ok(renameAt >= 0, "expected rename_table a → b");
	assert.ok(dropAt >= 0, "expected drop_table b");
	assert.ok(
		dropAt < renameAt,
		"found case: drop occupied destination b before rename_table a → b",
	);

	const swapFrom = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "a"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_b",
			identity: identity("app", "public", "b"),
			columns: [
				{
					id: "col_b_id",
					identity: identity("app", "public", "id"),
					type: scalarUuid,
					nullable: false,
				},
			],
			constraints: [],
			relations: [],
			indexes: [],
		},
	]);
	const swapTo = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "b"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_b",
			identity: identity("app", "public", "a"),
			columns: [
				{
					id: "col_b_id",
					identity: identity("app", "public", "id"),
					type: scalarUuid,
					nullable: false,
				},
			],
			constraints: [],
			relations: [],
			indexes: [],
		},
	]);
	const swap = diffSchemas({ from: swapFrom, to: swapTo });
	const renames = swap.operations.filter((op) => op.kind === "rename_table");
	assert.ok(renames.length >= 3, "found case: a↔b table swap must use a temp hop");
	const occupied = new Set(["a", "b"]);
	for (const op of renames) {
		assert.equal(op.kind, "rename_table");
		if (op.kind !== "rename_table") {
			continue;
		}
		assert.equal(
			occupied.has(op.to.name),
			false,
			`found case: rename ${op.from.name} → ${op.to.name} collides with a live table`,
		);
		occupied.delete(op.from.name);
		occupied.add(op.to.name);
	}
	assert.equal(occupied.has("a"), true);
	assert.equal(occupied.has("b"), true);
});

test("P2: Encode non-ASCII SMTP headers", () => {
	const mime = buildSmtpMime(
		smtpMessage({
			fromName: "Ångström",
			subject: "Café résumé",
		}),
	);
	const headerBlock = mime.split("\r\n\r\n", 1)[0] ?? mime;
	assert.match(
		headerBlock,
		/Subject:\s*=\?UTF-8\?B\?/i,
		"found case: non-ASCII subject must be a MIME encoded-word",
	);
	assert.equal(
		headerBlock.includes("Café"),
		false,
		"found case: Subject must not emit raw UTF-8 Café",
	);
	assert.match(
		headerBlock,
		/From:\s*=\?UTF-8\?B\?/i,
		"found case: non-ASCII fromName must be a MIME encoded-word",
	);
	assert.equal(
		headerBlock.includes("Ångström"),
		false,
		"found case: From must not emit raw UTF-8 Ångström",
	);
});

test("P2: Include copied recipients in console delivery receipts", async () => {
	const provider = consoleEmailProvider({ log: () => undefined });
	const result = await provider.send(
		smtpMessage({
			bcc: ["blind@example.com"],
			cc: ["cc@example.com"],
			to: ["user@example.com"],
		}),
	);
	assert.deepEqual(
		result.accepted,
		["user@example.com", "cc@example.com", "blind@example.com"],
		"found case: console receipts must include Cc and Bcc like every other provider",
	);
});

test("P1: Reject duplicate physical column names", () => {
	const duplicate = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			usersIdColumn,
			{
				id: "col_users_email_a",
				identity: identity("app", "public", "email"),
				type: {
					kind: "scalar" as const,
					semantic: "text",
					native: {
						arrayDimensions: 0,
						backend: "postgresql",
						name: "text",
					},
				},
				nullable: true,
			},
			{
				id: "col_users_email_b",
				identity: identity("app", "public", "email"),
				type: {
					kind: "scalar" as const,
					semantic: "text",
					native: {
						arrayDimensions: 0,
						backend: "postgresql",
						name: "text",
					},
				},
				nullable: true,
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(duplicate),
		/duplicate|physical name|email/,
		"found case: two columns with physical name email must fail closed",
	);
});

test("P1: Bound HTTP provider requests", async () => {
	const hangingFetch = httpEmailProvider({
		fetchImpl: () => new Promise(() => undefined) as Promise<Response>,
		timeoutMs: 40,
		url: "https://hooks.example.com/mail",
	});
	const started = Date.now();
	await assert.rejects(
		() => hangingFetch.send(smtpMessage()),
		(error: unknown) =>
			error instanceof AthenaEmailError &&
			error.code === ATHENA_EMAIL_DELIVERY_FAILED &&
			/timed out/i.test(error.message),
		"found case: hanging HTTP fetch must abort instead of pending forever",
	);
	assert.ok(
		Date.now() - started < 5_000,
		"found case: HTTP timeout must fire on the request deadline",
	);

	const hangingBody = httpEmailProvider({
		fetchImpl: async () =>
			({
				json: () => new Promise(() => undefined),
				ok: true,
				status: 200,
			}) as unknown as Response,
		timeoutMs: 40,
		url: "https://hooks.example.com/mail",
	});
	await assert.rejects(
		() => hangingBody.send(smtpMessage()),
		(error: unknown) =>
			error instanceof AthenaEmailError &&
			error.code === ATHENA_EMAIL_DELIVERY_FAILED &&
			/timed out/i.test(error.message),
		"found case: hanging JSON body read must abort",
	);
});

test("P1: Preserve the hostname for HTTPS attachment TLS", async () => {
	const fetched: Array<{ hostHeader: string | null; url: string }> = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		fetched.push({
			hostHeader: new Headers(init?.headers).get("host"),
			url: String(input),
		});
		return new Response("%PDF-ok", {
			headers: { "content-type": "application/pdf" },
			status: 200,
		});
	}) as typeof fetch;
	const provider = smtp({
		auth: { pass: "secret", user: "smtp-user" },
		fetchImpl,
		host: "smtp.example.com",
		lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
		transport: createMemorySmtpTransport(),
	});
	const result = await provider.send(
		smtpMessage({
			attachments: [
				{
					contentType: "application/pdf",
					fileUrl: "https://cdn.example.com/invoice.pdf",
					filename: "invoice.pdf",
				},
			],
		}),
	);
	assert.equal(result.success, true);
	assert.equal(fetched.length, 1);
	const first = fetched[0];
	assert.ok(first, "found case: HTTPS attachment must be fetched");
	const fetchedUrl = new URL(first.url);
	assert.equal(
		fetchedUrl.hostname,
		"cdn.example.com",
		"found case: rewriting https://cdn.example.com to the resolved IP makes TLS SNI/cert verify against 8.8.8.8 and hostname-only certs fail",
	);
	assert.equal(
		fetchedUrl.hostname.includes("8.8.8.8"),
		false,
		"found case: attachment URL hostname must not be replaced with the verified IP",
	);
});

test("P1: Reject duplicate physical table identities", () => {
	const duplicate = irTablesDoc([
		{
			id: "tbl_users",
			identity: identity("app", "public", "users"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_users_alias",
			identity: identity("app", "public", "users"),
			columns: [
				{
					id: "col_alias_id",
					identity: identity("app", "public", "id"),
					type: scalarUuid,
					nullable: false,
				},
			],
			constraints: [],
			relations: [],
			indexes: [],
		},
	]);
	assert.throws(
		() => validateAthenaSchemaIr(duplicate),
		/duplicate|physical identity|users/,
		"found case: two tables with distinct ids but the same physical database/namespace/name must fail closed",
	);
});

test("P1: Reject multiple primary-key constraints", () => {
	const twoPks = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [
			{
				id: "cst_users_pk_a",
				kind: "primary_key",
				columns: ["id"],
			},
			{
				id: "cst_users_pk_b",
				kind: "primary_key",
				columns: ["id"],
			},
		],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(twoPks),
		/primary_key|at most one|primary key/,
		"found case: two independently valid primary_key constraints on the same table must fail closed",
	);
});

test("P1: Require a nonnegative integer array dimension", () => {
	const negative = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			{
				...usersIdColumn,
				type: {
					...scalarUuid,
					native: { ...scalarUuid.native, arrayDimensions: -1 },
				},
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(negative),
		/arrayDimensions|nonnegative|integer/,
		"found case: arrayDimensions: -1 must fail closed instead of canonicalizing a bogus array type",
	);

	const fractional = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			{
				...usersIdColumn,
				type: {
					...scalarUuid,
					native: { ...scalarUuid.native, arrayDimensions: 1.5 },
				},
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(fractional),
		/arrayDimensions|integer/,
		"found case: arrayDimensions: 1.5 must fail closed instead of becoming a distinct column type",
	);
});

test("P1: Reject repeated columns within key constraints", () => {
	const duplicatePk = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [
			{
				id: "cst_users_pk",
				kind: "primary_key",
				columns: ["id", "id"],
			},
		],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(duplicatePk),
		/duplicate|repeat|unique/,
		'found case: primary_key columns: ["id", "id"] must fail closed instead of emitting an unusable key',
	);

	const authorIdColumn = {
		id: "col_posts_author",
		identity: identity("app", "public", "author_id"),
		type: scalarUuid,
		nullable: false,
	};
	const reviewerIdColumn = {
		id: "col_posts_reviewer",
		identity: identity("app", "public", "reviewer_id"),
		type: scalarUuid,
		nullable: false,
	};
	const duplicateFkTargets = irTablesDoc([
		{
			id: "tbl_users",
			identity: identity("app", "public", "users"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_posts",
			identity: identity("app", "public", "posts"),
			columns: [
				{
					id: "col_posts_id",
					identity: identity("app", "public", "id"),
					type: scalarUuid,
					nullable: false,
				},
				authorIdColumn,
				reviewerIdColumn,
			],
			constraints: [
				{
					id: "cst_posts_authors",
					kind: "foreign_key",
					columns: ["author_id", "reviewer_id"],
					targetTableId: "tbl_users",
					targetColumns: ["id", "id"],
				},
			],
			relations: [],
			indexes: [],
		},
	]);
	assert.throws(
		() => validateAthenaSchemaIr(duplicateFkTargets),
		/targetColumns|duplicate|repeat|unique/,
		'found case: foreign-key targetColumns: ["id", "id"] must fail closed instead of emitting a PostgreSQL-invalid key',
	);
});

test("P1: Reject repeated columns in indexes", () => {
	const duplicateStrings = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [],
		relations: [],
		indexes: [
			{
				id: "idx_users_id",
				columns: ["id", "id"],
				unique: false,
			},
		],
	});
	assert.throws(
		() => validateAthenaSchemaIr(duplicateStrings),
		/SchemaIndex\.columns|duplicate|repeat/,
		'found case: index columns: ["id", "id"] must fail closed instead of emitting a PostgreSQL-invalid index',
	);

	const duplicateObjects = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [],
		relations: [],
		indexes: [
			{
				id: "idx_users_id",
				columns: [{ name: "id" }, { name: "id", direction: "desc" }],
				unique: false,
			},
		],
	});
	assert.throws(
		() => validateAthenaSchemaIr(duplicateObjects),
		/SchemaIndex\.columns|duplicate|repeat/,
		"found case: index columns repeating the same name via objects must fail closed",
	);
});

test("P1: Stream pinned attachment responses before enforcing the cap", async () => {
	const originalRequest = http.request;
	const chunk = Buffer.alloc(256 * 1024, 7);
	const server = http.createServer((_req, res) => {
		res.writeHead(200, { "content-type": "application/octet-stream" });
		const pump = () => {
			if (!res.writable) {
				return;
			}
			res.write(chunk, () => {
				if (res.writable) {
					setImmediate(pump);
				}
			});
		};
		pump();
	});
	const port = await new Promise<number>((resolve, reject) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address && typeof address === "object") {
				resolve(address.port);
				return;
			}
			reject(new Error("test HTTP server did not bind a port"));
		});
		server.on("error", reject);
	});
	http.request = ((
		url: string | URL | http.RequestOptions,
		options?: http.RequestOptions | ((res: http.IncomingMessage) => void),
		callback?: (res: http.IncomingMessage) => void,
	) => {
		if (
			url &&
			typeof url === "object" &&
			!(url instanceof URL) &&
			url.hostname === "8.8.8.8"
		) {
			url.hostname = "127.0.0.1";
		}
		return originalRequest(
			url as never,
			options as never,
			callback as never,
		);
	}) as typeof http.request;
	try {
		const provider = smtp({
			auth: { pass: "secret", user: "smtp-user" },
			host: "smtp.example.com",
			lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
			transport: createMemorySmtpTransport(),
		});
		const started = Date.now();
		await assert.rejects(
			() =>
				provider.send(
					smtpMessage({
						attachments: [
							{
								contentType: "application/octet-stream",
								fileUrl: `http://cdn.example.com:${port}/endless.bin`,
								filename: "endless.bin",
							},
						],
					}),
				),
			(error: unknown) =>
				error instanceof AthenaEmailError &&
				error.code === ATHENA_EMAIL_DELIVERY_FAILED &&
				/size limit/i.test(error.message),
			"found case: DNS-pinned attachment fetch must apply the 10 MiB cap while reading, not after buffering the whole body",
		);
		assert.ok(
			Date.now() - started < 8_000,
			"found case: an endless public attachment body must fail on the byte cap instead of waiting for the response to end",
		);
	} finally {
		http.request = originalRequest;
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
});

test("P1: Use the configured timeout for pinned HTTP sockets", async () => {
	const originalRequest = http.request;
	const configuredTimeoutMs = 45_000;
	let seenSocketTimeout: number | undefined;
	const server = http.createServer((_req, res) => {
		res.writeHead(200, { "content-type": "application/pdf" });
		res.end("%PDF-1.4");
	});
	const port = await new Promise<number>((resolve, reject) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address && typeof address === "object") {
				resolve(address.port);
				return;
			}
			reject(new Error("test HTTP server did not bind a port"));
		});
		server.on("error", reject);
	});
	http.request = ((
		url: string | URL | http.RequestOptions,
		options?: http.RequestOptions | ((res: http.IncomingMessage) => void),
		callback?: (res: http.IncomingMessage) => void,
	) => {
		const opts =
			url && typeof url === "object" && !(url instanceof URL)
				? url
				: typeof options === "object"
					? options
					: undefined;
		if (opts && typeof opts.timeout === "number") {
			seenSocketTimeout = opts.timeout;
		}
		if (opts && opts.hostname === "8.8.8.8") {
			opts.hostname = "127.0.0.1";
		}
		return originalRequest(
			url as never,
			options as never,
			callback as never,
		);
	}) as typeof http.request;
	try {
		const provider = smtp({
			attachmentFetchTimeoutMs: configuredTimeoutMs,
			auth: { pass: "secret", user: "smtp-user" },
			host: "smtp.example.com",
			lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
			transport: createMemorySmtpTransport(),
		});
		await provider.send(
			smtpMessage({
				attachments: [
					{
						contentType: "application/pdf",
						fileUrl: `http://cdn.example.com:${port}/legacy.pdf`,
						filename: "legacy.pdf",
					},
				],
			}),
		);
		assert.equal(
			seenSocketTimeout,
			configuredTimeoutMs,
			"found case: DNS-pinned Node HTTP request must use attachmentFetchTimeoutMs for socket timeout, not the 15s constant",
		);
	} finally {
		http.request = originalRequest;
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
});

test("P1: Reject fractional native type parameters", () => {
	const fractionalLength = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			{
				...usersIdColumn,
				type: {
					kind: "scalar" as const,
					semantic: "text",
					native: {
						arrayDimensions: 0,
						backend: "postgresql",
						length: 1.5,
						name: "varchar",
					},
				},
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(fractionalLength),
		/length|integer/,
		"found case: length: 1.5 must fail closed instead of canonicalizing a fractional native modifier",
	);

	const fractionalPrecision = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			{
				...usersIdColumn,
				type: {
					kind: "scalar" as const,
					semantic: "decimal",
					native: {
						arrayDimensions: 0,
						backend: "postgresql",
						name: "numeric",
						precision: 2.5,
					},
				},
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(fractionalPrecision),
		/precision|integer/,
		"found case: precision: 2.5 must fail closed instead of emitting an unusable native-type migration",
	);
});

test("P1: Block shared-address-space attachment targets", async () => {
	const fetched: string[] = [];
	const fetchImpl = (async (input: RequestInfo | URL) => {
		fetched.push(String(input));
		return new Response("secret", { status: 200 });
	}) as typeof fetch;
	const literalProvider = smtp({
		auth: { pass: "secret", user: "smtp-user" },
		fetchImpl,
		host: "smtp.example.com",
		lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
		transport: createMemorySmtpTransport(),
	});

	await assert.rejects(
		() =>
			literalProvider.send(
				smtpMessage({
					attachments: [
						{
							contentType: "application/pdf",
							fileUrl: "http://100.64.0.1/secret.pdf",
							filename: "secret.pdf",
						},
					],
				}),
			),
		/private|shared|reserved|SMTP attachment/i,
		"found case: http://100.64.0.1/ must be rejected before fetch",
	);

	const resolvedProvider = smtp({
		auth: { pass: "secret", user: "smtp-user" },
		fetchImpl,
		host: "smtp.example.com",
		lookupImpl: async () => [{ address: "100.64.0.1", family: 4 }],
		transport: createMemorySmtpTransport(),
	});
	await assert.rejects(
		() =>
			resolvedProvider.send(
				smtpMessage({
					attachments: [
						{
							contentType: "application/pdf",
							fileUrl: "https://cdn.example.com/secret.pdf",
							filename: "secret.pdf",
						},
					],
				}),
			),
		/private|shared|reserved|SMTP attachment/i,
		"found case: DNS that resolves to 100.64.0.1 must be rejected before fetch",
	);
	assert.equal(
		fetched.length,
		0,
		"found case: 100.64.0.0/10 attachment targets must not be fetched",
	);
});

test("P1: Bound Resend provider requests", { timeout: 3_000 }, async () => {
	const hangingFetch = resend({
		apiKey: "re_test",
		fetchImpl: () => new Promise(() => undefined) as Promise<Response>,
		timeoutMs: 40,
	});
	const started = Date.now();
	await assert.rejects(
		() => hangingFetch.send(smtpMessage()),
		(error: unknown) =>
			error instanceof AthenaEmailError &&
			error.code === ATHENA_EMAIL_DELIVERY_FAILED &&
			/timed out/i.test(error.message),
		"found case: hanging Resend fetch must abort instead of pending forever",
	);
	assert.ok(
		Date.now() - started < 5_000,
		"found case: Resend timeout must cover the request deadline",
	);

	const hangingBody = resend({
		apiKey: "re_test",
		fetchImpl: async () =>
			({
				json: () => new Promise(() => undefined),
				ok: true,
				status: 200,
			}) as unknown as Response,
		timeoutMs: 40,
	});
	await assert.rejects(
		() => hangingBody.send(smtpMessage()),
		(error: unknown) =>
			error instanceof AthenaEmailError &&
			error.code === ATHENA_EMAIL_DELIVERY_FAILED &&
			/timed out/i.test(error.message),
		"found case: hanging Resend JSON body read must abort",
	);
});

test("P1: Drop dependent foreign keys before freeing rename targets", () => {
	const tableBId = {
		id: "col_b_id",
		identity: identity("app", "public", "id"),
		type: scalarUuid,
		nullable: false,
	};
	const tableCId = {
		id: "col_c_id",
		identity: identity("app", "public", "id"),
		type: scalarUuid,
		nullable: false,
	};
	const from = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "a"),
			columns: [usersIdColumn],
			constraints: [{ id: "cst_a_pk", kind: "primary_key", columns: ["id"] }],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_b",
			identity: identity("app", "public", "b"),
			columns: [tableBId],
			constraints: [{ id: "cst_b_pk", kind: "primary_key", columns: ["id"] }],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_c",
			identity: identity("app", "public", "c"),
			columns: [
				tableCId,
				{
					id: "col_c_b_id",
					identity: identity("app", "public", "b_id"),
					type: scalarUuid,
					nullable: false,
				},
			],
			constraints: [
				{ id: "cst_c_pk", kind: "primary_key", columns: ["id"] },
				{
					id: "cst_c_b_fk",
					kind: "foreign_key",
					columns: ["b_id"],
					targetTableId: "tbl_b",
					targetColumns: ["id"],
				},
			],
			relations: [],
			indexes: [],
		},
	]);
	const to = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "b"),
			columns: [usersIdColumn],
			constraints: [{ id: "cst_a_pk", kind: "primary_key", columns: ["id"] }],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_c",
			identity: identity("app", "public", "c"),
			columns: [
				tableCId,
				{
					id: "col_c_b_id",
					identity: identity("app", "public", "b_id"),
					type: scalarUuid,
					nullable: false,
				},
			],
			constraints: [{ id: "cst_c_pk", kind: "primary_key", columns: ["id"] }],
			relations: [],
			indexes: [],
		},
	]);
	const diff = diffSchemas({ from, to });
	const dropFkAt = diff.operations.findIndex(
		(op) => op.kind === "drop_foreign_key",
	);
	const dropTableAt = diff.operations.findIndex(
		(op) => op.kind === "drop_table" && op.table.name === "b",
	);
	const renameAt = diff.operations.findIndex(
		(op) =>
			op.kind === "rename_table" &&
			op.from.name === "a" &&
			op.to.name === "b",
	);
	assert.ok(dropFkAt >= 0, "expected drop_foreign_key on retained table c");
	assert.ok(dropTableAt >= 0, "expected drop_table b");
	assert.ok(renameAt >= 0, "expected rename_table a → b");
	assert.ok(
		dropFkAt < dropTableAt,
		"found case: inbound FK to old b must drop before drop_table b that frees the rename destination",
	);
	assert.ok(
		dropTableAt < renameAt,
		"found case: drop occupied destination b before rename_table a → b",
	);
});

test("P1: Keep renamed-table mutations after freeing the destination", () => {
	const extraColumn = {
		id: "col_a_extra",
		identity: identity("app", "public", "extra"),
		type: scalarUuid,
		nullable: true,
	};
	const tableBId = {
		id: "col_b_id",
		identity: identity("app", "public", "id"),
		type: scalarUuid,
		nullable: false,
	};
	const from = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "a"),
			columns: [usersIdColumn, extraColumn],
			constraints: [],
			relations: [],
			indexes: [
				{
					id: "idx_a_extra",
					columns: ["extra"],
					unique: false,
					name: "idx_a_extra",
				},
			],
		},
		{
			id: "tbl_b",
			identity: identity("app", "public", "b"),
			columns: [tableBId],
			constraints: [],
			relations: [],
			indexes: [],
		},
	]);
	const to = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "b"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
	]);
	const diff = diffSchemas({ from, to });
	const dropTableAt = diff.operations.findIndex(
		(op) => op.kind === "drop_table" && op.table.name === "b",
	);
	const renameAt = diff.operations.findIndex(
		(op) =>
			op.kind === "rename_table" &&
			op.from.name === "a" &&
			op.to.name === "b",
	);
	const dropColumnAt = diff.operations.findIndex(
		(op) => op.kind === "drop_column" && op.column.name === "extra",
	);
	const dropIndexAt = diff.operations.findIndex(
		(op) => op.kind === "drop_index" && op.index.name === "idx_a_extra",
	);
	assert.ok(dropTableAt >= 0, "expected drop_table of obsolete b");
	assert.ok(renameAt >= 0, "expected rename_table a → b");
	assert.ok(dropColumnAt >= 0, "expected drop_column extra on the renamed table");
	assert.ok(dropIndexAt >= 0, "expected drop_index idx_a_extra on the renamed table");
	assert.ok(
		dropTableAt < renameAt,
		"found case: obsolete b must drop before rename_table a → b",
	);
	assert.ok(
		renameAt < dropColumnAt,
		"found case: drop_column extra is recorded as table b but belongs to renamed a; it must run after rename_table a → b, not before drop_table of obsolete b",
	);
	assert.ok(
		renameAt < dropIndexAt,
		"found case: drop_index on the renamed table must run after rename_table a → b",
	);
});

test("P1: Reject empty explicit index names", () => {
	const doc = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [],
		relations: [],
		indexes: [
			{
				id: "idx_users_id",
				columns: ["id"],
				unique: false,
				name: "",
			},
		],
	});
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/SchemaIndex.name|non-empty/,
		'found case: index name: "" must fail closed instead of emitting a zero-length identifier',
	);
});

test("P1: Create destination schemas before moving tables", () => {
	const fromTable = {
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [],
		relations: [],
		indexes: [],
	};
	const from = {
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: [
			{
				id: "db_app",
				identity: identity("app", "public", "app"),
				namespaces: [
					{
						id: "ns_public",
						identity: identity("app", "public", "public"),
						tables: [fromTable],
					},
				],
			},
		],
		metadata: {},
	};
	const to = {
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: [
			{
				id: "db_app",
				identity: identity("app", "public", "app"),
				namespaces: [
					{
						id: "ns_analytics",
						identity: identity("app", "analytics", "analytics"),
						tables: [
							{
								...fromTable,
								identity: identity("app", "analytics", "users"),
							},
						],
					},
				],
			},
		],
		metadata: {},
	};
	const diff = diffSchemas({
		from: schemaIrFixture(from),
		to: schemaIrFixture(to),
	});
	const createAt = diff.operations.findIndex(
		(op) => op.kind === "create_schema" && op.schema === "analytics",
	);
	const renameAt = diff.operations.findIndex(
		(op) =>
			op.kind === "rename_table" &&
			op.from.schema === "public" &&
			op.to.schema === "analytics",
	);
	assert.ok(createAt >= 0, "expected create_schema analytics");
	assert.ok(renameAt >= 0, "expected rename_table public.users → analytics.users");
	assert.ok(
		createAt < renameAt,
		"found case: moving a stable table into a new schema must create_schema before rename_table",
	);
});

test("P1: Drop obsolete columns before reusing their names", () => {
	const from = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			usersIdColumn,
			{
				id: "col_users_a",
				identity: identity("app", "public", "a"),
				type: scalarUuid,
				nullable: true,
			},
			{
				id: "col_users_b",
				identity: identity("app", "public", "b"),
				type: scalarUuid,
				nullable: true,
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	const to = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [
			usersIdColumn,
			{
				id: "col_users_a",
				identity: identity("app", "public", "b"),
				type: scalarUuid,
				nullable: true,
			},
		],
		constraints: [],
		relations: [],
		indexes: [],
	});
	const diff = diffSchemas({
		from: schemaIrFixture(from),
		to: schemaIrFixture(to),
	});
	const dropAt = diff.operations.findIndex(
		(op) => op.kind === "drop_column" && op.column.name === "b",
	);
	const renameAt = diff.operations.findIndex(
		(op) =>
			op.kind === "rename_column" && op.from === "a" && op.to === "b",
	);
	assert.ok(dropAt >= 0, "expected drop_column b");
	assert.ok(renameAt >= 0, "expected rename_column a → b");
	assert.ok(
		dropAt < renameAt,
		"found case: renaming a→b while dropping unrelated b must drop_column before rename_column",
	);
});

test("P1: Reject empty constraint names", () => {
	for (const kind of ["primary_key", "unique", "foreign_key"] as const) {
		const doc = irTableDoc({
			id: "tbl_users",
			identity: identity("app", "public", "users"),
			columns: [usersIdColumn],
			constraints: [
				{
					id: "cst_named",
					kind,
					columns: ["id"],
					name: "",
					...(kind === "foreign_key"
						? { targetTableId: "tbl_users", targetColumns: ["id"] }
						: {}),
				},
			],
			relations: [],
			indexes: [],
		});
		assert.throws(
			() => validateAthenaSchemaIr(doc),
			/SchemaConstraint.name|non-empty/,
			`found case: ${kind} name: "" must fail closed instead of emitting a zero-length identifier`,
		);
	}
});

test("P1: Preserve independently supplied relation target columns", () => {
	const postsIdColumn = {
		id: "col_posts_id",
		identity: identity("app", "public", "id"),
		type: scalarUuid,
		nullable: false,
	};
	const usersEmailColumn = {
		id: "col_users_email",
		identity: identity("app", "public", "email"),
		type: scalarUuid,
		nullable: false,
	};
	const relationDoc = (targetColumns: string[]) =>
		irTablesDoc([
			{
				id: "tbl_users",
				identity: identity("app", "public", "users"),
				columns: [usersIdColumn, usersEmailColumn],
				constraints: [],
				relations: [],
				indexes: [],
			},
			{
				id: "tbl_posts",
				identity: identity("app", "public", "posts"),
				columns: [postsIdColumn],
				constraints: [],
				relations: [
					{
						id: "relation:posts:author",
						cardinality: "n:1",
						sourceTableId: "tbl_posts",
						targetTableId: "tbl_users",
						backingConstraintIds: [],
						targetColumns,
					},
				],
				indexes: [],
			},
		]);
	const onlyId = relationDoc(["id"]);
	const onlyEmail = relationDoc(["email"]);
	const canonical = canonicalizeAthenaSchemaIr(onlyId);
	const relation = canonical.databases[0]?.namespaces[0]?.tables
		.find((table) => table.id === "tbl_posts")
		?.relations?.find((item) => item.id === "relation:posts:author");
	assert.deepEqual(
		relation?.targetColumns,
		["id"],
		"found case: SchemaRelation.targetColumns without sourceColumns must survive canonicalize",
	);
	assert.equal(
		relation?.sourceColumns,
		undefined,
		"found case: omitted sourceColumns must stay omitted when only targetColumns is supplied",
	);
	assert.notEqual(
		fingerprintAthenaSchemaIr(onlyId),
		fingerprintAthenaSchemaIr(onlyEmail),
		"found case: different targetColumns-only relations must not share a fingerprint",
	);
});

test("P1: Reject duplicate explicit constraint names per table", () => {
	const doc = irTableDoc({
		id: "tbl_users",
		identity: identity("app", "public", "users"),
		columns: [usersIdColumn],
		constraints: [
			{
				id: "cst_users_pk",
				kind: "primary_key",
				columns: ["id"],
				name: "users_identity",
			},
			{
				id: "cst_users_uq",
				kind: "unique",
				columns: ["id"],
				name: "users_identity",
			},
		],
		relations: [],
		indexes: [],
	});
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/SchemaConstraint\.name|users_identity|Duplicate/,
		"found case: structurally different constraints sharing name users_identity must fail closed",
	);
});

test("P1: Reject duplicate explicit index names per namespace", () => {
	const postsIdColumn = {
		id: "col_posts_id",
		identity: identity("app", "public", "id"),
		type: scalarUuid,
		nullable: false,
	};
	const doc = irTablesDoc([
		{
			id: "tbl_users",
			identity: identity("app", "public", "users"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [
				{
					id: "idx_users_lookup",
					columns: ["id"],
					unique: false,
					name: "idx_lookup",
				},
			],
		},
		{
			id: "tbl_posts",
			identity: identity("app", "public", "posts"),
			columns: [postsIdColumn],
			constraints: [],
			relations: [],
			indexes: [
				{
					id: "idx_posts_lookup",
					columns: ["id"],
					unique: true,
					name: "idx_lookup",
				},
			],
		},
	]);
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/SchemaIndex\.name|idx_lookup|Duplicate/,
		"found case: two tables in public sharing explicit index name idx_lookup must fail closed",
	);
});

test("P2: Escape backslashes in attachment filenames", () => {
	const mime = buildSmtpMime(
		smtpMessage({
			attachments: [
				{
					content: new Uint8Array([1, 2, 3]),
					contentType: "text/plain",
					filename: "report\\",
				},
			],
		}),
	);
	assert.match(
		mime,
		/filename="report\\\\"/,
		'found case: trailing backslash filename report\\ must emit filename="report\\\\" so the closing quote is not escaped',
	);
	assert.doesNotMatch(
		mime,
		/filename="report\\"/,
		"found case: filename=\"report\\\" is a malformed quoted-string",
	);
});

test("P2: Quote ASCII display names with RFC specials", () => {
	const mime = buildSmtpMime(
		smtpMessage({
			fromName: "Doe, John",
		}),
	);
	const headerBlock = mime.split("\r\n\r\n", 1)[0] ?? mime;
	assert.match(
		headerBlock,
		/^From: "Doe, John" <no-reply@example.com>/m,
		"found case: fromName Doe, John must be a quoted-string so the comma is not a mailbox separator",
	);
	const quoted = buildSmtpMime(
		smtpMessage({
			fromName: 'Acme "West"',
		}),
	);
	const quotedHeader = quoted.split("\r\n\r\n", 1)[0] ?? quoted;
	assert.match(
		quotedHeader,
		/^From: "Acme \\"West\\"" <no-reply@example.com>/m,
		'found case: ASCII quotes in fromName must be escaped inside a quoted-string',
	);
});

test("P1: Reserve table names while validating index names", () => {
	const postsIdColumn = {
		id: "col_posts_id",
		identity: identity("app", "public", "id"),
		type: scalarUuid,
		nullable: false,
	};
	const doc = irTablesDoc([
		{
			id: "tbl_users",
			identity: identity("app", "public", "users"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_posts",
			identity: identity("app", "public", "posts"),
			columns: [postsIdColumn],
			constraints: [],
			relations: [],
			indexes: [
				{
					id: "idx_posts_users",
					columns: ["id"],
					unique: false,
					name: "users",
				},
			],
		},
	]);
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/SchemaIndex\.name|users|table|Duplicate|conflict/i,
		"found case: table users plus index named users on posts in public must fail closed",
	);
});

test("P1: Drop conflicting indexes before renaming tables", () => {
	const otherIdColumn = {
		id: "col_other_id",
		identity: identity("app", "public", "id"),
		type: scalarUuid,
		nullable: false,
	};
	const from = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "a"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_other",
			identity: identity("app", "public", "other"),
			columns: [otherIdColumn],
			constraints: [],
			relations: [],
			indexes: [
				{
					id: "idx_other_b",
					columns: ["id"],
					unique: false,
					name: "b",
				},
			],
		},
	]);
	const to = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "b"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_other",
			identity: identity("app", "public", "other"),
			columns: [otherIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
	]);
	const diff = diffSchemas({
		from: schemaIrFixture(from),
		to: schemaIrFixture(to),
	});
	const kinds = diff.operations.map((op) => op.kind);
	const renameAt = kinds.indexOf("rename_table");
	const dropAt = kinds.indexOf("drop_index");
	assert.ok(renameAt >= 0, "expected rename_table");
	assert.ok(dropAt >= 0, "expected drop_index");
	assert.ok(
		dropAt < renameAt,
		"found case: renaming a→b while dropping index b must drop_index before rename_table",
	);
	const drop = diff.operations[dropAt];
	assert.ok(drop && drop.kind === "drop_index");
	assert.equal(drop.index.name, "b");
});

test("P1: Free relation names owned by dropped tables before renaming", () => {
	const otherIdColumn = {
		id: "col_other_id",
		identity: identity("app", "public", "id"),
		type: scalarUuid,
		nullable: false,
	};
	const otherCode = {
		id: "col_other_code",
		identity: identity("app", "public", "code"),
		type: {
			kind: "scalar" as const,
			semantic: "text",
			native: {
				arrayDimensions: 0,
				backend: "postgresql",
				name: "text",
			},
		},
		nullable: false,
	};
	const renamedTo = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "b"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
	]);
	const assertDropBeforeRename = (
		from: AthenaSchemaIr,
		message: string,
	) => {
		const diff = diffSchemas({ from, to: renamedTo });
		const dropAt = diff.operations.findIndex((op) => op.kind === "drop_table");
		const renameAt = diff.operations.findIndex(
			(op) =>
				op.kind === "rename_table" &&
				op.from.name === "a" &&
				op.to.name === "b",
		);
		assert.ok(dropAt >= 0, "expected drop_table of the occupant owner");
		assert.ok(renameAt >= 0, "expected rename_table a → b");
		const drop = diff.operations[dropAt];
		assert.ok(drop && drop.kind === "drop_table");
		assert.equal(drop.table.name, "other");
		assert.ok(dropAt < renameAt, message);
	};

	assertDropBeforeRename(
		irTablesDoc([
			{
				id: "tbl_a",
				identity: identity("app", "public", "a"),
				columns: [usersIdColumn],
				constraints: [],
				relations: [],
				indexes: [],
			},
			{
				id: "tbl_other",
				identity: identity("app", "public", "other"),
				columns: [otherIdColumn],
				constraints: [],
				relations: [],
				indexes: [
					{
						id: "idx_other_b",
						columns: ["id"],
						unique: false,
						name: "b",
					},
				],
			},
		]),
		"found case: drop_table other (index named b) must precede rename_table a → b",
	);
	assertDropBeforeRename(
		irTablesDoc([
			{
				id: "tbl_a",
				identity: identity("app", "public", "a"),
				columns: [usersIdColumn],
				constraints: [],
				relations: [],
				indexes: [],
			},
			{
				id: "tbl_other",
				identity: identity("app", "public", "other"),
				columns: [otherIdColumn, otherCode],
				constraints: [
					{
						columns: ["code"],
						id: "cst_other_uq",
						kind: "unique",
						name: "b",
					},
				],
				indexes: [],
				relations: [],
			},
		]),
		"found case: drop_table other (unique named b) must precede rename_table a → b",
	);
	assertDropBeforeRename(
		irTablesDoc([
			{
				id: "tbl_a",
				identity: identity("app", "public", "a"),
				columns: [usersIdColumn],
				constraints: [],
				relations: [],
				indexes: [],
			},
			{
				id: "tbl_other",
				identity: identity("app", "public", "other"),
				columns: [otherIdColumn],
				constraints: [
					{
						columns: ["id"],
						id: "cst_other_pk",
						kind: "primary_key",
						name: "b",
					},
				],
				indexes: [],
				relations: [],
			},
		]),
		"found case: drop_table other (primary key named b) must precede rename_table a → b",
	);
});

test("P1: Bound attachment DNS resolution", async () => {
	const transport = createMemorySmtpTransport();
	const provider = smtp({
		attachmentFetchTimeoutMs: 25,
		auth: { pass: "secret", user: "smtp-user" },
		host: "smtp.example.com",
		lookupImpl: () => new Promise(() => undefined),
		transport,
	});
	const sendPromise = provider.send(
		smtpMessage({
			attachments: [
				{
					contentType: "application/pdf",
					fileUrl: "https://cdn.example.com/legacy.pdf",
					filename: "legacy.pdf",
				},
			],
		}),
	).then(
		() => "ok" as const,
		(error: unknown) => error,
	);
	const hung = new Promise<"hung">((resolve) => {
		setTimeout(() => {
			resolve("hung");
		}, 200);
	});
	const outcome = await Promise.race([sendPromise, hung]);
	assert.notEqual(
		outcome,
		"hung",
		"found case: hanging attachment DNS must not wait past the 15s fetch budget",
	);
	assert.ok(
		outcome instanceof AthenaEmailError &&
			outcome.code === ATHENA_EMAIL_DELIVERY_FAILED &&
			/timed out|timeout/i.test(outcome.message),
		"found case: hanging attachment DNS must fail closed inside the 15s fetch budget",
	);
});

test("P2: Split long MIME encoded-words", () => {
	const subject = "カフェ".repeat(40);
	const fromName = "氏名".repeat(40);
	const mime = buildSmtpMime(
		smtpMessage({
			fromName,
			subject,
		}),
	);
	const headerBlock = mime.split("\r\n\r\n", 1)[0] ?? mime;
	const encodedWords = headerBlock.match(/=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/gi) ?? [];
	assert.ok(
		encodedWords.length >= 2,
		"found case: long localized Subject/From must use more than one encoded-word",
	);
	for (const word of encodedWords) {
		assert.ok(
			word.length <= 75,
			`found case: encoded-word length ${String(word.length)} exceeds RFC 2047's 75-character limit: ${word}`,
		);
	}
	assert.match(
		headerBlock,
		/=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n[ \t]=\?UTF-8\?B\?/i,
		"found case: long encoded-words must fold the header with CRLF WSP",
	);
	const decodeWords = (header: string, name: string): string => {
		const line = header
			.split(/\r\n(?![ \t])/)
			.find((entry) => entry.toLowerCase().startsWith(`${name.toLowerCase()}:`));
		assert.ok(line, `expected ${name} header`);
		const chunks =
			line.match(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi) ?? [];
		const bytes = Buffer.concat(
			chunks.map((word) => {
				const payload = word.replace(/^=\?UTF-8\?B\?/i, "").replace(/\?=$/, "");
				return Buffer.from(payload, "base64");
			}),
		);
		return bytes.toString("utf8");
	};
	assert.equal(
		decodeWords(headerBlock, "Subject"),
		subject,
		"found case: folded encoded-words must round-trip the original UTF-8 subject",
	);
	assert.equal(
		decodeWords(headerBlock, "From").startsWith(fromName),
		true,
		"found case: folded encoded-words must round-trip the original UTF-8 display name",
	);
});

test("P1: Reserve primary and unique constraint index names per namespace", () => {
	const postsIdColumn = {
		id: "col_posts_id",
		identity: identity("app", "public", "id"),
		type: scalarUuid,
		nullable: false,
	};
	const doc = irTablesDoc([
		{
			id: "tbl_users",
			identity: identity("app", "public", "users"),
			columns: [usersIdColumn],
			constraints: [
				{
					id: "pk_users",
					kind: "primary_key",
					columns: ["id"],
					name: "shared_pkey",
				},
			],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_posts",
			identity: identity("app", "public", "posts"),
			columns: [postsIdColumn],
			constraints: [
				{
					id: "pk_posts",
					kind: "primary_key",
					columns: ["id"],
					name: "shared_pkey",
				},
			],
			relations: [],
			indexes: [],
		},
	]);
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/SchemaConstraint\.name|shared_pkey|index|Duplicate|conflict/i,
		"found case: two tables in public sharing explicit primary_key name shared_pkey must fail closed",
	);
});

test("P1: Scope index names to the table's physical namespace", () => {
	const postsIdColumn = {
		id: "col_posts_id",
		identity: identity("app", "archive", "id"),
		type: scalarUuid,
		nullable: false,
	};
	const archiveUsers = {
		logical: { database: "app", namespace: "public", name: "users" },
		physical: { database: "app", namespace: "archive", name: "users" },
	};
	const archivePosts = {
		logical: { database: "app", namespace: "public", name: "posts" },
		physical: { database: "app", namespace: "archive", name: "posts" },
	};
	const doc = irTablesDoc([
		{
			id: "tbl_users",
			identity: archiveUsers,
			columns: [
				{
					...usersIdColumn,
					identity: identity("app", "archive", "id"),
				},
			],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_posts",
			identity: archivePosts,
			columns: [postsIdColumn],
			constraints: [],
			relations: [],
			indexes: [
				{
					id: "idx_posts_users",
					columns: ["id"],
					unique: false,
					name: "users",
				},
			],
		},
	]);
	assert.throws(
		() => validateAthenaSchemaIr(doc),
		/SchemaIndex\.name|users|table|Duplicate|conflict/i,
		"found case: physical archive.users plus index named users on archive.posts must fail closed even when nested under public",
	);
});

test("P2: Preserve explicit enum names during canonicalization", () => {
	const enumDoc = (name?: string) =>
		({
			kind: ATHENA_SCHEMA_IR_KIND,
			irVersion: ATHENA_SCHEMA_IR_VERSION,
			databases: [
				{
					id: "db_app",
					identity: identity("app", "public", "app"),
					enums: [
						{
							id: "enum_status",
							identity: identity("app", "public", "status"),
							labels: ["open", "closed"],
							...(name === undefined ? {} : { name }),
						},
					],
					namespaces: [
						{
							id: "ns_public",
							identity: identity("app", "public", "public"),
							tables: [
								{
									id: "tbl_users",
									identity: identity("app", "public", "users"),
									columns: [usersIdColumn],
									constraints: [],
									relations: [],
									indexes: [],
								},
							],
						},
					],
				},
			],
			metadata: {},
		}) as unknown as AthenaSchemaIr;
	const named = canonicalizeAthenaSchemaIr(enumDoc("status_enum"));
	const unnamed = canonicalizeAthenaSchemaIr(enumDoc());
	const namedEnum = named.databases[0]?.enums?.find(
		(item) => item.id === "enum_status",
	);
	assert.equal(
		namedEnum?.name,
		"status_enum",
		"found case: SchemaEnum.name status_enum must survive canonicalizeAthenaSchemaIr",
	);
	assert.notEqual(
		fingerprintAthenaSchemaIr(named),
		fingerprintAthenaSchemaIr(unnamed),
		"found case: documents that differ only by enum name must not fingerprint identically",
	);
});

test("P2: Honor the configured attachment fetch timeout", async () => {
	const transport = createMemorySmtpTransport();
	const provider = smtp({
		attachmentFetchTimeoutMs: 25,
		auth: { pass: "secret", user: "smtp-user" },
		fetchImpl: (_input, init) =>
			new Promise((_resolve, reject) => {
				const signal = init?.signal;
				if (!signal) {
					return;
				}
				if (signal.aborted) {
					reject(new Error("aborted"));
					return;
				}
				signal.addEventListener(
					"abort",
					() => {
						reject(new Error("aborted"));
					},
					{ once: true },
				);
			}),
		host: "smtp.example.com",
		lookupImpl: async () => [{ address: "1.1.1.1", family: 4 as const }],
		transport,
	});
	const sendPromise = provider
		.send(
			smtpMessage({
				attachments: [
					{
						contentType: "application/pdf",
						fileUrl: "https://cdn.example.com/legacy.pdf",
						filename: "legacy.pdf",
					},
				],
			}),
		)
		.then(
			() => "ok" as const,
			(error: unknown) => error,
		);
	const hung = new Promise<"hung">((resolve) => {
		setTimeout(() => {
			resolve("hung");
		}, 200);
	});
	const outcome = await Promise.race([sendPromise, hung]);
	assert.notEqual(
		outcome,
		"hung",
		"found case: hanging attachment HTTP fetch must honor attachmentFetchTimeoutMs=25, not the 15s constant",
	);
	assert.ok(
		outcome instanceof Error,
		"found case: hanging attachment HTTP fetch must abort from the configured timeout",
	);
});

function introTextColumn(
	name: string,
	options: { isPrimaryKey?: boolean; enumValues?: string[]; udtName?: string } = {},
) {
	return {
		arrayDimensions: 0,
		dataType: options.enumValues ? "USER-DEFINED" : "text",
		hasDefault: false,
		isGenerated: false,
		isNullable: false,
		isPrimaryKey: options.isPrimaryKey === true,
		name,
		typeKind: options.enumValues ? ("enum" as const) : ("scalar" as const),
		udtName: options.udtName ?? (options.enumValues ? "status" : "text"),
		...(options.enumValues ? { enumValues: options.enumValues } : {}),
	};
}

test("P1: Drop backing indexes before reusing their names", () => {
	const otherId = {
		id: "col_other_id",
		identity: identity("app", "public", "id"),
		type: scalarUuid,
		nullable: false,
	};
	const otherCode = {
		id: "col_other_code",
		identity: identity("app", "public", "code"),
		type: {
			kind: "scalar" as const,
			semantic: "text",
			native: {
				arrayDimensions: 0,
				backend: "postgresql",
				name: "text",
			},
		},
		nullable: false,
	};
	const fromUnique = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "a"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_other",
			identity: identity("app", "public", "other"),
			columns: [otherId, otherCode],
			constraints: [
				{
					columns: ["code"],
					id: "cst_other_uq",
					kind: "unique",
					name: "b",
				},
			],
			indexes: [],
			relations: [],
		},
	]);
	const toUnique = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "b"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_other",
			identity: identity("app", "public", "other"),
			columns: [otherId, otherCode],
			constraints: [],
			indexes: [],
			relations: [],
		},
	]);
	const uniqueDiff = diffSchemas({ from: fromUnique, to: toUnique });
	const dropUniqueAt = uniqueDiff.operations.findIndex(
		(op) => op.kind === "drop_unique_constraint" && op.unique.name === "b",
	);
	const renameUniqueAt = uniqueDiff.operations.findIndex(
		(op) =>
			op.kind === "rename_table" &&
			op.from.name === "a" &&
			op.to.name === "b",
	);
	assert.ok(dropUniqueAt >= 0, "expected drop_unique_constraint named b");
	assert.ok(renameUniqueAt >= 0, "expected rename_table a → b");
	assert.ok(
		dropUniqueAt < renameUniqueAt,
		"found case: unique named b occupies the PG relation namespace until dropped, so rename_table a → b must wait",
	);

	const fromPk = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "a"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_other",
			identity: identity("app", "public", "other"),
			columns: [otherId],
			constraints: [
				{
					columns: ["id"],
					id: "cst_other_pk",
					kind: "primary_key",
					name: "b",
				},
			],
			indexes: [],
			relations: [],
		},
	]);
	const toPk = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "b"),
			columns: [usersIdColumn],
			constraints: [],
			relations: [],
			indexes: [],
		},
		{
			id: "tbl_other",
			identity: identity("app", "public", "other"),
			columns: [otherId],
			constraints: [],
			indexes: [],
			relations: [],
		},
	]);
	const pkDiff = diffSchemas({ from: fromPk, to: toPk });
	const dropPkAt = pkDiff.operations.findIndex(
		(op) => op.kind === "drop_primary_key" && op.primaryKey.name === "b",
	);
	const renamePkAt = pkDiff.operations.findIndex(
		(op) =>
			op.kind === "rename_table" &&
			op.from.name === "a" &&
			op.to.name === "b",
	);
	assert.ok(dropPkAt >= 0, "expected drop_primary_key named b");
	assert.ok(renamePkAt >= 0, "expected rename_table a → b with named PK");
	assert.ok(
		dropPkAt < renamePkAt,
		"found case: primary key named b occupies the PG relation namespace until dropped, so rename_table a → b must wait",
	);
});

test("P1: Preserve cross-schema references when filtering introspection", () => {
	const snapshot: IntrospectionSnapshot = {
		backend: "postgresql",
		database: "app",
		generatedAt: "2026-01-01T00:00:00.000Z",
		schemas: {
			auth: {
				name: "auth",
				tables: {
					users: {
						columns: {
							id: introTextColumn("id", { isPrimaryKey: true }),
						},
						name: "users",
						primaryKey: ["id"],
						relations: {},
						schema: "auth",
					},
				},
			},
			public: {
				name: "public",
				tables: {
					orders: {
						columns: {
							id: introTextColumn("id", { isPrimaryKey: true }),
							user_id: introTextColumn("user_id"),
						},
						name: "orders",
						primaryKey: ["id"],
						relations: {
							user: {
								kind: "many-to-one",
								name: "user",
								sourceColumns: ["user_id"],
								targetColumns: ["id"],
								targetModel: "users",
								targetSchema: "auth",
							},
						},
						schema: "public",
					},
				},
			},
		},
	};
	const ir = schemaIrFromIntrospection(snapshot, { schemas: ["public"] });
	assert.doesNotThrow(
		() => validateAthenaSchemaIr(ir),
		"found case: schemas=['public'] with public.orders → auth.users must not throw targetTableId does not identify a table",
	);
	const tables = ir.databases.flatMap((db) =>
		db.namespaces.flatMap((ns) => ns.tables),
	);
	assert.ok(
		tables.some(
			(table) =>
				table.identity.physical.namespace === "public" &&
				table.identity.physical.name === "orders",
		),
		"selected public.orders must be present",
	);
	assert.ok(
		tables.some(
			(table) =>
				table.identity.physical.namespace === "auth" &&
				table.identity.physical.name === "users",
		),
		"found case: auth.users must be retained as the FK target when filtering to public",
	);
	const orders = tables.find(
		(table) => table.identity.physical.name === "orders",
	);
	assert.ok(
		orders?.constraints.some(
			(constraint) =>
				constraint.kind === "foreign_key" &&
				String(constraint.targetTableId).includes("users"),
		),
		"found case: public.orders FK to auth.users must survive the schema filter",
	);
	assert.doesNotThrow(() => schemaSnapshotFromIr(ir));
});

test("P2: Deduplicate introspected enums across tables", () => {
	const labels = ["open", "closed"];
	const snapshot: IntrospectionSnapshot = {
		backend: "postgresql",
		database: "app",
		generatedAt: "2026-01-01T00:00:00.000Z",
		schemas: {
			public: {
				name: "public",
				tables: {
					orders: {
						columns: {
							id: introTextColumn("id", { isPrimaryKey: true }),
							status: introTextColumn("status", {
								enumValues: labels,
								udtName: "status",
							}),
						},
						name: "orders",
						primaryKey: ["id"],
						relations: {},
						schema: "public",
					},
					tickets: {
						columns: {
							id: introTextColumn("id", { isPrimaryKey: true }),
							status: introTextColumn("status", {
								enumValues: labels,
								udtName: "status",
							}),
						},
						name: "tickets",
						primaryKey: ["id"],
						relations: {},
						schema: "public",
					},
				},
			},
		},
	};
	const ir = schemaIrFromIntrospection(snapshot);
	assert.doesNotThrow(() => validateAthenaSchemaIr(ir));
	const enums = ir.databases.flatMap((db) =>
		db.namespaces.flatMap((ns) => ns.enums ?? []),
	);
	assert.equal(
		enums.length,
		1,
		"found case: one PostgreSQL status enum used by two tables must not emit two SchemaEnum objects",
	);
	assert.equal(String(enums[0]?.id), "enum:app.public.status");
	const tables = ir.databases.flatMap((db) =>
		db.namespaces.flatMap((ns) => ns.tables),
	);
	const statusIds = tables.flatMap((table) =>
		table.columns
			.filter((column) => column.identity.physical.name === "status")
			.map((column) =>
				column.type.kind === "enum" ? column.type.enumId : undefined,
			),
	);
	assert.equal(statusIds.length, 2);
	assert.equal(
		new Set(statusIds).size,
		1,
		"found case: both columns must reference the same introspected enum id",
	);
});

test("P1: Rename tables before dropping their own named constraints", () => {
	const fromUnique = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "a"),
			columns: [usersIdColumn],
			constraints: [
				{
					columns: ["id"],
					id: "cst_a_uq",
					kind: "unique",
					name: "b",
				},
			],
			relations: [],
			indexes: [],
		},
	]);
	const toUnique = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "b"),
			columns: [usersIdColumn],
			constraints: [],
			indexes: [],
			relations: [],
		},
	]);
	const uniqueDiff = diffSchemas({ from: fromUnique, to: toUnique });
	const dropUniqueAt = uniqueDiff.operations.findIndex(
		(op) => op.kind === "drop_unique_constraint" && op.unique.name === "b",
	);
	const renameUniqueAt = uniqueDiff.operations.findIndex(
		(op) =>
			op.kind === "rename_table" &&
			op.from.name === "a" &&
			op.to.name === "b",
	);
	assert.ok(dropUniqueAt >= 0, "expected drop_unique_constraint named b");
	assert.ok(renameUniqueAt >= 0, "expected rename_table a → b");
	const dropUnique = uniqueDiff.operations[dropUniqueAt];
	assert.ok(dropUnique && dropUnique.kind === "drop_unique_constraint");
	assert.equal(
		dropUnique.table.name,
		"b",
		"found case: drop is recorded against destination identity b",
	);
	assert.ok(
		renameUniqueAt < dropUniqueAt,
		"found case: renaming a→b while dropping its own unique named b must rename_table before drop_unique_constraint",
	);

	const fromPk = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "a"),
			columns: [usersIdColumn],
			constraints: [
				{
					columns: ["id"],
					id: "cst_a_pk",
					kind: "primary_key",
					name: "b",
				},
			],
			relations: [],
			indexes: [],
		},
	]);
	const toPk = irTablesDoc([
		{
			id: "tbl_a",
			identity: identity("app", "public", "b"),
			columns: [usersIdColumn],
			constraints: [],
			indexes: [],
			relations: [],
		},
	]);
	const pkDiff = diffSchemas({ from: fromPk, to: toPk });
	const dropPkAt = pkDiff.operations.findIndex(
		(op) => op.kind === "drop_primary_key" && op.primaryKey.name === "b",
	);
	const renamePkAt = pkDiff.operations.findIndex(
		(op) =>
			op.kind === "rename_table" &&
			op.from.name === "a" &&
			op.to.name === "b",
	);
	assert.ok(dropPkAt >= 0, "expected drop_primary_key named b");
	assert.ok(renamePkAt >= 0, "expected rename_table a → b with named PK");
	const dropPk = pkDiff.operations[dropPkAt];
	assert.ok(dropPk && dropPk.kind === "drop_primary_key");
	assert.equal(
		dropPk.table.name,
		"b",
		"found case: PK drop is recorded against destination identity b",
	);
	assert.ok(
		renamePkAt < dropPkAt,
		"found case: renaming a→b while dropping its own primary key named b must rename_table before drop_primary_key",
	);
});

test("P1: Preserve selected namespaces that contain no tables", () => {
	const snapshot: IntrospectionSnapshot = {
		backend: "postgresql",
		database: "app",
		generatedAt: "2026-01-01T00:00:00.000Z",
		schemas: {
			empty_ns: {
				name: "empty_ns",
				tables: {},
			},
			public: {
				name: "public",
				tables: {
					orders: {
						columns: {
							id: introTextColumn("id", { isPrimaryKey: true }),
						},
						name: "orders",
						primaryKey: ["id"],
						relations: {},
						schema: "public",
					},
				},
			},
		},
	};
	const ir = schemaIrFromIntrospection(snapshot);
	const namespaces = ir.databases.flatMap((db) => db.namespaces);
	const empty = namespaces.find(
		(ns) => ns.identity.physical.name === "empty_ns",
	);
	assert.ok(
		empty,
		"found case: introspected empty_ns with zero tables must be retained",
	);
	assert.equal(empty.tables.length, 0);
	assert.doesNotThrow(() => schemaSnapshotFromIr(ir));

	const selected = schemaIrFromIntrospection(snapshot, {
		schemas: ["empty_ns"],
	});
	const selectedNamespaces = selected.databases.flatMap((db) => db.namespaces);
	assert.ok(
		selectedNamespaces.some((ns) => ns.identity.physical.name === "empty_ns"),
		"found case: explicitly selected empty namespace must be retained",
	);
	assert.equal(
		selectedNamespaces.find((ns) => ns.identity.physical.name === "empty_ns")
			?.tables.length,
		0,
	);

	const desiredEmpty = schemaIrFixture({
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: [
			{
				id: schemaId("db_app"),
				identity: identity("app", "public", "app"),
				namespaces: [
					{
						id: schemaId("ns_empty"),
						identity: identity("app", "empty_ns", "empty_ns"),
						tables: [],
					},
				],
				backend: "postgresql",
			},
		],
		metadata: {},
	});
	const diff = diffSchemas({ from: selected, to: desiredEmpty });
	assert.equal(
		diff.operations.some((op) => op.kind === "create_schema"),
		false,
		"found case: empty selected namespace vs desired empty namespace must not emit create_schema",
	);
});

test("P1: Retain empty namespaces in the v1 projection", () => {
	const snapshot: IntrospectionSnapshot = {
		backend: "postgresql",
		database: "app",
		generatedAt: "2026-01-01T00:00:00.000Z",
		schemas: {
			empty_ns: {
				name: "empty_ns",
				tables: {},
			},
			public: {
				name: "public",
				tables: {
					orders: {
						columns: {
							id: introTextColumn("id", { isPrimaryKey: true }),
						},
						name: "orders",
						primaryKey: ["id"],
						relations: {},
						schema: "public",
					},
				},
			},
		},
	};
	const v1 = schemaSnapshotFromIntrospection(snapshot);
	const empty = v1.schemas.find((schema) => schema.name === "empty_ns");
	assert.ok(
		empty,
		"found case: schemaSnapshotFromIntrospection must keep empty_ns even with zero tables",
	);
	assert.equal(empty.tables.length, 0);

	const fromIr = schemaIrFromIntrospection(snapshot);
	const projected = schemaSnapshotFromIr(fromIr);
	assert.ok(
		projected.schemas.some(
			(schema) => schema.name === "empty_ns" && schema.tables.length === 0,
		),
		"found case: schemaSnapshotFromIr must initialize schemas from canonical namespaces",
	);

	const desiredEmpty = schemaIrFixture({
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: [
			{
				id: schemaId("db_app"),
				identity: identity("app", "public", "app"),
				namespaces: [
					{
						id: schemaId("ns_empty"),
						identity: identity("app", "empty_ns", "empty_ns"),
						tables: [],
					},
				],
				backend: "postgresql",
			},
		],
		metadata: {},
	});
	const selectedV1 = schemaSnapshotFromIntrospection(snapshot, {
		schemas: ["empty_ns"],
	});
	const diff = diffSchemas({ from: selectedV1, to: desiredEmpty });
	assert.equal(
		diff.operations.some((op) => op.kind === "create_schema"),
		false,
		"found case: v1 projection of an introspected empty namespace vs desired empty namespace must not emit create_schema",
	);
});

test("P1: Block remaining non-global IPv6 attachment targets", async () => {
	const fetched: string[] = [];
	const fetchImpl = (async (input: RequestInfo | URL) => {
		fetched.push(String(input));
		return new Response("secret", { status: 200 });
	}) as typeof fetch;
	const provider = smtp({
		auth: { pass: "secret", user: "smtp-user" },
		fetchImpl,
		host: "smtp.example.com",
		lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
		transport: createMemorySmtpTransport(),
	});

	await assert.rejects(
		() =>
			provider.send(
				smtpMessage({
					attachments: [
						{
							contentType: "application/pdf",
							fileUrl: "http://[fec0::1]/secret.pdf",
							filename: "secret.pdf",
						},
					],
				}),
			),
		/private|SMTP attachment/i,
		"found case: site-local fec0::1 attachment URLs must be rejected before fetch",
	);
	await assert.rejects(
		() =>
			provider.send(
				smtpMessage({
					attachments: [
						{
							contentType: "application/pdf",
							fileUrl: "http://[2001:db8::1]/secret.pdf",
							filename: "secret.pdf",
						},
					],
				}),
			),
		/private|SMTP attachment/i,
		"found case: documentation 2001:db8::1 attachment URLs must be rejected before fetch",
	);

	const dnsFetched: string[] = [];
	const dnsProvider = smtp({
		auth: { pass: "secret", user: "smtp-user" },
		fetchImpl: (async (input: RequestInfo | URL) => {
			dnsFetched.push(String(input));
			return new Response("secret", { status: 200 });
		}) as typeof fetch,
		host: "smtp.example.com",
		lookupImpl: async () => [
			{ address: "fec0::1", family: 6 as const },
			{ address: "2001:db8::1", family: 6 as const },
		],
		transport: createMemorySmtpTransport(),
	});
	await assert.rejects(
		() =>
			dnsProvider.send(
				smtpMessage({
					attachments: [
						{
							contentType: "application/pdf",
							fileUrl: "https://cdn.example.com/invoice.pdf",
							filename: "invoice.pdf",
						},
					],
				}),
			),
		/private|SMTP attachment/i,
		"found case: DNS answers in non-global IPv6 ranges must not be fetched",
	);
	assert.equal(
		fetched.length,
		0,
		"found case: literal non-global IPv6 attachment URLs must not be fetched",
	);
	assert.equal(
		dnsFetched.length,
		0,
		"found case: attachment URLs whose DNS answers are fec0::1 / 2001:db8::1 must not be fetched",
	);
});

test("P2: Deduplicate enums when lifting v1 snapshots", () => {
	const labels = ["open", "closed"];
	const enumColumn = {
		name: "status",
		type: {
			name: "status",
			arrayDimensions: 0,
			enumValues: labels,
		},
		nullable: false,
		default: null,
		isGenerated: false,
	};
	const snapshot = {
		version: ATHENA_SCHEMA_SNAPSHOT_VERSION,
		backend: "postgresql" as const,
		schemas: [
			{
				name: "public",
				tables: [
					{
						schema: "public",
						name: "orders",
						database: "app",
						columns: [
							{
								name: "id",
								type: { name: "uuid", arrayDimensions: 0 },
								nullable: false,
								default: null,
								isGenerated: false,
							},
							enumColumn,
						],
						primaryKey: { columns: ["id"] },
						uniqueConstraints: [],
						foreignKeys: [],
						indexes: [],
					},
					{
						schema: "public",
						name: "tickets",
						database: "app",
						columns: [
							{
								name: "id",
								type: { name: "uuid", arrayDimensions: 0 },
								nullable: false,
								default: null,
								isGenerated: false,
							},
							enumColumn,
						],
						primaryKey: { columns: ["id"] },
						uniqueConstraints: [],
						foreignKeys: [],
						indexes: [],
					},
				],
			},
		],
	};
	const ir = schemaIrFromSnapshot(snapshot);
	assert.doesNotThrow(() => validateAthenaSchemaIr(ir));
	const enums = ir.databases.flatMap((db) =>
		db.namespaces.flatMap((ns) => ns.enums ?? []),
	);
	assert.equal(
		enums.length,
		1,
		"found case: two v1 tables sharing PostgreSQL type status must lift as one SchemaEnum",
	);
	assert.equal(String(enums[0]?.id), "enum:app.public.status");
	const tables = ir.databases.flatMap((db) =>
		db.namespaces.flatMap((ns) => ns.tables),
	);
	const statusIds = tables.flatMap((table) =>
		table.columns
			.filter((column) => column.identity.physical.name === "status")
			.map((column) =>
				column.type.kind === "enum" ? column.type.enumId : undefined,
			),
	);
	assert.deepEqual(
		statusIds,
		["enum:app.public.status", "enum:app.public.status"],
		"found case: both columns must share the database/schema/native-type enumId",
	);
});

test("P2: Validate explicit relation names", () => {
	const relationDoc = (name: unknown) =>
		irTablesDoc([
			{
				id: "tbl_users",
				identity: identity("app", "public", "users"),
				columns: [usersIdColumn],
				constraints: [],
				relations: [],
				indexes: [],
			},
			{
				id: "tbl_posts",
				identity: identity("app", "public", "posts"),
				columns: [
					{
						id: "col_posts_id",
						identity: identity("app", "public", "id"),
						type: scalarUuid,
						nullable: false,
					},
				],
				constraints: [],
				relations: [
					{
						id: "relation:posts:author",
						cardinality: "n:1",
						sourceTableId: "tbl_posts",
						targetTableId: "tbl_users",
						backingConstraintIds: [],
						sourceColumns: ["id"],
						targetColumns: ["id"],
						name,
					},
				],
				indexes: [],
			},
		]);
	assert.throws(
		() => validateAthenaSchemaIr(relationDoc("")),
		/SchemaRelation\.name|non-empty/,
		'found case: SchemaRelation.name: "" must fail closed instead of canonicalizing a blank identifier',
	);
	assert.throws(
		() => validateAthenaSchemaIr(relationDoc(12)),
		/SchemaRelation\.name|non-empty/,
		"found case: non-string SchemaRelation.name must fail closed instead of coercing to \"\"",
	);
	const named = canonicalizeAthenaSchemaIr(relationDoc("authored_by"));
	const unnamed = canonicalizeAthenaSchemaIr(relationDoc(null));
	const relation = named.databases[0]?.namespaces[0]?.tables
		.find((table) => table.id === "tbl_posts")
		?.relations?.find((item) => item.id === "relation:posts:author");
	assert.equal(relation?.name, "authored_by");
	assert.notEqual(
		fingerprintAthenaSchemaIr(named),
		fingerprintAthenaSchemaIr(unnamed),
		"found case: documents that differ only by explicit relation name must not fingerprint identically",
	);
});

test("P1: Block all special-purpose IPv6 attachment targets", async () => {
	const fetched: string[] = [];
	const fetchImpl = (async (input: RequestInfo | URL) => {
		fetched.push(String(input));
		return new Response("secret", { status: 200 });
	}) as typeof fetch;
	const provider = smtp({
		auth: { pass: "secret", user: "smtp-user" },
		fetchImpl,
		host: "smtp.example.com",
		lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
		transport: createMemorySmtpTransport(),
	});

	await assert.rejects(
		() =>
			provider.send(
				smtpMessage({
					attachments: [
						{
							contentType: "application/pdf",
							fileUrl: "http://[2001:2::1]/secret.pdf",
							filename: "secret.pdf",
						},
					],
				}),
			),
		/private|SMTP attachment/i,
		"found case: benchmarking 2001:2::1 attachment URLs must be rejected before fetch",
	);
	assert.equal(
		fetched.length,
		0,
		"found case: 2001:2::/48 must not be treated as publicly routable global unicast",
	);

	const dnsFetched: string[] = [];
	const dnsProvider = smtp({
		auth: { pass: "secret", user: "smtp-user" },
		fetchImpl: (async (input: RequestInfo | URL) => {
			dnsFetched.push(String(input));
			return new Response("secret", { status: 200 });
		}) as typeof fetch,
		host: "smtp.example.com",
		lookupImpl: async () => [{ address: "2001:2::1", family: 6 as const }],
		transport: createMemorySmtpTransport(),
	});
	await assert.rejects(
		() =>
			dnsProvider.send(
				smtpMessage({
					attachments: [
						{
							contentType: "application/pdf",
							fileUrl: "https://cdn.example.com/invoice.pdf",
							filename: "invoice.pdf",
						},
					],
				}),
			),
		/private|SMTP attachment/i,
		"found case: DNS answers in 2001:2::/48 must not be fetched",
	);
	assert.equal(dnsFetched.length, 0);
});

test("P1: Block special-purpose IPv4 attachment targets", async () => {
	const fetched: string[] = [];
	const fetchImpl = (async (input: RequestInfo | URL) => {
		fetched.push(String(input));
		return new Response("secret", { status: 200 });
	}) as typeof fetch;
	const provider = smtp({
		auth: { pass: "secret", user: "smtp-user" },
		fetchImpl,
		host: "smtp.example.com",
		lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
		transport: createMemorySmtpTransport(),
	});

	await assert.rejects(
		() =>
			provider.send(
				smtpMessage({
					attachments: [
						{
							contentType: "application/pdf",
							fileUrl: "http://203.0.113.1/secret.pdf",
							filename: "secret.pdf",
						},
					],
				}),
			),
		/private|SMTP attachment/i,
		"found case: documentation 203.0.113.1 attachment URLs must be rejected before fetch",
	);
	await assert.rejects(
		() =>
			provider.send(
				smtpMessage({
					attachments: [
						{
							contentType: "application/pdf",
							fileUrl: "http://[::ffff:203.0.113.1]/secret.pdf",
							filename: "secret.pdf",
						},
					],
				}),
			),
		/private|SMTP attachment/i,
		"found case: IPv4-mapped TEST-NET-3 attachment URLs must be rejected before fetch",
	);

	const dnsFetched: string[] = [];
	const dnsProvider = smtp({
		auth: { pass: "secret", user: "smtp-user" },
		fetchImpl: (async (input: RequestInfo | URL) => {
			dnsFetched.push(String(input));
			return new Response("secret", { status: 200 });
		}) as typeof fetch,
		host: "smtp.example.com",
		lookupImpl: async () => [{ address: "203.0.113.1", family: 4 as const }],
		transport: createMemorySmtpTransport(),
	});
	await assert.rejects(
		() =>
			dnsProvider.send(
				smtpMessage({
					attachments: [
						{
							contentType: "application/pdf",
							fileUrl: "https://cdn.example.com/invoice.pdf",
							filename: "invoice.pdf",
						},
					],
				}),
			),
		/private|SMTP attachment/i,
		"found case: DNS answers in 203.0.113.0/24 must not be fetched",
	);
	assert.equal(
		fetched.length,
		0,
		"found case: literal TEST-NET-3 attachment URLs must not be fetched",
	);
	assert.equal(
		dnsFetched.length,
		0,
		"found case: attachment URLs whose DNS answers are 203.0.113.1 must not be fetched",
	);
	assert.throws(
		() => validateAttachmentTarget("http://203.0.113.1/secret.pdf"),
		/non-public IP/,
		"found case: template attachment validation must reject TEST-NET-3 literals",
	);
});

test("P2: Validate explicit enum names", () => {
	const enumDoc = (name: unknown) => ({
		kind: "athena.schema",
		irVersion: 2,
		databases: [
			{
				id: "db_app",
				identity: identity("app", "public", "app"),
				namespaces: [
					{
						id: "ns_public",
						identity: identity("app", "public", "public"),
						enums: [
							{
								id: "enum_status",
								identity: identity("app", "public", "status"),
								labels: ["active", "inactive"],
								name,
							},
						],
						tables: [
							{
								id: "tbl_users",
								identity: identity("app", "public", "users"),
								columns: [usersIdColumn],
								constraints: [],
								relations: [],
								indexes: [],
							},
						],
					},
				],
			},
		],
		metadata: {},
	});
	assert.throws(
		() => validateAthenaSchemaIr(enumDoc("")),
		/SchemaEnum\.name|non-empty/,
		'found case: SchemaEnum.name: "" must fail closed instead of canonicalizing a blank identifier',
	);
	assert.throws(
		() => validateAthenaSchemaIr(enumDoc(12)),
		/SchemaEnum\.name|non-empty/,
		"found case: non-string SchemaEnum.name must fail closed instead of coercing to \"\"",
	);
	const named = canonicalizeAthenaSchemaIr(enumDoc("status"));
	const unnamed = canonicalizeAthenaSchemaIr(enumDoc(null));
	const schemaEnum = named.databases[0]?.namespaces[0]?.enums?.find(
		(item) => item.id === "enum_status",
	);
	assert.equal(schemaEnum?.name, "status");
	assert.notEqual(
		fingerprintAthenaSchemaIr(named),
		fingerprintAthenaSchemaIr(unnamed),
		"found case: documents that differ only by explicit enum name must not fingerprint identically",
	);
});

test("P2: Return immediately when the SMTP socket is already closed", async () => {
	const server = createServer((socket) => {
		socket.destroy();
	});
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	assert.ok(address && typeof address === "object");
	const transport = createNodeSmtpTransport();
	try {
		const connection = await transport({
			host: "127.0.0.1",
			implicitTls: false,
			port: address.port,
			timeoutMs: 5_000,
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		const started = Date.now();
		await connection.close();
		assert.ok(
			Date.now() - started < 500,
			"found case: close() must not wait the socket timeout after the peer already closed",
		);
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
});

function reviewHasher() {
	return {
		async hash(password: string) {
			return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
		},
		needsRehash() {
			return false;
		},
		async verify(password: string, hash: string) {
			return hash.endsWith(Buffer.from(password).toString("base64url"));
		},
	};
}

test("P1: Keep reset-token consumption inside the mutation", async () => {
	const token = "reset-token-keep";
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher: reviewHasher(),
		hooks: {
			before: {
				"user.password.reset": async () => {
					throw new Error("reset vetoed");
				},
			},
		},
	});
	const signup = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email: "reset-keep@example.com",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(signup.status, 200);
	const stores = await runtime.getStores();
	await stores.createVerification({
		expiresAt: new Date(Date.now() + 60 * 60 * 1000),
		id: crypto.randomUUID(),
		identifier: "reset:reset-keep@example.com",
		value: token,
	});
	const reset = await runtime.handle(
		new Request("http://app.local/api/auth/reset-password", {
			body: JSON.stringify({
				password: "Password1234!",
				token,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(reset.status, 400);
	const remaining = await stores.getVerificationByValue(token);
	assert.ok(
		remaining,
		"found case: before user.password.reset rejection must not consume the one-time token",
	);
});

test("P1: Resolve the change-email target before invoking hooks", async () => {
	const seen: Array<{ email: string; userId: string }> = [];
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher: reviewHasher(),
		hooks: {
			before: {
				"user.email.update": async (payload) => {
					seen.push({
						email: payload.input.email,
						userId: payload.input.userId,
					});
					throw new Error("email update vetoed");
				},
			},
		},
	});
	const signup = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email: "old-email@example.com",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(signup.status, 200);
	const userId = ((await signup.json()) as { user: { id: string } }).user.id;
	const stores = await runtime.getStores();
	const token = "change-email-token";
	await stores.createVerification({
		expiresAt: new Date(Date.now() + 60 * 60 * 1000),
		id: crypto.randomUUID(),
		identifier: `change-email:${userId}:new-email@example.com`,
		value: token,
	});
	const verify = await runtime.handle(
		new Request(
			`http://app.local/api/auth/change-email/verify?token=${token}`,
		),
	);
	assert.equal(verify.status, 400);
	assert.equal(seen.length, 1);
	assert.equal(
		seen[0]?.userId,
		userId,
		"found case: before user.email.update must receive the token userId, not empty strings",
	);
	assert.equal(seen[0]?.email, "new-email@example.com");
	assert.ok(
		await stores.getVerificationByValue(token),
		"found case: token must still be consumed inside execute, not before hooks",
	);
});

test("P1: Propagate the deleted user ID from token confirmation", async () => {
	const seen: string[] = [];
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher: reviewHasher(),
		hooks: {
			after: {
				"user.delete": async (payload) => {
					seen.push(payload.result.userId);
				},
			},
		},
	});
	const signup = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email: "delete-me@example.com",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(signup.status, 200);
	const userId = ((await signup.json()) as { user: { id: string } }).user.id;
	const stores = await runtime.getStores();
	const token = "delete-user-token";
	await stores.createVerification({
		expiresAt: new Date(Date.now() + 60 * 60 * 1000),
		id: crypto.randomUUID(),
		identifier: `delete_user:${userId}`,
		value: token,
	});
	const verify = await runtime.handle(
		new Request(
			`http://app.local/api/auth/delete-user/verify?token=${token}`,
		),
	);
	assert.equal(verify.status, 200);
	assert.equal(
		seen[0],
		userId,
		"found case: user.delete after-hook must receive applyDeleteUserToken's user ID, not empty string",
	);
});

test("P1: Consume verification tokens inside the mutation", async () => {
	const token = "verify-email-keep";
	const runtime = createAthenaAuthRuntime({
		autoMigrate: false,
		hasher: reviewHasher(),
		hooks: {
			before: {
				"user.email.verify": async () => {
					throw new Error("verify vetoed");
				},
			},
		},
	});
	const signup = await runtime.handle(
		new Request("http://app.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email: "verify-keep@example.com",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(signup.status, 200);
	const stores = await runtime.getStores();
	await stores.createVerification({
		expiresAt: new Date(Date.now() + 60 * 60 * 1000),
		id: crypto.randomUUID(),
		identifier: "verify-keep@example.com",
		value: token,
	});
	const verify = await runtime.handle(
		new Request(
			`http://app.local/api/auth/verify-email?token=${encodeURIComponent(token)}`,
		),
	);
	assert.equal(verify.status, 400);
	const remaining = await stores.getVerificationByValue(token);
	assert.ok(
		remaining,
		"found case: before user.email.verify rejection must not consume the one-time token",
	);
});

test("P1: Issue restored sessions through the transaction scope", async () => {
	const NOW = new Date("2026-08-15T12:00:00.000Z");
	const scopedStores = { marker: "scoped-mutation-stores" };
	let issuedStores: unknown;
	const impersonatedSession: AuthSessionRow = {
		active: true,
		active_organization_id: null,
		created_at: NOW,
		expires_at: new Date("2026-08-16T12:00:00.000Z"),
		id: "impersonated-session",
		impersonated_by: "admin-1",
		ip_address: null,
		token: "impersonated-session",
		updated_at: NOW,
		user_agent: null,
		user_id: "user-2",
	};
	const adminUser: AuthUserRow = {
		ban_expires: null,
		ban_reason: null,
		banned: false,
		created_at: NOW,
		display_username: null,
		email: "admin@example.com",
		email_verified: true,
		id: "admin-1",
		image: null,
		last_sign_in_at: null,
		metadata: {},
		name: "Admin",
		role: "admin",
		two_factor_enabled: false,
		updated_at: NOW,
		username: "admin",
	};
	const restoredSession: AuthSessionRow = {
		...impersonatedSession,
		id: "restored-admin-session",
		impersonated_by: null,
		token: "restored-admin-session",
		user_id: "admin-1",
	};
	const response = await handleAdminRoute(
		new Request("http://localhost/api/auth/admin/stop-impersonating", {
			method: "POST",
		}),
		"/admin/stop-impersonating",
		"POST",
		{
			config: normalizeAthenaAuthConfig({ mode: "local" }),
			hasher: reviewHasher(),
			headers: new Headers(),
			hookRequest: (request, path) => ({
				method: request.method,
				path,
			}),
			issueSession: async (_request, storesOrUserId, maybeUserId?) => {
				issuedStores = storesOrUserId;
				const userId =
					typeof maybeUserId === "string" ? maybeUserId : String(storesOrUserId);
				return { ...restoredSession, user_id: userId };
			},
			mutate: async (input) =>
				input.execute({
					admin: {
						createImpersonationSession: async () => impersonatedSession,
						createUser: async () => adminUser,
						deleteSession: async () => true,
						deleteUser: async () => true,
						deleteUserSessions: async () => 0,
						getUser: async () => adminUser,
						getUserByEmail: async () => adminUser,
						listUsers: async () => ({
							limit: 50,
							offset: 0,
							total: 1,
							users: [adminUser],
						}),
						updateUser: async () => adminUser,
					},
					stores: scopedStores as never,
				}),
			requireSession: async () => ({
				session: impersonatedSession,
				token: impersonatedSession.token,
				user: {
					...adminUser,
					id: "user-2",
					role: "user",
				},
			}),
			store: {
				createImpersonationSession: async () => impersonatedSession,
				createUser: async () => adminUser,
				deleteSession: async () => true,
				deleteUser: async () => true,
				deleteUserSessions: async () => 0,
				getUser: async () => adminUser,
				getUserByEmail: async () => adminUser,
				listUsers: async () => ({
					limit: 50,
					offset: 0,
					total: 1,
					users: [adminUser],
				}),
				updateUser: async () => adminUser,
			},
			traceId: "test-trace",
		},
	);
	assert.ok(response);
	assert.equal(response.status, 200);
	assert.equal(
		issuedStores,
		scopedStores,
		"found case: stop-impersonating must issue the restored session through scope.stores, not the outer currentStores",
	);
});

test("P1: Serialize memory-backed mutation transactions", async () => {
	const stores = new MemoryAuthStores();
	const transaction = createMemoryAuthMutationTransaction(stores);
	let releaseFirst: () => void = () => {
		throw new Error("first mutation gate was never armed");
	};
	const firstGate = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	let enteredFirst: () => void = () => {
		throw new Error("first mutation never entered execute");
	};
	const firstEntered = new Promise<void>((resolve) => {
		enteredFirst = resolve;
	});
	const first = transaction(async (scope) => {
		await scope.stores.createUser({
			email: "first-fail@example.com",
			id: "user-first-fail",
			name: "first",
		});
		enteredFirst();
		await firstGate;
		throw new Error("first mutation failed after overlap");
	});
	await firstEntered;
	const second = transaction(async (scope) => {
		await scope.stores.createUser({
			email: "second-ok@example.com",
			id: "user-second-ok",
			name: "second",
		});
	});
	releaseFirst();
	await assert.rejects(() => first);
	await second;
	assert.ok(
		await stores.getUserById("user-second-ok"),
		"found case: rolling back a slower memory mutation must not restore over a concurrent committed mutation",
	);
	assert.equal(await stores.getUserById("user-first-fail"), undefined);
});
