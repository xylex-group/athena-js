import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createAthenaRuntimeReadiness } from "../src/runtime/readiness/index.ts";

test("runtime readiness gates wait until ready without making constructors async", async () => {
  const readiness = createAthenaRuntimeReadiness();
  let billed = false;
  const pending = readiness.waitFor("billing").then(() => {
    billed = true;
  });
  assert.equal(billed, false);
  readiness.ready("billing");
  await pending;
  assert.equal(billed, true);
  await readiness.waitFor("billing");
});

test("runtime readiness fail rejects waiters once", async () => {
  const readiness = createAthenaRuntimeReadiness();
  const pending = readiness.waitFor("auth");
  readiness.fail("auth", new Error("auth bootstrap failed"));
  await assert.rejects(pending, /auth bootstrap failed/);
  readiness.fail("auth", new Error("ignored"));
});
