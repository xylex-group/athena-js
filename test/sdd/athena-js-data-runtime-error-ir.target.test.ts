/**
 * Target: Data Runtime PostgreSQL classification into catalog Error IR.
 * RED on freeze HEAD. Frozen in RED_CONTRACT_FREEZE until GREEN.
 * See docs/sdd/xylex/athena-js-data-runtime-error-ir/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import { encodeAthenaGatewayResult } from "../../src/gateway/server/encode.ts";
import type { AthenaGatewayResponse } from "../../src/gateway/types.ts";
import type { PolicyDefinition } from "../../src/policy/types.ts";
import {
  mapPostgresQueryError,
  postgresErrorResponse,
} from "../../src/postgres/execute.ts";
import { readRuntimeErrorCode } from "../../src/runtime/data/errors.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";
import { classifyAthenaError } from "../../src/runtime/error/index.ts";
import type {
  AthenaErrorDomain,
  AthenaErrorIR,
} from "../../src/runtime/error/ir.ts";
import {
  errorDescriptor,
  errorDescriptorsForDomain,
} from "../../src/runtime/error/registry.ts";
import { string, table } from "../../src/schema/index.ts";
import { storageErrorResult } from "../../src/storage/runtime/errors.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const repoRoot = join(pkgRoot, "..", "..");

const MISSING_RELATION_TABLE = "billing.billing_provider_connections";
const MISSING_RELATION_MESSAGE = `relation "${MISSING_RELATION_TABLE}" does not exist`;
const GENERIC_RUNTIME_FAILURE = "Athena Local Runtime request failed.";
const RELATION_NOT_FOUND_DESCRIPTION =
  "The requested table or schema does not exist.";
const SQLSTATE_PUBLIC = /^[0-9A-Z]{5}$/;

type ClassifiedPublicError = {
  code?: string;
  errorNumber?: number;
  kind?: string;
  message?: string;
  retry?: string;
  status?: number;
};

function postgresDriver(
  code: string,
  message: string
): {
  code: string;
  message: string;
} {
  return { code, message };
}

function failingTransport(
  failure: AthenaGatewayResponse<unknown>
): AthenaGatewayClient {
  const fail = async <T>(): Promise<AthenaGatewayResponse<T>> =>
    failure as AthenaGatewayResponse<T>;
  return {
    baseUrl: "https://athena.local/mock",
    buildHeaders() {
      return {};
    },
    deleteGateway: fail,
    fetchGateway: fail,
    insertGateway: fail,
    queryGateway: fail,
    async resolveCallOptions(options) {
      return options;
    },
    rpcGateway: fail,
    updateGateway: fail,
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

function driverTransport(error: unknown): AthenaGatewayClient {
  return failingTransport(
    mapPostgresQueryError(error, "/gateway/fetch", "POST")
  );
}

async function executeAgainstDriver(
  error: unknown,
  payload: Record<string, unknown>
): Promise<AthenaGatewayResponse<unknown>> {
  const runtime = createAthenaServerRuntime({
    security: { mode: "trusted" },
    transport: driverTransport(error),
    unsafeAllowUnauthenticated: true,
  });
  return runtime.execute({
    operation: "fetch",
    payload,
  });
}

function rawPublicError(
  response: AthenaGatewayResponse<unknown>
): ClassifiedPublicError {
  const raw = response.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const error = (raw as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return {};
  }
  return error as ClassifiedPublicError;
}

function dataDescriptor(code: string): AthenaErrorIR | undefined {
  return errorDescriptor("data" as AthenaErrorDomain, code);
}

async function encodedError(
  response: AthenaGatewayResponse<unknown>,
  requestId: string
): Promise<{
  code?: string;
  errorNumber?: unknown;
  message?: string;
  status?: number;
  ok?: boolean;
}> {
  const encoded = encodeAthenaGatewayResult(response, requestId);
  const body = JSON.parse(await encoded.text()) as {
    error?: {
      code?: string;
      errorNumber?: unknown;
      message?: string;
      status?: number;
    };
    ok?: boolean;
  };
  return {
    code: body.error?.code,
    errorNumber: body.error?.errorNumber,
    message: body.error?.message,
    ok: body.ok,
    status: body.error?.status,
  };
}

test("P?: 42P01 billing.billing_provider_connections classifies as data_relation_not_found 404", async () => {
  const executeSrc = readFileSync(
    join(srcRoot, "runtime", "data", "nucleus", "execute.ts"),
    "utf8"
  );
  assert.equal(
    executeSrc.includes("normalizeDataTransportFailure"),
    true,
    "classify inside nucleus after sendAuthorizedTransport"
  );

  const result = await executeAgainstDriver(
    postgresDriver("42P01", MISSING_RELATION_MESSAGE),
    { table_name: MISSING_RELATION_TABLE }
  );
  const classified = rawPublicError(result);
  const descriptor = dataDescriptor("data_relation_not_found");
  const message =
    classified.message ??
    (typeof result.error === "string" ? result.error : undefined);

  assert.equal(result.ok, false);
  assert.equal(readRuntimeErrorCode(result), "data_relation_not_found");
  assert.equal(result.status, 404);
  assert.equal(classified.errorNumber, 10_000);
  assert.equal(descriptor?.errorNumber, 10_000);
  assert.equal(descriptor?.kind, "not_found");
  assert.equal(descriptor?.retry, "never");
  assert.equal(message, `Table "${MISSING_RELATION_TABLE}" does not exist.`);
  assert.equal(message?.includes(MISSING_RELATION_MESSAGE), false);
  assert.notEqual(message, GENERIC_RUNTIME_FAILURE);
  assert.match(message ?? "", /billing\.billing_provider_connections/);

  const absentTable = await executeAgainstDriver(
    postgresDriver("42P01", MISSING_RELATION_MESSAGE),
    {}
  );
  const absentMessage =
    rawPublicError(absentTable).message ??
    (typeof absentTable.error === "string" ? absentTable.error : undefined);
  assert.equal(readRuntimeErrorCode(absentTable), "data_relation_not_found");
  assert.equal(absentTable.status, 404);
  assert.equal(absentMessage, RELATION_NOT_FOUND_DESCRIPTION);
  assert.equal(absentMessage?.includes(MISSING_RELATION_MESSAGE), false);
  assert.notEqual(absentMessage, GENERIC_RUNTIME_FAILURE);
});

test("P?: hint is never a public code", async () => {
  const hintCases: Array<{
    hint: string;
    response: AthenaGatewayResponse<unknown>;
  }> = [
    {
      hint: "42P01",
      response: mapPostgresQueryError(
        postgresDriver("42P01", MISSING_RELATION_MESSAGE),
        "/gateway/fetch",
        "POST"
      ),
    },
    {
      hint: "unique_violation (users_email_key)",
      response: mapPostgresQueryError(
        {
          code: "23505",
          constraint: "users_email_key",
          message: "duplicate key value violates unique constraint",
        },
        "/gateway/fetch",
        "POST"
      ),
    },
    {
      hint: "connection",
      response: mapPostgresQueryError(
        new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        "/gateway/fetch",
        "POST"
      ),
    },
    {
      hint: "PostgreSQL SQL compile failed (X)",
      response: postgresErrorResponse(
        400,
        "HTTP_ERROR",
        "SQL compile failed",
        "/gateway/fetch",
        "POST",
        "PostgreSQL SQL compile failed (X)"
      ),
    },
  ];

  for (const fixture of hintCases) {
    assert.equal(fixture.response.errorDetails?.hint, fixture.hint);
    assert.notEqual(
      readRuntimeErrorCode(fixture.response),
      fixture.hint,
      `hint ${fixture.hint} must not be a public code`
    );
  }

  const classified = await executeAgainstDriver(
    postgresDriver("42P01", MISSING_RELATION_MESSAGE),
    { table_name: MISSING_RELATION_TABLE }
  );
  const envelope = await encodedError(classified, "req-t02");
  assert.equal(SQLSTATE_PUBLIC.test(envelope.code ?? ""), false);
  assert.notEqual(envelope.code, "42P01");
});

test("P?: 42703 classifies as data_column_not_found", async () => {
  const result = await executeAgainstDriver(
    postgresDriver("42703", 'column "nope" does not exist'),
    { table_name: MISSING_RELATION_TABLE }
  );
  const descriptor = dataDescriptor("data_column_not_found");
  assert.equal(readRuntimeErrorCode(result), "data_column_not_found");
  assert.equal(result.status, 404);
  assert.equal(rawPublicError(result).errorNumber, 10_002);
  assert.equal(descriptor?.errorNumber, 10_002);
  assert.equal(descriptor?.kind, "not_found");
  assert.notEqual(result.status, 400);
});

test("P?: 23505 classifies as data_conflict 409", async () => {
  const result = await executeAgainstDriver(
    {
      code: "23505",
      constraint: "users_email_key",
      message: "duplicate key value violates unique constraint",
    },
    { table_name: "public.users" }
  );
  const descriptor = dataDescriptor("data_conflict");
  assert.equal(readRuntimeErrorCode(result), "data_conflict");
  assert.equal(result.status, 409);
  assert.equal(rawPublicError(result).errorNumber, 10_006);
  assert.equal(descriptor?.errorNumber, 10_006);
  assert.equal(descriptor?.kind, "conflict");
  assert.equal(descriptor?.retry, "never");
});

test("P?: 42501 is data_permission_denied distinct from ATHENA_POLICY_DENIED", async () => {
  const result = await executeAgainstDriver(
    postgresDriver("42501", "permission denied for table invoices"),
    { table_name: "public.invoices" }
  );
  const descriptor = dataDescriptor("data_permission_denied");
  assert.equal(readRuntimeErrorCode(result), "data_permission_denied");
  assert.notEqual(readRuntimeErrorCode(result), "ATHENA_POLICY_DENIED");
  assert.equal(result.status, 403);
  assert.equal(rawPublicError(result).errorNumber, 10_007);
  assert.equal(descriptor?.errorNumber, 10_007);
  assert.equal(descriptor?.kind, "authorization");

  const denyPolicy: PolicyDefinition = {
    actions: 1,
    composition: "permissive",
    id: "admin-only-invoices",
    principals: [{ kind: "admin" }],
    resource: { schema: "public", table: "invoices" },
  };
  const policyRuntime = createAthenaServerRuntime({
    policies: {
      definitions: [denyPolicy],
      mode: "enforce",
    },
    security: { mode: "policy" },
    transport: driverTransport(
      postgresDriver("42501", "permission denied for table invoices")
    ),
  });
  const policyDenied = await policyRuntime.execute({
    operation: "fetch",
    payload: { table_name: "invoices" },
  });
  assert.equal(readRuntimeErrorCode(policyDenied), "ATHENA_POLICY_DENIED");
  assert.notEqual(readRuntimeErrorCode(policyDenied), "data_permission_denied");
});

test("P?: 08006 and ECONNREFUSED classify as data_backend_unavailable 503", async () => {
  const sqlState = await executeAgainstDriver(
    postgresDriver("08006", "connection failure"),
    { table_name: MISSING_RELATION_TABLE }
  );
  const network = await executeAgainstDriver(
    new Error("connect ECONNREFUSED 127.0.0.1:5432"),
    { table_name: MISSING_RELATION_TABLE }
  );
  const descriptor = dataDescriptor("data_backend_unavailable");
  for (const result of [sqlState, network]) {
    assert.equal(readRuntimeErrorCode(result), "data_backend_unavailable");
    assert.equal(result.status, 503);
    assert.equal(rawPublicError(result).errorNumber, 10_009);
  }
  assert.equal(descriptor?.errorNumber, 10_009);
  assert.equal(descriptor?.kind, "unavailable");
  assert.equal(descriptor?.retry, "safe");
});

test("P?: unknown SQLSTATE classifies as data_execution_failed not the SQLSTATE string", async () => {
  for (const sqlState of ["XX000", "99999"]) {
    const result = await executeAgainstDriver(
      postgresDriver(sqlState, `internal error ${sqlState}`),
      { table_name: MISSING_RELATION_TABLE }
    );
    assert.equal(readRuntimeErrorCode(result), "data_execution_failed");
    assert.notEqual(readRuntimeErrorCode(result), sqlState);
    assert.equal(result.status, 500);
    assert.equal(rawPublicError(result).errorNumber, 10_010);
    const envelope = await encodedError(result, `req-${sqlState}`);
    assert.notEqual(envelope.code, sqlState);
    assert.equal(envelope.code, "data_execution_failed");
  }
  const descriptor = dataDescriptor("data_execution_failed");
  assert.equal(descriptor?.errorNumber, 10_010);
  assert.equal(descriptor?.kind, "internal");
});

test("P?: ATHENA_POLICY_DENIED and ATHENA_MODEL_NOT_EXPOSED still win when those gates fire", async () => {
  const users = table("users")
    .schema("public")
    .columns({
      id: string(),
      name: string(),
    })
    .primaryKey("id");

  const modelRuntime = createAthenaServerRuntime({
    modelEnforcement: "known-only",
    models: { users },
    security: { mode: "trusted" },
    transport: driverTransport(
      postgresDriver("42P01", MISSING_RELATION_MESSAGE)
    ),
    unsafeAllowUnauthenticated: true,
  });
  const modelDenied = await modelRuntime.execute({
    operation: "fetch",
    payload: { table_name: "secrets" },
  });
  assert.equal(readRuntimeErrorCode(modelDenied), "ATHENA_MODEL_NOT_EXPOSED");
  assert.equal(readRuntimeErrorCode(modelDenied)?.startsWith("data_"), false);

  const denyPolicy: PolicyDefinition = {
    actions: 1,
    composition: "permissive",
    id: "admin-only",
    principals: [{ kind: "admin" }],
    resource: { schema: "public", table: "invoices" },
  };
  const policyRuntime = createAthenaServerRuntime({
    policies: {
      definitions: [denyPolicy],
      mode: "enforce",
    },
    security: { mode: "policy" },
    transport: driverTransport(
      postgresDriver("42P01", MISSING_RELATION_MESSAGE)
    ),
  });
  const policyDenied = await policyRuntime.execute({
    operation: "fetch",
    payload: { table_name: "invoices" },
  });
  assert.equal(readRuntimeErrorCode(policyDenied), "ATHENA_POLICY_DENIED");
  assert.equal(readRuntimeErrorCode(policyDenied)?.startsWith("data_"), false);
});

test("P?: HTTP envelope includes errorNumber", async () => {
  const result = await executeAgainstDriver(
    postgresDriver("42P01", MISSING_RELATION_MESSAGE),
    { table_name: MISSING_RELATION_TABLE }
  );
  const envelope = await encodedError(result, "req-t09");
  assert.equal(envelope.ok, false);
  assert.equal(envelope.code, "data_relation_not_found");
  assert.equal(envelope.errorNumber, 10_000);
  assert.equal(envelope.status, 404);
  assert.notEqual(envelope.errorNumber, undefined);
});

test("P?: domain data is on AthenaErrorDomain and generated descriptors", () => {
  const irSrc = readFileSync(
    join(srcRoot, "runtime", "error", "ir.ts"),
    "utf8"
  );
  assert.equal(
    irSrc.includes('"data"'),
    true,
    'AthenaErrorDomain must include "data"'
  );
  const generateSrc = readFileSync(
    join(pkgRoot, "scripts", "generate-error-ir.mjs"),
    "utf8"
  );
  assert.equal(
    generateSrc.includes('["data", "data"]') ||
      generateSrc.includes("['data', 'data']"),
    true,
    "generate-error-ir.mjs must project the data domain"
  );
  assert.equal(
    existsSync(join(repoRoot, "contracts", "data", "errors.json")),
    true
  );
  assert.equal(
    existsSync(join(srcRoot, "runtime", "error", "generated", "data.ts")),
    true
  );

  const descriptors = errorDescriptorsForDomain("data" as AthenaErrorDomain);
  const relation = descriptors.find(
    (entry) => entry.code === "data_relation_not_found"
  );
  assert.ok(
    relation,
    "generated Data descriptors must include data_relation_not_found"
  );
  assert.equal(relation.domain, "data");
  assert.equal(relation.errorNumber, 10_000);
  assert.equal(relation.status, 404);
  assert.equal(relation.kind, "not_found");
  assert.equal(relation.retry, "never");
});

test("P?: encode after nucleus classification does not need to guess from hints", async () => {
  const result = await executeAgainstDriver(
    postgresDriver("42P01", MISSING_RELATION_MESSAGE),
    { table_name: MISSING_RELATION_TABLE }
  );
  assert.equal(readRuntimeErrorCode(result), "data_relation_not_found");

  const classified = rawPublicError(result);
  assert.equal(classified.code, "data_relation_not_found");

  const withHint: AthenaGatewayResponse<unknown> = {
    ...result,
    errorDetails: {
      ...(result.errorDetails ?? {
        code: "HTTP_ERROR",
        endpoint: "/gateway/fetch",
        message: classified.message ?? "",
        method: "POST",
        status: 404,
      }),
      hint: "42P01",
    },
  };
  const withoutHint: AthenaGatewayResponse<unknown> = {
    ...result,
    errorDetails: result.errorDetails
      ? { ...result.errorDetails, hint: undefined }
      : null,
  };

  const hinted = await encodedError(withHint, "req-t11-hint");
  const stripped = await encodedError(withoutHint, "req-t11-no-hint");
  assert.equal(hinted.code, "data_relation_not_found");
  assert.equal(stripped.code, "data_relation_not_found");
  assert.equal(hinted.code, stripped.code);
  assert.notEqual(hinted.code, "42P01");
});

test("P?: browser/storage Error IR unchanged storage_authorization_denied 3003", () => {
  const error = classifyAthenaError({
    domain: "storage",
    failure: {
      message: "access denied",
      providerCode: "AccessDenied",
      source: "provider",
    },
  });
  assert.equal(error.code, "storage_authorization_denied");
  assert.equal(error.errorNumber, 3003);
  assert.equal(error.status, 403);
  assert.equal(error.kind, "authorization");
  assert.equal(error.domain, "storage");

  const helper = storageErrorResult({
    message: "Storage operation put denied (missing storage.put)",
    source: "runtime",
    status: 403,
  });
  assert.equal(helper.ok, false);
  assert.equal(helper.status, 403);
  assert.equal(helper.error?.code, "storage_authorization_denied");
  assert.equal(helper.error?.errorNumber, 3003);
  assert.notEqual(error.code, "data_permission_denied");
  assert.notEqual(error.errorNumber, 10_000);
});
