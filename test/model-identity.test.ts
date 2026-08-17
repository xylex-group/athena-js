import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { string, table } from "../src/index.ts";
import {
  athenaEntityKeyToken,
  createAthenaEntityKey,
  modelIdentity,
} from "../src/query/model-identity.ts";

const File = table("File")
  .schema("public")
  .from("files")
  .columns({
    displayName: string(),
    fileId: string().generated(),
    organizationId: string(),
  })
  .primaryKey("fileId");

const Membership = table("Membership")
  .schema("public")
  .from("memberships")
  .columns({
    organizationId: string(),
    userId: string(),
  })
  .primaryKey("organizationId", "userId");

test("modelIdentity reads a single primary key", () => {
  assert.deepEqual(
    modelIdentity(File, { displayName: "a.pdf", fileId: "123" }),
    [["fileId", "123"]]
  );
});

test("modelIdentity reads a composite primary key", () => {
  assert.deepEqual(
    modelIdentity(Membership, { organizationId: "org-1", userId: "user-5" }),
    [
      ["organizationId", "org-1"],
      ["userId", "user-5"],
    ]
  );
});

test("modelIdentity fails closed when a PK field is missing", () => {
  assert.throws(
    () => modelIdentity(File, { displayName: "a.pdf" }),
    /missing primary key field "fileId"/
  );
  assert.throws(
    () => modelIdentity(Membership, { organizationId: "org-1" }),
    /missing primary key field "userId"/
  );
});

test("AthenaEntityKey includes access context", () => {
  const row = { fileId: "1" };
  const orgA = createAthenaEntityKey(File, row, { organizationId: "org-a" });
  const orgB = createAthenaEntityKey(File, row, { organizationId: "org-b" });
  assert.notEqual(athenaEntityKeyToken(orgA), athenaEntityKeyToken(orgB));
  assert.equal(orgA.model.table, "files");
  assert.equal(orgA.context?.organizationId, "org-a");
});
