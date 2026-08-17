import { strict as assert } from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	compileD1Fetch,
	normalizeD1TableName,
} from "../src/cloudflare/d1/sql.ts";
import {
	boolean,
	defineRegistry,
	defineSchema,
	enumeration,
	json,
	modelsToSqlFiles,
	number,
	sqlD1,
	sqlPostgres,
	string,
	table,
	writeModelSqlFiles,
} from "../src/index.ts";

const users = table("users")
	.schema("public")
	.columns({
		active: boolean().defaulted(),
		email: string(),
		id: string().generated(),
		meta: json().optional(),
		role: enumeration(["admin", "member"] as const),
	})
	.primaryKey("id");

test("normalizeD1TableName strips Postgres schema for edge drop-in", () => {
	assert.equal(normalizeD1TableName("public.users"), "users");
	assert.equal(normalizeD1TableName("analytics.events"), "events");
	assert.equal(normalizeD1TableName("users"), "users");
});

test("D1 compiler accepts schema-qualified table_name from AthenaModels", () => {
	const compiled = compileD1Fetch({
		columns: ["id", "email"],
		table_name: "public.users",
	});
	assert.match(compiled.sql, /FROM "users"/);
	assert.doesNotMatch(compiled.sql, /public/);
});

test("sqlPostgres emits schema-qualified CREATE TABLE", () => {
	const sql = sqlPostgres(users);
	assert.match(sql, /CREATE SCHEMA IF NOT EXISTS "public"/);
	assert.match(sql, /CREATE TABLE IF NOT EXISTS "public"\."users"/);
	assert.match(sql, /"id" TEXT PRIMARY KEY/);
	assert.match(sql, /"email" TEXT NOT NULL/);
	assert.match(sql, /"active" BOOLEAN/);
	assert.match(sql, /"meta" JSONB/);
	assert.match(sql, /CHECK \("role" IN \('admin', 'member'\)\)/);
});

test("sqlD1 emits bare-table CREATE TABLE (edge physical names)", () => {
	const sql = sqlD1(users);
	assert.doesNotMatch(sql, /CREATE SCHEMA/);
	assert.match(sql, /CREATE TABLE IF NOT EXISTS "users"/);
	assert.doesNotMatch(sql, /"public"/);
	assert.match(sql, /"id" TEXT PRIMARY KEY/);
	assert.match(sql, /"active" INTEGER/);
	assert.match(sql, /"meta" TEXT/);
	assert.match(sql, /CHECK \("role" IN \('admin', 'member'\)\)/);
});

test("sqlD1 maps generated number PK to INTEGER PRIMARY KEY AUTOINCREMENT", () => {
	const counters = table("counters")
		.columns({
			id: number().generated(),
			value: number(),
		})
		.primaryKey("id");
	const sql = sqlD1(counters);
	assert.match(sql, /"id" INTEGER PRIMARY KEY AUTOINCREMENT/);
	assert.match(sqlPostgres(counters), /"id" BIGSERIAL PRIMARY KEY/);
});

test("registry input emits all tables for both dialects", () => {
	const events = table("events")
		.schema("analytics")
		.columns({ id: string().generated(), name: string() })
		.primaryKey("id");
	const registry = defineRegistry({
		app: {
			schemas: {
				analytics: defineSchema({ events }),
				public: defineSchema({ users }),
			},
		},
	});

	const pg = sqlPostgres(registry);
	assert.match(pg, /"public"\."users"/);
	assert.match(pg, /"analytics"\."events"/);

	const d1 = sqlD1(registry);
	assert.match(d1, /CREATE TABLE IF NOT EXISTS "users"/);
	assert.match(d1, /CREATE TABLE IF NOT EXISTS "events"/);
});

test("modelsToSqlFiles and writeModelSqlFiles produce dialect .sql tree", async () => {
	const files = modelsToSqlFiles(users, { dialects: ["postgres", "d1"] });
	assert.equal(files.length, 2);
	assert.ok(
		files.some((file) => file.filename === "postgres/public/users.sql"),
	);
	assert.ok(files.some((file) => file.filename === "d1/public/users.sql"));

	const dir = await mkdtemp(path.join(tmpdir(), "athena-model-sql-"));
	try {
		const written = await writeModelSqlFiles(users, {
			dialects: ["postgres", "d1"],
			outDir: dir,
		});
		assert.equal(written.length, 2);
		const pgPath = path.join(dir, "postgres", "public", "users.sql");
		const d1Path = path.join(dir, "d1", "public", "users.sql");
		const pgBody = await readFile(pgPath, "utf8");
		const d1Body = await readFile(d1Path, "utf8");
		assert.match(pgBody, /"public"\."users"/);
		assert.match(d1Body, /CREATE TABLE IF NOT EXISTS "users"/);
	} finally {
		await rm(dir, { force: true, recursive: true });
	}
});
