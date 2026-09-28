/**
 * SUPERSEDED by test/sdd/athena-js-storage-billing-transport-conformance.target.test.ts
 *
 * Former characterization of freeze-HEAD remaining defects (post-#774):
 * PDF/64KiB corpus omitted, local list ignored cursor/limit, invalid-key 3010,
 * GET-only Billing contract, factory/topology gaps. Target suite is the CI
 * source of truth. Not collected by pnpm test (superseded/ is skipped).
 *
 * See docs/sdd/xylex/athena-js-storage-billing-transport-conformance/
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseAthenaRuntimeDiscoveryDocument } from "../../../src/gateway/discovery-types.ts";
import { createAthenaHttpTransportIR } from "../../../src/runtime/transport/http.ts";
import { assertSafeObjectKey } from "../../../src/storage/local.ts";
import { mapProviderFailure } from "../../../src/storage/runtime/errors.ts";
import { createLocalStorageProviderFromRoot } from "../../../src/storage/runtime/providers/local-provider.ts";
import type { AuthorizedStorageOperation } from "../../../src/storage/runtime/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");
const finalityTarget = join(
  here,
  "..",
  "athena-js-storage-billing-transport-finality.target.test.ts"
);

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

function packageExports(): Record<string, unknown> {
  return (
    (
      JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
        exports?: Record<string, unknown>;
      }
    ).exports ?? {}
  );
}

function storageOp(
  partial: Omit<AuthorizedStorageOperation, "principal">
): AuthorizedStorageOperation {
  return {
    ...partial,
    principal: {
      authenticated: true,
      grants: [],
      rights: [],
      userId: "conformance-baseline",
    },
  };
}

const DISCOVERY_CAPABILITIES = {
  auth: { available: false },
  delete: true,
  fetch: true,
  insert: true,
  models: "off" as const,
  nestedRelations: false,
  policy: false,
  rawSql: false,
  rpc: false,
  update: true,
};

test("B-ST-NO-PDF-64K: P?: hostile Storage corpus omits PDF header and 64KiB random", () => {
  const finality = readFileSync(finalityTarget, "utf8");
  assert.match(finality, /const HOSTILE_BYTES/);
  assert.match(finality, /0x00/);
  assert.match(finality, /0xff/);
  assert.match(finality, /0xfe/);
  assert.match(finality, /0x80/);
  assert.match(finality, /0xc0/);
  assert.match(finality, /0xd8/);
  assert.match(finality, /0x89,\s*0x50,\s*0x4e,\s*0x47/);
  assert.match(finality, /0x50,\s*0x4b,\s*0x03,\s*0x04/);
  assert.match(finality, /randomBytes\(4096\)/);
  assert.equal(/0x25\s*,\s*0x50\s*,\s*0x44\s*,\s*0x46/.test(finality), false);
  assert.equal(finality.includes("%PDF"), false);
  assert.equal(finality.includes("65536"), false);
  assert.equal(/64\s*KiB/i.test(finality), false);
});

test("B-ST-LOCAL-LIST-IGNORE: P?: local Storage list ignores cursor and limit", async () => {
  const providerSrc = readSrc("storage/runtime/providers/local-provider.ts");
  assert.match(
    providerSrc,
    /store\.file\.list\(\{\s*prefix:\s*op\.prefix\s*\}\s*as never\)/
  );
  assert.equal(providerSrc.includes("cursor"), false);
  assert.equal(providerSrc.includes("limit"), false);

  const localSrc = readSrc("storage/local.ts");
  assert.equal(/\bcursor\b/.test(localSrc), false);
  assert.equal(/\blimit\b/.test(localSrc), false);
  assert.match(localSrc, /count:\s*listed\.length/);
  assert.match(localSrc, /files:\s*listed/);

  const root = mkdtempSync(join(tmpdir(), "athena-st-list-baseline-"));
  const provider = createLocalStorageProviderFromRoot({ root });
  for (const key of ["p/a.bin", "p/b.bin", "p/c.bin", "p/d.bin", "p/e.bin"]) {
    const put = await provider.execute(
      storageOp({
        body: new Uint8Array([1]),
        key,
        op: "put",
      })
    );
    assert.equal(put.ok, true, key);
  }
  const listed = await provider.execute(
    storageOp({
      cursor: "p/a.bin",
      limit: 2,
      op: "list",
      prefix: "p/",
    })
  );
  assert.equal(listed.ok, true);
  const data = listed.data as {
    count?: number;
    cursor?: unknown;
    files?: unknown[];
  };
  assert.equal(data.count, 5);
  assert.equal(Array.isArray(data.files), true);
  assert.equal(data.files?.length, 5);
  assert.equal("cursor" in data, false);
});

test("B-ST-OPTIONAL-ABSENCE: P?: Storage HTTP optional field absence is untested", () => {
  const finality = readFileSync(finalityTarget, "utf8");
  assert.match(
    finality,
    /T-ST-FIELD-PARITY: P\?: Storage HTTP forwards key body contentType metadata prefix cursor limit/
  );
  const start = finality.indexOf("T-ST-FIELD-PARITY:");
  const end = finality.indexOf('\ntest("T-ST-ERROR-IDENTITY:');
  assert.ok(start >= 0 && end > start);
  const fieldParity = finality.slice(start, end);
  assert.match(fieldParity, /contentType:\s*"image\/png"/);
  assert.match(fieldParity, /metadata:\s*\{\s*k:\s*"v"\s*\}/);
  assert.match(fieldParity, /cursor:\s*"after-1"/);
  assert.match(fieldParity, /limit:\s*25/);
  assert.match(fieldParity, /prefix:\s*"docs\/"/);
  assert.equal(finality.includes("T-ST-OPTIONAL-FIELDS"), false);
  assert.equal(/optional field absence/i.test(finality), false);
  assert.equal(/omit those fields|omitted optionals/i.test(finality), false);
});

test("B-ST-NO-CTOR: P?: createStorageClient is not a package export", () => {
  const exports = packageExports();
  assert.equal(
    "./storage" in exports && "createStorageClient" in exports,
    false
  );
  assert.equal(exports["./transport"], undefined);
  const index = readSrc("index.ts");
  assert.equal(index.includes("createStorageClient"), false);
});

test("B-ST-INVALID-KEY-INTERNAL: P?: invalid Storage object key becomes storage_internal 3010", async () => {
  assert.throws(
    () => assertSafeObjectKey("..\0secret"),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).name, "Error");
      assert.match((error as Error).message, /invalid|null bytes/i);
      return true;
    }
  );
  assert.throws(
    () => assertSafeObjectKey("../x"),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).name, "Error");
      assert.match((error as Error).message, /\.\./);
      return true;
    }
  );

  const mappedNull = mapProviderFailure(
    new Error("Object key is invalid: must not contain null bytes")
  );
  assert.equal(mappedNull.ok, false);
  assert.equal(mappedNull.error?.errorNumber, 3010);
  assert.equal(mappedNull.error?.code, "storage_internal");
  assert.equal(mappedNull.status, 500);
  assert.equal(mappedNull.error?.code === "storage_invalid_request", false);
  assert.equal(mappedNull.error?.errorNumber === 3000, false);

  const root = mkdtempSync(join(tmpdir(), "athena-st-key-baseline-"));
  const provider = createLocalStorageProviderFromRoot({ root });
  for (const key of ["../x", "a\0b"]) {
    const result = await provider.execute(storageOp({ key, op: "get" }));
    assert.equal(result.ok, false, key);
    assert.equal(result.error?.errorNumber, 3010, key);
    assert.equal(result.error?.code, "storage_internal", key);
    assert.equal(result.status, 500, key);
  }
});

test("B-BIL-CONTRACT-GET-ONLY: P?: Billing Direct vs browser contract is GET-only", () => {
  const finality = readFileSync(finalityTarget, "utf8");
  assert.match(
    finality,
    /T-BIL-CONTRACT: P\?: Direct vs browser Billing contract holds/
  );
  const start = finality.indexOf("T-BIL-CONTRACT:");
  const end = finality.indexOf('\ntest("T-BIL-THIN-HTTP:');
  assert.ok(start >= 0 && end > start);
  const contract = finality.slice(start, end);
  for (const op of [
    "customers.get",
    "payments.get",
    "refunds.get",
    "subscriptions.get",
    "paymentLinks.get",
    "invoices.get",
    "webhooks.list",
  ]) {
    assert.equal(contract.includes(`httpOp: "${op}"`), true, op);
  }
  for (const op of [
    "payments.create",
    "customers.create",
    "customers.update",
    "customers.delete",
    "refunds.create",
    "subscriptions.create",
    "subscriptions.cancel",
    "paymentLinks.delete",
    "webhooks.delete",
  ]) {
    assert.equal(contract.includes(`httpOp: "${op}"`), false, op);
  }
});

test("B-BIL-NO-RUNTIME-PARITY: P?: billing runtime-parity harness file is absent", () => {
  assert.equal(
    existsSync(
      join(pkgRoot, "test", "conformance", "billing", "runtime-parity.test.ts")
    ),
    false
  );
});

test("B-BIL-HTTP-SAFETY-UNPROVEN: P?: Billing HTTP financial-safety bypass is unproven", () => {
  const handlers = readSrc("next/billing-handlers.ts");
  assert.equal(handlers.includes("prepareBillingCommand"), false);
  assert.match(handlers, /runtime\.execute/);

  const finality = readFileSync(finalityTarget, "utf8");
  assert.equal(finality.includes("T-BIL-HTTP-SAFETY"), false);
  assert.equal(
    /payments\.create[\s\S]{0,800}without[\s\S]{0,80}idempotencyKey/i.test(
      finality
    ),
    false
  );
  const createPayloads = [
    ...finality.matchAll(
      /operation === "payments\.create"[\s\S]{0,280}idempotencyKey/g
    ),
  ];
  assert.ok(createPayloads.length >= 1);
  assert.match(finality, /idempotencyKey:\s*"idem-1"/);
  assert.match(finality, /idempotencyKey:\s*"idem-rights"/);
});

test("B-BIL-NO-CTOR: P?: createBillingClient is not a package export", () => {
  const exports = packageExports();
  assert.equal(exports["./transport"], undefined);
  const index = readSrc("index.ts");
  assert.equal(index.includes("createBillingClient"), false);
  const billingIndex = existsSync(join(srcRoot, "billing", "index.ts"))
    ? readSrc("billing/index.ts")
    : "";
  assert.equal(
    billingIndex.includes("export function createBillingClient"),
    false
  );
});

test("B-TR-FACTORY-GAPS: P?: createAthenaHttpTransportIR lacks credentials reject set and auth domain", () => {
  const httpSrc = readSrc("runtime/transport/http.ts");
  assert.match(
    httpSrc,
    /export function createAthenaHttpTransportIR\(input: \{\s*basePath: string;\s*domain: string;\s*origin: string;\s*\}\)/
  );
  assert.equal(
    /createAthenaHttpTransportIR\(input: \{[^}]*credentials\??:/.test(httpSrc),
    false
  );
  assert.match(
    httpSrc,
    /export type AthenaHttpTransportDomain = "storage" \| "billing" \| "data";/
  );
  assert.equal(
    httpSrc.includes(
      'export type AthenaHttpTransportDomain = "storage" | "billing" | "data" | "auth"'
    ),
    false
  );

  assert.doesNotThrow(() =>
    createAthenaHttpTransportIR({
      basePath: "",
      domain: "storage",
      origin: "same-origin",
    })
  );
  const empty = createAthenaHttpTransportIR({
    basePath: "",
    domain: "storage",
    origin: "same-origin",
  });
  assert.equal(empty.basePath, "");
  assert.equal(empty.origin, "same-origin");

  assert.doesNotThrow(() =>
    createAthenaHttpTransportIR({
      basePath: "ftp://example.com/objects",
      domain: "storage",
      origin: "same-origin",
    })
  );
  const ftp = createAthenaHttpTransportIR({
    basePath: "ftp://example.com/objects",
    domain: "storage",
    origin: "same-origin",
  });
  assert.equal(ftp.origin, "same-origin");
  assert.equal(ftp.credentials, "same-origin");

  const auth = createAthenaHttpTransportIR({
    basePath: "/api/athena/auth",
    domain: "auth",
    origin: "same-origin",
  });
  assert.equal(auth.domain, "auth");
});

test("B-TR-NO-TOPOLOGY-VALIDATOR: P?: discovery parser accepts storage.domain billing without validateAthenaRuntimeTopologyIR", () => {
  const srcBlob = joinedSources(srcRoot);
  assert.equal(srcBlob.includes("validateAthenaRuntimeTopologyIR"), false);

  const parsed = parseAthenaRuntimeDiscoveryDocument({
    athena: true,
    capabilities: DISCOVERY_CAPABILITIES,
    endpoints: {
      data: "/api/athena",
      storage: "/api/athena/storage",
    },
    protocol: { major: 1, minor: 2 },
    runtime: "next-local",
    runtimeImplementation: "athena-js",
    topology: {
      transports: {
        storage: {
          basePath: "/api/athena/storage",
          domain: "billing",
          kind: "http",
        },
      },
    },
  });
  assert.ok(parsed);
  assert.equal(parsed?.topology == null, false);
  assert.equal(parsed?.topology?.transports?.storage?.domain, "billing");
});

test("B-TR-NO-DATA-AUTH-HTTP: P?: data and auth HTTP are not compiled through Transport IR", () => {
  const callFiles: string[] = [];
  for (const file of collectTsFiles(srcRoot)) {
    const text = readFileSync(file, "utf8");
    if (
      text.includes("createAthenaHttpTransportIR(") &&
      !text.includes("export function createAthenaHttpTransportIR(")
    ) {
      callFiles.push(file.replace(/\\/g, "/"));
    }
  }
  assert.equal(
    callFiles.some((file) =>
      file.endsWith("storage/runtime/browser-transport.ts")
    ),
    true
  );
  assert.equal(
    callFiles.some((file) =>
      file.endsWith("billing/runtime/browser-transport.ts")
    ),
    true
  );
  assert.equal(
    callFiles.some(
      (file) => /auth/i.test(file) && file.includes("browser-transport")
    ),
    false
  );
  assert.equal(
    callFiles.some(
      (file) => file.includes("/data/") && file.includes("browser-transport")
    ),
    false
  );

  const topology = readSrc("gateway/discovery-types.ts");
  assert.match(
    topology,
    /export interface AthenaRuntimeDiscoveryTopology \{[\s\S]*?transports\?: \{[\s\S]*?billing\?:[\s\S]*?data\?:[\s\S]*?storage\?:/
  );
  assert.equal(/transports\?: \{[^}]*auth\?:/.test(topology), false);
});

test("B-TR-NO-EXEC-CONTEXT: P?: HTTP executor has no requestId traceId AbortSignal deadline substrate", () => {
  const httpSrc = readSrc("runtime/transport/http.ts");
  assert.match(httpSrc, /export function createAthenaHttpExecutor\(/);
  assert.match(
    httpSrc,
    /async function send\(url: string, init: RequestInit\)/
  );
  assert.match(
    httpSrc,
    /async postJson\(\s*url: string,\s*body: unknown,\s*\)/
  );
  assert.equal(httpSrc.includes("requestId"), false);
  assert.equal(httpSrc.includes("traceId"), false);
  assert.equal(httpSrc.includes("correlationId"), false);
  assert.equal(httpSrc.includes("AbortSignal"), false);
  assert.equal(httpSrc.includes("deadline"), false);
  assert.equal(/\bsignal\s*[?:]/.test(httpSrc), false);
});
