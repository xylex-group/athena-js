/**
 * SUPERSEDED by test/sdd/athena-resource-identity.target.test.ts
 *
 * Former characterization of split resource identity:
 * - PolicyResourceRef was a standalone interface
 * - runtime model descriptor dropped database/model
 * - resourceNameFromPayload returned raw table_name (still true; not inverted)
 * - Data Nucleus mutation input was table-only
 *
 * Target suite is the CI source of truth. Do not invert titles in place.
 *
 * See docs/sdd/xylex/athena-resource-identity/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildAthenaRuntimeModelIndex,
  resourceNameFromPayload,
} from "../../../src/runtime/data/model-registry.ts";
import { buildDataMutationInput } from "../../../src/runtime/data/nucleus/prepare.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

test("P?: PolicyResourceRef is a standalone interface, not AthenaResourceRef", () => {
  const src = readSrc("policy/types.ts");
  assert.match(src, /export interface PolicyResourceRef/);
  assert.equal(
    /export type PolicyResourceRef = AthenaResourceRef/.test(src),
    false
  );
  assert.equal(existsSync(join(srcRoot, "schema", "resource.ts")), false);
});

test("P?: runtime model descriptor drops database and model", () => {
  const index = buildAthenaRuntimeModelIndex(
    {
      User: {
        meta: {
          database: "main",
          model: "User",
          primaryKey: ["id"],
          schema: "auth",
          tableName: "users",
        },
      },
    },
    "strict"
  );
  const descriptor = index.get("auth.users");
  assert.ok(descriptor);
  assert.equal(descriptor.table, "users");
  assert.equal(descriptor.schema, "auth");
  assert.equal(descriptor.canonicalResource, "auth.users");
  assert.equal(
    "database" in descriptor && descriptor.database !== undefined,
    false
  );
  assert.equal("model" in descriptor && descriptor.model !== undefined, false);
});

test("P?: resourceNameFromPayload returns the raw table_name string", () => {
  assert.equal(resourceNameFromPayload({ table_name: "users" }), "users");
  assert.equal(
    resourceNameFromPayload({ table_name: "auth.users" }),
    "auth.users"
  );
});

test("P?: Data Nucleus mutation input is table-only", () => {
  const input = buildDataMutationInput({
    operation: "insert",
    payload: {
      insert_body: { id: "1" },
      table_name: "users",
    },
  });
  assert.ok(input);
  assert.equal(input.table, "users");
  assert.equal("resource" in input && input.resource !== undefined, false);
  const types = readSrc("runtime/data/nucleus/types.ts");
  assert.match(types, /table\?: string/);
  assert.equal(/\bresource\?:/.test(types) || /\bresource:/.test(types), false);
});
