import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { authCallOptionsFromRequestContext } from "../src/auth/client/request.ts";
import { createAuthModule } from "../src/auth/client.ts";
import {
  AthenaAuthConfigurationError,
  AthenaAuthProtocolError,
  AthenaAuthUpstreamError,
  AthenaSessionOrganizationError,
  AthenaUnauthenticatedError,
} from "../src/auth/session-errors.ts";
import {
  classifyGetSessionPayload,
  getServerSession,
  getServerSessionOrNull,
  mapGetServerSessionOrNull,
  mapRequireServerSession,
  parseAthenaSessionDataHeader,
  parseAthenaSessionDataHeaderResult,
  requireServerSession,
  SESSION_ERROR_HINT,
  throwFromServerSessionResult,
} from "../src/next/get-server-session.ts";
import { createServerSessionResolver } from "../src/next/server-session-resolver.ts";
import { ATHENA_SESSION_DATA_HEADER } from "../src/utils/athena-auth-url.ts";

const sampleSession = {
  session: {
    activeOrganizationId: "org_raw",
    id: "session_1",
  },
  user: { email: "user@example.com", id: "user_1", name: "User" },
};

const authorizedSession = {
  authorization: {
    activeOrganizationId: "org_1",
    assignableRoles: [],
    capabilities: {
      canChangeMemberRole: true,
      canDeleteOrganization: false,
      canInviteMembers: true,
      canManageOrganizationRoles: true,
      canManagePlatformRoles: true,
      canRemoveMember: true,
    },
    effectiveRights: [
      "authorization.platform.read",
      "authorization.platform.write",
    ],
    revision: 1,
    roles: [
      {
        displayName: "Customer",
        key: "platform_customer",
        scopeKind: "platform" as const,
      },
      {
        displayName: "Organization owner",
        key: "organization_owner",
        scopeKind: "organization" as const,
      },
    ],
  },
  grants: ["legacy:session"],
  rights: ["authorization.platform.read", "authorization.platform.write"],
  session: { activeOrganizationId: "org_1", id: "session_1" },
  user: { email: "owner@example.com", id: "user_1" },
};

test("auth request context conversion keeps custom headers separate from credentials", () => {
  assert.deepEqual(
    authCallOptionsFromRequestContext({
      bearerToken: "bearer_806",
      cookie: "session=806",
      forceNoCache: true,
      headers: {
        Authorization: "Bearer bearer_806",
        Cookie: "session=806",
        "X-Trace-Id": "trace_806",
      },
    }),
    {
      bearerToken: "bearer_806",
      cookie: "session=806",
      forceNoCache: true,
      headers: { "X-Trace-Id": "trace_806" },
    }
  );
  assert.deepEqual(
    authCallOptionsFromRequestContext({
      headers: { "X-Session-Data": "identity-only" },
    }),
    {
      bearerToken: undefined,
      cookie: undefined,
      forceNoCache: undefined,
      headers: { "X-Session-Data": "identity-only" },
    }
  );
});

test("parseAthenaSessionDataHeader accepts session+user JSON", () => {
  const parsed = parseAthenaSessionDataHeader(JSON.stringify(sampleSession));
  assert.equal(parsed?.user.id, "user_1");
  assert.equal(parsed?.session.activeOrganizationId, "org_raw");
});

test("parseAthenaSessionDataHeader accepts wrapped data payload", () => {
  const parsed = parseAthenaSessionDataHeader(
    JSON.stringify({ data: sampleSession })
  );
  assert.equal(parsed?.user.id, "user_1");
});

test("session header paths preserve full authorization state", () => {
  for (const payload of [authorizedSession, { data: authorizedSession }]) {
    const parsed = parseAthenaSessionDataHeader(JSON.stringify(payload));
    assert.deepEqual(
      parsed?.authorization?.roles,
      authorizedSession.authorization.roles
    );
    assert.deepEqual(
      parsed?.authorization?.effectiveRights,
      authorizedSession.authorization.effectiveRights
    );
    assert.deepEqual(parsed?.rights, authorizedSession.rights);
    assert.deepEqual(parsed?.grants, authorizedSession.grants);
  }
});

test("parseAthenaSessionDataHeader returns null for garbage", () => {
  assert.equal(parseAthenaSessionDataHeader("not-json"), null);
  assert.equal(parseAthenaSessionDataHeader("{}"), null);
  assert.equal(parseAthenaSessionDataHeader(null), null);
});

test("getServerSession uses middleware session header without fetch", async () => {
  let fetchCalls = 0;
  const result = await getServerSession({
    fetchImpl: (async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 500 });
    }) as typeof fetch,
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sampleSession),
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.ok, true);
  assert.equal(result.authenticated, true);
  assert.equal(result.meta.fromSessionDataHeader, true);
  assert.equal(result.data?.user.id, "user_1");
  assert.equal(result.data?.organization.rawActiveId, "org_raw");
  assert.equal(result.data?.organization.activeId, "org_raw");
  assert.equal(result.error, null);
});

