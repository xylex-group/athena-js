import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresBillingSubjectRepository } from "../src/billing/subject/postgres.ts";

test("reservation inserts once, retries reuse, then promote to Mollie customer id", async () => {
  const rows: Array<Record<string, unknown>> = [];
  let customerCreates = 0;
  const sql = {
    async query(text: string, params?: readonly unknown[]) {
      if (text.includes("INSERT INTO billing.billing_subject_bindings")) {
        const existing = rows.find(
          (row) =>
            row.connection_id === params?.[0] &&
            row.provider_subject_kind === params?.[3] &&
            row.provider_subject_id === params?.[4]
        );
        if (existing) {
          return { rows: [] };
        }
        const row = {
          connection_id: params?.[0],
          email_snapshot: null,
          id: "bind_1",
          is_primary: false,
          provider_subject_id: params?.[4],
          provider_subject_kind: params?.[3],
          source: params?.[5],
          status: "pending",
          subject_id: params?.[2],
          subject_kind: params?.[1],
        };
        rows.push(row);
        return { rows: [row] };
      }
      if (text.includes("UPDATE billing.billing_subject_bindings")) {
        const row = rows.find((entry) => entry.id === params?.[1]);
        if (row == null) {
          return { rows: [] };
        }
        row.provider_subject_id = params?.[0];
        row.status = "active";
        row.is_primary = true;
        return { rows: [row] };
      }
      if (text.includes("SELECT * FROM billing.billing_subject_bindings")) {
        return { rows: [...rows] };
      }
      return { rows: [] };
    },
  };
  const repository = createPostgresBillingSubjectRepository(sql);
  const subject = { id: "user_1", kind: "user" as const };
  const first = await repository.reserve({
    connectionId: "conn_1",
    providerSubjectKind: "customer",
    source: "created",
    subject,
  });
  assert.equal(first.inserted, true);
  assert.equal(first.binding.providerSubjectId, "reserve:user_1");
  const retry = await repository.reserve({
    connectionId: "conn_1",
    providerSubjectKind: "customer",
    source: "created",
    subject,
  });
  assert.equal(retry.inserted, false);
  assert.equal(retry.binding.providerSubjectId, "reserve:user_1");
  customerCreates += 1;
  const activated = await repository.activate({
    id: first.binding.id,
    providerSubjectId: "cst_xxxxxxxxx",
  });
  assert.equal(activated.providerSubjectId, "cst_xxxxxxxxx");
  assert.equal(customerCreates, 1);
  assert.equal(rows.length, 1);
});
