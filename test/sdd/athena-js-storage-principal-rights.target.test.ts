/**
 * Target: Storage HTTP uses canonical authority; Nucleus checks Storage Rights.
 * RED on CURRENT until the slice lands.
 * See docs/sdd/xylex/athena-js-storage-principal-rights/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type { AthenaRuntimeDiscoveryDocument } from "../../src/gateway/discovery-types.ts";
import { createAthenaStorageHandlers } from "../../src/next/storage-handlers.ts";
import { createPolicyRegistry } from "../../src/policy/registry.ts";
import { ACTION_BITS } from "../../src/policy/types.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import {
  type AthenaRuntimeSessionLookup,
  normalizeAthenaPrincipal,
} from "../../src/runtime/data/principal.ts";
import {
  authorizeStorageOperation,
  bindStorageProvider,
  bindStorageRuntime,
  createBrowserStorageTransport,
  createStorageRuntime,
  isAthenaStorageAuthorizationError,
} from "../../src/storage/runtime/index.ts";
import type {
  AuthorizedStorageOperation,
  StorageObjectOp,
  StorageObjectProvider,
  StorageObjectResult,
} from "../../src/storage/runtime/types.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

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

const EXPECTED_RIGHTS: Record<StorageObjectOp, string> = {
  delete: "storage.delete",
  get: "storage.get",
  head: "storage.head",
  list: "storage.list",
  put: "storage.put",
};

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

function principalWithRights(
  rights: readonly string[],
  grants: readonly string[] = []
) {
  return normalizeAthenaPrincipal({
    authenticated: true,
    grants,
    rights: [...rights],
    userId: "user-a",
  });
}

function sessionFor(
  rights: readonly string[],
  extra?: Partial<AthenaRuntimeSessionLookup>
): AthenaRuntimeSessionLookup {
  return {
    session: {
      activeOrganizationId: "org_1",
      id: "session-a",
      userId: "user-a",
      ...extra?.session,
    },
    user: {
      id: "user-a",
      rights: [...rights],
      ...extra?.user,
    },
  };
}

function expectedRightsDenial(op: StorageObjectOp) {
  const right = EXPECTED_RIGHTS[op];
  return {
    code: "storage_authorization_denied",
    errorNumber: 3003,
    message: `Storage operation ${op} denied (missing ${right})`,
    missing: [right],
    operation: op,
  };
}

function storageFetch(
  handlers: ReturnType<typeof createAthenaStorageHandlers>,
  headers: Record<string, string> = {}
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const merged = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    for (const [key, value] of Object.entries(headers)) {
      if (!merged.has(key)) {
        merged.set(key, value);
      }
    }
    if (!merged.has("origin")) {
      merged.set("origin", "http://localhost");
    }
    const request = new Request(url, {
      body: init?.body ?? (input instanceof Request ? input.body : undefined),
      headers: merged,
      method,
    });
    if (method === "GET") {
      return handlers.GET(request);
    }
    return handlers.POST(request);
  }) as typeof fetch;
}

function cookie(token: string): string {
  return `${ATHENA_AUTH_SESSION_COOKIE_NAME}=${token}`;
}

async function postStorage(
  handlers: ReturnType<typeof createAthenaStorageHandlers>,
  operation: StorageObjectOp,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<{
  json: StorageObjectResult & { data?: unknown };
  response: Response;
}> {
  const response = await handlers.POST(
    new Request("http://localhost/api/athena/storage", {
      body: JSON.stringify({ operation, payload }),
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        ...headers,
      },
      method: "POST",
    })
  );
  const json = (await response.json()) as StorageObjectResult & {
    data?: unknown;
  };
  return { json, response };
}

function handlersWithAuth(
  provider: StorageObjectProvider,
  auth: {
    lookupSession: (
      token: string
    ) => Promise<AthenaRuntimeSessionLookup | null>;
    verifyOrganizationMembership?: (input: {
      organizationId: string;
      userId: string;
    }) => boolean | Promise<boolean>;
  },
  security: "trusted" | "authenticated" = "authenticated"
) {
  const runtime = createStorageRuntime({ provider });
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    storage: bindStorageRuntime(bindStorageProvider({}, provider), runtime),
  });
  return {
    client,
    handlers: createAthenaStorageHandlers({
      auth: {
        lookupSession: auth.lookupSession,
        mode: "athena-session",
        ...(auth.verifyOrganizationMembership
          ? { verifyOrganizationMembership: auth.verifyOrganizationMembership }
          : {}),
      },
      client,
      discoveryDocument: DISCOVERY,
      security: { mode: security },
    }),
    runtime,
  };
}

test("T-STO-NO-SYNTHETIC: P?: storage HTTP has no synthetic storage-http principal", () => {
  const src = readSrc("next/storage-handlers.ts");
  assert.equal(src.includes("storage-http"), false);
  assert.equal(/userId:\s*["']storage-http["']/.test(src), false);
});

test("T-STO-HANDLER-AUTHORITY: P?: storage handlers resolve principal through runtime/authority", () => {
  const src = readSrc("next/storage-handlers.ts");
  assert.match(src, /runtime\/authority/);
  assert.match(src, /resolveAthenaRuntimePrincipal/);
});

test("T-STO-RIGHTS-TABLE: P?: canonical Storage operation Rights exist", async () => {
  const rightsMod = await import(
    new URL("../../src/storage/runtime/rights.ts", import.meta.url).href
  );
  const required = rightsMod.requiredStorageRight as (
    op: StorageObjectOp
  ) => { toString?: () => string } | string;
  for (const [op, key] of Object.entries(EXPECTED_RIGHTS) as Array<
    [StorageObjectOp, string]
  >) {
    assert.equal(String(required(op)), key);
    assert.equal(String(parseAthenaRightKey(key)), key);
  }
});

test("T-STO-NUCLEUS-RIGHTS: P?: Storage Nucleus authorizes Rights not the HTTP handler", () => {
  const nucleus = readSrc("storage/runtime/nucleus.ts");
  const rights = readSrc("storage/runtime/rights.ts");
  const handlers = readSrc("next/storage-handlers.ts");
  const providers = collectTsFiles(
    join(srcRoot, "storage", "runtime", "providers")
  )
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.match(nucleus, /authorizeStorageOperation/);
  assert.match(rights, /missingRequiredRights/);
  assert.equal(handlers.includes("missingRequiredRights"), false);
  assert.equal(providers.includes("missingRequiredRights"), false);
});

test("T-STO-GRANTS: P?: grants never satisfy Storage Rights", async () => {
  const provider = recordingProvider();
  const runtime = createStorageRuntime({ provider });
  const denied = await runtime.execute(
    { body: new TextEncoder().encode("x"), key: "g.bin", op: "put" },
    principalWithRights([], ["storage.put"])
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error?.errorNumber, 3003);
  assert.equal(provider.calls.length, 0);
});

test("T-STO-ANONYMOUS: P?: anonymous storage HTTP is denied", async () => {
  const provider = recordingProvider();
  const { handlers } = handlersWithAuth(
    provider,
    {
      lookupSession: async () => null,
    },
    "trusted"
  );
  const { json, response } = await postStorage(handlers, "put", {
    body: Buffer.from("x").toString("base64"),
    key: "anon.bin",
  });
  assert.equal(response.ok, false);
  assert.equal(json.ok, false);
  assert.equal(json.error?.errorNumber, 3003);
  assert.equal(json.error?.missing, undefined);
  assert.equal(json.error?.operation, undefined);
  assert.equal(provider.calls.length, 0);
});

test("T-STO-REVOKED: P?: revoked session is denied before Storage execute", async () => {
  const provider = recordingProvider();
  const { handlers } = handlersWithAuth(provider, {
    lookupSession: async () =>
      sessionFor(["storage.put"], {
        session: { id: "session-a", revoked: true, userId: "user-a" },
      }),
  });
  const { json } = await postStorage(
    handlers,
    "put",
    { body: Buffer.from("x").toString("base64"), key: "r.bin" },
    { cookie: cookie("sess_revoked") }
  );
  assert.equal(json.ok, false);
  assert.equal(json.status, 401);
  assert.equal(provider.calls.length, 0);
});

test("T-STO-EXPIRED: P?: expired session is denied before Storage execute", async () => {
  const provider = recordingProvider();
  const { handlers } = handlersWithAuth(provider, {
    lookupSession: async () =>
      sessionFor(["storage.put"], {
        session: {
          expiresAt: "2000-01-01T00:00:00.000Z",
          id: "session-a",
          userId: "user-a",
        },
      }),
  });
  const { json } = await postStorage(
    handlers,
    "put",
    { body: Buffer.from("x").toString("base64"), key: "e.bin" },
    { cookie: cookie("sess_expired") }
  );
  assert.equal(json.ok, false);
  assert.equal(json.status, 401);
  assert.equal(provider.calls.length, 0);
});

test("T-STO-BANNED: P?: banned user is denied before Storage execute", async () => {
  const provider = recordingProvider();
  const { handlers } = handlersWithAuth(provider, {
    lookupSession: async () =>
      sessionFor(["storage.put"], {
        user: { banned: true, id: "user-a", rights: ["storage.put"] },
      }),
  });
  const { json } = await postStorage(
    handlers,
    "put",
    { body: Buffer.from("x").toString("base64"), key: "b.bin" },
    { cookie: cookie("sess_banned") }
  );
  assert.equal(json.ok, false);
  assert.equal(json.status, 401);
  assert.equal(provider.calls.length, 0);
});

test("T-STO-MALFORMED: P?: malformed Rights never confer Storage authority", async () => {
  const provider = recordingProvider();
  const runtime = createStorageRuntime({ provider });
  const denied = await runtime.execute(
    { body: new TextEncoder().encode("x"), key: "m.bin", op: "put" },
    principalWithRights(["admin:read", "not a right"])
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error?.errorNumber, 3003);
  assert.equal(provider.calls.length, 0);
});

test("T-STO-ORG: P?: organization header is a membership hint for Storage HTTP", async () => {
  const provider = recordingProvider();
  const { handlers } = handlersWithAuth(provider, {
    lookupSession: async () => sessionFor(["storage.put"]),
  });
  const { json } = await postStorage(
    handlers,
    "put",
    { body: Buffer.from("x").toString("base64"), key: "o.bin" },
    {
      cookie: cookie("sess_a"),
      "x-athena-organization": "org_evil",
    }
  );
  assert.equal(json.ok, false);
  assert.equal(json.status, 403);
  assert.equal(json.error?.missing, undefined);
  assert.equal(json.error?.operation, undefined);
  assert.equal(provider.calls.length, 0);
});

test("T-STO-WILDCARD: P?: storage.* allows Storage operations", async () => {
  const provider = recordingProvider();
  const runtime = createStorageRuntime({ provider });
  const principal = principalWithRights(["storage.*"]);
  const put = await runtime.execute(
    { body: new TextEncoder().encode("x"), key: "w.bin", op: "put" },
    principal
  );
  const got = await runtime.execute({ key: "w.bin", op: "get" }, principal);
  assert.equal(put.ok, true);
  assert.equal(got.ok, true);
  assert.equal(provider.calls.length, 2);
});

test("T-STO-WILDCARD-STAR: P?: * allows Storage operations", async () => {
  const provider = recordingProvider();
  const runtime = createStorageRuntime({ provider });
  const principal = principalWithRights(["*"]);
  const put = await runtime.execute(
    { body: new TextEncoder().encode("x"), key: "star.bin", op: "put" },
    principal
  );
  assert.equal(put.ok, true);
  assert.equal(provider.calls.length, 1);
});

test("T-STO-CUSTOMER-READ: P?: platform_customer Storage Rights allow list/get/head and deny write/delete", async () => {
  const provider = recordingProvider();
  const runtime = createStorageRuntime({ provider });
  const customer = principalWithRights([
    "storage.get",
    "storage.head",
    "storage.list",
  ]);
  const listed = await runtime.execute({ op: "list" }, customer);
  assert.equal(listed.ok, true);
  const got = await runtime.execute({ key: "c.bin", op: "get" }, customer);
  assert.equal(got.ok, true);
  const headed = await runtime.execute({ key: "c.bin", op: "head" }, customer);
  assert.equal(headed.ok, true);
  const put = await runtime.execute(
    { body: new TextEncoder().encode("x"), key: "c.bin", op: "put" },
    customer
  );
  assert.equal(put.ok, false);
  assert.equal(put.status, 403);
  const removed = await runtime.execute(
    { key: "c.bin", op: "delete" },
    customer
  );
  assert.equal(removed.ok, false);
  assert.equal(removed.status, 403);
});

test("T-STO-ALLOW: P?: matching Storage Right allows the operation", async () => {
  const provider = recordingProvider();
  const runtime = createStorageRuntime({ provider });
  const allowed = await runtime.execute(
    { body: new TextEncoder().encode("x"), key: "a.bin", op: "put" },
    principalWithRights(["storage.put"])
  );
  assert.equal(allowed.ok, true);
  assert.equal(provider.calls.length, 1);
});

test("T-STO-DENY: P?: missing Storage Right denies the operation", async () => {
  const provider = recordingProvider();
  const runtime = createStorageRuntime({ provider });
  const denied = await runtime.execute(
    { body: new TextEncoder().encode("x"), key: "d.bin", op: "put" },
    principalWithRights(["storage.get"])
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.error, expectedRightsDenial("put"));
  assert.equal(isAthenaStorageAuthorizationError(denied.error), true);
  assert.equal(provider.calls.length, 0);
});

test("T-STO-DENY-OPS: P?: every Storage operation reports its missing Right", async () => {
  const ops: StorageObjectOp[] = ["get", "head", "list", "put", "delete"];
  for (const op of ops) {
    const provider = recordingProvider();
    const runtime = createStorageRuntime({ provider });
    const request =
      op === "list"
        ? { op }
        : {
            body: op === "put" ? new TextEncoder().encode("x") : undefined,
            key: `${op}.bin`,
            op,
          };
    const denied = await runtime.execute(request, principalWithRights([]));
    assert.equal(denied.ok, false, op);
    assert.equal(denied.status, 403, op);
    assert.deepEqual(denied.error, expectedRightsDenial(op), op);
    assert.equal(provider.calls.length, 0, op);
  }
});

test("T-STO-PARITY: P?: direct Storage and HTTP Storage make identical authorization decisions", async () => {
  const allowProvider = recordingProvider();
  const denyProvider = recordingProvider();
  const allowRuntime = createStorageRuntime({ provider: allowProvider });
  const denyRuntime = createStorageRuntime({ provider: denyProvider });
  const allowPrincipal = principalWithRights(["storage.put"]);
  const denyPrincipal = principalWithRights(["storage.get"]);
  const putReq = {
    body: new TextEncoder().encode("x"),
    key: "p.bin",
    op: "put" as const,
  };
  const directAllow = await allowRuntime.execute(putReq, allowPrincipal);
  const directDeny = await denyRuntime.execute(putReq, denyPrincipal);

  const httpAllow = handlersWithAuth(recordingProvider(), {
    lookupSession: async (token) =>
      token === "sess_allow" ? sessionFor(["storage.put"]) : null,
  });
  const httpDeny = handlersWithAuth(recordingProvider(), {
    lookupSession: async (token) =>
      token === "sess_deny" ? sessionFor(["storage.get"]) : null,
  });
  const httpAllowResult = await postStorage(
    httpAllow.handlers,
    "put",
    { body: Buffer.from("x").toString("base64"), key: "p.bin" },
    { cookie: cookie("sess_allow") }
  );
  const httpDenyResult = await postStorage(
    httpDeny.handlers,
    "put",
    { body: Buffer.from("x").toString("base64"), key: "p.bin" },
    { cookie: cookie("sess_deny") }
  );

  assert.equal(directAllow.ok, httpAllowResult.json.ok);
  assert.equal(directAllow.status, httpAllowResult.json.status);
  assert.equal(directDeny.ok, httpDenyResult.json.ok);
  assert.equal(
    directDeny.error?.errorNumber,
    httpDenyResult.json.error?.errorNumber
  );
  assert.deepEqual(directDeny.error, httpDenyResult.json.error);
  assert.equal(httpDeny.handlers && denyProvider.calls.length, 0);
});

test("T-STO-NO-PROVIDER: P?: provider does not execute after Storage authorization denial", async () => {
  const provider = recordingProvider();
  const { handlers } = handlersWithAuth(provider, {
    lookupSession: async () => sessionFor(["storage.get"]),
  });
  await postStorage(
    handlers,
    "delete",
    { key: "nope.bin" },
    { cookie: cookie("sess_a") }
  );
  assert.equal(provider.calls.length, 0);
});

test("T-STO-HTTP-ENVELOPE: P?: Storage HTTP Rights denial exposes operation and missing", async () => {
  const provider = recordingProvider();
  const { handlers } = handlersWithAuth(provider, {
    lookupSession: async () => sessionFor(["storage.get"]),
  });
  const { json, response } = await postStorage(
    handlers,
    "put",
    { key: "avatar.png" },
    { cookie: cookie("sess_a") }
  );
  assert.equal(response.status, 403);
  assert.equal(json.ok, false);
  assert.equal(json.status, 403);
  assert.deepEqual(json.error, expectedRightsDenial("put"));
  assert.equal(provider.calls.length, 0);
});

test("T-STO-BROWSER-ENVELOPE: P?: browser Storage transport preserves Rights denial metadata", async () => {
  const provider = recordingProvider();
  const { handlers } = handlersWithAuth(provider, {
    lookupSession: async () => sessionFor(["storage.get"]),
  });
  const transport = createBrowserStorageTransport({
    fetch: storageFetch(handlers, { cookie: cookie("sess_a") }),
  });
  const result = await transport.execute({
    key: "avatar.png",
    op: "put",
    principal: principalWithRights(["storage.get"]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.deepEqual(result.error, expectedRightsDenial("put"));
  assert.equal(provider.calls.length, 0);
});

test("T-STO-POLICY: P?: Policy 403 does not fabricate missing Rights", async () => {
  const provider = recordingProvider();
  const policies = createPolicyRegistry({
    definitions: [
      {
        actions: ACTION_BITS["storage.object.read"],
        composition: "permissive",
        id: "sto-read-only",
        principals: [{ kind: "authenticated" }],
        resource: { schema: "storage", table: "object" },
      },
    ],
    mode: "enforce",
  });
  const runtime = createStorageRuntime({ policies, provider });
  const denied = await runtime.execute(
    { body: new TextEncoder().encode("x"), key: "policy.bin", op: "put" },
    principalWithRights(["storage.put"])
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  assert.equal(denied.error?.code, "storage_authorization_denied");
  assert.equal(denied.error?.errorNumber, 3003);
  assert.equal(denied.error?.missing, undefined);
  assert.equal(denied.error?.operation, undefined);
  assert.equal(isAthenaStorageAuthorizationError(denied.error), false);
  assert.equal(provider.calls.length, 0);
});

test("T-STO-GATE: P?: authorizeStorageOperation never discards missing Rights", () => {
  const denied = authorizeStorageOperation(principalWithRights([]), "put");
  assert.ok(denied);
  assert.deepEqual(denied.error, expectedRightsDenial("put"));
  assert.equal(
    authorizeStorageOperation(principalWithRights(["storage.*"]), "put"),
    undefined
  );
  assert.equal(
    authorizeStorageOperation(principalWithRights(["*"]), "put"),
    undefined
  );
});