test("untrusted session headers cannot inject authorization", async () => {
  const result = await getServerSession({
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(authorizedSession),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.authenticated, true);
  assert.equal(result.meta.fromSessionDataHeader, true);
  assert.equal(result.data?.authorization, undefined);
  assert.deepEqual(result.data?.rights, []);
});

test("getServerSession applies product resolveActiveOrganizationId hook", async () => {
  const result = await getServerSession({
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(authorizedSession),
    },
    resolveActiveOrganizationId: async ({
      userId,
      rawActiveOrganizationId,
    }) => {
      assert.equal(userId, "user_1");
      assert.equal(rawActiveOrganizationId, "org_1");
      return "org_2";
    },
    trustSessionDataHeader: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data?.organization.activeId, "org_2");
  assert.equal(result.data?.organization.rawActiveId, "org_1");
  assert.equal(result.data?.authorization, undefined);
  assert.deepEqual(result.data?.rights, []);
});

test("getServerSession fetches get-session when header absent", async () => {
  const result = await getServerSession({
    appOrigin: "https://app.example.com",
    fetchImpl: (async (url, init) => {
      assert.match(String(url), /\/api\/auth\/get-session/);
      assert.match(String(url), /disableCookieCache=true/);
      assert.match(
        new Headers(init?.headers).get("cookie") ?? "",
        /athena-auth\.session_token=abc/
      );
      return new Response(JSON.stringify(sampleSession), { status: 200 });
    }) as typeof fetch,
    requestCookies: "athena-auth.session_token=abc",
    requestHeaders: {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.meta.fromSessionDataHeader, false);
  assert.equal(result.data?.user.id, "user_1");
  assert.equal(result.data?.organization.activeId, "org_raw");
});

test("getServerSession fetch preserves authorization state", async () => {
  const result = await getServerSession({
    appOrigin: "https://app.example.com",
    fetchImpl: (async () =>
      new Response(JSON.stringify(authorizedSession), {
        status: 200,
      })) as typeof fetch,
    requestCookies: "athena-auth.session_token=abc",
    requestHeaders: {},
  });
  const headerResult = await getServerSession({
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(authorizedSession),
    },
    trustSessionDataHeader: true,
  });

  assert.equal(result.ok, true);
  assert.equal(headerResult.ok, true);
  assert.deepEqual(result.data, headerResult.data);
  assert.deepEqual(
    result.data?.authorization?.roles,
    authorizedSession.authorization.roles
  );
  assert.deepEqual(
    result.data?.authorization?.effectiveRights,
    authorizedSession.authorization.effectiveRights
  );
  assert.deepEqual(result.data?.rights, authorizedSession.rights);
  assert.deepEqual(result.data?.grants, authorizedSession.grants);
  assert.deepEqual(
    result.data?.authorization?.roles.map((role) => role.scopeKind),
    ["platform", "organization"]
  );
});

test("malformed session authorization and provenance fail as protocol errors", async () => {
  const malformed = [
    {
      authorization: {
        ...authorizedSession.authorization,
        roles: "organization_owner",
      },
    },
    { rights: ["not a real right"] },
    { grants: [123] },
    {
      authorization: {
        ...authorizedSession.authorization,
        roles: [
          authorizedSession.authorization.roles[0],
          authorizedSession.authorization.roles[0],
        ],
      },
    },
    {
      authorization: {
        ...authorizedSession.authorization,
        roles: [
          { displayName: "Legacy", key: "owner", scopeKind: "organization" },
        ],
      },
    },
    {
      authorization: {
        ...authorizedSession.authorization,
        capabilities: {
          ...authorizedSession.authorization.capabilities,
          canManagePlatformRoles: false,
        },
      },
    },
    { rights: [] },
    {
      authorization: {
        ...authorizedSession.authorization,
        activeOrganizationId: "org_2",
      },
    },
  ];

  for (const patch of malformed) {
    const payload = { ...authorizedSession, ...patch };
    const result = await getServerSession({
      appOrigin: "https://app.example.com",
      fetchImpl: (async () =>
        new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch,
      requestCookies: "athena-auth.session_token=abc",
      requestHeaders: {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.authenticated, false);
    assert.equal(result.error?.hint, SESSION_ERROR_HINT.protocol);
    assert.equal(
      parseAthenaSessionDataHeaderResult(
        JSON.stringify({ ...authorizedSession, ...patch })
      ).status,
      "invalid"
    );
  }
});

test("trusted session header preserves authorization", async () => {
  const result = await getServerSession({
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(authorizedSession),
    },
    trustSessionDataHeader: true,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.data?.authorization?.effectiveRights,
    authorizedSession.authorization.effectiveRights
  );
});

test("legacy session payloads without authorization normalize to empty arrays", () => {
  const parsed = parseAthenaSessionDataHeader(JSON.stringify(sampleSession));
  assert.equal(parsed?.authorization, undefined);
  assert.deepEqual(parsed?.rights, []);
  assert.deepEqual(parsed?.grants, []);
});

test("getServerSession skips fetch without credentials by default", async () => {
  let fetchCalls = 0;
  const result = await getServerSession({
    appOrigin: "https://app.example.com",
    fetchImpl: (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(sampleSession), { status: 200 });
    }) as typeof fetch,
    requestCookies: "",
    requestHeaders: {},
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.ok, true);
  assert.equal(result.authenticated, false);
  assert.equal(result.data, null);
});

test("getServerSession ensureActiveOrganization fills missing org", async () => {
  const sessionWithoutOrg = {
    session: { activeOrganizationId: null, id: "session_1" },
    user: { email: "user@example.com", id: "user_1" },
  };

  let setActiveCalls = 0;
  const result = await getServerSession({
    ensureActiveOrganization: {
      listOrganizations: async () => [{ id: "org_first" }],
      setActiveOrganization: async (id) => {
        setActiveCalls += 1;
        assert.equal(id, "org_first");
      },
    },
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sessionWithoutOrg),
    },
  });

  assert.equal(setActiveCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.meta.organizationResolution?.repaired, true);
  assert.equal(result.meta.organizationResolution?.persisted, true);
  assert.equal(result.data?.organization.activeId, "org_first");
  assert.equal(result.data?.organization.rawActiveId, null);
});

test("getServerSession drops authorization when ensureActive repairs its scope", async () => {
  const sessionWithoutOrg = {
    authorization: {
      activeOrganizationId: undefined,
      assignableRoles: [],
      capabilities: {
        canChangeMemberRole: false,
        canDeleteOrganization: false,
        canInviteMembers: false,
        canManageOrganizationRoles: false,
        canManagePlatformRoles: false,
        canRemoveMember: false,
      },
      effectiveRights: [],
      revision: 1,
      roles: [],
    },
    grants: [],
    rights: [],
    session: { activeOrganizationId: null, id: "session_1" },
    user: { email: "user@example.com", id: "user_1" },
  };
  const result = await getServerSession({
    ensureActiveOrganization: {
      listOrganizations: async () => [{ id: "org_next" }],
      setActiveOrganization: async () => undefined,
    },
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sessionWithoutOrg),
    },
    trustSessionDataHeader: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data?.organization.activeId, "org_next");
  assert.equal(result.data?.authorization, undefined);
  assert.deepEqual(result.data?.rights, []);
});

test("getServerSession ensureActive forwards request cookie through client-backed repair", async () => {
  const sessionWithoutOrg = {
    session: { activeOrganizationId: null, id: "session_806" },
    user: { email: "user@example.com", id: "user_806" },
  };
  const requestCookie = "athena-auth.session_token=session_806";
  const calls: Array<{ endpoint: string; cookie: string | null }> = [];

  const fetchImpl = (async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    const cookie = new Headers(init?.headers).get("cookie");
    calls.push({ cookie, endpoint });

    if (
      (endpoint.endsWith("/organization/list") ||
        endpoint.endsWith("/organization/set-active") ||
        endpoint.endsWith("/get-session")) &&
      cookie !== requestCookie
    ) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
      });
    }
    if (endpoint.endsWith("/organization/list")) {
      return new Response(JSON.stringify([{ id: "org_806" }]), { status: 200 });
    }
    if (endpoint.endsWith("/organization/set-active")) {
      return new Response(JSON.stringify({ status: true }), { status: 200 });
    }
    if (endpoint.endsWith("/get-session")) {
      return new Response(
        JSON.stringify({
          session: { activeOrganizationId: "org_806", id: "session_806" },
          user: { email: "user@example.com", id: "user_806" },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const result = await getServerSession({
    client: {
      auth: createAuthModule({
        baseUrl: "https://auth.example.com/api/auth",
        fetch: fetchImpl,
      }).auth,
    },
    organization: { ensureActive: true },
    requestCookies: requestCookie,
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sessionWithoutOrg),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.authenticated, true);
  assert.equal(result.data?.organization.activeId, "org_806");
  assert.equal(result.meta.organizationResolution?.repaired, true);
  assert.equal(result.meta.organizationResolution?.persisted, true);
  assert.deepEqual(
    calls.map(({ endpoint }) => endpoint),
    [
      "/api/auth/organization/list",
      "/api/auth/organization/set-active",
      "/api/auth/get-session",
    ]
  );
  assert.ok(calls.every(({ cookie }) => cookie === requestCookie));
});

test("getServerSession ensureActive forwards request bearer through client-backed repair", async () => {
  const sessionWithoutOrg = {
    session: { activeOrganizationId: null, id: "session_bearer_806" },
    user: { email: "user@example.com", id: "user_bearer_806" },
  };
  const bearer = "bearer_806";
  const calls: Array<{ endpoint: string; authorization: string | null }> = [];
  const fetchImpl = (async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    const authorization = new Headers(init?.headers).get("authorization");
    calls.push({ authorization, endpoint });

    if (
      (endpoint.endsWith("/organization/list") ||
        endpoint.endsWith("/organization/set-active") ||
        endpoint.endsWith("/get-session")) &&
      authorization !== `Bearer ${bearer}`
    ) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
      });
    }
    if (endpoint.endsWith("/organization/list")) {
      return new Response(JSON.stringify([{ id: "org_bearer_806" }]), {
        status: 200,
      });
    }
    if (endpoint.endsWith("/organization/set-active")) {
      return new Response(JSON.stringify({ status: true }), { status: 200 });
    }
    if (endpoint.endsWith("/get-session")) {
      return new Response(
        JSON.stringify({
          session: {
            activeOrganizationId: "org_bearer_806",
            id: "session_bearer_806",
          },
          user: { email: "user@example.com", id: "user_bearer_806" },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const result = await getServerSession({
    client: {
      auth: createAuthModule({
        baseUrl: "https://auth.example.com/api/auth",
        fetch: fetchImpl,
      }).auth,
    },
    organization: { ensureActive: true },
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sessionWithoutOrg),
      authorization: `Bearer ${bearer}`,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data?.organization.activeId, "org_bearer_806");
  assert.ok(
    calls.every(({ authorization }) => authorization === `Bearer ${bearer}`)
  );
});

test("getServerSession ensureActive forwards cookie and bearer together", async () => {
  const requestCookie = "athena-auth.session_token=session_both_806";
  const bearer = "bearer_both_806";
  const calls: Array<{
    authorization: string | null;
    cookie: string | null;
  }> = [];
  const fetchImpl = (async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    const headers = new Headers(init?.headers);
    calls.push({
      authorization: headers.get("authorization"),
      cookie: headers.get("cookie"),
    });
    if (
      (endpoint.endsWith("/organization/list") ||
        endpoint.endsWith("/organization/set-active") ||
        endpoint.endsWith("/get-session")) &&
      (headers.get("cookie") !== requestCookie ||
        headers.get("authorization") !== `Bearer ${bearer}`)
    ) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
      });
    }
    if (endpoint.endsWith("/organization/list")) {
      return new Response(JSON.stringify([{ id: "org_both_806" }]), {
        status: 200,
      });
    }
    if (endpoint.endsWith("/organization/set-active")) {
      return new Response(JSON.stringify({ status: true }), { status: 200 });
    }
    if (endpoint.endsWith("/get-session")) {
      return new Response(
        JSON.stringify({
          session: {
            activeOrganizationId: "org_both_806",
            id: "session_both_806",
          },
          user: { email: "user@example.com", id: "user_both_806" },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const result = await getServerSession({
    client: {
      auth: createAuthModule({
        baseUrl: "https://auth.example.com/api/auth",
        fetch: fetchImpl,
      }).auth,
    },
    organization: { ensureActive: true },
    requestCookies: requestCookie,
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify({
        session: { activeOrganizationId: null, id: "session_both_806" },
        user: { email: "user@example.com", id: "user_both_806" },
      }),
      authorization: `Bearer ${bearer}`,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data?.organization.activeId, "org_both_806");
  assert.ok(
    calls.every(
      ({ authorization, cookie }) =>
        authorization === `Bearer ${bearer}` && cookie === requestCookie
    )
  );
});

test("getServerSession ensureActive does not fabricate credentials from session data", async () => {
  const calls: Array<{ authorization: string | null; cookie: string | null }> =
    [];
  const fetchImpl = (async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    const headers = new Headers(init?.headers);
    calls.push({
      authorization: headers.get("authorization"),
      cookie: headers.get("cookie"),
    });
    if (endpoint.endsWith("/organization/list")) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const result = await getServerSession({
    client: {
      auth: createAuthModule({
        baseUrl: "https://auth.example.com/api/auth",
        fetch: fetchImpl,
      }).auth,
    },
    organization: { ensureActive: true },
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify({
        session: { activeOrganizationId: null, id: "session_no_credential" },
        user: { email: "user@example.com", id: "user_no_credential" },
      }),
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.status, 401);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].authorization, null);
  assert.equal(calls[0].cookie, null);
});

test("getServerSession ensureActive persist:false does not call setActive", async () => {
  const sessionWithoutOrg = {
    session: { activeOrganizationId: null, id: "session_1" },
    user: { email: "user@example.com", id: "user_1" },
  };
  let setActiveCalls = 0;
  const result = await getServerSession({
    ensureActiveOrganization: {
      listOrganizations: async () => [{ id: "org_a" }],
      persist: false,
      setActiveOrganization: async () => {
        setActiveCalls += 1;
      },
    },
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sessionWithoutOrg),
    },
  });
  assert.equal(setActiveCalls, 0);
  assert.equal(result.ok, true);
  assert.equal(result.data?.organization.activeId, "org_a");
  assert.equal(result.meta.organizationResolution?.persisted, false);
});

test("getServerSession onEmpty error fails closed", async () => {
  const sessionWithoutOrg = {
    session: { activeOrganizationId: null, id: "session_1" },
    user: { email: "user@example.com", id: "user_1" },
  };
  const result = await getServerSession({
    ensureActiveOrganization: {
      listOrganizations: async () => [],
      onEmpty: "error",
      setActiveOrganization: async () => undefined,
    },
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sessionWithoutOrg),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.hint, "ATHENA_SESSION_NO_ACCESSIBLE_ORGANIZATION");
});

test("getServerSession maps upstream HTTP failure to ok:false", async () => {
  const result = await getServerSession({
    appOrigin: "https://app.example.com",
    fetchImpl: (async () =>
      new Response("nope", { status: 503 })) as typeof fetch,
    requestCookies: "athena-auth.session_token=abc",
    requestHeaders: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.authenticated, false);
  assert.equal(result.error?.code, "HTTP_ERROR");
  assert.equal(result.error?.status, 503);
});

test("getServerSessionOrNull returns null when unauthenticated", async () => {
  const data = await getServerSessionOrNull({
    requestCookies: "",
    requestHeaders: {},
  });
  assert.equal(data, null);
});

test("getServerSessionOrNull throws on upstream failure", async () => {
  await assert.rejects(
    () =>
      getServerSessionOrNull({
        appOrigin: "https://app.example.com",
        fetchImpl: (async () =>
          new Response("nope", { status: 500 })) as typeof fetch,
        requestCookies: "athena-auth.session_token=abc",
        requestHeaders: {},
      }),
    (error: unknown) => {
      assert.equal((error as Error).name, "AthenaAuthUpstreamError");
      return true;
    }
  );
});

test("requireServerSession returns data when authenticated", async () => {
  const data = await requireServerSession({
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sampleSession),
    },
  });
  assert.equal(data.user.id, "user_1");
});

test("requireServerSession throws unauthenticated", async () => {
  await assert.rejects(
    () =>
      requireServerSession({
        requestCookies: "",
        requestHeaders: {},
      }),
    (error: unknown) => error instanceof AthenaUnauthenticatedError
  );
});

test("createServerSessionResolver binds helpers", async () => {
  const resolver = createServerSessionResolver({
    client: {},
    request: "none",
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sampleSession),
    },
  });
  const result = await resolver.getSession();
  assert.equal(result.ok, true);
  assert.equal(result.data?.user.id, "user_1");
  const required = await resolver.requireSession();
  assert.equal(required.user.id, "user_1");
});

test("createServerSessionResolver requires client", () => {
  assert.throws(
    () =>
      createServerSessionResolver({
        client: null as unknown as object,
      } as never),
    (error: unknown) => error instanceof AthenaAuthConfigurationError
  );
});

test("malformed session-data header is protocol failure not fetch fallback", async () => {
  let fetchCalls = 0;
  const result = await getServerSession({
    appOrigin: "https://app.example.com",
    fetchImpl: (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(sampleSession), { status: 200 });
    }) as typeof fetch,
    requestCookies: "athena-auth.session_token=abc",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: "{not-json",
    },
  });
  assert.equal(fetchCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.error?.hint, SESSION_ERROR_HINT.protocol);
});

