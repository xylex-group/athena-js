import assert from "node:assert/strict";
import test from "node:test";
import {
  getOriginFromHeaders,
  isDynamicServerUsageError,
} from "../src/utils/request-origin.ts";

test("isDynamicServerUsageError detects digest and message", () => {
  assert.equal(isDynamicServerUsageError(null), false);
  assert.equal(
    isDynamicServerUsageError({ digest: "DYNAMIC_SERVER_USAGE" }),
    true
  );
  assert.equal(
    isDynamicServerUsageError({ message: "Dynamic server usage: headers" }),
    true
  );
  assert.equal(isDynamicServerUsageError({ message: "other" }), false);
});

test("getOriginFromHeaders prefers Origin", () => {
  const headers = {
    get: (name: string) =>
      name === "origin" ? "https://app.example.com" : null,
  };
  assert.equal(getOriginFromHeaders(headers), "https://app.example.com");
});

test("getOriginFromHeaders uses forwarded host and proto", () => {
  const headers = {
    get: (name: string) => {
      if (name === "x-forwarded-host") {
        return "preview.example.com, other";
      }
      if (name === "x-forwarded-proto") {
        return "https, http";
      }
      return null;
    },
  };
  assert.equal(getOriginFromHeaders(headers), "https://preview.example.com");
});

test("getOriginFromHeaders falls back host + preferHttp", () => {
  const headers = {
    get: (name: string) => (name === "host" ? "localhost:3000" : null),
  };
  assert.equal(
    getOriginFromHeaders(headers, { preferHttpWhenMissingProto: true }),
    "http://localhost:3000"
  );
  assert.equal(
    getOriginFromHeaders(headers, { preferHttpWhenMissingProto: false }),
    "https://localhost:3000"
  );
});
