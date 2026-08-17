import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import packageJson from "../package.json" with { type: "json" };
import {
  applyAthenaApiKeyHeaders,
  buildAthenaRequestHeaders,
} from "../src/utils/athena-request-headers.ts";

const SDK_HEADER_VALUE = `xylex-group/athena ${packageJson.version}`;

test("buildAthenaRequestHeaders sets the canonical API key header", () => {
  const headers = buildAthenaRequestHeaders({
    apiKey: "ath_test_key",
    client: "railway_direct",
    profile: "gateway",
    sdkHeaderValue: SDK_HEADER_VALUE,
  });

  assert.equal(headers["X-Athena-Key"], "ath_test_key");
  assert.equal(headers["X-Athena-Client"], "railway_direct");
  assert.equal(headers["X-Athena-Sdk"], SDK_HEADER_VALUE);
});

test("buildAthenaRequestHeaders mirrors lean cookie session auth for gateway and storage", () => {
  const headers = buildAthenaRequestHeaders({
    apiKey: "secret",
    configHeaders: {
      Authorization: "Bearer bearer-from-header",
      Cookie: "athena-auth.session-token=session-from-cookie; theme=dark",
    },
    profile: "storage",
    sdkHeaderValue: SDK_HEADER_VALUE,
  });

  assert.equal(
    headers.Cookie,
    "athena-auth.session-token=session-from-cookie; theme=dark"
  );
  assert.equal(headers.Authorization, "Bearer bearer-from-header");
  assert.equal(headers["X-Athena-Auth-Session-Token"], "session-from-cookie");
  assert.equal(headers["X-Athena-Auth-Bearer-Token"], "bearer-from-header");
});

test("buildAthenaRequestHeaders forwards pg and jdbc routing headers", () => {
  const headers = buildAthenaRequestHeaders({
    apiKey: "secret",
    jdbcUrl: "jdbc:postgresql://db.internal:5432/app",
    pgUri: "postgres://user:pass@db.internal:5432/app",
    profile: "gateway",
    sdkHeaderValue: SDK_HEADER_VALUE,
  });

  assert.equal(
    headers["x-pg-uri"],
    "postgres://user:pass@db.internal:5432/app"
  );
  assert.equal(
    headers["x-athena-jdbc-url"],
    "jdbc:postgresql://db.internal:5432/app"
  );
  assert.equal(headers["x-jdbc-url"], "jdbc:postgresql://db.internal:5432/app");
});

test("buildAthenaRequestHeaders auth profile keeps bearer and session without gateway mirrors", () => {
  const headers = buildAthenaRequestHeaders({
    apiKey: "auth-key",
    bearerToken: "bearer_1",
    cookie: "athena-auth.session_token=session_1",
    profile: "auth",
    sdkHeaderValue: SDK_HEADER_VALUE,
    sessionToken: "session_1",
  });

  assert.equal(headers["X-Athena-Key"], "auth-key");
  assert.equal(headers.Authorization, "Bearer bearer_1");
  assert.equal(headers.Cookie, "athena-auth.session_token=session_1");
  assert.equal(headers["X-Athena-Auth-Session-Token"], "session_1");
  assert.equal(headers["X-Athena-Auth-Bearer-Token"], undefined);
});

test("buildAthenaRequestHeaders chat profile mirrors auth context and accepts prefixed bearer tokens", () => {
  const headers = buildAthenaRequestHeaders({
    apiKey: "secret",
    bearerToken: "Bearer chat-token",
    client: "chat_client",
    cookie: "athena-auth.session_token=chat-session",
    profile: "chat",
    sdkHeaderValue: SDK_HEADER_VALUE,
  });

  assert.equal(headers.Accept, "application/json");
  assert.equal(headers["X-Athena-Client"], "chat_client");
  assert.equal(headers.Authorization, "Bearer chat-token");
  assert.equal(headers["X-Athena-Auth-Bearer-Token"], "chat-token");
  assert.equal(headers["X-Athena-Auth-Session-Token"], "chat-session");
});

test("applyAthenaApiKeyHeaders does not clobber an explicit canonical key header", () => {
  const headers: Record<string, string> = {
    "X-Athena-Key": "explicit-key",
  };

  applyAthenaApiKeyHeaders(headers, "fallback-key");

  assert.deepEqual(headers, { "X-Athena-Key": "explicit-key" });
});

test("buildAthenaRequestHeaders accepts a legacy X-Api-Key input header and normalizes it", () => {
  const headers = buildAthenaRequestHeaders({
    configHeaders: {
      "X-Api-Key": "header-only-key",
    },
    profile: "gateway",
    sdkHeaderValue: SDK_HEADER_VALUE,
  });

  assert.equal(headers["X-Athena-Key"], "header-only-key");
});

test("buildAthenaRequestHeaders preserves an explicit canonical key header", () => {
  const headers = buildAthenaRequestHeaders({
    apiKey: "general-key",
    callHeaders: {
      "X-Athena-Key": "call-athena-key",
    },
    profile: "gateway",
    sdkHeaderValue: SDK_HEADER_VALUE,
  });

  assert.equal(headers["X-Athena-Key"], "call-athena-key");
});
