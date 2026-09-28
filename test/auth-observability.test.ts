import assert from "node:assert/strict";
import { test } from "node:test";
import { ATHENA_AUTH_SCHEMA_GENERATION } from "../src/auth/contract/index.ts";
import { ATHENA_AUTH_EVENT_DEFINITIONS } from "../src/auth/domain/catalog.ts";
import { ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS } from "../src/auth/hooks/events.ts";
import { executeAuthMutation } from "../src/auth/hooks/execute.ts";
import { MemoryAuthStores } from "../src/auth/local/memory-stores.ts";
import { createMemoryAuthMutationTransaction } from "../src/auth/local/mutation-transaction.ts";
import {
  currentAuthRequestTiming,
  runWithAuthRequestTiming,
} from "../src/auth/local/request-timing.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { getAthenaAuthExpectedLedger } from "../src/auth/local/schema.ts";
import {
  createMemoryAuthAuditWriter,
  type MemoryAuthAuditSink,
} from "../src/auth/observability/audit.ts";
import {
  createMemoryAuthTraceRecorder,
  createPostgresAuthTraceRecorder,
  runWithAuthTrace,
} from "../src/auth/observability/traces.ts";
import type { AthenaAuthTraceRecord } from "../src/auth/observability/types.ts";
import { AthenaConfigurationError, createClient } from "../src/v3-client.ts";

function emptyMemoryAuditSink(): MemoryAuthAuditSink {
  return { entries: [] };
}

test("023_auth_observability is in the embedded-auth ledger", () => {
  const ledger = getAthenaAuthExpectedLedger();
  const entry = ledger.find((row) => row.version === 23);
  assert.ok(entry);
  assert.equal(entry?.name, "023_auth_observability");
  assert.match(entry?.checksum ?? "", /^[a-f0-9]{64}$/);
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION >= 28, true);
  assert.ok(entry?.checksum && entry.checksum.length > 0);
});

test("every implemented event has an explicit audit policy", () => {
  for (const event of ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS) {
    assert.equal(ATHENA_AUTH_EVENT_DEFINITIONS[event].audit, true);
  }
});

test("audit write lives in the mutation transaction and rolls back with it", async () => {
  const stores = new MemoryAuthStores();
  const sink = emptyMemoryAuditSink();
  const transaction = createMemoryAuthMutationTransaction(
    stores,
    undefined,
    sink
  );
  await assert.rejects(
    () =>
      executeAuthMutation({
        auditWriter: {
          async write(scope, entry) {
            await createMemoryAuthAuditWriter(sink).write(scope, entry);
            throw new Error("audit boom");
          },
        },
        context: {
          actor: { kind: "user" },
          request: { method: "POST", path: "/sign-up/email" },
          traceId: "tr_test",
        },
        event: "user.create",
        execute: async ({ stores: scoped }) => {
          await scoped.createUser({
            email: "a@b.c",
            id: "u1",
            name: "A",
          });
          return { id: "u1" };
        },
        input: { email: "a@b.c" },
        resultOf: () =>
          ({
            user: {
              createdAt: new Date().toISOString(),
              email: "a@b.c",
              emailVerified: false,
              id: "u1",
              image: null,
              name: "A",
              role: null,
              twoFactorEnabled: false,
              updatedAt: new Date().toISOString(),
              username: null,
            },
          }) as never,
        transaction,
      }),
    /audit boom/
  );
  assert.equal(sink.entries.length, 0);
  assert.equal(await stores.getUserById("u1"), undefined);
});

test("committed mutation writes audit_log_auth shaped history", async () => {
  const stores = new MemoryAuthStores();
  const sink = emptyMemoryAuditSink();
  const transaction = createMemoryAuthMutationTransaction(
    stores,
    undefined,
    sink
  );
  await executeAuthMutation({
    auditWriter: createMemoryAuthAuditWriter(sink),
    context: {
      actor: { kind: "admin", userId: "admin_1" },
      request: { method: "POST", path: "/admin/create-user" },
      traceId: "tr_abc",
    },
    event: "user.create",
    execute: async () => ({ id: "user_1" }),
    input: { email: "admin-created@example.com" },
    resultOf: () =>
      ({
        user: {
          createdAt: new Date().toISOString(),
          email: "admin-created@example.com",
          emailVerified: false,
          id: "user_1",
          image: null,
          name: null,
          role: null,
          twoFactorEnabled: false,
          updatedAt: new Date().toISOString(),
          username: null,
        },
      }) as never,
    transaction,
  });
  assert.equal(sink.entries.length, 1);
  assert.equal(sink.entries[0]?.event, "user.create");
  assert.equal(sink.entries[0]?.traceId, "tr_abc");
  assert.ok(sink.entries[0]?.eventId);
});

test("trace persistence failure does not fail authentication", async () => {
  const recorder = createPostgresAuthTraceRecorder({
    async query() {
      throw new Error("trace insert failed");
    },
    async transaction(fn) {
      return fn(this);
    },
  });
  const trace = recorder.start({
    method: "POST",
    path: "/sign-up/email",
    traceId: "tr_fail",
  });
  await assert.doesNotReject(() => trace.success(200));
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
  });
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/ok", { method: "GET" })
  );
  assert.notEqual(response.status, 500);
  await runtime.close();
});

test("traces_auth persists the AuthRequestTiming snapshot used for Server-Timing", async () => {
  const records: AthenaAuthTraceRecord[] = [];
  const recorder = createMemoryAuthTraceRecorder({ records });
  await runWithAuthRequestTiming(async () => {
    currentAuthRequestTiming()?.addSpan("authz", 12);
    currentAuthRequestTiming()?.addSqlExec(4);
    currentAuthRequestTiming()?.addSqlCount(2);
    const trace = recorder.start({
      method: "POST",
      path: "/sign-up/email",
      traceId: "tr_timing",
    });
    await runWithAuthTrace(trace, async () => {
      await trace.success(200, 40);
    });
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.totalMs, 40);
  assert.equal(records[0]?.requestTiming?.authzMs, 12);
  assert.equal(records[0]?.requestTiming?.sqlCount, 2);
  assert.equal(records[0]?.authorizeMs, 12);
  assert.deepEqual(
    (records[0]?.metadata.requestTiming as { authzMs: number } | undefined)
      ?.authzMs,
    12
  );
});

test("remote auth.observability throws ATHENA_AUTH_OBSERVABILITY_REQUIRES_LOCAL_RUNTIME", () => {
  assert.throws(
    () =>
      createClient({
        auth: {
          mode: "remote",
          observability: { auditLog: true },
          url: "https://auth.example.com",
        },
        key: "key",
        url: "https://athena.example.com",
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_OBSERVABILITY_REQUIRES_LOCAL_RUNTIME"
  );
});