test("classifyGetSessionPayload treats malformed envelope as protocol error", () => {
  const bad = classifyGetSessionPayload({ session: null, user: {} }, 200);
  assert.equal(bad.kind, "error");
  if (bad.kind === "error") {
    assert.equal(bad.error.hint, SESSION_ERROR_HINT.protocol);
  }
  const empty = classifyGetSessionPayload(null, 200);
  assert.equal(empty.kind, "ok");
  if (empty.kind === "ok") {
    assert.equal(empty.session, null);
  }
});

test("parseAthenaSessionDataHeaderResult distinguishes missing vs invalid", () => {
  assert.equal(parseAthenaSessionDataHeaderResult(null).status, "missing");
  assert.equal(parseAthenaSessionDataHeaderResult("").status, "missing");
  assert.equal(parseAthenaSessionDataHeaderResult("{").status, "invalid");
  assert.equal(
    parseAthenaSessionDataHeaderResult(JSON.stringify(sampleSession)).status,
    "ok"
  );
});

test("getServerSession ensureActive upstream call count is at most 3", async () => {
  const sessionWithoutOrg = {
    session: { activeOrganizationId: null, id: "session_1" },
    user: { email: "user@example.com", id: "user_1" },
  };
  let list = 0;
  let set = 0;
  const result = await getServerSession({
    ensureActiveOrganization: {
      listOrganizations: async () => {
        list += 1;
        return [{ id: "org_x" }];
      },
      setActiveOrganization: async () => {
        set += 1;
      },
    },
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sessionWithoutOrg),
    },
  });
  assert.equal(result.ok, true);
  assert.equal(list, 1);
  assert.equal(set, 1);
  assert.ok((result.meta.organizationResolution?.upstreamCalls ?? 99) <= 3);
});

