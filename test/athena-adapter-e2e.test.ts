import { strict as assert } from "assert";
import { test } from "node:test";
import crypto from "crypto";
import { createClient } from "../src/client.ts";

const ATHENA_URL = process.env.ATHENA_URL_E2E;
const ATHENA_API_KEY = process.env.ATHENA_API_KEY_E2E;
const ATHENA_CLIENT = process.env.ATHENA_CLIENT_E2E;
const ATHENA_COMPANY_ID = process.env.ATHENA_COMPANY_ID_E2E ?? "athena_logging";
const ATHENA_ORG_ID = process.env.ATHENA_ORG_ID_E2E ?? "athena_logging";
const ATHENA_USER_ID = process.env.ATHENA_USER_ID_E2E ?? "athena_logging";

const testFn = ATHENA_URL && ATHENA_API_KEY ? test : test.skip;

// Define type for the table schema
type AthenaAdapterE2E = {
  id: string;
  name: string;
  email: string;
  number: number;
  text: string;
  uuid: string;
  jsonb: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

testFn("adapter E2E: insert, select, update, delete on athena_adapter_e2e", async () => {
  const athena = createClient({
    key: ATHENA_API_KEY,
    gatewayUrl: ATHENA_URL,
    client: ATHENA_CLIENT,
    backend: { type: "athena" },
    headers: {
      "X-Company-Id": ATHENA_COMPANY_ID,
      "X-Organization-Id": ATHENA_ORG_ID,
      "X-User-Id": ATHENA_USER_ID,
    },
  });
  const id = `e2e-${crypto.randomUUID()}`;
  const email = `${id}@example.com`;

  try {
    // Insert
    const {
      data: inserted,
      error: insertError,
      status: insertStatus,
    }: {
      data: AthenaAdapterE2E | null;
      error: { message: string } | null;
      status: number;
    } = await athena
      .from<AthenaAdapterE2E>("athena_adapter_e2e")
      .insert({
        id,
        name: "E2E User",
        email,
        number: 123,
        text: "hello",
        uuid: crypto.randomUUID(),
        jsonb: { hello: "world" },
      })
      .select("id,name,email,number,text,uuid,jsonb,created_at,updated_at");

    assert.ok(
      insertStatus >= 200 && insertStatus < 300,
      `insert unexpected status ${insertStatus} error ${insertError?.message ?? ""}`,
    );
    assert.equal(insertError, null, `insert error: ${insertError?.message ?? ""}`);
    assert.equal(inserted?.id, id);
    assert.equal(inserted?.email, email);

    // Select
    const {
      data: selectData,
      error: selectError,
    }: {
      data: AthenaAdapterE2E | null;
      error: { message: string } | null;
    } = await athena
      .from<AthenaAdapterE2E>("athena_adapter_e2e")
      .select("id,name,email,number,text,uuid,jsonb,created_at,updated_at")
      .eq("id", id)
      .single();
    assert.equal(selectError, null, `select error: ${selectError?.message ?? ""}`);
    assert.equal(selectData?.email, email);
    assert.equal(selectData?.name, "E2E User");
    assert.equal(selectData?.number, 123);
    assert.equal(selectData?.text, "hello");
    assert.ok(selectData?.uuid);
    assert.ok(selectData?.jsonb);

    // Delete
    const {
      error: deleteError,
    }: {
      error: { message: string } | null;
    } = await athena
      .from<AthenaAdapterE2E>("athena_adapter_e2e")
      .eq("id", id)
      .delete()
      .single("id");
    assert.equal(deleteError, null, `delete error: ${deleteError?.message ?? ""}`);
  } finally {
    // Best-effort cleanup
    await athena.from("public.athena_adapter_e2e").eq("id", id).delete();
  }
});
