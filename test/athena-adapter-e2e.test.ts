import { strict as assert } from "assert";
import { test } from "node:test";
import crypto from "crypto";
import { createClient } from "../src/supabase.ts";

const ATHENA_URL =
  process.env.ATHENA_URL_E2E ?? "https://mirror1.athena-db.com";
const ATHENA_API_KEY =
  process.env.ATHENA_API_KEY_E2E ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCIsImVtYWlsIjoiZmxvcmlzQHh5bGV4LmFpIiwiZXhwIjoyNDk3MDMzNjY2fQ.LdPqTGaFq5pTokW1DA81WFjmG4nReJCOSKr3mFtXNoA";
const ATHENA_CLIENT = process.env.ATHENA_CLIENT_E2E;
const ATHENA_COMPANY_ID = process.env.ATHENA_COMPANY_ID_E2E ?? "athena_logging";
const ATHENA_ORG_ID = process.env.ATHENA_ORG_ID_E2E ?? "athena_logging";
const ATHENA_USER_ID = process.env.ATHENA_USER_ID_E2E ?? "athena_logging";

if (!ATHENA_URL || !ATHENA_API_KEY) {
  throw new Error(
    "ATHENA_URL_E2E and ATHENA_API_KEY_E2E (or defaults) are required for E2E",
  );
}

test("adapter E2E: insert, select, update, delete on athena_adapter_e2e", async () => {
  const client = createClient(ATHENA_URL, ATHENA_API_KEY, {
    ...(ATHENA_CLIENT ? { client: ATHENA_CLIENT } : {}),
    headers: {
      "X-Company-Id": ATHENA_COMPANY_ID,
      "X-Organization-Id": ATHENA_ORG_ID,
    },
  });
  const id = `e2e-${crypto.randomUUID()}`;
  const email = `${id}@example.com`;

  try {
    // Insert
    const insertResult = await client
      .from("public.athena_adapter_e2e")
      .insert({ id, name: "E2E User", email })
      .single("id,name,email,created_at,updated_at");

    assert.ok(
      insertResult.status >= 200 && insertResult.status < 300,
      `insert unexpected status ${insertResult.status} error ${insertResult.error ?? ""}`,
    );
    if (
      insertResult.error &&
      insertResult.error !== "Data inserted successfully"
    ) {
      assert.fail(`insert error: ${insertResult.error}`);
    }
    const inserted = insertResult.data as {
      id?: string;
      name?: string;
      email?: string;
    } | null;
    assert.equal(inserted?.id, id);
    assert.equal(inserted?.email, email);

    // Select
    const selectResult = await client
      .from("public.athena_adapter_e2e")
      .select("id,name,email,created_at,updated_at")
      .eq("id", id)
      .single();
    assert.equal(
      selectResult.error,
      null,
      `select error: ${selectResult.error ?? ""}`,
    );
    const selectData = selectResult.data as {
      email?: string;
      name?: string;
    } | null;
    assert.equal(selectData?.email, email);
    assert.equal(selectData?.name, "E2E User");

    // Delete
    const deleteResult = await client
      .from("public.athena_adapter_e2e")
      .eq("id", id)
      .delete()
      .single("id");
    assert.equal(
      deleteResult.error,
      null,
      `delete error: ${deleteResult.error ?? ""}`,
    );
  } finally {
    // Best-effort cleanup
    await client.from("athena_adapter_e2e").eq("id", id).delete();
  }
});