test("resolver OrNull and require share getSession path (single fetch)", async () => {
  let fetchCalls = 0;
  const fetchImpl = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify(sampleSession), { status: 200 });
  }) as typeof fetch;

  // Request-scoped memo (stands in for React.cache within one request)
  let memo: Promise<unknown> | undefined;
  const fakeCache = <T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args: never[]) => {
      if (args.length === 0) {
        if (!memo) {
          memo = Promise.resolve(fn(...args));
        }
        return memo;
      }
      return fn(...args);
    }) as T;

  const resolver = createServerSessionResolver({
    appOrigin: "https://app.example.com",
    cache: "request",
    cacheImpl: fakeCache,
    client: {},
    fetchImpl,
    request: "none",
    requestCookies: "athena-auth.session_token=abc",
    requestHeaders: {},
  });

  const a = await resolver.getSession();
  const b = await resolver.requireSession();
  const c = await resolver.getSessionOrNull();
  assert.equal(a.ok, true);
  assert.equal(b.user.id, "user_1");
  assert.equal(c?.user.id, "user_1");
  assert.equal(fetchCalls, 1);
});

test("resolver request cache does not leak options across resolver instances", async () => {
  // Identity cacheImpl: each resolver's cached fn still calls run() internally
  // with that resolver's closed-over config — no cross-resolver option capture.
  const identityCache = <T extends (...args: never[]) => unknown>(fn: T): T =>
    fn;

  const mk = (userId: string) =>
    createServerSessionResolver({
      cache: "request",
      cacheImpl: identityCache,
      client: {},
      request: "none",
      requestCookies: "",
      requestHeaders: {
        [ATHENA_SESSION_DATA_HEADER]: JSON.stringify({
          session: { activeOrganizationId: "o", id: "s" },
          user: { email: "e", id: userId },
        }),
      },
    });

  const r1 = mk("user_a");
  const r2 = mk("user_b");
  const s1 = await r1.requireSession();
  const s2 = await r2.requireSession();
  assert.equal(s1.user.id, "user_a");
  assert.equal(s2.user.id, "user_b");
});

