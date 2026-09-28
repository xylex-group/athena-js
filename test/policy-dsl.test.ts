import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { string, table } from "../src/index.ts";
import {
  definePolicies,
  fingerprintDocument,
  type PolicyIrDocument,
  policy,
  publicAuthorizationMessage,
} from "../src/policy/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(
  here,
  "../../../test/fixtures/policy-ir/own-invoices.json"
);

const invoices = table("invoices")
  .schema("public")
  .columns({
    amount: string(),
    id: string().generated(),
    userId: string().from("user_id"),
  })
  .primaryKey("id");

test("T1 policy(table, {select}) builds IR matching own-invoices fixture semantics", () => {
  const authored = policy(invoices, {
    id: "users-see-own-invoices",
    name: "Users see own invoices",
    select: {
      allow: ({ row, auth }) => row.userId.eq(auth.userId),
      to: ["authenticated"],
    },
  });

  const doc = definePolicies([authored]);
  assert.equal(doc.irVersion, 1);
  assert.equal(doc.policies.length, 1);

  const p = doc.policies[0];
  assert.equal(p.resource.schema, "public");
  assert.equal(p.resource.table, "invoices");
  assert.equal(p.actions, 1);
  assert.equal(p.composition, "permissive");
  assert.deepEqual(p.principals, [{ kind: "authenticated" }]);
  assert.deepEqual(p.visibility, {
    left: {
      column: { logical: "userId", physical: "user_id" },
      kind: "column",
    },
    op: "eq",
    right: {
      kind: "subject",
      subject: { slot: "userId" },
    },
  });

  const fixture = JSON.parse(
    readFileSync(fixturePath, "utf8")
  ) as PolicyIrDocument;
  assert.deepEqual(doc, fixture);
});

test("T3 fingerprint stable under policy reorder", () => {
  const a = definePolicies([
    policy(invoices, {
      id: "a-policy",
      select: {
        allow: ({ row, auth }) => row.userId.eq(auth.userId),
      },
    }),
    policy(invoices, {
      id: "z-policy",
      select: {
        allow: ({ row, auth }) => row.userId.eq(auth.userId),
      },
    }),
  ]);
  const b: PolicyIrDocument = {
    irVersion: 1,
    policies: [a.policies[1], a.policies[0]],
  };
  assert.equal(fingerprintDocument(a), fingerprintDocument(b));
});

test("fixture fingerprint is deterministic", () => {
  const fixture = JSON.parse(
    readFileSync(fixturePath, "utf8")
  ) as PolicyIrDocument;
  const once = fingerprintDocument(fixture);
  const twice = fingerprintDocument(fixture);
  assert.equal(once, twice);
  assert.match(once, /^[a-f0-9]{64}$/);
});

test("scope mismatch is not distinguishable from missing as public rights dump", () => {
  assert.equal(publicAuthorizationMessage("scope_mismatch"), "not found");
  assert.equal(
    publicAuthorizationMessage("missing_right"),
    "insufficient rights"
  );
  assert.equal(publicAuthorizationMessage("untrusted_claim"), "unauthorized");
});
