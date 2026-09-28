/**
 * Athena 5 Finality — P11 advanced Auth classification (INV-11).
 * Public seam: createClient rejects unsupported embedded features.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { AthenaConfigurationError, createClient } from "../src/v3-client.ts";

const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_finality_test";

test("P11: embedded Auth rejects passkeys with an explicit Athena error", () => {
  assert.throws(
    () =>
      createClient({
        auth: { passkeys: true } as never,
        databaseUrl: SAMPLE_PG,
        env: {},
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_FEATURE_UNSUPPORTED" &&
      /passkey/i.test(error.message)
  );
});

test("P11: embedded Auth rejects WebAuthn/passkeys aliases", () => {
  assert.throws(
    () =>
      createClient({
        auth: { webauthn: true } as never,
        databaseUrl: SAMPLE_PG,
        env: {},
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_FEATURE_UNSUPPORTED"
  );
});

test("P11: object auth.oauth provider maps are not a JS-only OAuth stack", () => {
  let client: unknown;
  try {
    client = createClient({
      auth: {
        mode: "remote",
        oauth: { google: { clientId: "x" } },
        url: "https://auth.example.test",
      } as never,
      env: {},
    });
  } catch (error) {
    assert.equal(
      error instanceof AthenaConfigurationError &&
        error.code === "ATHENA_AUTH_FEATURE_UNSUPPORTED",
      false,
      "object auth.oauth must not throw ATHENA_AUTH_FEATURE_UNSUPPORTED"
    );
    throw error;
  }
  assert.ok(client);
  void SAMPLE_PG;
});