test("resolver cacheImpl memo does not reuse another request context", async () => {
  // Two sequential "requests" with separate memo bags (request isolation).
  const makeRequestCache = () => {
    let memo: Promise<unknown> | undefined;
    return <T extends (...args: never[]) => unknown>(fn: T): T =>
      ((...args: never[]) => {
        if (!memo) {
          memo = Promise.resolve(fn(...args));
        }
        return memo;
      }) as T;
  };

  const sessionFor = (id: string) =>
    JSON.stringify({
      session: { activeOrganizationId: "o", id: "s" },
      user: { email: "e", id },
    });

  const req1 = createServerSessionResolver({
    cache: "request",
    cacheImpl: makeRequestCache(),
    client: {},
    getRequestContext: async () => ({
      requestCookies: "",
      requestHeaders: {
        [ATHENA_SESSION_DATA_HEADER]: sessionFor("req1_user"),
      },
    }),
    request: "none",
  });
  const first = await req1.requireSession();
  assert.equal(first.user.id, "req1_user");

  const req2 = createServerSessionResolver({
    cache: "request",
    cacheImpl: makeRequestCache(),
    client: {},
    getRequestContext: async () => ({
      requestCookies: "",
      requestHeaders: {
        [ATHENA_SESSION_DATA_HEADER]: sessionFor("req2_user"),
      },
    }),
    request: "none",
  });
  const second = await req2.requireSession();
  assert.equal(second.user.id, "req2_user");
});

