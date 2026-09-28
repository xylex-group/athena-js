import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { isAllowedRequestOrigin } from "../src/runtime/data/origin.ts";

function request(
  url: string,
  init?: { method?: string; origin?: string; referer?: string }
): Request {
  const headers = new Headers();
  if (init?.origin) {
    headers.set("origin", init.origin);
  }
  if (init?.referer) {
    headers.set("referer", init.referer);
  }
  return new Request(url, { headers, method: init?.method ?? "GET" });
}

test("isAllowedRequestOrigin rejects missing Origin on POST", () => {
  assert.equal(
    isAllowedRequestOrigin(
      request("https://app.example/api/athena", { method: "POST" })
    ),
    false
  );
});

test("isAllowedRequestOrigin allows same-origin GET without Origin when opted in", () => {
  assert.equal(
    isAllowedRequestOrigin(
      request("https://app.example/api/athena/storage?key=a"),
      [],
      { allowMissingOriginOnSafeMethods: true }
    ),
    true
  );
});

test("isAllowedRequestOrigin still rejects cross-origin Origin on opted-in GET", () => {
  assert.equal(
    isAllowedRequestOrigin(
      request("https://app.example/api/athena/storage?key=a", {
        origin: "https://evil.example",
      }),
      [],
      { allowMissingOriginOnSafeMethods: true }
    ),
    false
  );
});

test("isAllowedRequestOrigin rejects missing Origin on POST even when GET option is set", () => {
  assert.equal(
    isAllowedRequestOrigin(
      request("https://app.example/api/athena", { method: "POST" }),
      [],
      { allowMissingOriginOnSafeMethods: true }
    ),
    false
  );
});

test("isAllowedRequestOrigin uses Referer when Origin is absent on opted-in GET", () => {
  assert.equal(
    isAllowedRequestOrigin(
      request("https://app.example/api/athena/storage?key=a", {
        referer: "https://evil.example/page",
      }),
      [],
      { allowMissingOriginOnSafeMethods: true }
    ),
    false
  );
  assert.equal(
    isAllowedRequestOrigin(
      request("https://app.example/api/athena/storage?key=a", {
        referer: "https://app.example/settings",
      }),
      [],
      { allowMissingOriginOnSafeMethods: true }
    ),
    true
  );
});
