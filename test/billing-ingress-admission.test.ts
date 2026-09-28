import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createBillingIngressAdmission,
  type BillingIngressAdmission,
} from "../src/billing/ingestion/admission.ts";
import { createAthenaBillingIngressHandlers } from "../src/next/billing-ingress-handlers.ts";
import {
  attachAthenaClientInternals,
  createRootClientInternals,
} from "../src/runtime/client-internals.ts";

function admission(
  overrides: Parameters<typeof createBillingIngressAdmission>[0] = {}
): BillingIngressAdmission {
  return createBillingIngressAdmission({
    ...overrides,
    now: (() => {
      let time = 0;
      return () => time++;
    })(),
  });
}

test("forwarded IP headers require an explicit trusted-proxy policy", () => {
  assert.equal(admission().policy().trustProxy, false);
  assert.equal(admission({ trustProxy: true }).policy().trustProxy, true);
});

test("Billing ingress admission enforces body size and concurrent caps", () => {
  const controller = admission({
    maxBodyBytes: 10,
    maxConcurrent: 1,
  });
  const accepted = controller.admit({
    bodyBytes: 5,
    connectionId: "connection-a",
    ip: "127.0.0.1",
    provider: "mollie",
  });
  assert.equal(accepted.accepted, true);
  assert.equal(
    controller.admit({
      bodyBytes: 5,
      connectionId: "connection-a",
      ip: "127.0.0.1",
      provider: "mollie",
    }).reason,
    "concurrent_limit"
  );
  accepted.release();
  assert.equal(
    controller.admit({
      bodyBytes: 11,
      connectionId: "connection-a",
      ip: "127.0.0.1",
      provider: "mollie",
    }).reason,
    "body_too_large"
  );
});

test("Billing ingress admission applies burst/rate limits per stable key", () => {
  const controller = admission({
    burst: 2,
    ratePerSecond: 1,
  });
  const input = {
    bodyBytes: 1,
    connectionId: "connection-a",
    ip: "127.0.0.1",
    provider: "mollie",
  };
  assert.equal(controller.admit(input).accepted, true);
  assert.equal(controller.admit(input).accepted, true);
  assert.equal(controller.admit(input).reason, "rate_limited");
  assert.equal(
    controller.admit({ ...input, connectionId: "connection-b" }).accepted,
    true
  );
});

test("unknown webhook tokens share the source identity admission bucket", () => {
  const controller = admission({
    burst: 2,
    ratePerSecond: 1,
  });
  const input = {
    bodyBytes: 1,
    ip: "203.0.113.10",
    provider: "mollie",
  };
  assert.equal(
    controller.admit({ ...input, token: "whtok_aaaaaaaaaaaaaa" }).accepted,
    true
  );
  assert.equal(
    controller.admit({ ...input, token: "whtok_bbbbbbbbbbbbbb" }).accepted,
    true
  );
  assert.equal(
    controller.admit({ ...input, token: "whtok_cccccccccccccc" }).reason,
    "rate_limited"
  );
});

test("unknown webhook tokens share the anonymous bucket without a trusted proxy", () => {
  const controller = admission({
    burst: 2,
    ratePerSecond: 1,
  });
  const input = {
    bodyBytes: 1,
    provider: "mollie",
  };
  assert.equal(
    controller.admit({ ...input, token: "whtok_aaaaaaaaaaaaaa" }).accepted,
    true
  );
  assert.equal(
    controller.admit({ ...input, token: "whtok_bbbbbbbbbbbbbb" }).accepted,
    true
  );
  assert.equal(
    controller.admit({ ...input, token: "whtok_cccccccccccccc" }).reason,
    "rate_limited"
  );
});

test("resolved webhook admission transfers to the connection bucket", () => {
  const controller = admission({
    burst: 1,
    maxConcurrent: 1,
    ratePerSecond: 1,
  });
  const accepted = controller.admit({
    provider: "mollie",
    token: "whtok_valid",
  });
  assert.equal(accepted.accepted, true);
  const rekeyed = accepted.rekey({
    connectionId: "connection-a",
    provider: "mollie",
  });
  assert.equal(rekeyed.accepted, true);
  assert.equal(
    controller.admit({ provider: "mollie", token: "whtok_unknown" }).accepted,
    true
  );
  assert.equal(
    controller.admit({
      connectionId: "connection-a",
      provider: "mollie",
    }).reason,
    "concurrent_limit"
  );
  rekeyed.release();
});

test("Billing ingress admission records invalid-auth and duplicate counters", () => {
  const controller = admission();
  controller.recordInvalidAuth("connection-a");
  controller.recordDuplicate("connection-a");
  assert.deepEqual(controller.counters(), {
    accepted: 0,
    duplicate: 1,
    invalidAuth: 1,
    rateLimited: 0,
    received: 0,
  });
});

function handlerClient(ingest: (request: unknown) => Promise<unknown>): object {
  const client = {};
  attachAthenaClientInternals(
    client,
    createRootClientInternals({
      config: { auth: false },
      eventIngressRuntime: { ingest },
      plan: {
        auth: { runtime: "disabled" },
        db: { transport: "gateway" },
        runtime: { environment: "node" },
        storage: { transport: "none" },
      },
    })
  );
  return client;
}

test("Billing HTTP admission rejects oversized bodies before normalization", async () => {
  let calls = 0;
  const handlers = createAthenaBillingIngressHandlers({
    admission: { maxBodyBytes: 3 },
    client: handlerClient(async () => {
      calls += 1;
      return { duplicate: false, events: [] };
    }),
    connectionId: "connection-a",
  });
  const response = await handlers.POST(
    new Request("http://localhost/api/athena/billing/webhook/mollie/classic", {
      body: "12345",
      headers: {
        "content-length": "5",
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 413);
  assert.equal(calls, 0);
});

test("Billing HTTP admission caps in-flight webhook processing", async () => {
  let started = 0;
  let releaseProcessing: (() => void) | undefined;
  const processingReleased = new Promise<void>((resolve) => {
    releaseProcessing = resolve;
  });
  const handlers = createAthenaBillingIngressHandlers({
    admission: { maxConcurrent: 1 },
    client: handlerClient(async () => {
      started += 1;
      await processingReleased;
      return { duplicate: false, events: [] };
    }),
    connectionId: "connection-a",
  });
  const request = () =>
    handlers.POST(
      new Request(
        "http://localhost/api/athena/billing/webhook/mollie/classic",
        {
          body: "id=tr_xxx",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
        }
      )
    );
  const first = request();
  await new Promise((resolve) => setImmediate(resolve));
  const second = await request();
  assert.equal(second.status, 429);
  assert.equal(started, 1);
  releaseProcessing?.();
  assert.equal((await first).status, 202);
});
