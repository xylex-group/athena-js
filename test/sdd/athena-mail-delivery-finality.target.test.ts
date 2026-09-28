/**
 * Mail delivery persistence: submitted / accepted / failed, no double-send.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { emitAuthEmail } from "../../src/auth/email/emit.ts";
import { MemoryAuthEmailStore } from "../../src/auth/local/email/store.ts";
import type {
  AthenaEmailDeliveryPort,
  AthenaEmailDeliveryResult,
} from "../../src/email/types.ts";

const EVENT = "user.email.verify";
const DATA = {
  verification_url: "https://app.example/verify?token=verify_abc",
};

function emitInput() {
  return {
    data: DATA,
    eventType: EVENT,
    recipient: "ada@example.com",
  };
}

test("provider accepted persists submitted then accepted with messageId and from", async () => {
  const store = new MemoryAuthEmailStore();
  const delivery: AthenaEmailDeliveryPort = {
    async send(): Promise<AthenaEmailDeliveryResult> {
      return {
        accepted: ["ada@example.com"],
        from: "Athena <noreply@example.com>",
        messageId: "msg-provider-1",
        provider: "test",
        rejected: [],
        success: true,
      };
    },
  };
  let legacyCalls = 0;
  const result = await emitAuthEmail(emitInput(), {
    defaultFrom: "noreply@example.com",
    delivery,
    legacySend: () => {
      legacyCalls += 1;
    },
    store,
  });
  assert.equal(result.success, true);
  assert.equal(legacyCalls, 0);
  const rows = await store.listEmails();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row?.metadata.delivery_status, "accepted");
  assert.equal(row?.metadata.provider_message_id, "msg-provider-1");
  assert.equal(row?.from_address, "Athena <noreply@example.com>");
  assert.equal(row?.provider, "test");
  assert.equal((await store.listFailures()).length, 0);
});

test("provider throws keeps the submitted row as failed", async () => {
  const store = new MemoryAuthEmailStore();
  const delivery: AthenaEmailDeliveryPort = {
    async send(): Promise<AthenaEmailDeliveryResult> {
      throw new Error("smtp down");
    },
  };
  const result = await emitAuthEmail(emitInput(), {
    defaultFrom: "noreply@example.com",
    delivery,
    store,
  });
  assert.equal(result.success, false);
  const rows = await store.listEmails();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.metadata.delivery_status, "failed");
  assert.equal(rows[0]?.metadata.failure_reason, "smtp down");
  assert.equal((await store.listFailures()).length, 1);
});

test("provider success:false keeps the row as failed", async () => {
  const store = new MemoryAuthEmailStore();
  const delivery: AthenaEmailDeliveryPort = {
    async send(): Promise<AthenaEmailDeliveryResult> {
      return {
        accepted: [],
        provider: "test",
        rejected: ["ada@example.com"],
        success: false,
      };
    },
  };
  const result = await emitAuthEmail(emitInput(), {
    defaultFrom: "noreply@example.com",
    delivery,
    store,
  });
  assert.equal(result.success, false);
  const rows = await store.listEmails();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.metadata.delivery_status, "failed");
  assert.equal(rows[0]?.provider, "test");
});

test("from address comes from normalized root email defaults", async () => {
  const store = new MemoryAuthEmailStore();
  let seenFrom: string | undefined;
  const delivery: AthenaEmailDeliveryPort = {
    async send(message): Promise<AthenaEmailDeliveryResult> {
      seenFrom = message.from;
      return {
        accepted: ["ada@example.com"],
        from: message.from,
        provider: "test",
        rejected: [],
        success: true,
      };
    },
  };
  await emitAuthEmail(emitInput(), {
    defaultFrom: "ops@athena.example",
    defaultFromName: "Athena Ops",
    delivery,
    store,
  });
  assert.equal(seenFrom, "ops@athena.example");
  const row = (await store.listEmails())[0];
  assert.equal(row?.from_address, "ops@athena.example");
  assert.equal(row?.from_name, "Athena Ops");
});
