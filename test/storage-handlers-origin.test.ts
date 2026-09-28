import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../src/auth/contract/index.ts";
import type { AthenaGatewayClient } from "../src/gateway/client.ts";
import type { AthenaRuntimeDiscoveryDocument } from "../src/gateway/discovery-types.ts";
import { createAthenaStorageHandlers } from "../src/next/storage-handlers.ts";
import type { AthenaRuntimeSessionLookup } from "../src/runtime/data/principal.ts";
import {
  bindStorageProvider,
  bindStorageRuntime,
  createStorageRuntime,
} from "../src/storage/runtime/index.ts";
import type {
  AuthorizedStorageOperation,
  StorageObjectProvider,
  StorageObjectResult,
} from "../src/storage/runtime/types.ts";
import { createClient } from "../src/v3-client.ts";

const DISCOVERY: AthenaRuntimeDiscoveryDocument = {
  athena: true,
  capabilities: {
    auth: { available: false },
    delete: true,
    fetch: true,
    insert: true,
    models: "off",
    nestedRelations: false,
    policy: false,
    rawSql: false,
    rpc: false,
    update: true,
  },
  endpoints: {
    data: "/api/athena",
    storage: "/api/athena/storage",
  },
  protocol: { major: 1, minor: 1 },
  runtime: "next-local",
  runtimeImplementation: "athena-js",
};

const CROSS_ORIGIN_DENIED = "cross-origin storage request denied";

function mockTransport(): AthenaGatewayClient {
  const ok = async () =>
    ({
      count: null,
      data: [],
      error: null,
      ok: true,
      raw: { data: [] },
      status: 200,
      statusText: "OK",
    }) as never;
  return {
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
  };
}

function recordingProvider(): StorageObjectProvider & {
  calls: AuthorizedStorageOperation[];
} {
  const calls: AuthorizedStorageOperation[] = [];
  return {
    calls,
    async execute(op: AuthorizedStorageOperation) {
      calls.push(op);
      return { data: { key: op.key, op: op.op }, ok: true, status: 200 };
    },
  };
}

function sessionFor(
  rights: readonly string[]
): AthenaRuntimeSessionLookup {
  return {
    session: { id: "session-storage-origin", userId: "user-storage-origin" },
    user: { id: "user-storage-origin", rights: [...rights] },
  };
}

function cookie(token: string): string {
  return `${ATHENA_AUTH_SESSION_COOKIE_NAME}=${token}`;
}

function createStorageClient(input?: {
  appUrl?: string;
  provider?: StorageObjectProvider;
}) {
  const provider = input?.provider ?? recordingProvider();
  const runtime = createStorageRuntime({ provider });
  const client = createClient({
    ...(input?.appUrl ? { app: { url: input.appUrl } } : {}),
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_origin",
    gatewayTransport: mockTransport(),
    storage: bindStorageRuntime(bindStorageProvider({}, provider), runtime),
  });
  return { client, provider, runtime };
}

function handlers(input?: {
  appUrl?: string;
  allowedOrigins?: readonly string[];
  mode?: "trusted" | "authenticated";
  provider?: StorageObjectProvider;
  rights?: readonly string[];
}) {
  const { client, provider } = createStorageClient({
    ...(input?.appUrl ? { appUrl: input.appUrl } : {}),
    ...(input?.provider ? { provider: input.provider } : {}),
  });
  const rights = input?.rights ?? ["storage.list", "storage.get"];
  return {
    client,
    handlers: createAthenaStorageHandlers({
      auth: {
        lookupSession: async (token) =>
          token === "sess_storage" ? sessionFor(rights) : null,
        mode: "athena-session",
      },
      client,
      discoveryDocument: DISCOVERY,
      security: {
        mode: input?.mode ?? "authenticated",
        ...(input?.allowedOrigins
          ? { http: { allowedOrigins: input.allowedOrigins } }
          : {}),
      },
    }),
    provider,
  };
}

async function postJson(
  storage: ReturnType<typeof createAthenaStorageHandlers>,
  input: {
    body?: unknown;
    headers?: Record<string, string>;
    url?: string;
  } = {}
): Promise<{ json: StorageObjectResult; response: Response }> {
  const response = await storage.POST(
    new Request(input.url ?? "http://localhost/api/athena/storage", {
      body: JSON.stringify(
        input.body ?? { operation: "list", payload: { prefix: "avatars/" } }
      ),
      headers: {
        "content-type": "application/json",
        ...input.headers,
      },
      method: "POST",
    })
  );
  const json = (await response.json()) as StorageObjectResult;
  return { json, response };
}

