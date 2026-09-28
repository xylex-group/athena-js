import assert from "node:assert/strict";
import { test } from "node:test";

import { AthenaAuthRuntimeError } from "../src/auth/local/errors.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { assertAthenaAuthSchemaCompatible } from "../src/auth/local/schema.ts";
import { createObservingAuthDatabase } from "./auth-schema-observer.ts";

test("older Auth schema is upgrade-required and fails closed", async () => {
  const database = createObservingAuthDatabase({ version: 1 });
  await assert.rejects(
    () => assertAthenaAuthSchemaCompatible(database),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_SCHEMA_OUTDATED" &&
      error.publicMessage.includes("npx @xylex-group/athena migrate")
  );

  const runtime = createAthenaAuthRuntime({
    database,
    secret: "test-secret",
  });
  await assert.rejects(
    () => runtime.getStores(),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_SCHEMA_OUTDATED" &&
      error.publicMessage.includes("npx @xylex-group/athena migrate")
  );
  await runtime.close();
});
