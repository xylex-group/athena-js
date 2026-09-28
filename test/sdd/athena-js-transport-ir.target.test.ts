/**
 * Target: Athena JS Transport IR .
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getAttachedAthenaAuthRouting } from "../../src/auth/resolve-routing.ts";
import { AthenaBillingError } from "../../src/billing/errors.ts";
import { createBrowserBillingTransport } from "../../src/billing/runtime/browser-transport.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import {
  type AthenaRuntimeDiscoveryDocument,
  parseAthenaRuntimeDiscoveryDocument,
} from "../../src/gateway/discovery-types.ts";
import { ATHENA_NEXT_RUNTIME_PROTOCOL } from "../../src/gateway/protocol.ts";
import type { AthenaGatewayCallOptions } from "../../src/gateway/types.ts";
import {
  createClient as createNextClient,
  resetAthenaDiscoverySessionCache,
} from "../../src/next/client.ts";
import {
  createAthenaNextHandler,
  createAthenaNextHandlers,
} from "../../src/next/data-handlers.ts";
import { topologyFromDiscoveryDocument } from "../../src/next/topology.ts";
import { serializeAthenaNextRuntimeDiscoveryDocument } from "../../src/runtime/data/discovery-document.ts";
import { compileDiscoveryToTransportTopology } from "../../src/runtime/transport/compiler.ts";
import { executeAthenaHttpTransport } from "../../src/runtime/transport/http/client.ts";
import type { AthenaHttpTransportIR } from "../../src/runtime/transport/http/ir.ts";
import type { AthenaRuntimeTopologyIR } from "../../src/runtime/transport/topology.ts";
import { createBrowserStorageTransport } from "../../src/storage/runtime/browser-transport.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const srcRoot = join(pkgRoot, "src");
const transportRoot = join(srcRoot, "runtime", "transport");

const TRANSPORT_FILES = [
  "domain.ts",
  "ir.ts",
  "invocation.ts",
  "topology.ts",
  "error-envelope.ts",
  "compiler.ts",
  "parser.ts",
  "index.ts",
  join("http", "ir.ts"),
  join("http", "url.ts"),
  join("http", "request-compiler.ts"),
  join("http", "response-parser.ts"),
  join("http", "client.ts"),
  join("direct", "ir.ts"),
] as const;

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

function joinedTransportSources(): string {
  return collectTsFiles(transportRoot)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function nextLocalDocument(
  overrides?: Partial<AthenaRuntimeDiscoveryDocument> & {
    endpoints?: AthenaRuntimeDiscoveryDocument["endpoints"];
    capabilities?: Partial<AthenaRuntimeDiscoveryDocument["capabilities"]>;
  }
): AthenaRuntimeDiscoveryDocument {
  return {
    athena: true,
    capabilities: {
      auth: { available: true, transport: "same-origin" },
      billing: false,
      data: true,
      delete: true,
      fetch: true,
      insert: true,
      models: "off",
      nestedRelations: false,
      policy: false,
      rawSql: false,
      rpc: false,
      storage: false,
      update: true,
      ...overrides?.capabilities,
    },
    endpoints: {
      auth: "/api/auth",
      data: "/api/athena",
      ...overrides?.endpoints,
    },
    protocol: { major: 1, minor: 1 },
    runtime: "next-local",
    runtimeImplementation: "athena-js",
    ...overrides,
  };
}

test("ACT-TIR-DIR: src/runtime/transport module files exist", () => {
  assert.equal(existsSync(transportRoot), true, "src/runtime/transport/");
  for (const file of TRANSPORT_FILES) {
    assert.equal(
      existsSync(join(transportRoot, file)),
      true,
      `src/runtime/transport/${file}`
    );
  }
});

test("ACT-TIR-EXPORT: package.json does not export ./transport", () => {
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as { exports?: Record<string, unknown> };
  assert.equal(pkg.exports?.["./transport"], undefined);
  assert.equal(
    Object.keys(pkg.exports ?? {}).some((key) => key.includes("transport")),
    false
  );
});

test("ACT-TIR-UNION: AthenaTransportIR is http | direct only", () => {
  const sources = joinedTransportSources();
  assert.match(sources, /kind:\s*"http"/);
  assert.match(sources, /kind:\s*"direct"/);
  assert.doesNotMatch(sources, /AthenaBindingTransportIR/);
  assert.doesNotMatch(sources, /AthenaWorkerTransportIR/);
  assert.doesNotMatch(sources, /kind:\s*"binding"/);
  assert.doesNotMatch(sources, /kind:\s*"worker"/);
});

test("ACT-TIR-SECRETS: transport IR sources do not declare secret fields", () => {
  const sources = joinedTransportSources();
  assert.doesNotMatch(sources, /\bapiKey\b/);
  assert.doesNotMatch(sources, /\bpassword\b/);
  assert.doesNotMatch(sources, /\bjwt\b/i);
  assert.doesNotMatch(sources, /\bliveKey\b/);
  assert.doesNotMatch(sources, /\bsecretAccessKey\b/);
});

test("TIR-002: HTTP method is not on topology IR", () => {
  const topology = readSrc("runtime/transport/topology.ts");
  const httpIr = readSrc("runtime/transport/http/ir.ts");
  assert.doesNotMatch(topology, /method:\s*"GET"/);
  assert.doesNotMatch(topology, /method:\s*"POST"/);
  assert.match(httpIr, /method:/);
});

test("ACT-TIR-TOPOLOGY: Next topology includes storage and billing when advertised", () => {
  const document = nextLocalDocument({
    capabilities: {
      auth: { available: true, transport: "same-origin" },
      billing: true,
      data: true,
      delete: true,
      fetch: true,
      insert: true,
      models: "off",
      nestedRelations: false,
      policy: false,
      rawSql: false,
      rpc: false,
      storage: true,
      update: true,
    },
    endpoints: {
      auth: "/api/auth",
      billing: "/api/athena/billing",
      data: "/api/athena",
      storage: "/api/athena/storage",
    },
  });
  const topology = topologyFromDiscoveryDocument(document, "/api/athena");
  assert.equal(topology.transports.storage?.kind, "http");
  assert.equal(topology.transports.billing?.kind, "http");
  if (topology.transports.storage?.kind === "http") {
    assert.equal(topology.transports.storage.basePath, "/api/athena/storage");
  }
  if (topology.transports.billing?.kind === "http") {
    assert.equal(topology.transports.billing.basePath, "/api/athena/billing");
  }
  assert.equal(topology.auth?.path, "/api/auth");
  assert.equal(topology.data?.path, "/api/athena");
});

test("ACT-TIR-TOPOLOGY-PUBLIC: exported ResolvedNextAthenaTopology omits Transport IR", () => {
  const topology = readSrc("next/topology.ts");
  const client = readSrc("next/client.ts");
  assert.match(
    topology,
    /export type ResolvedNextAthenaTopology = \{\s*auth\?:/
  );
  assert.doesNotMatch(
    topology,
    /export type ResolvedNextAthenaTopology = AthenaRuntimeTopologyIR/
  );
  assert.match(
    topology,
    /export type ResolvedNextAthenaRuntimeTopology = AthenaRuntimeTopologyIR/
  );
  assert.match(
    client,
    /export type \{\s*AthenaNextAdapterConfig,\s*AthenaNextTopologyConfig,\s*ResolvedNextAthenaTopology,\s*\} from "\.\/topology\.ts"/
  );
  assert.doesNotMatch(
    client,
    /export type \{[^}]*ResolvedNextAthenaRuntimeTopology/
  );
});

test("TIR-009: missing storage is undefined on compiled topology, not a guessed path", () => {
  const topology = compileDiscoveryToTransportTopology(
    nextLocalDocument({
      capabilities: {
        auth: { available: false },
        billing: false,
        data: true,
        delete: true,
        fetch: true,
        insert: true,
        models: "off",
        nestedRelations: false,
        policy: false,
        rawSql: false,
        rpc: false,
        storage: false,
        update: true,
      },
      endpoints: { data: "/api/athena" },
    })
  );
  assert.equal(topology.transports.storage, undefined);
  assert.equal(topology.transports.billing, undefined);
  assert.equal(topology.transports.data?.kind, "http");
});

test("ACT-TIR-N1: discovery still serializes endpoints and adds transports at 1.2", () => {
  assert.equal(ATHENA_NEXT_RUNTIME_PROTOCOL.major, 1);
  assert.equal(ATHENA_NEXT_RUNTIME_PROTOCOL.minor, 2);
  const document = serializeAthenaNextRuntimeDiscoveryDocument({
    auth: { available: true, transport: "same-origin" },
    dataRuntime: {
      capabilities: {
        auth: false,
        modelEnforcement: "off",
        nestedRelations: false,
        policies: false,
        rawSql: false,
        rpc: false,
      },
    } as never,
    endpoints: {
      auth: "/api/auth",
      billing: "/api/athena/billing",
      data: "/api/athena",
      storage: "/api/athena/storage",
    },
  });
  assert.equal(document.endpoints?.data, "/api/athena");
  assert.equal(document.endpoints?.storage, "/api/athena/storage");
  assert.equal(document.endpoints?.billing, "/api/athena/billing");
  assert.equal(document.transports?.storage?.kind, "http");
  assert.equal(document.protocol.minor, 2);
});

test("parser prefers transports over legacy endpoints", () => {
  const document = nextLocalDocument({
    capabilities: {
      auth: { available: false },
      billing: false,
      data: true,
      delete: true,
      fetch: true,
      insert: true,
      models: "off",
      nestedRelations: false,
      policy: false,
      rawSql: false,
      rpc: false,
      storage: true,
      update: true,
    },
    endpoints: {
      data: "/api/athena",
      storage: "/legacy/storage",
    },
    protocol: { major: 1, minor: 2 },
    transports: {
      data: {
        credentials: "same-origin",
        kind: "http",
        origin: "same-origin",
        path: "/api/athena",
      },
      storage: {
        credentials: "same-origin",
        kind: "http",
        origin: "same-origin",
        path: "/canonical/storage",
      },
    },
  });
  const topology = compileDiscoveryToTransportTopology(document);
  assert.equal(
    topology.transports.storage && topology.transports.storage.kind === "http"
      ? topology.transports.storage.basePath
      : undefined,
    "/canonical/storage"
  );
});

test("1.2 transports without auth omit topology.auth (no legacy fallback)", () => {
  const document = nextLocalDocument({
    capabilities: {
      auth: { available: true, transport: "remote" },
      billing: false,
      data: true,
      delete: true,
      fetch: true,
      insert: true,
      models: "off",
      nestedRelations: false,
      policy: false,
      rawSql: false,
      rpc: false,
      storage: false,
      update: true,
    },
    endpoints: { data: "/api/athena" },
    protocol: { major: 1, minor: 2 },
    transports: {
      data: {
        credentials: "same-origin",
        kind: "http",
        origin: "same-origin",
        path: "/api/athena",
      },
    },
  });
  const topology = topologyFromDiscoveryDocument(document, "/api/athena");
  assert.equal(topology.auth, undefined);
  assert.equal(topology.transports.auth, undefined);
});

test("createAthenaNextHandlers advertises remote Auth transport from auth.url", async () => {
  const authUrl = "https://auth.example.com/api/auth";
  const ok = async () =>
    ({
      count: null,
      data: [{ id: "remote-auth" }],
      error: null,
      ok: true,
      raw: { data: [{ id: "remote-auth" }] },
      status: 200,
      statusText: "OK",
    }) as never;
  const client = createClient({
    auth: { url: authUrl },
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_handlers",
    gatewayTransport: {
      baseUrl: "https://athena.local/postgres-direct",
      buildHeaders() {
        return {};
      },
      deleteGateway: ok,
      fetchGateway: ok,
      insertGateway: ok,
      queryGateway: ok,
      async resolveCallOptions(options) {
        return options;
      },
      rpcGateway: ok,
      updateGateway: ok,
      async verifyConnection() {
        return { ok: true } as never;
      },
    },
    key: "test-key",
  });
  const handlers = createAthenaNextHandlers({
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const response = await handlers.data.GET(
    new Request("http://localhost/api/athena/capabilities")
  );
  assert.equal(response.ok, true);
  const document = (await response.json()) as AthenaRuntimeDiscoveryDocument;
  assert.equal(document.transports?.auth?.kind, "http");
  assert.equal(document.transports?.auth?.origin, "remote");
  assert.equal(document.transports?.auth?.path, authUrl);
  assert.equal(document.endpoints?.auth, authUrl);
  const topology = topologyFromDiscoveryDocument(document, "/api/athena");
  assert.equal(topology.auth?.transport, "remote");
  assert.equal(topology.auth?.path, authUrl);
});

test("ACT-TIR-EXEC: HTTP executor has no storage/billing browser-transport imports", () => {
  const client = readSrc("runtime/transport/http/client.ts");
  assert.doesNotMatch(client, /storage\/runtime\/browser-transport/);
  assert.doesNotMatch(client, /billing\/runtime\/browser-transport/);
  assert.doesNotMatch(client, /billing\/runtime/);
  assert.doesNotMatch(client, /storage\/runtime/);
});

test("HTTP executor posts JSON envelope and maps error identity", async () => {
  const transport: AthenaHttpTransportIR = {
    basePath: "/api/athena/storage",
    credentials: "same-origin",
    domain: "storage",
    encoding: "json",
    kind: "http",
    origin: "same-origin",
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://localhost/api/athena/storage");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body)) as {
      operation: string;
      payload: { key: string };
    };
    assert.equal(body.operation, "get");
    assert.equal(body.payload.key, "a");
    return new Response(
      JSON.stringify({
        error: { code: "storage_unavailable", message: "down" },
        ok: false,
        status: 503,
      }),
      { status: 503 }
    );
  };
  const result = await executeAthenaHttpTransport({
    fetch: fetchImpl,
    invocation: {
      domain: "storage",
      operation: "get",
      payload: { key: "a" },
    },
    transport,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "storage_unavailable");
    assert.equal(result.error.status, 503);
  }
});

test("HTTP executor preserves explicit null and omitted enveloped success data", async () => {
  const transport: AthenaHttpTransportIR = {
    basePath: "/api/athena/billing",
    credentials: "same-origin",
    domain: "billing",
    encoding: "json",
    kind: "http",
    origin: "same-origin",
  };
  const parse = (json: unknown) =>
    executeAthenaHttpTransport({
      fetch: async () => new Response(JSON.stringify(json), { status: 200 }),
      invocation: {
        domain: "billing",
        operation: "customers.delete",
        payload: {},
      },
      transport,
    });
  const omitted = await parse({ ok: true, status: 200 });
  assert.equal(omitted.ok, true);
  if (omitted.ok) {
    assert.equal(omitted.data, undefined);
  }
  const explicitNull = await parse({ data: null, ok: true, status: 200 });
  assert.equal(explicitNull.ok, true);
  if (explicitNull.ok) {
    assert.equal(explicitNull.data, null);
  }
  const raw = await parse({ id: "unenveloped" });
  assert.equal(raw.ok, true);
  if (raw.ok) {
    assert.deepEqual(raw.data, { id: "unenveloped" });
  }
  const billing = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: async () =>
      new Response(JSON.stringify({ ok: true, status: 200 }), {
        status: 200,
      }),
  });
  assert.equal(await billing.catalog.products.list({} as never), undefined);
});

test("ACT-TIR-STORAGE-FETCH: storage adapter is not a URL framework", () => {
  const source = readSrc("storage/runtime/browser-transport.ts");
  assert.doesNotMatch(source, /function joinPath\(/);
  assert.doesNotMatch(source, /function parseEndpoint\(/);
  assert.doesNotMatch(source, /method:\s*"GET"/);
  assert.match(source, /executeAthenaHttpTransport/);
});

test("ACT-TIR-PROBE: storage does not GET-probe when topology omits storage", async () => {
  const topology: AthenaRuntimeTopologyIR = {
    protocol: { major: 1, minor: 2 },
    transports: {
      data: {
        basePath: "/api/athena",
        credentials: "same-origin",
        domain: "data",
        encoding: "json",
        kind: "http",
        origin: "same-origin",
      },
    },
    version: 1,
  };
  let fetches = 0;
  const provider = createBrowserStorageTransport({
    fetch: async () => {
      fetches += 1;
      return new Response("{}", { status: 200 });
    },
    topology,
  });
  const result = await provider.execute({
    authorized: true,
    key: "k",
    op: "get",
    principal: {
      authenticated: true,
      rights: ["storage.*"],
      userId: "u",
    },
  } as never);
  assert.equal(fetches, 0);
  const unavailable = requireStorageFailure(result);
  assert.equal(unavailable.code, "storage_unavailable");
});

test("ACT-TIR-NEXT-PROPAGATE: Next discovery binds resolved topology into storage/billing transports", () => {
  const nextClient = readSrc("next/client.ts");
  assert.match(
    nextClient,
    /resolveRuntimeTopology:\s*\(\)\s*=>\s*discovered\.resolveTopology\(\)/
  );
  assert.match(nextClient, /type AthenaNextInternalClientConfig/);
  const publicNextConfig = nextClient.slice(
    nextClient.indexOf("export type AthenaBrowserClientConfig"),
    nextClient.indexOf("type AthenaNextInternalClientConfig")
  );
  assert.doesNotMatch(publicNextConfig, /resolveRuntimeTopology/);
  const core = readSrc("v3-client-assembly.ts");
  const publicConfig = core.slice(
    core.indexOf("export interface AthenaClientConfig"),
    core.indexOf("type AthenaInternalClientConfig")
  );
  assert.doesNotMatch(publicConfig, /resolveRuntimeTopology/);
  assert.match(core, /type AthenaInternalClientConfig/);
  assert.match(core, /resolveTopology:\s*core\.config\.resolveRuntimeTopology/);
  assert.match(core, /createBrowserStorageTransport\(/);
  assert.match(core, /createBrowserBillingTransport\(/);
  assert.match(nextClient, /bindAthenaAuthClientBaseUrl\(/);
  assert.match(nextClient, /discoveredAuthBasePath\(/);
  assert.match(nextClient, /ensureAuthTopologyBound/);
  assert.match(nextClient, /wrapAuthOperationsForDiscoveredTopology/);
  assert.match(nextClient, /transports\.auth/);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function requireStorageFailure(result: {
  error?: { code: string; errorNumber: number };
  ok: boolean;
  status: number;
}): { code: string; errorNumber: number; status: number } {
  assert.equal(result.ok, false);
  const error = result.error;
  if (error === undefined) {
    throw new Error("expected result.error on failed storage result");
  }
  return {
    code: error.code,
    errorNumber: error.errorNumber,
    status: result.status,
  };
}

test("discovered same-origin Auth path is bound before getSession", async () => {
  resetAthenaDiscoverySessionCache();
  const urls: string[] = [];
  const document = nextLocalDocument({
    endpoints: { auth: "/api/athena/auth", data: "/api/athena" },
    protocol: { major: 1, minor: 2 },
    transports: {
      auth: {
        credentials: "same-origin",
        kind: "http",
        origin: "same-origin",
        path: "/api/athena/auth",
      },
      data: {
        credentials: "same-origin",
        kind: "http",
        origin: "same-origin",
        path: "/api/athena",
      },
    },
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.includes("/capabilities") || url.includes("/health")) {
      return jsonResponse(document);
    }
    return jsonResponse({ data: null, ok: true });
  };
  try {
    const client = createNextClient({
      topology: { discover: "next", fallback: "error" },
    });
    await client.auth.getSession();
    assert.equal(
      urls.some((url) => url.includes("/api/athena/auth/get-session")),
      true
    );
    assert.equal(
      urls.some((url) => url.includes("/api/auth/get-session")),
      false
    );
    assert.equal(
      getAttachedAthenaAuthRouting(client)?.browserRequestBaseUrl,
      "/api/athena/auth"
    );
  } finally {
    resetAthenaDiscoverySessionCache();
    globalThis.fetch = original;
  }
});

test("ACT-TIR-DATA-GATEWAY: advertised transports.data.path is used for Data gateway", async () => {
  resetAthenaDiscoverySessionCache();
  const probeMount = "/api/athena";
  const advertisedData = "/api/athena/data";
  const document = nextLocalDocument({
    endpoints: { auth: "/api/auth", data: advertisedData },
    protocol: { major: 1, minor: 2 },
    transports: {
      data: {
        credentials: "same-origin",
        kind: "http",
        origin: "same-origin",
        path: advertisedData,
      },
    },
  });
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.includes("/capabilities") || url.includes("/health")) {
      return jsonResponse(document);
    }
    return jsonResponse({ data: [{ id: "1" }], ok: true });
  };
  try {
    const client = createNextClient({
      topology: { discover: "next", fallback: "error" },
    });
    const result = await client.from("users").select();
    assert.equal(result.error, null);
    const dataOps = urls.filter((url) => url.includes("/gateway/fetch"));
    assert.equal(dataOps.length > 0, true);
    assert.equal(
      dataOps.every((url) => url.includes(`${advertisedData}/gateway/fetch`)),
      true
    );
    assert.equal(
      dataOps.some((url) => url.includes(`${probeMount}/gateway/fetch`)),
      false
    );
  } finally {
    resetAthenaDiscoverySessionCache();
    globalThis.fetch = original;
  }
});

test("ACT-TIR-DATA-GATEWAY: session cache restores advertised Data transport", async () => {
  resetAthenaDiscoverySessionCache();
  const advertisedData = "/api/athena/data";
  const document = nextLocalDocument({
    endpoints: { auth: "/api/auth", data: advertisedData },
    protocol: { major: 1, minor: 2 },
    transports: {
      data: {
        credentials: "same-origin",
        kind: "http",
        origin: "same-origin",
        path: advertisedData,
      },
    },
  });
  type SessionStorageStub = {
    getItem(key: string): string | null;
    removeItem(key: string): void;
    setItem(key: string, value: string): void;
  };
  const store = new Map<string, string>();
  const previousStorage = (
    globalThis as { sessionStorage?: SessionStorageStub }
  ).sessionStorage;
  (globalThis as { sessionStorage?: SessionStorageStub }).sessionStorage = {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
  store.set(
    "athena.discovery.v1:/api/athena:local",
    JSON.stringify({
      endpoint: "/api/athena",
      selected: "local",
      topology: topologyFromDiscoveryDocument(document, "/api/athena"),
    })
  );
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.includes("/capabilities") || url.includes("/health")) {
      return jsonResponse(document);
    }
    return jsonResponse({ data: [{ id: "1" }], ok: true });
  };
  try {
    const restored = createNextClient({
      topology: {
        discover: "next",
        fallback: "error",
        probe: { cache: "session" },
      },
    });
    const result = await restored.from("users").select();
    assert.equal(result.error, null);
    assert.equal(
      urls.some(
        (url) => url.includes("/capabilities") || url.includes("/health")
      ),
      false
    );
    const dataOps = urls.filter((url) => url.includes("/gateway/fetch"));
    assert.equal(
      dataOps.every((url) => url.includes(`${advertisedData}/gateway/fetch`)),
      true
    );
    assert.equal(
      dataOps.some((url) => url.includes("/api/athena/gateway/fetch")),
      false
    );
  } finally {
    resetAthenaDiscoverySessionCache();
    if (previousStorage) {
      (globalThis as { sessionStorage?: SessionStorageStub }).sessionStorage =
        previousStorage;
    } else {
      delete (globalThis as { sessionStorage?: SessionStorageStub })
        .sessionStorage;
    }
    globalThis.fetch = original;
  }
});

test("discovered remote auth.url is bound before getSession", async () => {
  resetAthenaDiscoverySessionCache();
  const authUrl = "https://auth.example.com/api/auth";
  const urls: string[] = [];
  const document = nextLocalDocument({
    capabilities: {
      auth: { available: true, transport: "remote" },
      billing: false,
      data: true,
      delete: true,
      fetch: true,
      insert: true,
      models: "off",
      nestedRelations: false,
      policy: false,
      rawSql: false,
      rpc: false,
      storage: false,
      update: true,
    },
    endpoints: { auth: authUrl, data: "/api/athena" },
    protocol: { major: 1, minor: 2 },
    transports: {
      auth: {
        credentials: "none",
        kind: "http",
        origin: "remote",
        path: authUrl,
      },
      data: {
        credentials: "same-origin",
        kind: "http",
        origin: "same-origin",
        path: "/api/athena",
      },
    },
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    urls.push(url);
    if (url.includes("/capabilities") || url.includes("/health")) {
      return jsonResponse(document);
    }
    return jsonResponse({ data: null, ok: true });
  };
  try {
    const client = createNextClient({
      topology: { discover: "next", fallback: "error" },
    });
    await client.auth.getSession();
    assert.equal(
      urls.some((url) => url.startsWith(`${authUrl}/get-session`)),
      true
    );
    assert.equal(
      urls.some(
        (url) =>
          url.startsWith("/api/auth/") ||
          (url.includes("://localhost") && url.includes("/api/auth/"))
      ),
      false
    );
    assert.equal(
      getAttachedAthenaAuthRouting(client)?.browserRequestBaseUrl,
      authUrl
    );
  } finally {
    resetAthenaDiscoverySessionCache();
    globalThis.fetch = original;
  }
});

test("discovered same-origin Auth path is bound before first ok and signIn", async () => {
  interface DiscoveredAuthClient {
    auth: {
      ok: () => Promise<unknown>;
      signIn: {
        email: (input: { email: string; password: string }) => Promise<unknown>;
      };
    };
  }

  async function runFirstAuthOperation(
    operation: (client: DiscoveredAuthClient) => Promise<unknown>,
    discoveredSubstring: string,
    legacySubstring: string
  ) {
    resetAthenaDiscoverySessionCache();
    const urls: string[] = [];
    const document = nextLocalDocument({
      endpoints: { auth: "/api/athena/auth", data: "/api/athena" },
      protocol: { major: 1, minor: 2 },
      transports: {
        auth: {
          credentials: "same-origin",
          kind: "http",
          origin: "same-origin",
          path: "/api/athena/auth",
        },
        data: {
          credentials: "same-origin",
          kind: "http",
          origin: "same-origin",
          path: "/api/athena",
        },
      },
    });
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = requestUrl(input);
      urls.push(url);
      if (url.includes("/capabilities") || url.includes("/health")) {
        return jsonResponse(document);
      }
      return jsonResponse({ data: null, ok: true });
    };
    try {
      const client = createNextClient({
        topology: { discover: "next", fallback: "error" },
      });
      await operation(client);
      assert.equal(
        urls.some((url) => url.includes(discoveredSubstring)),
        true
      );
      assert.equal(
        urls.some((url) => url.includes(legacySubstring)),
        false
      );
    } finally {
      resetAthenaDiscoverySessionCache();
      globalThis.fetch = original;
    }
  }

  await runFirstAuthOperation(
    (client) => client.auth.ok(),
    "/api/athena/auth/ok",
    "/api/auth/ok"
  );
  await runFirstAuthOperation(
    (client) =>
      client.auth.signIn.email({
        email: "user@example.com",
        password: "secret",
      }),
    "/api/athena/auth/sign-in/email",
    "/api/auth/sign-in/email"
  );
});

test("ACT-TIR-RESOLVE-TOPOLOGY: advertised storage/billing paths win over defaults", async () => {
  const topology: AthenaRuntimeTopologyIR = {
    protocol: { major: 1, minor: 2 },
    transports: {
      billing: {
        basePath: "/custom/billing",
        credentials: "same-origin",
        domain: "billing",
        encoding: "json",
        kind: "http",
        origin: "same-origin",
      },
      data: {
        basePath: "/api/athena",
        credentials: "same-origin",
        domain: "data",
        encoding: "json",
        kind: "http",
        origin: "same-origin",
      },
      storage: {
        basePath: "/custom/storage",
        credentials: "same-origin",
        domain: "storage",
        encoding: "json",
        kind: "http",
        origin: "same-origin",
      },
    },
    version: 1,
  };
  const posted: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    posted.push(String(input instanceof Request ? input.url : input));
    return new Response(JSON.stringify({ data: { key: "k" }, ok: true }), {
      status: 200,
    });
  };
  const resolveTopology = async () => topology;
  const provider = createBrowserStorageTransport({
    fetch: fetchImpl,
    resolveTopology,
  });
  const storageResult = await provider.execute({
    authorized: true,
    key: "k",
    op: "get",
    principal: {
      authenticated: true,
      rights: ["storage.*"],
      userId: "u",
    },
  } as never);
  assert.equal(storageResult.ok, true);
  const billing = createBrowserBillingTransport({
    fetch: fetchImpl,
    resolveTopology,
  });
  await billing.catalog.products.list({} as never);
  assert.equal(
    posted.some((url) => url.includes("/custom/storage")),
    true
  );
  assert.equal(
    posted.some((url) => url.includes("/custom/billing")),
    true
  );
  assert.equal(
    posted.some((url) => url.includes("/api/athena/storage")),
    false
  );
  assert.equal(
    posted.some((url) => url.includes("/api/athena/billing")),
    false
  );
});

test("ACT-TIR-BILLING-ERROR: billing HTTP failures keep machine-readable code", async () => {
  const source = readSrc("billing/runtime/browser-transport.ts");
  assert.doesNotMatch(source, /throw new Error\(/);
  assert.doesNotMatch(source, /function joinPath\(/);
  assert.doesNotMatch(source, /function parseEndpoint\(/);
  assert.doesNotMatch(source, /method:\s*"GET"/);

  const billing = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "ATHENA_BILLING_AUTHORIZATION_DENIED",
            message: "nope",
          },
          ok: false,
          status: 403,
        }),
        { status: 403 }
      ),
  });
  try {
    await billing.catalog.products.list({} as never);
    assert.fail("expected typed billing error");
  } catch (error) {
    assert.equal(error instanceof AthenaBillingError, true);
    assert.equal(
      (error as AthenaBillingError).code,
      "ATHENA_BILLING_AUTHORIZATION_DENIED"
    );
    assert.equal((error as AthenaBillingError).status, 403);
  }
});

test("ACT-TIR-BILLING-DISCOVERY-ORIGIN: absolute discovery billing URLs stay same-origin", async () => {
  const posted: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    posted.push(String(input instanceof Request ? input.url : input));
    return new Response(JSON.stringify({ ok: true, status: 200 }), {
      status: 200,
    });
  };
  const topology: AthenaRuntimeTopologyIR = {
    protocol: { major: 1, minor: 2 },
    transports: {
      billing: {
        basePath: "https://evil.example/steal",
        credentials: "same-origin",
        domain: "billing",
        encoding: "json",
        kind: "http",
        origin: "remote",
      },
    },
    version: 1,
  };
  const fromTopology = createBrowserBillingTransport({
    fetch: fetchImpl,
    topology,
  });
  await fromTopology.catalog.products.list({} as never);
  const fromEndpoint = createBrowserBillingTransport({
    endpoints: { billing: "https://evil.example/steal" },
    fetch: fetchImpl,
  });
  await fromEndpoint.catalog.products.list({} as never);
  assert.equal(
    posted.some((url) => url.includes("evil.example")),
    false
  );
  assert.equal(
    posted.some((url) => url.includes("/api/athena/billing")),
    true
  );
});

test("ACT-TIR-STORAGE-ERROR: storage HTTP failures keep wire errorNumber", async () => {
  const provider = createBrowserStorageTransport({
    endpoints: { storage: "/api/athena/storage" },
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "storage_file_not_found",
            errorNumber: 3005,
            message: "missing",
          },
          ok: false,
          status: 404,
        }),
        { status: 404 }
      ),
  });
  const result = await provider.execute({
    authorized: true,
    key: "missing.bin",
    op: "get",
    principal: {
      authenticated: true,
      rights: ["storage.*"],
      userId: "u",
    },
  } as never);
  const failure = requireStorageFailure(result);
  assert.equal(failure.code, "storage_file_not_found");
  assert.equal(failure.errorNumber, 3005);
  assert.equal(failure.status, 404);
});

test("ACT-TIR-STORAGE-ERROR: generic transport HTTP codes map to storage status codes", async () => {
  const cases = [
    {
      body: "",
      code: "storage_unauthenticated",
      errorNumber: 3003,
      status: 401,
    },
    {
      body: JSON.stringify({ error: { message: "denied" }, ok: false }),
      code: "storage_authorization_denied",
      errorNumber: 3003,
      status: 403,
    },
    {
      body: "upstream unavailable",
      code: "storage_unavailable",
      errorNumber: 3007,
      status: 503,
    },
  ] as const;
  for (const fixture of cases) {
    const provider = createBrowserStorageTransport({
      endpoints: { storage: "/api/athena/storage" },
      fetch: async () => new Response(fixture.body, { status: fixture.status }),
    });
    const result = await provider.execute({
      authorized: true,
      key: "secret.bin",
      op: "get",
      principal: {
        authenticated: true,
        rights: ["storage.*"],
        userId: "u",
      },
    } as never);
    const failure = requireStorageFailure(result);
    assert.equal(failure.code, fixture.code);
    assert.equal(failure.errorNumber, fixture.errorNumber);
    assert.equal(failure.status, fixture.status);
  }
});

test("ACT-TIR-STORAGE-ERROR: generic HTTP status mapping lives only in the legacy projector", () => {
  const source = readSrc("storage/runtime/browser-transport.ts");
  assert.match(source, /export function hasAuthoritativeStorageWireError/);
  assert.match(source, /export function projectStorageWireError/);
  assert.match(source, /export function projectLegacyGenericStorageHttpError/);
  const start = source.indexOf(
    "export function projectLegacyGenericStorageHttpError"
  );
  const end = source.indexOf("function mapStorageHttpFailure");
  const projector = source.slice(start, end);
  const rest = `${source.slice(0, start)}${source.slice(end)}`;
  assert.match(projector, /status === 401 \|\| status === 403/);
  assert.equal(rest.includes("status === 401 || status === 403"), false);
});

test("ACT-TIR-ENVELOPE: HTTP failures lift errorNumber, requestId, and wire retryable", async () => {
  const { parseAthenaHttpTransportResponse } = await import(
    "../../src/runtime/transport/http/response-parser.ts"
  );
  const headers = new Headers({
    "x-athena-request-id": "req_transport_1",
  });
  const result = parseAthenaHttpTransportResponse({
    headers,
    json: {
      error: {
        code: "storage_file_not_found",
        errorNumber: 3005,
        message: "missing",
        retryable: false,
      },
      ok: false,
      status: 404,
    },
    status: 404,
    statusText: "Not Found",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "storage_file_not_found");
    assert.equal(result.error.errorNumber, 3005);
    assert.equal(result.error.requestId, "req_transport_1");
    assert.equal(result.error.retryable, false);
    assert.equal(result.error.status, 404);
  }
});

test("createAthenaNextHandler routes storage, billing, and unified auth under /api/athena", async () => {
  assert.match(
    readSrc("next/data-handlers.ts"),
    /export function createAthenaNextHandler\(/
  );
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  const authPath = async (request: Request) =>
    json({ path: new URL(request.url).pathname, route: "auth" });
  const handler = createAthenaNextHandler({
    handlers: {
      auth: {
        DELETE: authPath,
        GET: authPath,
        HEAD: authPath,
        OPTIONS: authPath,
        POST: authPath,
        PUT: authPath,
      },
      billing: {
        GET: async () => json({ route: "billing" }),
        POST: async () => json({ route: "billing" }),
      },
      billingIngress: {
        POST: async () => json({ route: "billingIngress" }),
      },
      data: {
        DELETE: async () => json({ route: "data" }),
        GET: async () => json({ route: "data" }),
        PATCH: async () => json({ route: "data" }),
        POST: async () => json({ route: "data" }),
      },
      storage: {
        GET: async () => json({ route: "storage" }),
        POST: async () => json({ route: "storage" }),
      },
    },
  });
  const storage = await handler.POST(
    new Request("http://localhost/api/athena/storage", { method: "POST" })
  );
  const billing = await handler.POST(
    new Request("http://localhost/api/athena/billing", { method: "POST" })
  );
  const billingIngress = await handler.POST(
    new Request("http://localhost/api/athena/billing/webhook", {
      method: "POST",
    })
  );
  const classicIngress = await handler.POST(
    new Request("http://localhost/api/athena/billing/webhook/mollie/classic", {
      method: "POST",
    })
  );
  const eventsIngress = await handler.POST(
    new Request("http://localhost/api/athena/billing/webhook/mollie/events", {
      method: "POST",
    })
  );
  const data = await handler.GET(new Request("http://localhost/api/athena"));
  const unifiedAuth = await handler.GET(
    new Request("http://localhost/api/athena/auth/get-session")
  );
  const unifiedAuthOptions = await handler.OPTIONS(
    new Request("http://localhost/api/athena/auth/get-session", {
      method: "OPTIONS",
    })
  );
  const unifiedAuthHead = await handler.HEAD(
    new Request("http://localhost/api/athena/auth/ok", {
      method: "HEAD",
    })
  );
  const unifiedAuthPut = await handler.PUT(
    new Request("http://localhost/api/athena/auth/ok", {
      method: "PUT",
    })
  );
  const legacyAuth = await handler.GET(
    new Request("http://localhost/api/auth/get-session")
  );
  assert.deepEqual(await storage.json(), { route: "storage" });
  assert.deepEqual(await billing.json(), { route: "billing" });
  assert.deepEqual(await billingIngress.json(), { route: "billingIngress" });
  assert.deepEqual(await classicIngress.json(), { route: "billingIngress" });
  assert.deepEqual(await eventsIngress.json(), { route: "billingIngress" });
  assert.deepEqual(await data.json(), { route: "data" });
  assert.deepEqual(await unifiedAuth.json(), {
    path: "/api/auth/get-session",
    route: "auth",
  });
  assert.deepEqual(await unifiedAuthOptions.json(), {
    path: "/api/auth/get-session",
    route: "auth",
  });
  assert.deepEqual(await unifiedAuthHead.json(), {
    path: "/api/auth/ok",
    route: "auth",
  });
  assert.deepEqual(await unifiedAuthPut.json(), {
    path: "/api/auth/ok",
    route: "auth",
  });
  assert.deepEqual(await legacyAuth.json(), {
    path: "/api/auth/get-session",
    route: "auth",
  });
});

function mockGatewayOk(): AthenaGatewayClient {
  const ok = async <T>() =>
    ({
      count: null,
      data: [{ id: "ok" }],
      error: null,
      ok: true,
      raw: { data: [{ id: "ok" }] },
      status: 200,
      statusText: "OK",
    }) as T;
  return {
    baseUrl: "https://athena.local/postgres-direct",
    buildHeaders() {
      return {};
    },
    deleteGateway: ok,
    fetchGateway: ok,
    insertGateway: ok,
    queryGateway: ok,
    async resolveCallOptions(
      options?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayCallOptions | undefined> {
      return options;
    },
    rpcGateway: ok,
    updateGateway: ok,
    async verifyConnection() {
      return { ok: true } as never;
    },
  };
}

test("createAthenaNextHandler advertises same-origin Auth at /api/athena/auth", async () => {
  const client = createClient({
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_handlers",
    env: {},
    gatewayTransport: mockGatewayOk(),
    key: "test-key",
  });
  try {
    const handler = createAthenaNextHandler({
      client,
      security: { mode: "trusted" },
      unsafeAllowUnauthenticated: true,
    });
    const response = await handler.GET(
      new Request("http://localhost/api/athena/capabilities")
    );
    assert.equal(response.ok, true);
    const document = (await response.json()) as AthenaRuntimeDiscoveryDocument;
    assert.equal(document.endpoints?.auth, "/api/athena/auth");
    assert.equal(document.transports?.auth?.path, "/api/athena/auth");
    assert.equal(document.transports?.auth?.origin, "same-origin");
    const split = createAthenaNextHandlers({
      client,
      security: { mode: "trusted" },
      unsafeAllowUnauthenticated: true,
    });
    const splitResponse = await split.data.GET(
      new Request("http://localhost/api/athena/capabilities")
    );
    const splitDocument =
      (await splitResponse.json()) as AthenaRuntimeDiscoveryDocument;
    assert.equal(splitDocument.endpoints?.auth, "/api/auth");
    assert.equal(splitDocument.transports?.auth?.path, "/api/auth");
  } finally {
    void client.close();
  }
});

test("createAthenaNextHandler rewrites prebuilt handler discovery to /api/athena/auth", async () => {
  const client = createClient({
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_handlers",
    env: {},
    gatewayTransport: mockGatewayOk(),
    key: "test-key",
  });
  try {
    const handler = createAthenaNextHandler({
      handlers: createAthenaNextHandlers({
        client,
        security: { mode: "trusted" },
        unsafeAllowUnauthenticated: true,
      }),
    });
    const response = await handler.GET(
      new Request("http://localhost/api/athena/capabilities")
    );
    assert.equal(response.ok, true);
    const document = (await response.json()) as AthenaRuntimeDiscoveryDocument;
    assert.equal(document.endpoints?.auth, "/api/athena/auth");
    assert.equal(document.transports?.auth?.path, "/api/athena/auth");
    assert.equal(document.transports?.auth?.origin, "same-origin");
  } finally {
    void client.close();
  }
});

test("createAthenaNextHandler keeps remote Auth URL for prebuilt handlers", async () => {
  const authUrl = "https://auth.example.com/api/auth";
  const client = createClient({
    auth: { url: authUrl },
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_handlers",
    gatewayTransport: mockGatewayOk(),
    key: "test-key",
  });
  try {
    const handler = createAthenaNextHandler({
      handlers: createAthenaNextHandlers({
        client,
        security: { mode: "trusted" },
        unsafeAllowUnauthenticated: true,
      }),
    });
    const response = await handler.GET(
      new Request("http://localhost/api/athena/capabilities")
    );
    const document = (await response.json()) as AthenaRuntimeDiscoveryDocument;
    assert.equal(document.endpoints?.auth, authUrl);
    assert.equal(document.transports?.auth?.path, authUrl);
    assert.equal(document.transports?.auth?.origin, "remote");
  } finally {
    void client.close();
  }
});

test("createAthenaNextHandler keeps remote Auth URL in discovery", async () => {
  const authUrl = "https://auth.example.com/api/auth";
  const client = createClient({
    auth: { url: authUrl },
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_handlers",
    gatewayTransport: mockGatewayOk(),
    key: "test-key",
  });
  try {
    const handler = createAthenaNextHandler({
      client,
      security: { mode: "trusted" },
      unsafeAllowUnauthenticated: true,
    });
    const response = await handler.GET(
      new Request("http://localhost/api/athena/capabilities")
    );
    const document = (await response.json()) as AthenaRuntimeDiscoveryDocument;
    assert.equal(document.endpoints?.auth, authUrl);
    assert.equal(document.transports?.auth?.path, authUrl);
    assert.equal(document.transports?.auth?.origin, "remote");
  } finally {
    void client.close();
  }
});

test("ACT-TIR-CTOR: no createStorageClient / createBillingClient / public transport barrel", () => {
  const index = readFileSync(join(srcRoot, "index.ts"), "utf8");
  assert.doesNotMatch(index, /createStorageClient/);
  assert.doesNotMatch(index, /createBillingClient/);
  assert.doesNotMatch(index, /createPolicyClient/);
  const sessionCache = readSrc("next/topology.ts");
  assert.match(sessionCache, /topology\?:/);
});

test("ACT-TIR-ROUTE-SURFACE: unified dispatch uses finite AthenaRouteSurface", () => {
  const source = readSrc("next/data-handlers.ts");
  assert.match(source, /type AthenaRouteSurface = \{/);
  assert.match(
    source,
    /function invokeRouteHandler\(\s*surface: AthenaRouteSurface/
  );
  assert.doesNotMatch(source, /invokeRouteHandler\(\s*surface: Record<string/);
});

test("ACT-TIR-RPC: Storage/Billing compiler is compileAthenaRpcHttpRequest POST envelope", () => {
  const compiler = readSrc("runtime/transport/http/request-compiler.ts");
  const httpIr = readSrc("runtime/transport/http/ir.ts");
  assert.match(compiler, /export function compileAthenaRpcHttpRequest\(/);
  assert.match(compiler, /method:\s*"POST"/);
  assert.match(compiler, /operation:\s*input\.invocation\.operation/);
  assert.match(httpIr, /"HEAD"/);
  assert.match(httpIr, /"OPTIONS"/);
  assert.match(httpIr, /"PUT"/);
  assert.doesNotMatch(httpIr, /"bearer"/);
});

test("parseAthenaRuntimeDiscoveryDocument aliases Fetch omit/include credentials", () => {
  const parsed = parseAthenaRuntimeDiscoveryDocument({
    ...nextLocalDocument({
      protocol: { major: 1, minor: 2 },
    }),
    transports: {
      auth: {
        credentials: "include",
        kind: "http",
        path: "/api/auth",
      },
      data: {
        credentials: "omit",
        kind: "http",
        path: "/api/athena",
      },
    },
  } as unknown);
  assert.ok(parsed);
  assert.equal(parsed.transports?.data?.credentials, "none");
  assert.equal(parsed.transports?.auth?.credentials, "same-origin");
});

test("ACT-TIR-CREDENTIALS: advertised bearer is stripped, not executed", () => {
  const discovery = readSrc("gateway/discovery-types.ts");
  const parser = readSrc("runtime/transport/parser.ts");
  assert.match(discovery, /credentials\?:\s*"none"\s*\|\s*"same-origin"/);
  assert.doesNotMatch(
    discovery,
    /credentials\?:\s*"none"\s*\|\s*"same-origin"\s*\|\s*"bearer"/
  );
  assert.match(parser, /record\.credentials === "same-origin"/);
  assert.doesNotMatch(parser, /record\.credentials === "bearer"/);
});

test("ADR 0059 documents HTTP consolidation and Direct vocabulary", () => {
  const adr = readFileSync(
    join(
      repoRoot,
      "docs",
      "adr",
      "technical",
      "0059-athena-js-transport-ir.md"
    ),
    "utf8"
  );
  assert.match(adr, /HTTP consolidation/);
  assert.match(adr, /Direct IR vocabulary/);
  assert.match(adr, /compileAthenaRpcHttpRequest/);
});

test("ADR 0059 and package companion exist", () => {
  assert.equal(
    existsSync(
      join(
        repoRoot,
        "docs",
        "adr",
        "technical",
        "0059-athena-js-transport-ir.md"
      )
    ),
    true
  );
  assert.equal(
    existsSync(join(pkgRoot, "docs", "adr", "0030-transport-ir.md")),
    true
  );
});

test("runtime barrel does not re-export transport as public API", async () => {
  const runtimeBarrel = await import(
    pathToFileURL(join(srcRoot, "runtime", "index.ts")).href
  );
  assert.equal("compileDiscoveryToTransportTopology" in runtimeBarrel, false);
  assert.equal("createAthenaHttpTransportExecutor" in runtimeBarrel, false);
});