test("long-lived resolver isolates concurrent organization repair credentials", async () => {
  const cookieA = "athena-auth.session_token=session_A";
  const cookieB = "athena-auth.session_token=session_B";
  const calls: Array<{
    cookie: string | null;
    endpoint: string;
    organizationId?: string;
  }> = [];
  const fetchImpl = (async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    const headers = new Headers(init?.headers);
    const cookie = headers.get("cookie");
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as { organizationId?: string })
        : undefined;
    calls.push({ cookie, endpoint, organizationId: body?.organizationId });

    if (
      (endpoint.endsWith("/organization/list") ||
        endpoint.endsWith("/organization/set-active") ||
        endpoint.endsWith("/get-session")) &&
      cookie !== cookieA &&
      cookie !== cookieB
    ) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
      });
    }
    await new Promise((resolve) =>
      setTimeout(resolve, cookie === cookieA ? 5 : 0)
    );
    if (endpoint.endsWith("/organization/list")) {
      return new Response(
        JSON.stringify([{ id: cookie === cookieA ? "org_A" : "org_B" }]),
        { status: 200 }
      );
    }
    if (endpoint.endsWith("/organization/set-active")) {
      return new Response(JSON.stringify({ status: true }), { status: 200 });
    }
    if (endpoint.endsWith("/get-session")) {
      const suffix = cookie === cookieA ? "A" : "B";
      return new Response(
        JSON.stringify({
          session: {
            activeOrganizationId: `org_${suffix}`,
            id: `session_${suffix}`,
          },
          user: { email: `${suffix}@example.com`, id: `user_${suffix}` },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const auth = createAuthModule({
    baseUrl: "https://auth.example.com/api/auth",
    fetch: fetchImpl,
  }).auth;
  const resolver = createServerSessionResolver({
    client: { auth },
    organization: { ensureActive: true },
    request: "none",
  });

  const [resultA, resultB] = await Promise.all([
    resolver.getSession({
      requestCookies: cookieA,
      requestHeaders: {
        [ATHENA_SESSION_DATA_HEADER]: JSON.stringify({
          session: { activeOrganizationId: null, id: "session_A" },
          user: { email: "A@example.com", id: "user_A" },
        }),
      },
    }),
    resolver.getSession({
      requestCookies: cookieB,
      requestHeaders: {
        [ATHENA_SESSION_DATA_HEADER]: JSON.stringify({
          session: { activeOrganizationId: null, id: "session_B" },
          user: { email: "B@example.com", id: "user_B" },
        }),
      },
    }),
  ]);

  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, true);
  assert.equal(resultA.data?.organization.activeId, "org_A");
  assert.equal(resultB.data?.organization.activeId, "org_B");

  const repairCalls = calls.filter((call) =>
    call.endpoint.includes("/organization/")
  );
  assert.equal(repairCalls.length, 4);
  for (const call of repairCalls) {
    assert.ok(call.cookie === cookieA || call.cookie === cookieB);
    if (call.endpoint.endsWith("/organization/list")) {
      assert.equal(call.organizationId, undefined);
    } else {
      assert.equal(
        call.organizationId,
        call.cookie === cookieA ? "org_A" : "org_B"
      );
    }
  }
});

test("getServerSession fetch malformed envelope is protocol failure not unauthenticated", async () => {
  const result = await getServerSession({
    appOrigin: "https://app.example.com",
    fetchImpl: (async () =>
      new Response(JSON.stringify({ session: null, user: {} }), {
        status: 200,
      })) as typeof fetch,
    requestCookies: "athena-auth.session_token=abc",
    requestHeaders: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.authenticated, false);
  assert.equal(result.error?.hint, SESSION_ERROR_HINT.protocol);
});

test("getServerSession fetch null body is unauthenticated", async () => {
  const result = await getServerSession({
    appOrigin: "https://app.example.com",
    fetchImpl: (async () =>
      new Response("null", { status: 200 })) as typeof fetch,
    requestCookies: "athena-auth.session_token=abc",
    requestHeaders: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.authenticated, false);
  assert.equal(result.data, null);
});

test("getServerSession missing credentials config is configuration hint", async () => {
  const result = await getServerSession({
    requestCookies: "athena-auth.session_token=abc",
    requestHeaders: {},
    // no appOrigin / authSessionUrl
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.hint, SESSION_ERROR_HINT.configuration);
});

test("getServerSession preserve organization.list errorDetails", async () => {
  const sessionWithoutOrg = {
    session: { activeOrganizationId: null, id: "session_1" },
    user: { email: "user@example.com", id: "user_1" },
  };
  const result = await getServerSession({
    client: {
      auth: {
        organization: {
          list: async () => ({
            data: null,
            error: "list denied",
            errorDetails: {
              code: "HTTP_ERROR" as const,
              message: "org list denied",
              requestId: "req_org_1",
              status: 403,
            },
            ok: false,
            status: 403,
          }),
          setActive: async () => ({
            data: null,
            error: null,
            ok: true,
            status: 200,
          }),
        },
      },
    },
    organization: { ensureActive: true },
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sessionWithoutOrg),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.message, "org list denied");
  assert.equal(result.error?.requestId, "req_org_1");
  assert.equal(result.error?.status, 403);
});

test("getServerSession preserve organization.setActive errorDetails", async () => {
  const sessionWithoutOrg = {
    session: { activeOrganizationId: null, id: "session_1" },
    user: { email: "user@example.com", id: "user_1" },
  };
  const result = await getServerSession({
    client: {
      auth: {
        organization: {
          list: async () => ({
            data: [{ id: "org_z" }],
            error: null,
            ok: true,
            status: 200,
          }),
          setActive: async () => ({
            data: null,
            error: "set denied",
            errorDetails: {
              code: "HTTP_ERROR" as const,
              message: "setActive denied",
              requestId: "req_set_1",
              status: 409,
            },
            ok: false,
            status: 409,
          }),
        },
      },
    },
    organization: { ensureActive: { onEmpty: "allow-null", persist: true } },
    requestCookies: "",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify(sessionWithoutOrg),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.message, "setActive denied");
  assert.equal(result.error?.requestId, "req_set_1");
  assert.equal(result.error?.status, 409);
});

test("throwFromServerSessionResult classifies by hint not message text", () => {
  assert.throws(
    () =>
      throwFromServerSessionResult({
        code: "UNKNOWN_ERROR",
        hint: SESSION_ERROR_HINT.configuration,
        message: "totally custom wording without keywords",
        status: 0,
      }),
    (error: unknown) => error instanceof AthenaAuthConfigurationError
  );
  assert.throws(
    () =>
      throwFromServerSessionResult({
        code: "UNKNOWN_ERROR",
        hint: SESSION_ERROR_HINT.noOrganization,
        message: "custom no org text",
        status: 0,
      }),
    (error: unknown) => error instanceof AthenaSessionOrganizationError
  );
  assert.throws(
    () =>
      throwFromServerSessionResult({
        code: "INVALID_JSON",
        hint: SESSION_ERROR_HINT.protocol,
        message: "custom protocol",
        status: 400,
      }),
    (error: unknown) => error instanceof AthenaAuthProtocolError
  );
  assert.throws(
    () =>
      throwFromServerSessionResult({
        code: "HTTP_ERROR",
        hint: SESSION_ERROR_HINT.upstream,
        message: "custom upstream",
        status: 502,
      }),
    (error: unknown) => error instanceof AthenaAuthUpstreamError
  );
});

test("mapGetServerSessionOrNull and mapRequireServerSession cover branches", () => {
  const authed = {
    authenticated: true as const,
    data: {
      grants: [],
      organization: { activeId: "o", rawActiveId: "o" },
      rights: [],
      session: { activeOrganizationId: "o", id: "s" },
      user: { email: "e", id: "u" },
    },
    error: null,
    meta: { fromSessionDataHeader: false },
    ok: true as const,
  };
  const loggedOut = {
    authenticated: false as const,
    data: null,
    error: null,
    meta: { fromSessionDataHeader: false },
    ok: true as const,
  };
  const failed = {
    authenticated: false as const,
    data: null,
    error: {
      code: "HTTP_ERROR" as const,
      hint: SESSION_ERROR_HINT.upstream,
      message: "boom",
      status: 500,
    },
    meta: { fromSessionDataHeader: false },
    ok: false as const,
  };

  assert.equal(mapGetServerSessionOrNull(authed)?.user.id, "u");
  assert.equal(mapGetServerSessionOrNull(loggedOut), null);
  assert.throws(
    () => mapGetServerSessionOrNull(failed),
    (e: unknown) => e instanceof AthenaAuthUpstreamError
  );
  assert.equal(mapRequireServerSession(authed).user.id, "u");
  assert.throws(
    () => mapRequireServerSession(loggedOut),
    (e: unknown) => e instanceof AthenaUnauthenticatedError
  );
});

test("incomplete session-data header payload is invalid not missing", () => {
  const parsed = parseAthenaSessionDataHeaderResult(
    JSON.stringify({ session: { id: "s" }, user: {} })
  );
  assert.equal(parsed.status, "invalid");
  if (parsed.status === "invalid") {
    assert.equal(parsed.error.hint, SESSION_ERROR_HINT.protocol);
  }
});

test("getServerSession incomplete header does not fetch", async () => {
  let fetchCalls = 0;
  const result = await getServerSession({
    appOrigin: "https://app.example.com",
    fetchImpl: (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(sampleSession), { status: 200 });
    }) as typeof fetch,
    requestCookies: "athena-auth.session_token=abc",
    requestHeaders: {
      [ATHENA_SESSION_DATA_HEADER]: JSON.stringify({
        session: { id: "s" },
        user: {},
      }),
    },
  });
  assert.equal(fetchCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.error?.hint, SESSION_ERROR_HINT.protocol);
});

test("classifyGetSessionPayload empty object and data:null are unauthenticated", () => {
  const emptyObj = classifyGetSessionPayload({}, 200);
  assert.equal(emptyObj.kind, "ok");
  if (emptyObj.kind === "ok") {
    assert.equal(emptyObj.session, null);
  }

  const dataNull = classifyGetSessionPayload({ data: null }, 200);
  assert.equal(dataNull.kind, "ok");
  if (dataNull.kind === "ok") {
    assert.equal(dataNull.session, null);
  }

  const sessionUserNull = classifyGetSessionPayload(
    { session: null, user: null },
    200
  );
  assert.equal(sessionUserNull.kind, "ok");
  if (sessionUserNull.kind === "ok") {
    assert.equal(sessionUserNull.session, null);
  }
});

test("resolver require then OrNull still single fetch with cache", async () => {
  let fetchCalls = 0;
  let memo: Promise<unknown> | undefined;
  const fakeCache = <T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args: never[]) => {
      if (!memo) {
        memo = Promise.resolve(fn(...args));
      }
      return memo;
    }) as T;
  const resolver = createServerSessionResolver({
    appOrigin: "https://app.example.com",
    cache: "request",
    cacheImpl: fakeCache,
    client: {},
    fetchImpl: (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(sampleSession), { status: 200 });
    }) as typeof fetch,
    request: "none",
    requestCookies: "athena-auth.session_token=abc",
    requestHeaders: {},
  });
  const required = await resolver.requireSession();
  const nullable = await resolver.getSessionOrNull();
  assert.equal(required.user.id, "user_1");
  assert.equal(nullable?.user.id, "user_1");
  assert.equal(fetchCalls, 1);
});

