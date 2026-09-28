import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import type { AthenaRuntimeDiscoveryDocument } from "../src/gateway/discovery-types.ts";
import {
  createClient,
  resetAthenaDiscoverySessionCache,
} from "../src/next/client.ts";

const document: AthenaRuntimeDiscoveryDocument = {
  athena: true,
  capabilities: {
    auth: { available: true, transport: "same-origin" },
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
  endpoints: {
    auth: "/api/auth",
    data: "/api/athena",
  },
  protocol: { major: 1, minor: 2 },
  runtime: "next-local",
  runtimeImplementation: "athena-js",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function isDiscoveryRequest(input: RequestInfo | URL): boolean {
  const url = String(input);
  return url.endsWith("/capabilities") || url.endsWith("/health");
}

test("Next discovery session cache evicts failed selections for later clients", async () => {
  resetAthenaDiscoverySessionCache();
  const originalFetch = globalThis.fetch;
  let available = false;
  let probes = 0;
  globalThis.fetch = async (input) => {
    if (isDiscoveryRequest(input)) {
      probes += 1;
      return available ? jsonResponse(document) : new Response("missing", { status: 404 });
    }
    return jsonResponse({ data: [{ id: "recovered" }], ok: true });
  };

  try {
    const first = createClient({
      topology: {
        discover: "next",
        fallback: "error",
        probe: { cache: "session" },
      },
    });
    const unavailable = await first.from("users").select();
    assert.equal(unavailable.error?.code, "ATHENA_DISCOVERY_UNAVAILABLE");

    available = true;
    const recovered = createClient({
      topology: {
        discover: "next",
        fallback: "error",
        probe: { cache: "session" },
      },
    });
    const result = await recovered.from("users").select();
    assert.equal(result.error, null);
    assert.equal(probes, 3);
  } finally {
    resetAthenaDiscoverySessionCache();
    globalThis.fetch = originalFetch;
  }
});

test("Next discovery client-lifetime cache retries after an unavailable probe", async () => {
  const originalFetch = globalThis.fetch;
  let available = false;
  globalThis.fetch = async (input) => {
    if (isDiscoveryRequest(input)) {
      return available ? jsonResponse(document) : new Response("missing", { status: 404 });
    }
    return jsonResponse({ data: [{ id: "recovered" }], ok: true });
  };

  try {
    const client = createClient({
      topology: { discover: "next", fallback: "error" },
    });
    const unavailable = await client.from("users").select();
    assert.equal(unavailable.error?.code, "ATHENA_DISCOVERY_UNAVAILABLE");

    available = true;
    const result = await client.from("users").select();
    assert.equal(result.error, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Next discovery removes malformed session selections before probing", async () => {
  resetAthenaDiscoverySessionCache();
  const originalFetch = globalThis.fetch;
  const originalStorage = (
    globalThis as {
      sessionStorage?: {
        getItem(key: string): string | null;
        removeItem(key: string): void;
        setItem(key: string, value: string): void;
      };
    }
  ).sessionStorage;
  const store = new Map<string, string>([
    [
      "athena.discovery.v1:/api/athena:local",
      JSON.stringify({
        selected: "local",
        topology: {
          protocol: { major: 1, minor: 2 },
          transports: {},
          version: 1,
        },
      }),
    ],
  ]);
  let cacheWasPurged = false;
  (globalThis as { sessionStorage?: typeof originalStorage }).sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
  globalThis.fetch = async (input) => {
    if (isDiscoveryRequest(input)) {
      cacheWasPurged = !store.has("athena.discovery.v1:/api/athena:local");
      return jsonResponse(document);
    }
    return jsonResponse({ data: [{ id: "recovered" }], ok: true });
  };

  try {
    const client = createClient({
      topology: {
        discover: "next",
        fallback: "error",
        probe: { cache: "session" },
      },
    });
    const result = await client.from("users").select();
    assert.equal(result.error, null);
    assert.equal(cacheWasPurged, true);
  } finally {
    resetAthenaDiscoverySessionCache();
    globalThis.fetch = originalFetch;
    if (originalStorage) {
      (globalThis as { sessionStorage?: typeof originalStorage }).sessionStorage =
        originalStorage;
    } else {
      delete (globalThis as { sessionStorage?: typeof originalStorage }).sessionStorage;
    }
  }
});

test("Next Auth discovery retries after an unavailable topology", async () => {
  const originalFetch = globalThis.fetch;
  let available = false;
  const authUrls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (isDiscoveryRequest(input)) {
      return available ? jsonResponse(document) : new Response("missing", { status: 404 });
    }
    authUrls.push(url);
    return jsonResponse({ data: null, ok: true });
  };

  try {
    const client = createClient({
      topology: { discover: "next", fallback: "error" },
    });
    const unavailable = await client.auth.ok();
    assert.equal(unavailable.error, "ATHENA_AUTH_NOT_AVAILABLE");

    available = true;
    const recovered = await client.auth.ok();
    assert.equal(recovered.error, null);
    assert.equal(
      authUrls.some((url) => url.includes("/api/auth/ok")),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
