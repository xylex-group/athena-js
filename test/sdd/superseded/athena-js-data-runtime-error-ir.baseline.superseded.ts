/**
 * Baseline: Data Runtime PostgreSQL classification found case.
 * GREEN on freeze HEAD defects. Do not invert in place.
 * See docs/sdd/xylex/athena-js-data-runtime-error-ir/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import { encodeAthenaGatewayResult } from "../../src/gateway/server/encode.ts";
import type { AthenaGatewayResponse } from "../../src/gateway/types.ts";
import { mapPostgresDriverError } from "../../src/postgres/errors.ts";
import { mapPostgresQueryError } from "../../src/postgres/execute.ts";
import { readRuntimeErrorCode } from "../../src/runtime/data/errors.ts";
import { publicRuntimeErrorMessage } from "../../src/runtime/data/redact.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");

const MISSING_RELATION_TABLE = "billing.billing_provider_connections";
const MISSING_RELATION_MESSAGE = `relation "${MISSING_RELATION_TABLE}" does not exist`;
const GENERIC_RUNTIME_FAILURE = "Athena Local Runtime request failed.";

function postgresUndefinedTableError(): {
  code: string;
  message: string;
} {
  return {
    code: "42P01",
    message: MISSING_RELATION_MESSAGE,
  };
}

function missingRelationTransport(): AthenaGatewayClient {
  const failure = mapPostgresQueryError(
    postgresUndefinedTableError(),
    "/gateway/fetch",
    "POST"
  );
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

test("P?: 42P01 fixture maps to hint/SQLSTATE as public-ish code", () => {
  const mapped = mapPostgresDriverError(postgresUndefinedTableError());
  assert.equal(mapped.code, "HTTP_ERROR");
  assert.equal(mapped.status, 400);
  assert.equal(mapped.hint, "42P01");
  assert.equal(mapped.sqlState, "42P01");
  assert.equal(mapped.message, MISSING_RELATION_MESSAGE);
  assert.notEqual(mapped.hint, "data_relation_not_found");
  assert.notEqual(mapped.code, "data_relation_not_found");
});

test("P?: encodeAthenaGatewayResult / readRuntimeErrorCode exposes 42P01", async () => {
  const response = mapPostgresQueryError(
    postgresUndefinedTableError(),
    "/gateway/fetch",
    "POST"
  );
  assert.equal(response.ok, false);
  assert.equal(response.errorDetails?.hint, "42P01");
  assert.equal(typeof response.raw, "object");
  assert.equal(
    (response.raw as { code?: string; error?: unknown }).error,
    MISSING_RELATION_MESSAGE
  );
  assert.equal(readRuntimeErrorCode(response), "42P01");

  const encoded = encodeAthenaGatewayResult(response, "req-42p01");
  const body = JSON.parse(await encoded.text()) as {
    error?: {
      code?: string;
      errorNumber?: unknown;
      message?: string;
      status?: number;
    };
    ok?: boolean;
  };
  assert.equal(body.ok, false);
  assert.equal(body.error?.code, "42P01");
  assert.equal(body.error?.status, 400);
  assert.equal(body.error?.message, GENERIC_RUNTIME_FAILURE);
  assert.equal(body.error?.errorNumber, undefined);
});

test("P?: publicRuntimeErrorMessage redacts relation-does-not-exist to generic local-runtime failure", () => {
  assert.equal(
    publicRuntimeErrorMessage(MISSING_RELATION_MESSAGE),
    GENERIC_RUNTIME_FAILURE
  );
});

test("P?: nucleus execute returns unnormalized gateway HTTP_ERROR for missing relation", async () => {
  const executeSrc = readFileSync(
    join(srcRoot, "runtime", "data", "nucleus", "execute.ts"),
    "utf8"
  );
  assert.equal(
    executeSrc.includes("normalizeDataTransportFailure"),
    false,
    "freeze HEAD does not classify after sendAuthorizedTransport"
  );

  const runtime = createAthenaServerRuntime({
    security: { mode: "trusted" },
    transport: missingRelationTransport(),
    unsafeAllowUnauthenticated: true,
  });
  const result = await runtime.execute({
    operation: "fetch",
    payload: { table_name: MISSING_RELATION_TABLE },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.errorDetails?.code, "HTTP_ERROR");
  assert.equal(result.errorDetails?.hint, "42P01");
  assert.equal(readRuntimeErrorCode(result), "42P01");
  assert.notEqual(readRuntimeErrorCode(result), "data_relation_not_found");
});

test("P?: postgres-direct-errors undefined_table maps to 400", () => {
  const mapped = mapPostgresDriverError({
    code: "42P01",
    message: 'relation "nope" does not exist',
  });
  assert.equal(mapped.status, 400);
  assert.equal(mapped.sqlState, "42P01");
});
