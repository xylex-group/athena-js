import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { resolveTrustedCallbackUrl } from "../src/auth/local/security.ts";

const requestUrl = "https://app.example.test/api/auth/sign-in";
const trustedOrigins = ["https://app.example.test", "https://admin.example.test"];

test("trusted callback URLs accept relative and configured origins", () => {
  assert.equal(
    resolveTrustedCallbackUrl({
      callbackUrl: "/settings?tab=security",
      requestUrl,
      trustedOrigins,
    }),
    "https://app.example.test/settings?tab=security"
  );
  assert.equal(
    resolveTrustedCallbackUrl({
      callbackUrl: "https://admin.example.test/complete",
      requestUrl,
      trustedOrigins,
    }),
    "https://admin.example.test/complete"
  );
});

test("relative callbacks prefer the trusted origin handling the request", () => {
  assert.equal(
    resolveTrustedCallbackUrl({
      callbackUrl: "/settings",
      requestUrl: "https://admin.example.test/api/auth/sign-in",
      trustedOrigins,
    }),
    "https://admin.example.test/settings"
  );
  assert.equal(
    resolveTrustedCallbackUrl({
      requestUrl: "https://admin.example.test/api/auth/sign-in",
      fallbackPath: "/reset-password",
      trustedOrigins,
    }),
    "https://admin.example.test/reset-password"
  );
});

test("same-origin callbacks retain compatibility without configured origins", () => {
  assert.equal(
    resolveTrustedCallbackUrl({
      callbackUrl: "/settings",
      requestUrl: "https://app.example.test/api/auth/sign-in",
      trustedOrigins: [],
    }),
    "https://app.example.test/settings"
  );
  assert.equal(
    resolveTrustedCallbackUrl({
      callbackUrl: "https://app.example.test/settings",
      requestUrl,
      trustedOrigins: [],
    }),
    "https://app.example.test/settings"
  );
  assert.throws(() =>
    resolveTrustedCallbackUrl({
      callbackUrl: "https://evil.example.test/settings",
      requestUrl,
      trustedOrigins: [],
    })
  );
});

test("trusted callback URLs reject untrusted and credential-bearing destinations", () => {
  for (const callbackUrl of [
    "https://evil.example.test/steal",
    "//evil.example.test/steal",
    "javascript:alert(1)",
    "data:text/html,owned",
    "https://user:password@app.example.test/steal",
  ]) {
    assert.throws(() =>
      resolveTrustedCallbackUrl({
        callbackUrl,
        requestUrl,
        trustedOrigins,
      })
    );
  }
});

test("relative callbacks resolve against configured origin, not request origin", () => {
  assert.equal(
    resolveTrustedCallbackUrl({
      callbackUrl: "/settings",
      requestUrl: "https://attacker.example.test/api/auth/sign-in",
      trustedOrigins: ["https://app.example.test"],
    }),
    "https://app.example.test/settings"
  );
  assert.throws(() =>
    resolveTrustedCallbackUrl({
      callbackUrl: "https://attacker.example.test/settings",
      requestUrl: "https://app.example.test/api/auth/sign-in",
      trustedOrigins: ["https://app.example.test"],
    })
  );
});