test("long-lived resolver isolates two sequential request contexts", async () => {
  // Models React.cache: wrap once at module/resolver scope; memo bag is
  // request-local (AsyncLocalStorage analogue). Same long-lived resolver,
  // two sequential HTTP/RSC requests must not share identity.
  type MemoBag = Map<object, Promise<unknown>>;
  let requestMemos: MemoBag | null = null;

  const reactCacheAnalogue = <T extends (...args: never[]) => unknown>(
    fn: T
  ): T =>
    ((...args: never[]) => {
      if (!requestMemos) {
        throw new Error("no active request cache scope");
      }
      const key = fn as object;
      let memo = requestMemos.get(key);
      if (!memo) {
        memo = Promise.resolve(fn(...args));
        requestMemos.set(key, memo);
      }
      return memo;
    }) as T;

  let currentUser = "none";
  let fetchCalls = 0;
  const resolver = createServerSessionResolver({
    appOrigin: "https://app.example.com",
    cache: "request",
    cacheImpl: reactCacheAnalogue,
    client: {},
    fetchImpl: (async (_url, init) => {
      fetchCalls += 1;
      const cookie = new Headers(init?.headers).get("cookie") ?? "";
      const userId = cookie.includes("user_a")
        ? "user_a"
        : cookie.includes("user_b")
          ? "user_b"
          : "unknown";
      return new Response(
        JSON.stringify({
          session: { activeOrganizationId: "org", id: "s_" + userId },
          user: { email: userId + "@ex.com", id: userId },
        }),
        { status: 200 }
      );
    }) as typeof fetch,
    getRequestContext: async () => ({
      requestCookies: "athena-auth.session_token=" + currentUser,
      requestHeaders: {},
    }),
    request: "none",
  });

  // Request 1
  requestMemos = new Map();
  currentUser = "user_a";
  const a1 = await resolver.requireSession();
  const a2 = await resolver.getSessionOrNull();
  assert.equal(a1.user.id, "user_a");
  assert.equal(a2?.user.id, "user_a");
  assert.equal(fetchCalls, 1);

  // Request 2: fresh ALS memo bag, different cookies, same resolver instance
  requestMemos = new Map();
  currentUser = "user_b";
  const b1 = await resolver.requireSession();
  const b2 = await resolver.getSession();
  assert.equal(b1.user.id, "user_b");
  assert.equal(b2.ok && b2.data?.user.id, "user_b");
  assert.equal(fetchCalls, 2);
});
