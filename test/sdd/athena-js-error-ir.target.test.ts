import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  athenaErrorResult,
  classifyAthenaError,
  createAthenaErrorInstance,
} from "../../src/runtime/error/index.ts";
import { storageErrorDescriptor } from "../../src/runtime/error/registry.ts";
import { storageErrorResult } from "../../src/storage/runtime/errors.ts";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

test("T-EIR-SHAPE: Error IR and occurrence data stay separate", () => {
  const error = classifyAthenaError({
    domain: "storage",
    failure: {
      message: "access denied",
      providerCode: "AccessDenied",
      source: "provider",
    },
  });
  const instance = createAthenaErrorInstance(error, {
    cause: new Error("provider detail"),
    details: { requestId: "req-1" },
    message: "storage operation denied",
  });

  assert.deepEqual(error, {
    code: "storage_authorization_denied",
    description: "Caller is not authorized for the storage operation.",
    domain: "storage",
    errorNumber: 3003,
    kind: "authorization",
    retry: "never",
    status: 403,
  });
  assert.equal(instance.error, error);
  assert.equal(instance.message, "storage operation denied");
  assert.deepEqual(athenaErrorResult(instance), {
    error: {
      code: "storage_authorization_denied",
      errorNumber: 3003,
      message: "storage operation denied",
    },
    ok: false,
    status: 403,
  });
});

test("T-EIR-DETAILS: authorization occurrence details survive athenaErrorResult", () => {
  const error = classifyAthenaError({
    domain: "storage",
    failure: {
      code: "storage_authorization_denied",
      message: "Storage operation put denied (missing storage.put)",
      source: "runtime",
      status: 403,
    },
  });
  const instance = createAthenaErrorInstance(error, {
    details: {
      missing: ["storage.put"],
      operation: "put",
    },
    message: "Storage operation put denied (missing storage.put)",
  });
  assert.deepEqual(athenaErrorResult(instance), {
    error: {
      code: "storage_authorization_denied",
      errorNumber: 3003,
      message: "Storage operation put denied (missing storage.put)",
      missing: ["storage.put"],
      operation: "put",
    },
    ok: false,
    status: 403,
  });
});

test("T-EIR-CLASSIFY: HTTP, provider, and runtime authorization failures converge", () => {
  const failures = [
    {
      message: "HTTP unauthorized",
      source: "http" as const,
      status: 401,
    },
    {
      message: "S3 AccessDenied",
      providerCode: "AccessDenied",
      source: "provider" as const,
      status: 403,
    },
    {
      message: "missing required storage right",
      source: "runtime" as const,
      status: 403,
    },
  ];
  const classified = failures.map((failure) =>
    classifyAthenaError({ domain: "storage", failure })
  );

  assert.deepEqual(classified[0], classified[1]);
  assert.deepEqual(classified[1], classified[2]);
  assert.equal(classified[0].code, "storage_authorization_denied");
  assert.equal(classified[0].errorNumber, 3003);
  assert.equal(classified[0].status, 403);
});

test("T-EIR-WIRE: known wire codes select catalog descriptors", () => {
  const known = storageErrorDescriptor("AUTHORIZATION_DENIED");
  const unavailable = storageErrorDescriptor("storage_provider_unavailable");

  assert.equal(known?.errorNumber, 3003);
  assert.equal(known?.kind, "authorization");
  assert.equal(unavailable?.retry, "safe");
  assert.equal(unavailable?.status, 503);
});

test("T-EIR-CATALOG: generated Storage descriptors match contract identity", () => {
  const contract = JSON.parse(
    readFileSync(`${repoRoot}/contracts/storage/errors.json`, "utf8")
  ) as {
    codes: Array<{
      code: string;
      errorNumber: number;
      status: number;
      description: string;
      kind: string;
      retry: string;
    }>;
  };

  for (const entry of contract.codes) {
    const descriptor = storageErrorDescriptor(entry.code);
    assert.ok(descriptor, entry.code);
    assert.equal(descriptor.errorNumber, entry.errorNumber, entry.code);
    assert.equal(descriptor.status, entry.status, entry.code);
    assert.equal(descriptor.description, entry.description, entry.code);
    assert.equal(descriptor.kind, entry.kind, entry.code);
    assert.equal(descriptor.retry, entry.retry, entry.code);
  }
});

test("T-EIR-STORAGE: Storage result helpers classify rather than mint identity", () => {
  const notFound = storageErrorResult({
    message: "NoSuchKey",
    providerCode: "NoSuchKey",
    source: "provider",
    status: 404,
  });
  const invalid = storageErrorResult({
    message: "object key is invalid",
    source: "runtime",
    status: 400,
  });

  assert.equal(notFound.error?.code, "storage_file_not_found");
  assert.equal(notFound.error?.errorNumber, 3005);
  assert.equal(invalid.error?.code, "storage_invalid_request");
  assert.equal(invalid.error?.errorNumber, 3000);
});

test("T-EIR-BOUNDARIES: Error IR does not create a client or replace billing safety", () => {
  const storageErrors = readFileSync(
    `${repoRoot}/packages/athena-js/src/storage/runtime/errors.ts`,
    "utf8"
  );
  const browserTransport = readFileSync(
    `${repoRoot}/packages/athena-js/src/storage/runtime/browser-transport.ts`,
    "utf8"
  );
  const billingRetry = readFileSync(
    `${repoRoot}/packages/athena-js/src/billing/safety/retry.ts`,
    "utf8"
  );

  assert.equal(storageErrors.includes("storageErrorResult(30"), false);
  assert.equal(browserTransport.includes("storageErrorResult(30"), false);
  assert.equal(storageErrors.includes("createErrorClient"), false);
  assert.match(billingRetry, /export function billingRetryDisposition\(/);
  assert.equal(billingRetry.includes("billingRetryDispositionForKind"), false);
});
