/**
 * Data Nucleus target — GREEN after Phases 0–6.
 * Titles encode the original found case (`P?: <exact subject>`).
 * Baseline retired: test/sdd/superseded/athena-data-nucleus.baseline.superseded.ts
 *
 * See docs/sdd/xylex/athena-data-nucleus/SPEC.md
 * and dual-suite/dual-suite-spec.md.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AthenaConfigurationError } from "../../src/config/errors.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type {
  AthenaDeletePayload,
  AthenaGatewayCallOptions,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaQueryPayload,
  AthenaUpdatePayload,
} from "../../src/gateway/types.ts";
import { createAthenaDataHandlers } from "../../src/next/data-handlers.ts";
import type { PolicyDefinition } from "../../src/policy/types.ts";
import { readRuntimeErrorCode } from "../../src/runtime/data/errors.ts";
import * as lifecycleIndex from "../../src/runtime/data/lifecycle/index.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";
import { string, table } from "../../src/schema/index.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const lifecycleDir = join(srcRoot, "runtime", "data", "lifecycle");
const nucleusDir = join(srcRoot, "runtime", "data", "nucleus");
const packageJsonPath = join(pkgRoot, "package.json");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function joinedSources(dir: string): string {
  return collectTsFiles(dir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function ok<T>(data: T): AthenaGatewayResponse<T> {
  return {
    count: Array.isArray(data) ? data.length : 1,
    data,
    error: undefined,
    errorDetails: null,
    ok: true,
    raw: { data },
    status: 200,
    statusText: "OK",
  };
}

function createRecordingTransport(): AthenaGatewayClient & {
  calls: Array<{ op: string; payload: unknown }>;
} {
  const calls: Array<{ op: string; payload: unknown }> = [];
  return {
    baseUrl: "https://athena.local/mock",
    buildHeaders() {
      return {};
    },
    calls,
    async deleteGateway<T>(
      payload: AthenaDeletePayload,
      _options?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      calls.push({ op: "delete", payload });
      return ok([{ deleted: true }] as T);
    },
    async fetchGateway<T>(
      payload: Parameters<AthenaGatewayClient["fetchGateway"]>[0],
      _options?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      calls.push({ op: "fetch", payload });
      return ok([{ id: "1" }] as T);
    },
    async insertGateway<T>(
      payload: AthenaInsertPayload,
      _options?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      calls.push({ op: "insert", payload });
      return ok([payload.insert_body] as T);
    },
    async queryGateway<T>(
      payload: AthenaQueryPayload,
      _options?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      calls.push({ op: "query", payload });
      return ok([{ sql: true }] as T);
    },
    async resolveCallOptions(options) {
      return options;
    },
    async rpcGateway<T>(
      payload: Parameters<AthenaGatewayClient["rpcGateway"]>[0],
      _options?: Parameters<AthenaGatewayClient["rpcGateway"]>[1]
    ): Promise<AthenaGatewayResponse<T>> {
      calls.push({ op: "rpc", payload });
      return ok([{ rpc: payload.function }] as T);
    },
    async updateGateway<T>(
      payload: AthenaUpdatePayload,
      _options?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      calls.push({ op: "update", payload });
      return ok([payload.update_body] as T);
    },
    async verifyConnection() {
      return {
        baseUrl: "https://athena.local/mock",
        error: undefined,
        errorDetails: null,
        ok: true,
        raw: null,
        reachable: true,
        status: 200,
        statusText: "OK",
        url: "https://athena.local/mock/health",
      };
    },
  };
}

const users = table("users")
  .schema("public")
  .columns({
    email: string(),
    id: string(),
    name: string(),
    status: string(),
  })
  .primaryKey("id");

const INSERT_OPEN_ONLY: PolicyDefinition = {
  actions: 2,
  check: {
    left: {
      column: { logical: "status", physical: "status" },
      kind: "column",
    },
    op: "eq",
    right: {
      kind: "literal",
      value: { type: "string", value: "open" },
    },
  },
  composition: "permissive",
  id: "insert-open-only",
  principals: [{ kind: "public" }],
  resource: { schema: "public", table: "users" },
};

const NUCLEUS_MODULES = [
  "catalog",
  "context",
  "envelope",
  "execute",
  "hooks",
  "prepare",
  "result",
  "errors",
  "timing",
  "sanitize",
  "transaction",
  "types",
] as const;

test("P?: runPrepareAndBefore is deleted; prepareDataMutation / runDataBeforeHooks / runDataAfterHooks / reportDataHookError exist", () => {
  assert.equal("runPrepareAndBefore" in lifecycleIndex, false);
  assert.equal(typeof lifecycleIndex.prepareDataMutation, "function");
  assert.equal(typeof lifecycleIndex.runDataBeforeHooks, "function");
  assert.equal(typeof lifecycleIndex.runDataAfterHooks, "function");
  assert.equal(typeof lifecycleIndex.reportDataHookError, "function");
  const runnerSrc = existsSync(join(lifecycleDir, "runner.ts"))
    ? readSrc("runtime/data/lifecycle/runner.ts")
    : "";
  const lifecycleSrc = joinedSources(lifecycleDir);
  const nucleusSrc = joinedSources(nucleusDir);
  assert.equal(/\brunPrepareAndBefore\b/.test(runnerSrc), false);
  assert.equal(/\brunPrepareAndBefore\b/.test(lifecycleSrc), false);
  assert.equal(/\brunPrepareAndBefore\b/.test(nucleusSrc), false);
});

function firstMatch(src: string, patterns: readonly RegExp[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const pattern of patterns) {
    const match = pattern.exec(src);
    if (match && match.index < best) {
      best = match.index;
    }
  }
  return best;
}

test("P?: target security order is principal, prepare, canonicalize, policy rewrite, canonicalize, final model, final limits, freeze, before, execute, after, event", () => {
  assert.equal(existsSync(join(nucleusDir, "execute.ts")), true);
  const executeSrc = readSrc("runtime/data/nucleus/execute.ts");
  assert.equal(/\brunPrepareAndBefore\b/.test(executeSrc), false);
  const prepareAt = executeSrc.indexOf('clock.mark("prepare")');
  const firstCanonAt = executeSrc.indexOf('clock.mark("canonicalize")', prepareAt);
  const policyAt = executeSrc.indexOf('clock.mark("policy")', firstCanonAt);
  const secondCanonAt = executeSrc.indexOf(
    'clock.mark("canonicalize")',
    policyAt
  );
  const modelsAt = executeSrc.indexOf('clock.mark("model")', secondCanonAt);
  const limitsAt = executeSrc.indexOf('clock.mark("limits")', modelsAt);
  const freezeAt = executeSrc.indexOf("Object.freeze(authorized)", limitsAt);
  const beforeAt = executeSrc.indexOf('clock.mark("before_hooks")', freezeAt);
  const afterAt = executeSrc.indexOf('clock.mark("after_hooks")', beforeAt);
  const emitAt = executeSrc.indexOf("emitExecutionEvent(", afterAt);
  assert.ok(prepareAt >= 0, "prepareDataMutation must run");
  assert.ok(prepareAt < firstCanonAt, "canonicalize after prepare");
  assert.ok(firstCanonAt < policyAt, "prepare/canonicalize before policy rewrite");
  assert.ok(policyAt < secondCanonAt, "second canonicalize after policy rewrite");
  assert.ok(secondCanonAt < modelsAt, "final model after policy rewrite");
  assert.ok(modelsAt < limitsAt, "final limits after final model");
  assert.ok(limitsAt < freezeAt, "authorized freeze after final limits");
  assert.ok(freezeAt < beforeAt, "before veto after freeze");
  assert.ok(beforeAt < afterAt, "after after execution/before");
  assert.ok(afterAt < emitAt, "execution event after after-hooks");
});

test("P?: prepare cannot inject a field or relation that skips policy", async () => {
  assert.equal(
    existsSync(join(nucleusDir, "execute.ts")),
    true,
    "final authorization after prepare lives in the data nucleus"
  );
  assert.match(
    readSrc("runtime/data/nucleus/execute.ts"),
    /prepareDataMutation/
  );
  const transport = createRecordingTransport();
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        prepareInsert: (event: { record?: Record<string, unknown> }) => ({
          ...(event.record ?? {}),
          injected: "skips-policy",
          posts: [{ id: "rel-1" }],
          status: "closed",
        }),
      },
    } as never,
    modelEnforcement: "strict",
    models: { users },
    policies: {
      definitions: [INSERT_OPEN_ONLY],
      mode: "enforce",
    },
    security: { mode: "trusted" },
    transport,
  });
  const result = await runtime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada", status: "open" },
      table_name: "public.users",
    },
  });
  assert.equal(result.ok, false);
  assert.equal(transport.calls.length, 0);
  const code = readRuntimeErrorCode(result);
  assert.ok(
    code === "ATHENA_POLICY_DENIED" ||
      code === "ATHENA_POLICY_WRITE_CONFLICT" ||
      code === "ATHENA_MODEL_UNKNOWN_FIELD",
    `expected policy/model deny, got ${code ?? result.error}`
  );
});

test("P?: payload size / IN limits apply to the POST-prepare payload", async () => {
  assert.equal(existsSync(join(nucleusDir, "execute.ts")), true);
  const executeSrc = readSrc("runtime/data/nucleus/execute.ts");
  const prepareAt = executeSrc.indexOf('clock.mark("prepare")');
  const rewriteAt = executeSrc.indexOf('clock.mark("policy")', prepareAt);
  const limitsAt = executeSrc.indexOf('clock.mark("limits")', rewriteAt);
  assert.ok(prepareAt >= 0 && rewriteAt > prepareAt && limitsAt > rewriteAt);
  const insertTransport = createRecordingTransport();
  const insertRuntime = createAthenaServerRuntime({
    http: true,
    lifecycle: {
      data: {
        prepareInsert: (event: { record?: Record<string, unknown> }) => [
          { ...(event.record ?? {}), id: "1" },
          { id: "2", name: "overflow" },
        ],
      },
    } as never,
    limits: { maxInItems: 1, maxInsertRows: 1 },
    modelEnforcement: "known-only",
    models: { users },
    security: { mode: "trusted" },
    transport: insertTransport,
  });
  const insertResult = await insertRuntime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada" },
      table_name: "public.users",
    },
  });
  assert.equal(insertResult.ok, false);
  assert.equal(readRuntimeErrorCode(insertResult), "ATHENA_LIMIT_EXCEEDED");
  assert.equal(insertTransport.calls.length, 0);
});

test("P?: transport accepts branded AuthorizedDataMutation", () => {
  assert.equal(existsSync(nucleusDir), true);
  for (const name of NUCLEUS_MODULES) {
    assert.equal(
      existsSync(join(nucleusDir, `${name}.ts`)),
      true,
      `src/runtime/data/nucleus/${name}.ts`
    );
  }
  const nucleusSrc = joinedSources(nucleusDir);
  assert.match(nucleusSrc, /AuthorizedDataMutation/);
  assert.match(nucleusSrc, /Symbol\(/);
  assert.equal(/\brunPrepareAndBefore\b/.test(nucleusSrc), false);
  assert.match(nucleusSrc, /unique symbol|AuthorizedDataMutationBrand/);
});

test("P?: authorized payload freeze precedes before veto", async () => {
  assert.equal(existsSync(join(nucleusDir, "execute.ts")), true);
  const executeSrc = readSrc("runtime/data/nucleus/execute.ts");
  const freezeAt = firstMatch(executeSrc, [
    /AuthorizedDataMutation/,
    /Object\.freeze/,
  ]);
  const beforeAt = firstMatch(executeSrc, [/runDataBeforeHooks\b/]);
  assert.ok(freezeAt < beforeAt, "branded freeze must precede before veto");
  let seen: { record?: Record<string, unknown> } | undefined;
  const transport = createRecordingTransport();
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        beforeInsert: (event: { record?: Record<string, unknown> }) => {
          seen = event;
          if (event.record) {
            event.record.name = "mutated-by-before";
          }
        },
      },
    } as never,
    modelEnforcement: "known-only",
    models: { users },
    security: { mode: "trusted" },
    transport,
  });
  const result = await runtime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada" },
      table_name: "public.users",
    },
  });
  assert.equal(result.ok, true);
  assert.ok(seen, "beforeInsert must run");
  assert.equal(Object.isFrozen(seen), true);
  if (seen.record) {
    assert.equal(Object.isFrozen(seen.record), true);
  }
  const sent = transport.calls[0]?.payload as {
    insert_body?: { name?: string };
  };
  assert.equal(sent.insert_body?.name, "Ada");
});

test("P?: hooks receive clone+sanitize+freeze AthenaDataMutationInput", async () => {
  const nucleusSrc = existsSync(nucleusDir) ? joinedSources(nucleusDir) : "";
  assert.match(nucleusSrc, /AthenaDataMutationInput/);
  assert.match(nucleusSrc, /sanitize/);
  assert.equal(/AthenaAuthHooks/.test(nucleusSrc), false);
  assert.equal(/from ["']pg["']/.test(nucleusSrc), false);
  let seen: Record<string, unknown> | undefined;
  const transport = createRecordingTransport();
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        beforeInsert: (event: Record<string, unknown>) => {
          seen = event;
        },
      },
    } as never,
    modelEnforcement: "known-only",
    models: { users },
    security: { mode: "trusted" },
    transport,
  });
  const result = await runtime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada" },
      table_name: "public.users",
    },
  });
  assert.equal(result.ok, true);
  assert.ok(seen, "beforeInsert must receive a snapshot");
  assert.equal(Object.isFrozen(seen), true);
  for (const leak of [
    "transport",
    "db",
    "pool",
    "policyEngine",
    "policy-engine",
    "request",
  ]) {
    assert.equal(leak in seen, false, `hook snapshot must not leak ${leak}`);
  }
});

test("P?: ATHENA_DATA_NUCLEUS_EVENTS implements data.insert|update|delete|upsert only", () => {
  const catalogSrc = existsSync(join(nucleusDir, "catalog.ts"))
    ? readSrc("runtime/data/nucleus/catalog.ts")
    : joinedSources(lifecycleDir);
  assert.match(catalogSrc, /ATHENA_DATA_NUCLEUS_EVENTS/);
  assert.match(catalogSrc, /data\.insert/);
  assert.match(catalogSrc, /data\.update/);
  assert.match(catalogSrc, /data\.delete/);
  assert.match(catalogSrc, /data\.upsert/);
  assert.equal(/data\.select\b/.test(catalogSrc), false);
  assert.equal(/data\.fetch\b/.test(catalogSrc), false);
  assert.equal(/data\.rpc\b/.test(catalogSrc), false);
  assert.equal(/data\.query\b/.test(catalogSrc), false);
});

test("P?: upsert runs prepareUpsert/beforeUpsert/afterUpsert and does not run insert hooks", async () => {
  const typesSrc = readSrc("runtime/data/lifecycle/types.ts");
  assert.match(typesSrc, /beforeUpsert\?:/);
  assert.match(typesSrc, /afterUpsert\?:/);
  assert.match(typesSrc, /prepareUpsert\?:/);

  const sequence: string[] = [];
  const transport = createRecordingTransport();
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        afterInsert: () => {
          sequence.push("afterInsert");
        },
        afterUpsert: () => {
          sequence.push("afterUpsert");
        },
        beforeInsert: () => {
          sequence.push("beforeInsert");
        },
        beforeUpsert: () => {
          sequence.push("beforeUpsert");
        },
        prepareInsert: () => {
          sequence.push("prepareInsert");
          return { id: "1", name: "from-insert" };
        },
        prepareUpsert: () => {
          sequence.push("prepareUpsert");
          return { id: "1", name: "from-upsert" };
        },
      },
    } as never,
    modelEnforcement: "known-only",
    models: { users },
    security: { mode: "trusted" },
    transport,
  });
  const result = await runtime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada" },
      table_name: "public.users",
    },
    semanticOperation: "upsert",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(sequence, ["prepareUpsert", "beforeUpsert", "afterUpsert"]);
  assert.equal(transport.calls[0]?.op, "insert");
});

test("P?: semanticOperation never affects Policy", () => {
  const decideSrc = readSrc("policy/decide.ts");
  const applySrc = readSrc("policy/apply.ts");
  const decisionSrc = readSrc("policy/decision.ts");
  const executorSrc = readSrc("runtime/data/executor.ts");
  assert.equal(/semanticOperation/.test(decideSrc), false);
  assert.equal(/semanticOperation/.test(applySrc), false);
  const actionFnStart = decisionSrc.indexOf(
    "export function actionFromRuntimeOperation"
  );
  const actionFn = decisionSrc.slice(actionFnStart, actionFnStart + 800);
  assert.equal(/semanticOperation/.test(actionFn), false);
  assert.match(executorSrc, /void semanticLifecycleHint\(request\)/);
  assert.match(executorSrc, /actionFromRuntimeOperation\(request\.operation\)/);
});

test("P?: prepareDelete is deprecated one release and its return is never applied", async () => {
  const typesSrc = readSrc("runtime/data/lifecycle/types.ts");
  assert.match(typesSrc, /prepareDelete\?:/);
  assert.match(typesSrc, /@deprecated/);
  const transport = createRecordingTransport();
  const payload = {
    conditions: [{ column: "id", operator: "eq" as const, value: "keep-me" }],
    table_name: "public.users",
  };
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        prepareDelete: () => ({
          conditions: [
            { column: "id", operator: "eq", value: "injected-predicate" },
          ],
          table_name: "public.users",
        }),
      },
    } as never,
    modelEnforcement: "known-only",
    models: { users },
    security: { mode: "trusted" },
    transport,
  });
  const result = await runtime.execute({
    operation: "delete",
    payload,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(transport.calls[0]?.payload, payload);
});

test("P?: after throw does not fail the client mutation but is observable", async () => {
  assert.equal(typeof lifecycleIndex.reportDataHookError, "function");
  const hookSrc = `${joinedSources(nucleusDir)}\n${joinedSources(lifecycleDir)}`;
  assert.match(hookSrc, /reportDataHookError\(/);
  let reported = 0;
  const events: Array<{ decision?: string; errorKind?: string }> = [];
  const transport = createRecordingTransport();
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        afterInsert: async () => {
          throw new Error("afterInsert boom");
        },
        onError: () => {
          reported += 1;
        },
      },
    } as never,
    modelEnforcement: "known-only",
    models: { users },
    onExecutionEvent: (event) => {
      events.push(event);
    },
    security: { mode: "trusted" },
    transport,
  });
  const result = await runtime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada" },
      table_name: "public.users",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(transport.calls.length, 1);
  assert.equal(events[0]?.decision, "allow");
  assert.equal(events[0]?.errorKind, undefined);
  assert.ok(
    reported >= 1,
    "after failure must be observable via reportDataHookError / onError"
  );
});

test("P?: public surface remains createClient({ lifecycle: { data } })", () => {
  const runtimeIndex = readSrc("runtime/index.ts");
  const dataIndex = readSrc("runtime/data/index.ts");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    exports?: Record<string, unknown>;
  };
  const exportBlob = JSON.stringify(pkg.exports ?? {});
  assert.equal(/nucleus/.test(runtimeIndex), false);
  assert.equal(/nucleus/.test(dataIndex), false);
  assert.equal(/nucleus/.test(exportBlob), false);
  const clientCoreSrc = readSrc("client/contracts.ts");
  assert.match(clientCoreSrc, /lifecycle\?:/);
  void createAthenaDataHandlers;
});

test("P?: Data nucleus copies Auth split not AthenaAuthHooks", () => {
  const dataRuntime = joinedSources(join(srcRoot, "runtime", "data"));
  assert.equal(/AthenaAuthHooks/.test(dataRuntime), false);
  assert.equal(/ExecuteAuthMutationOptions/.test(dataRuntime), false);
  assert.equal(existsSync(nucleusDir), true);
});

test("P?: lifecycle.data on remote/browser fail-closes", () => {
  const errorsSrc = readSrc("config/errors.ts");
  assert.match(errorsSrc, /ATHENA_DATA_LIFECYCLE_REQUIRES_LOCAL_RUNTIME/);
  assert.throws(
    () =>
      createClient({
        key: "publishable",
        lifecycle: {
          data: {
            async afterInsert() {},
          },
        },
        url: "https://hosted.example",
      } as never),
    (error: unknown) => {
      assert.ok(error instanceof AthenaConfigurationError);
      assert.equal(error.code, "ATHENA_DATA_LIFECYCLE_REQUIRES_LOCAL_RUNTIME");
      return true;
    }
  );
});

test("P?: bytes reaching the backend equal the frozen authorized payload", async () => {
  const nucleusSrc = existsSync(nucleusDir) ? joinedSources(nucleusDir) : "";
  assert.match(nucleusSrc, /AuthorizedDataMutation/);
  const transport = createRecordingTransport();
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        beforeInsert: (event: { record?: Record<string, unknown> }) => {
          if (event.record) {
            event.record.name = "should-not-reach-backend";
          }
        },
        prepareInsert: (event: { record?: Record<string, unknown> }) => ({
          ...(event.record ?? {}),
          name: "prepared",
        }),
      },
    } as never,
    modelEnforcement: "known-only",
    models: { users },
    security: { mode: "trusted" },
    transport,
  });
  const result = await runtime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada" },
      table_name: "public.users",
    },
  });
  assert.equal(result.ok, true);
  const sent = transport.calls[0]?.payload as {
    insert_body?: { name?: string };
  };
  assert.equal(sent.insert_body?.name, "prepared");
});

test("P?: eventId/traceId/requestId are distinct and persist through before, after, and execution event", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const events: Array<{
    eventId?: string;
    requestId?: string;
    traceId?: string;
  }> = [];
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        afterInsert: (event) => {
          seen.push({
            eventId: event.eventId,
            phase: "after",
            requestId: event.requestId,
            traceId: event.traceId,
          });
        },
        beforeInsert: (event) => {
          seen.push({
            eventId: event.eventId,
            phase: "before",
            requestId: event.requestId,
            traceId: event.traceId,
          });
        },
      },
    },
    modelEnforcement: "known-only",
    models: { users },
    onExecutionEvent: (event) => {
      events.push({
        eventId: event.eventId,
        requestId: event.requestId,
        traceId: event.traceId,
      });
    },
    security: { mode: "trusted" },
    transport: createRecordingTransport(),
  });
  const result = await runtime.execute(
    {
      operation: "insert",
      payload: {
        insert_body: { id: "1", name: "Ada" },
        table_name: "public.users",
      },
    },
    { requestId: "req-fixed" }
  );
  assert.equal(result.ok, true);
  assert.equal(seen.length, 2);
  const before = seen[0];
  const after = seen[1];
  assert.equal(before?.eventId, after?.eventId);
  assert.equal(before?.traceId, after?.traceId);
  assert.equal(before?.requestId, "req-fixed");
  assert.notEqual(before?.eventId, before?.traceId);
  assert.notEqual(before?.eventId, before?.requestId);
  assert.equal(events[0]?.eventId, before?.eventId);
  assert.equal(events[0]?.traceId, before?.traceId);
  assert.equal(events[0]?.requestId, "req-fixed");
});

test("P?: incoming x-athena-trace-id is inherited", async () => {
  let traceId: string | undefined;
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        beforeInsert: (event) => {
          traceId = event.traceId;
        },
      },
    },
    modelEnforcement: "known-only",
    models: { users },
    security: { mode: "trusted" },
    transport: createRecordingTransport(),
  });
  await runtime.execute(
    {
      operation: "insert",
      payload: {
        insert_body: { id: "1", name: "Ada" },
        table_name: "public.users",
      },
    },
    { headers: { "X-Athena-Trace-Id": "trace-from-header" } }
  );
  assert.equal(traceId, "trace-from-header");
});

test("P?: sanitized principal has no claims or tokens", async () => {
  let principal: unknown;
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        beforeInsert: (event) => {
          principal = event.principal;
        },
      },
    },
    modelEnforcement: "known-only",
    models: { users },
    security: { mode: "trusted" },
    transport: createRecordingTransport(),
  });
  await runtime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada" },
      table_name: "public.users",
    },
  });
  assert.equal(typeof principal, "object");
  const bag = principal as Record<string, unknown>;
  assert.equal("claims" in bag, false);
  assert.equal("token" in bag, false);
  assert.equal("sessionToken" in bag, false);
  assert.equal(typeof bag.authenticated, "boolean");
});

test("P?: after hooks receive affectedRows and bounded result", async () => {
  let result: { affectedRows?: number; ok?: boolean } | undefined;
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        afterInsert: (event) => {
          result = event.result;
        },
      },
    },
    modelEnforcement: "known-only",
    models: { users },
    security: { mode: "trusted" },
    transport: createRecordingTransport(),
  });
  await runtime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada" },
      table_name: "public.users",
    },
  });
  assert.equal(result?.ok, true);
  assert.equal(result?.affectedRows, 1);
  assert.equal("records" in (result ?? {}), false);
});

test("P?: execution event includes phase timings and transactionSemantics is not atomic", async () => {
  const events: Array<{
    prepareMs?: number;
    totalMs?: number;
    transactionSemantics?: string;
  }> = [];
  const runtime = createAthenaServerRuntime({
    modelEnforcement: "known-only",
    models: { users },
    onExecutionEvent: (event) => {
      events.push(event);
    },
    security: { mode: "trusted" },
    transport: createRecordingTransport(),
  });
  await runtime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada" },
      table_name: "public.users",
    },
  });
  assert.equal(events.length, 1);
  assert.notEqual(events[0]?.transactionSemantics, "atomic");
  assert.ok(
    events[0]?.transactionSemantics === "unknown" ||
      events[0]?.transactionSemantics === "backend-managed"
  );
  assert.equal(typeof events[0]?.totalMs, "number");
});

test("P?: audit.resources marks matching mutations without dumping payload", async () => {
  const events: Array<{ audit?: boolean }> = [];
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        audit: { resources: ["users"] },
      },
    },
    modelEnforcement: "known-only",
    models: { users },
    onExecutionEvent: (event) => {
      events.push(event);
    },
    security: { mode: "trusted" },
    transport: createRecordingTransport(),
  });
  await runtime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada" },
      table_name: "public.users",
    },
  });
  assert.equal(events[0]?.audit, true);
  assert.equal("payload" in (events[0] ?? {}), false);
  assert.equal("insert_body" in (events[0] ?? {}), false);
});
