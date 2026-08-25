import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { withPostgresLibpqCompatConnectionString } from "../src/postgres/connection-string.ts";

function searchParams(connectionString: string): URLSearchParams {
  const normalized = connectionString.replace(/^postgresql:/i, "postgres:");
  return new URL(normalized).searchParams;
}

test("libpq compat rewrites sslmode=require to verify-full without uselibpqcompat", () => {
  const out = withPostgresLibpqCompatConnectionString(
    "postgresql://user:pass@ep-foo.neon.tech/neondb?sslmode=require"
  );
  const params = searchParams(out);
  assert.equal(params.get("sslmode"), "verify-full");
  assert.equal(params.has("uselibpqcompat"), false);
  assert.equal(params.getAll("sslmode").length, 1);
});

test("libpq compat keeps explicit uselibpqcompat=true with sslmode=require", () => {
  const out = withPostgresLibpqCompatConnectionString(
    "postgres://user:pass@db.example.com/app?sslmode=require&uselibpqcompat=true&sslmode=require&uselibpqcompat=true"
  );
  const params = searchParams(out);
  assert.equal(params.get("sslmode"), "require");
  assert.equal(params.get("uselibpqcompat"), "true");
  assert.equal(params.getAll("sslmode").length, 1);
  assert.equal(params.getAll("uselibpqcompat").length, 1);
});

test("libpq compat does not inject SSL flags on loopback URLs without sslmode", () => {
  const input = "postgresql://postgres@127.0.0.1:5432/athena_hmr_pool";
  const out = withPostgresLibpqCompatConnectionString(input);
  const params = searchParams(out);
  assert.equal(params.has("sslmode"), false);
  assert.equal(params.has("uselibpqcompat"), false);
});

test("libpq compat defaults remote URLs without sslmode to verify-full", () => {
  const out = withPostgresLibpqCompatConnectionString(
    "postgres://user:pass@ep-foo.neon.tech/neondb"
  );
  const params = searchParams(out);
  assert.equal(params.get("sslmode"), "verify-full");
  assert.equal(params.has("uselibpqcompat"), false);
});

test("libpq compat rewrites Neon sslmode=require with channel_binding to verify-full", () => {
  const out = withPostgresLibpqCompatConnectionString(
    "postgresql://user:pass@ep-foo.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
  );
  const params = searchParams(out);
  assert.equal(params.get("sslmode"), "verify-full");
  assert.equal(params.get("channel_binding"), "require");
  assert.equal(params.has("uselibpqcompat"), false);
});

test("libpq compat preserves sslmode=verify-full without forcing uselibpqcompat", () => {
  const out = withPostgresLibpqCompatConnectionString(
    "postgres://user:pass@db.example.com/app?sslmode=verify-full"
  );
  const params = searchParams(out);
  assert.equal(params.get("sslmode"), "verify-full");
  assert.equal(params.has("uselibpqcompat"), false);
});

test("libpq compat keeps postgresql: scheme", () => {
  const out = withPostgresLibpqCompatConnectionString(
    "postgresql://user:pass@db.example.com/app?sslmode=require"
  );
  assert.match(out, /^postgresql:/);
  assert.match(out, /sslmode=verify-full/);
});
