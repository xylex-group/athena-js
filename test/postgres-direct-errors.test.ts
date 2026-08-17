import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
	mapPostgresDriverError,
	sanitizePostgresMessage,
} from "../src/postgres/errors.ts";

test("sanitize strips connection URIs", () => {
	const msg = sanitizePostgresMessage(
		"fail postgresql://user:secret@localhost:5432/db and more",
	);
	assert.equal(msg.includes("secret"), false);
	assert.match(msg, /postgresql:\/\/\*\*\*/);
});

test("unique_violation → 409", () => {
	const mapped = mapPostgresDriverError({
		code: "23505",
		constraint: "users_email_key",
		message: "duplicate key value violates unique constraint",
	});
	assert.equal(mapped.status, 409);
	assert.equal(mapped.code, "HTTP_ERROR");
	assert.equal(mapped.hint, "unique_violation (users_email_key)");
	assert.equal(mapped.sqlState, "23505");
});

test("foreign_key_violation → 409", () => {
	const mapped = mapPostgresDriverError({
		code: "23503",
		message: "insert or update on table violates foreign key",
	});
	assert.equal(mapped.status, 409);
	assert.equal(mapped.hint, "foreign_key_violation");
});

test("not_null_violation → 400 with column", () => {
	const mapped = mapPostgresDriverError({
		code: "23502",
		column: "email",
		message: "null value in column email",
	});
	assert.equal(mapped.status, 400);
	assert.equal(mapped.hint, "not_null_violation (email)");
});

test("undefined_table → 400", () => {
	const mapped = mapPostgresDriverError({
		code: "42P01",
		message: 'relation "nope" does not exist',
	});
	assert.equal(mapped.status, 400);
	assert.equal(mapped.sqlState, "42P01");
});

test("invalid_password → 401", () => {
	const mapped = mapPostgresDriverError({
		code: "28P01",
		message: "password authentication failed",
	});
	assert.equal(mapped.status, 401);
});

test("connection_failure → 503 NETWORK_ERROR", () => {
	const mapped = mapPostgresDriverError({
		code: "08006",
		message: "connection failure",
	});
	assert.equal(mapped.status, 503);
	assert.equal(mapped.code, "NETWORK_ERROR");
});

test("deadlock → 409", () => {
	const mapped = mapPostgresDriverError({
		code: "40P01",
		message: "deadlock detected",
	});
	assert.equal(mapped.status, 409);
});

test("ECONNREFUSED without SQLSTATE → NETWORK_ERROR", () => {
	const mapped = mapPostgresDriverError(
		new Error("connect ECONNREFUSED 127.0.0.1:5432"),
	);
	assert.equal(mapped.status, 503);
	assert.equal(mapped.code, "NETWORK_ERROR");
});

test("query_canceled → 408", () => {
	const mapped = mapPostgresDriverError({
		code: "57014",
		message: "canceling statement due to user request",
	});
	assert.equal(mapped.status, 408);
});