function originDenied(json: StorageObjectResult): boolean {
  return json.error?.message === CROSS_ORIGIN_DENIED;
}

test("storage POST allows same-origin Origin", async () => {
  const { handlers: storage, provider } = handlers();
  const { json, response } = await postJson(storage, {
    headers: {
      cookie: cookie("sess_storage"),
      origin: "http://localhost",
    },
  });
  assert.equal(originDenied(json), false);
  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(provider.calls.length, 1);
});

test("storage POST allows configured security.http.allowedOrigins", async () => {
  const publicOrigin = "https://files.example.test";
  const { handlers: storage } = handlers({
    allowedOrigins: [publicOrigin],
  });
  const allowed = await postJson(storage, {
    headers: {
      cookie: cookie("sess_storage"),
      origin: publicOrigin,
    },
    url: "http://localhost:3010/api/athena/storage",
  });
  assert.equal(originDenied(allowed.json), false);
  assert.equal(allowed.json.ok, true);
});

test("storage POST allows client app.url as an extra origin", async () => {
  const publicOrigin = "https://app.example.test";
  const denied = await postJson(handlers().handlers, {
    headers: { origin: publicOrigin },
    url: "http://localhost:3010/api/athena/storage",
  });
  assert.equal(denied.response.status, 403);
  assert.equal(originDenied(denied.json), true);

  const allowed = await postJson(handlers({ appUrl: publicOrigin }).handlers, {
    headers: {
      cookie: cookie("sess_storage"),
      origin: publicOrigin,
    },
    url: "http://localhost:3010/api/athena/storage",
  });
  assert.equal(originDenied(allowed.json), false);
  assert.equal(allowed.json.ok, true);
});

test("storage POST rejects a foreign Origin", async () => {
  const { json, response } = await postJson(handlers().handlers, {
    headers: { origin: "https://evil.example" },
  });
  assert.equal(response.status, 403);
  assert.equal(originDenied(json), true);
});

test("storage GET without Origin is allowed on the object path", async () => {
  const { handlers: storage } = handlers();
  const response = await storage.GET(
    new Request("http://localhost/api/athena/storage?key=avatar.png")
  );
  assert.notEqual(response.status, 403);
  const json = (await response.json()) as StorageObjectResult;
  assert.equal(originDenied(json), false);
});

test("storage GET with a foreign Origin is rejected", async () => {
  const { handlers: storage } = handlers();
  const response = await storage.GET(
    new Request("http://localhost/api/athena/storage?key=avatar.png", {
      headers: { origin: "https://evil.example" },
    })
  );
  const json = (await response.json()) as StorageObjectResult;
  assert.equal(response.status, 403);
  assert.equal(originDenied(json), true);
});

test("trusted server callers without a session cookie skip Origin", async () => {
  const { handlers: storage } = handlers({ mode: "trusted" });
  const { json, response } = await postJson(storage, {
    headers: { "content-type": "application/json" },
  });
  assert.equal(originDenied(json), false);
  assert.notEqual(response.status, 403);
});

test("trusted cookie-session callers still require Origin", async () => {
  const { handlers: storage } = handlers({ mode: "trusted" });
  const cookieHeader = cookie("sess_storage");

  const missing = await postJson(storage, {
    headers: { cookie: cookieHeader },
  });
  assert.equal(missing.response.status, 403);
  assert.equal(originDenied(missing.json), true);

  const evil = await postJson(storage, {
    headers: {
      cookie: cookieHeader,
      origin: "https://evil.example",
    },
  });
  assert.equal(evil.response.status, 403);
  assert.equal(originDenied(evil.json), true);

  const matching = await postJson(storage, {
    headers: {
      cookie: cookieHeader,
      origin: "http://localhost",
    },
  });
  assert.equal(originDenied(matching.json), false);
});

test("origin pass still enforces Storage Rights", async () => {
  const { handlers: storage, provider } = handlers({
    rights: ["storage.get"],
  });
  const { json, response } = await postJson(storage, {
    headers: {
      cookie: cookie("sess_storage"),
      origin: "http://localhost",
    },
  });
  assert.equal(originDenied(json), false);
  assert.equal(response.status, 403);
  assert.equal(json.error?.code, "storage_authorization_denied");
  assert.equal(json.error?.errorNumber, 3003);
  assert.deepEqual(json.error?.missing, ["storage.list"]);
  assert.equal(json.error?.operation, "list");
  assert.equal(provider.calls.length, 0);
});
