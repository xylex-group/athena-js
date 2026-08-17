import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { appendHttpQuery } from "../src/http/append-query.ts";
import { parseHttpResponseBody } from "../src/http/parse-response-body.ts";

test("parseHttpResponseBody returns null for empty body", () => {
	assert.deepEqual(parseHttpResponseBody("", null), {
		parsed: null,
		parseFailed: false,
	});
});

test("parseHttpResponseBody parses JSON content-type", () => {
	const result = parseHttpResponseBody(
		'{"ok":true}',
		"application/json; charset=utf-8",
	);
	assert.equal(result.parseFailed, false);
	assert.deepEqual(result.parsed, { ok: true });
});

test("parseHttpResponseBody parses JSON-looking bodies without content-type", () => {
	const result = parseHttpResponseBody("[1,2]", null);
	assert.equal(result.parseFailed, false);
	assert.deepEqual(result.parsed, [1, 2]);
});

test("parseHttpResponseBody keeps plain text and flags invalid JSON", () => {
	assert.deepEqual(parseHttpResponseBody("not-json", "text/plain"), {
		parsed: "not-json",
		parseFailed: false,
	});
	assert.deepEqual(parseHttpResponseBody("{broken", "application/json"), {
		parsed: "{broken",
		parseFailed: true,
	});
});

test("appendHttpQuery skips nullish values", () => {
	assert.equal(
		appendHttpQuery("/path", { a: 1, b: null, c: undefined, d: "x" }),
		"/path?a=1&d=x",
	);
});

test("appendHttpQuery can skip empty strings", () => {
	assert.equal(
		appendHttpQuery("/path", { a: "", b: "ok" }, { skipEmptyString: true }),
		"/path?b=ok",
	);
	assert.equal(appendHttpQuery("/path", { a: "" }), "/path?a=");
});
