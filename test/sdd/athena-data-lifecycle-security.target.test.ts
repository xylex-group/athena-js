/**
 * Wave 1 target — RED on the PR #697 found-case order until prepare/before
 * split and authorize-after-prepare land. Do not invert the baseline file.
 *
 * Found-case pin: feat/athena-js-policy-dx-b-f SHA 35a1b29a9.
 * See docs/sdd/xylex/athena-data-runtime-finality/SPEC.md
 * and dual-suite/dual-suite-spec.md.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type {
  AthenaDeletePayload,
  AthenaGatewayCallOptions,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaQueryPayload,
  AthenaUpdatePayload,
} from "../../src/gateway/types.ts";
import type { PolicyDefinition } from "../../src/policy/types.ts";
import { readRuntimeErrorCode } from "../../src/runtime/data/errors.ts";
import type { AthenaDataLifecycleEvent } from "../../src/runtime/data/lifecycle/events.ts";
import type { AthenaDataLifecycleHooks } from "../../src/runtime/data/lifecycle/types.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";
import { string, table } from "../../src/schema/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const lifecycleDir = join(srcRoot, "runtime", "data", "lifecycle");

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

function lifecycleSources(): string {
  return collectTsFiles(lifecycleDir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function executeAthenaRequestBody(): string {
  const src = readSrc("runtime/data/executor.ts");
  const fnStart = src.indexOf("export async function executeAthenaRequest");
  assert.ok(fnStart >= 0, "executeAthenaRequest must exist");
  return src.slice(fnStart);
}

function callIndex(src: string, name: string, from = 0): number {
  const match = new RegExp(String.raw`\b${name}\s*\(`).exec(src.slice(from));
  return match ? from + match.index : -1;
}

function exportedFn(src: string, name: string): string | undefined {
  const match = new RegExp(
    String.raw`export async function ${name}\b|export function ${name}\b`
  ).exec(src);
  if (!match) {
    return;
  }
  const start = match.index;
  const rest = src.slice(start + 1);
  const nextExport = rest.search(/\nexport (async )?function /);
  return nextExport >= 0
    ? src.slice(start, start + 1 + nextExport)
    : src.slice(start);
}

async function importLifecycle(): Promise<Record<string, unknown>> {
  const url = pathToFileURL(join(lifecycleDir, "index.ts")).href;
  return (await import(url)) as Record<string, unknown>;
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
      calls.push({ op: "insert", payload: structuredClone(payload) });
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
      calls.push({ op: "update", payload: structuredClone(payload) });
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

const FREEZE_OR_CLONE =
  /Object\.freeze|deepFreeze|freezeAuthorized|freezePayload|structuredClone|defensiveClone|cloneAuthorized|clonePayload/;

test("P?: runPrepareAndBefore is split into runPrepare and runBefore", async () => {
  const lifecycle = await importLifecycle();
  assert.equal(typeof lifecycle.runPrepare, "function");
  assert.equal(typeof lifecycle.runBefore, "function");
  assert.equal(
    Object.hasOwn(lifecycle, "runPrepareAndBefore"),
    false,
    "runPrepareAndBefore must be absent from the lifecycle barrel"
  );
  assert.equal(typeof lifecycle.runPrepareAndBefore, "undefined");

  const runnerSrc = readSrc("runtime/data/lifecycle/runner.ts");
  const indexSrc = readSrc("runtime/data/lifecycle/index.ts");
  assert.match(runnerSrc, /export async function runPrepare\b/);
  assert.match(runnerSrc, /export async function runBefore\b/);
  assert.equal(/\brunPrepareAndBefore\b/.test(runnerSrc), false);
  assert.match(indexSrc, /\brunPrepare\b/);
  assert.match(indexSrc, /\brunBefore\b/);
  assert.equal(/\brunPrepareAndBefore\b/.test(indexSrc), false);
  assert.equal(
    /\brunPrepareAndBefore\b/.test(executeAthenaRequestBody()),
    false
  );
});

test("P?: prepare runs before model, policy, and HTTP limits", () => {
  const body = executeAthenaRequestBody();
  const principalAt = callIndex(body, "resolveAthenaRuntimePrincipal");
  const prepareAt = callIndex(body, "runPrepare");
  const modelsAt = callIndex(body, "enforceModels");
  const policyAt = callIndex(body, "enforcePolicy");
  const limitsAt = callIndex(body, "enforceHttpLimits");
  const beforeAt = callIndex(body, "runBefore");
  const transportAt = body.search(
    /transport\.(insertGateway|updateGateway|deleteGateway)\(/
  );
  const afterAt = callIndex(body, "runAfterHooks");
  const lastEmit = body.lastIndexOf("emitExecutionEvent(");

  assert.ok(principalAt >= 0, "must resolve principal");
  assert.ok(prepareAt >= 0, "must call runPrepare");
  assert.ok(modelsAt >= 0, "must call enforceModels");
  assert.ok(policyAt >= 0, "must call enforcePolicy");
  assert.ok(limitsAt >= 0, "must call enforceHttpLimits");
  assert.ok(beforeAt >= 0, "must call runBefore");
  assert.ok(transportAt >= 0, "must call transport after before*");
  assert.ok(afterAt >= 0, "must call runAfterHooks");
  assert.ok(lastEmit >= 0, "must emit execution event");
  assert.ok(
    principalAt < prepareAt &&
      prepareAt < modelsAt &&
      modelsAt < policyAt &&
      policyAt < limitsAt &&
      limitsAt < beforeAt &&
      beforeAt < transportAt &&
      transportAt < afterAt &&
      afterAt < lastEmit,
    "desired: principal → runPrepare → model → policy → HTTP limits → runBefore → transport → after → execution event"
  );
  assert.equal(/\brunPrepareAndBefore\b/.test(body), false);
});

test("P?: semantic lifecycle event is rebuilt after preparation", async () => {
  const runnerSrc = readSrc("runtime/data/lifecycle/runner.ts");
  const body = executeAthenaRequestBody();
  const prepareFn = exportedFn(runnerSrc, "runPrepare");
  assert.ok(
    prepareFn,
    "runPrepare must exist so the event can be rebuilt after it"
  );
  const applyAt = callIndex(prepareFn, "applyPreparedBody");
  const rebuildInPrepare = prepareFn.indexOf(
    "buildDataLifecycleEvent",
    Math.max(applyAt, 0)
  );
  const prepareCall = callIndex(body, "runPrepare");
  const rebuildInExecutor = body.indexOf(
    "buildDataLifecycleEvent",
    prepareCall
  );
  const beforeCall = callIndex(body, "runBefore");
  const rebuiltAfterPrepare =
    (applyAt >= 0 && rebuildInPrepare > applyAt) ||
    (prepareCall >= 0 &&
      rebuildInExecutor > prepareCall &&
      (beforeCall < 0 || rebuildInExecutor < beforeCall));
  assert.ok(
    rebuiltAfterPrepare,
    "buildDataLifecycleEvent must run after runPrepare applies the body, before runBefore"
  );

  let seen: AthenaDataLifecycleEvent | undefined;
  const transport = createRecordingTransport();
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        beforeInsert: (event) => {
          seen = event;
        },
        prepareInsert: (event) => ({
          ...(event.record ?? {}),
          email: "ada@athena.dev",
          status: "open",
        }),
      },
    },
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
      insert_body: { id: "1", name: "Ada" },
      table_name: "public.users",
    },
  });
  assert.equal(
    result.ok,
    true,
    "policy must see the rebuilt prepared row (status supplied by prepare), not the inbound image"
  );
  assert.ok(seen, "beforeInsert must receive the rebuilt event");
  assert.equal(seen.record?.email, "ada@athena.dev");
  assert.equal(seen.record?.status, "open");
  assert.ok(
    seen.changedFields.includes("email"),
    "changedFields must include prepare-injected keys, not the inbound-only image"
  );
  assert.ok(seen.changedFields.includes("status"));
  assert.equal(transport.calls.length, 1);
  const sent = transport.calls[0]?.payload as {
    insert_body?: { email?: string; status?: string };
  };
  assert.equal(sent.insert_body?.email, "ada@athena.dev");
  assert.equal(sent.insert_body?.status, "open");
});

test("P?: prepare cannot inject a field or relation that skips policy validation", async () => {
  const fieldTransport = createRecordingTransport();
  let beforeAfterInject = false;
  const fieldRuntime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        beforeInsert: () => {
          beforeAfterInject = true;
        },
        prepareInsert: (event) => ({
          ...(event.record ?? {}),
          injected: "skips-policy",
          posts: { create: { title: "nested-relation" } },
          status: "open",
        }),
      },
    },
    modelEnforcement: "strict",
    models: { users },
    policies: {
      definitions: [INSERT_OPEN_ONLY],
      mode: "enforce",
    },
    security: { mode: "trusted" },
    transport: fieldTransport,
  });
  const fieldResult = await fieldRuntime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada", status: "open" },
      table_name: "public.users",
    },
  });
  assert.equal(fieldResult.ok, false);
  assert.equal(readRuntimeErrorCode(fieldResult), "ATHENA_MODEL_UNKNOWN_FIELD");
  assert.equal(fieldTransport.calls.length, 0);
  assert.equal(
    beforeAfterInject,
    false,
    "before* must not run on a payload that failed model/policy"
  );

  const policyTransport = createRecordingTransport();
  const policyRuntime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        prepareInsert: (event) => ({
          ...(event.record ?? {}),
          status: "closed",
        }),
      },
    },
    modelEnforcement: "strict",
    models: { users },
    policies: {
      definitions: [INSERT_OPEN_ONLY],
      mode: "enforce",
    },
    security: { mode: "trusted" },
    transport: policyTransport,
  });
  const policyResult = await policyRuntime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada", status: "open" },
      table_name: "public.users",
    },
  });
  assert.equal(policyResult.ok, false);
  assert.equal(
    readRuntimeErrorCode(policyResult),
    "ATHENA_POLICY_WRITE_CONFLICT"
  );
  assert.equal(policyTransport.calls.length, 0);

  const body = executeAthenaRequestBody();
  const prepareAt = callIndex(body, "runPrepare");
  const modelsAt = callIndex(body, "enforceModels");
  const policyAt = callIndex(body, "enforcePolicy");
  assert.ok(
    prepareAt >= 0 && modelsAt > prepareAt && policyAt > prepareAt,
    "model and policy must run on the prepared payload"
  );
});

test("P?: payload size / IN limits apply to the POST-prepare payload", async () => {
  const insertTransport = createRecordingTransport();
  const insertRuntime = createAthenaServerRuntime({
    http: true,
    lifecycle: {
      data: {
        prepareInsert: (event) => [
          { ...(event.record ?? {}), id: "1" },
          { id: "2", name: "overflow", status: "open" },
        ],
      },
    },
    limits: { maxInItems: 8, maxInsertRows: 1, maxPageSize: 50 },
    modelEnforcement: "known-only",
    models: { users },
    security: { mode: "trusted" },
    transport: insertTransport,
  });
  const insertResult = await insertRuntime.execute({
    operation: "insert",
    payload: {
      insert_body: { id: "1", name: "Ada", status: "open" },
      table_name: "public.users",
    },
  });
  assert.equal(insertResult.ok, false);
  assert.equal(readRuntimeErrorCode(insertResult), "ATHENA_LIMIT_EXCEEDED");
  assert.equal(insertTransport.calls.length, 0);

  const inTransport = createRecordingTransport();
  const inRuntime = createAthenaServerRuntime({
    http: true,
    lifecycle: {
      data: {
        prepareUpdate: () => ({
          name: { operator: "in", value: ["Ada", "Bob"] },
        }),
      },
    },
    limits: { maxInItems: 1, maxInsertRows: 8, maxPageSize: 50 },
    modelEnforcement: "known-only",
    models: { users },
    security: { mode: "trusted" },
    transport: inTransport,
  });
  const inResult = await inRuntime.execute({
    operation: "update",
    payload: {
      conditions: [{ column: "id", operator: "eq", value: "1" }],
      table_name: "public.users",
      update_body: { name: "Ada" },
    },
  });
  assert.equal(inResult.ok, false);
  assert.equal(readRuntimeErrorCode(inResult), "ATHENA_LIMIT_EXCEEDED");
  assert.equal(inTransport.calls.length, 0);

  const body = executeAthenaRequestBody();
  const prepareAt = callIndex(body, "runPrepare");
  const limitsAt = callIndex(body, "enforceHttpLimits");
  assert.ok(
    prepareAt >= 0 && limitsAt > prepareAt,
    "inspectPayloadLimits / enforceHttpLimits must run on the POST-prepare payload"
  );
  assert.equal(body.includes("inspectPayloadLimits"), true);
});

test("P?: authorized payload is frozen or cloned before before* ", async () => {
  const joined = `${readSrc("runtime/data/executor.ts")}\n${lifecycleSources()}`;
  assert.equal(
    FREEZE_OR_CLONE.test(joined),
    true,
    "executor/lifecycle must deep-freeze or defensively clone the authorized payload"
  );

  let freezeOrThrow = false;
  const transport = createRecordingTransport();
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        beforeInsert: (event) => {
          const record = event.record;
          if (!record) {
            return;
          }
          if (
            Object.isFrozen(record) ||
            Object.isFrozen(Object.getPrototypeOf(record))
          ) {
            freezeOrThrow = true;
          }
          try {
            record.name = "mutated-by-before";
          } catch {
            freezeOrThrow = true;
          }
        },
      },
    },
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
  const insertCall = transport.calls.find((call) => call.op === "insert");
  assert.ok(insertCall);
  const sent = insertCall.payload as { insert_body?: { name?: string } };
  assert.equal(sent.insert_body?.name, "Ada");
  assert.ok(
    freezeOrThrow || sent.insert_body?.name !== "mutated-by-before",
    "before* must see a frozen or cloned authorized payload"
  );
});

test("P?: before* MUST NOT mutate the transport-bound body", async () => {
  const transport = createRecordingTransport();
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        beforeInsert: (event) => {
          if (event.record) {
            event.record.name = "mutated-by-before";
            event.record.smuggled = true;
          }
          if (event.records) {
            for (const row of event.records) {
              row.name = "mutated-by-before";
            }
          }
        },
        prepareInsert: (event) => ({
          ...(event.record ?? {}),
          email: "ada@athena.dev",
          name: "prepared",
        }),
      },
    },
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
  assert.equal(transport.calls.length, 1);
  const sent = transport.calls[0]?.payload as {
    insert_body?: { email?: string; name?: string; smuggled?: boolean };
  };
  assert.equal(sent.insert_body?.name, "prepared");
  assert.equal(sent.insert_body?.email, "ada@athena.dev");
  assert.equal(sent.insert_body?.smuggled, undefined);
});

test("P?: prepareDelete is absent", async () => {
  const typesSrc = readSrc("runtime/data/lifecycle/types.ts");
  const runnerSrc = readSrc("runtime/data/lifecycle/runner.ts");
  assert.equal(typesSrc.includes("prepareDelete"), false);
  assert.equal(runnerSrc.includes("prepareDelete"), false);
  assert.equal(lifecycleSources().includes("prepareDelete"), false);

  const lifecycle = await importLifecycle();
  assert.equal("prepareDelete" in lifecycle, false);

  let prepareDeleteCalled = false;
  const transport = createRecordingTransport();
  const hooks = {
    prepareDelete: () => {
      prepareDeleteCalled = true;
      return {
        conditions: [
          { column: "id", operator: "eq", value: "injected-predicate" },
        ],
      };
    },
  };
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: hooks as AthenaDataLifecycleHooks,
    },
    modelEnforcement: "known-only",
    models: { users },
    security: { mode: "trusted" },
    transport,
  });
  const payload = {
    conditions: [{ column: "id", operator: "eq" as const, value: "keep-me" }],
    table_name: "public.users",
  };
  const result = await runtime.execute({
    operation: "delete",
    payload,
  });
  assert.equal(result.ok, true);
  assert.equal(prepareDeleteCalled, false);
  assert.equal(transport.calls.length, 1);
  assert.deepEqual(transport.calls[0]?.payload, payload);
});

test("P?: bytes reaching transport equal what security gates authorized", async () => {
  const authorized = {
    email: "ada@athena.dev",
    id: "1",
    name: "prepared",
    status: "open",
  };
  const transport = createRecordingTransport();
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        beforeInsert: (event) => {
          if (event.record) {
            event.record.name = "mutated-after-authorize";
          }
        },
        prepareInsert: () => ({ ...authorized }),
      },
    },
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
  assert.equal(result.ok, true);
  assert.equal(transport.calls.length, 1);
  const sent = transport.calls[0]?.payload as {
    insert_body?: Record<string, unknown>;
    table_name?: string;
  };
  assert.deepEqual(sent.insert_body, authorized);
  assert.equal(sent.table_name, "public.users");
});

test("P?: after* throw still must not fail the client mutation / execution event", async () => {
  const events: Array<{ decision?: string; errorKind?: string }> = [];
  let afterCalled = false;
  const transport = createRecordingTransport();
  const runtime = createAthenaServerRuntime({
    lifecycle: {
      data: {
        afterInsert: async () => {
          afterCalled = true;
          throw new Error("afterInsert boom");
        },
      },
    },
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
  assert.equal(afterCalled, true);
  assert.equal(result.ok, true);
  assert.equal(transport.calls.length, 1);
  assert.ok(events.length >= 1);
  assert.equal(events[0]?.decision, "allow");
  assert.equal(events[0]?.errorKind, undefined);
});

test("P?: semanticOperation never affects Policy", () => {
  const decideSrc = readSrc("policy/decide.ts");
  const applySrc = readSrc("policy/apply.ts");
  const decisionSrc = readSrc("policy/decision.ts");
  const executorSrc = readSrc("runtime/data/executor.ts");
  assert.equal(decideSrc.includes("semanticOperation"), false);
  assert.equal(applySrc.includes("semanticOperation"), false);
  assert.equal(decisionSrc.includes("semanticOperation"), false);
  const actionFn = exportedFn(decisionSrc, "actionFromRuntimeOperation") ?? "";
  assert.equal(actionFn.includes("semanticOperation"), false);
  assert.equal(actionFn.includes("upsert"), false);
  assert.equal(
    /decideAthenaPolicy\([\s\S]*semanticOperation/.test(executorSrc),
    false
  );
  assert.equal(
    /applyAthenaPolicyDecision\([\s\S]*semanticOperation/.test(executorSrc),
    false
  );
  assert.equal(
    /actionFromRuntimeOperation\([^)]*semanticOperation/.test(executorSrc),
    false
  );
});

test("P?: redactAthenaRuntimeExecutionEvent is not on the hot path", () => {
  const executorSrc = readSrc("runtime/data/executor.ts");
  assert.equal(
    executorSrc.includes("redactAthenaRuntimeExecutionEvent"),
    false
  );
  for (const file of collectTsFiles(lifecycleDir)) {
    const text = readFileSync(file, "utf8");
    assert.equal(
      text.includes("redactAthenaRuntimeExecutionEvent"),
      false,
      file
    );
  }
});

test("P?: Data hooks copy Auth split not AthenaAuthHooks", () => {
  assert.equal(existsSync(lifecycleDir), true);
  const files = collectTsFiles(lifecycleDir);
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes("AthenaAuthHooks"), false, file);
    assert.equal(text.includes('from "../../auth/hooks'), false, file);
  }
  const typesSrc = readSrc("runtime/data/lifecycle/types.ts");
  assert.match(typesSrc, /export type AthenaDataLifecycleHooks/);
  assert.equal(typesSrc.includes("AthenaAuthHooks"), false);
});
