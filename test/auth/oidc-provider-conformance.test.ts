import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { createAuthRouter } from "../../src/auth/local/router.ts";
import { createRuntimeDependencies } from "../../src/auth/local/runtime-dependencies.ts";
import { resolveSocialCallbackUri } from "../../src/auth/social/server/redirect.ts";

function testHasher() {
  return {
    async hash(password: string) {
      return `hash:${password}`;
    },
    needsRehash() {
      return false;
    },
    async verify(password: string, hash: string) {
      return hash === `hash:${password}`;
    },
  };
}

function cookieOf(response: Response): string {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function runAthenaConformance(
  database?: string,
  omitUserInfoFromDiscovery = false,
  useIdentityConnection = false,
  unverifiedFederation = false,
  ordinarySocialNoEmail = false
): Promise<void> {
  const issuerA = "https://athena-a.example";
  const issuerB = "https://athena-b.example";
  const resource = "https://api.example/resource";
  const runId = crypto.randomUUID();
  const clientId = `athena-b-oidc-${runId}`;
  const connectionId = `athena-b-connection-${runId}`;
  const providerId = ordinarySocialNoEmail
    ? "company"
    : useIdentityConnection
    ? `identity-connection-${connectionId}`
    : "athena";
  const companyClientId = `company-social-${runId}`;
  const emailDomain = `tenant-${runId}.example.com`;
  const issuerEmail = `issuer-${runId}@${emailDomain}`;
  const callbackUri = resolveSocialCallbackUri({
    baseURL: issuerB,
    provider: providerId,
  });
  const depsA = createRuntimeDependencies({
    ...(database ? { autoMigrate: true, database } : {}),
    config: normalizeAthenaAuthConfig({
      authorizationServer: {
        enabled: true,
        issuer: issuerA,
        resources: {
          [resource]: { scopes: { "invoice:read": {} } },
        },
      },
      mode: "local",
      secret: "athena-a-conformance-secret",
      url: issuerA,
    }),
    hasher: testHasher(),
    ...(!database ? { stores: new MemoryAuthStores() } : {}),
  });
  const jitMemberAdds: string[] = [];
  const depsB = createRuntimeDependencies({
    config: normalizeAthenaAuthConfig({
      mode: "local",
      secret: "athena-b-conformance-secret",
      social: {
        providers: ordinarySocialNoEmail
          ? {
              company: {
                clientId: companyClientId,
                clientSecret: "company-social-secret",
                issuer: issuerA,
                resource,
                scope: ["openid"],
              },
            }
          : useIdentityConnection
            ? {}
            : { athena: { clientId, issuer: issuerA, resource } },
      },
      url: issuerB,
    }),
    hasher: testHasher(),
    hooks: {
      after: {
        "organization.member.add": ({ result }) => {
          jitMemberAdds.push(result.member.userId);
        },
      },
    },
    stores: new MemoryAuthStores(),
  });
  const originalFetch = globalThis.fetch;
  const storesA = await depsA.ensureReady();
  const storesB = await depsB.ensureReady();
  const ownerEmail = unverifiedFederation
    ? issuerEmail
    : `owner-${runId}@${emailDomain}`;
  const owner = await storesB.createUser({
    email: ownerEmail,
    id: `athena-b-owner-${runId}`,
    name: "Organization Owner",
  });
  const organization = await storesB.createOrganization({
    createdByUserId: owner.id,
    id: `athena-b-org-${runId}`,
    name: "Federation Organization",
    slug: `federation-${runId}`,
  });
  await storesB.addMember({
    id: `athena-b-owner-member-${runId}`,
    organizationId: organization.id,
    role: "owner",
    userId: owner.id,
  });
  const routerA = createAuthRouter(depsA);
  const routerB = createAuthRouter(depsB);
  const callA = (request: Request, path: string) =>
    routerA.handleRoute(request, path, storesA, new Headers(), "trace-oidc-a");
  const callB = (request: Request, path: string) =>
    routerB.handleRoute(request, path, storesB, new Headers(), "trace-oidc-b");

  try {
    const oauthStoresA = await depsA.getOAuthStores();
    await oauthStoresA.clients.create({
      clientName: "Athena B",
      id: clientId,
      redirectUris: [callbackUri],
      resourceUris: [resource],
      scopes: ["email", "openid", "profile", "invoice:read"],
    });
    if (ordinarySocialNoEmail) {
      await oauthStoresA.clients.create({
        clientName: "Company social provider",
        id: companyClientId,
        redirectUris: [callbackUri],
        resourceUris: [resource],
        scopes: ["openid", "invoice:read"],
      });
    }
    const issuerUser = await callA(
      new Request(`${issuerA}/api/auth/sign-up/email`, {
        body: JSON.stringify({
          email: issuerEmail,
          name: "Issuer User",
          password: "Password123!",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      "/sign-up/email"
    );
    assert.equal(issuerUser.status, 200);
    const issuerCookie = cookieOf(issuerUser);
    const issuerAccount = await storesA.getUserByEmail(issuerEmail);
    assert.ok(issuerAccount);
    if (!unverifiedFederation) {
      await storesA.updateUser(issuerAccount.id, { emailVerified: true });
    }
    if (useIdentityConnection) {
      await storesB.createIdentityConnection({
        authenticationRequired: true,
        clientId,
        connectionType: "oidc",
        credentialRef: null,
        domains: unverifiedFederation ? [] : [emailDomain],
        enabled: true,
        id: connectionId,
        issuer: issuerA,
        jitDefaultRoleId: "organization_member",
        jitEnabled: true,
        name: "Athena A",
        organizationId: organization.id,
        resource,
        tokenEndpointAuthMethod: "none",
      });
    }
    if (ordinarySocialNoEmail) {
      const linkedUser = await storesB.createUser({
        email: `linked-${runId}@${emailDomain}`,
        id: `athena-b-linked-${runId}`,
      });
      await storesB.createAccount({
        accountId: issuerAccount.id,
        id: `athena-b-company-account-${runId}`,
        providerId: "company",
        userId: linkedUser.id,
      });
    }

    if (useIdentityConnection && !unverifiedFederation) {
      await assert.rejects(
        callB(
          new Request(`${issuerB}/api/auth/sign-in/email`, {
            body: JSON.stringify({
              email: ownerEmail,
              password: "not-a-password",
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
          "/sign-in/email"
        ),
        { status: 403 }
      );
      await assert.rejects(
        callB(
          new Request(`${issuerB}/api/auth/sign-up/email`, {
            body: JSON.stringify({
              email: `new-${runId}@${emailDomain}`,
              password: "Password123!",
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
          "/sign-up/email"
        ),
        { status: 403 }
      );
    }

    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.origin === issuerA) {
        const upstreamRequest = new Request(url, init);
        const path = url.pathname.replace(/^\/api\/auth/, "") || "/";
        if (ordinarySocialNoEmail && path === "/userinfo") {
          return Response.json({
            name: "Company User",
            sub: issuerAccount.id,
          });
        }
        const response = await routerA.handleRoute(
          upstreamRequest,
          path,
          storesA,
          new Headers(),
          "trace-oidc-upstream"
        );
        if (
          omitUserInfoFromDiscovery &&
          path === "/.well-known/openid-configuration"
        ) {
          const document = (await response.json()) as Record<string, unknown>;
          delete document.userinfo_endpoint;
          return Response.json(document, { status: response.status });
        }
        if (ordinarySocialNoEmail && path === "/oauth/token") {
          const tokenBody = (await response.json()) as Record<string, unknown>;
          delete tokenBody.id_token;
          return Response.json(tokenBody, { status: response.status });
        }
        return response;
      }
      return originalFetch(input, init);
    };

    const start = await callB(
      new Request(`${issuerB}/api/auth/sign-in/social`, {
        body: JSON.stringify({
          callbackURL: `${issuerB}/dashboard`,
          provider: providerId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      "/sign-in/social"
    );
    assert.equal(
      start.status,
      200,
      `${await start.clone().text()} location=${start.headers.get("location")}`
    );
    const startBody = (await start.json()) as { url?: string };
    assert.ok(startBody.url);
    const authorization = new URL(startBody.url);
    assert.equal(authorization.origin, issuerA);
    assert.equal(authorization.searchParams.get("resource"), resource);
    assert.ok(authorization.searchParams.get("nonce"));

    const interactionResponse = await callA(
      new Request(authorization, { headers: { cookie: issuerCookie } }),
      "/oauth/authorize"
    );
    assert.equal(
      interactionResponse.status,
      200,
      `${await interactionResponse.clone().text()} location=${interactionResponse.headers.get("location")}`
    );
    const interaction = (await interactionResponse.json()) as {
      interactionId?: string;
    };
    assert.ok(interaction.interactionId);
    const approval = await callA(
      new Request(`${issuerA}/api/auth/oauth/authorize`, {
        body: new URLSearchParams({
          decision: "approve",
          interaction_id: interaction.interactionId,
        }),
        headers: {
          cookie: issuerCookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      }),
      "/oauth/authorize"
    );
    assert.equal(approval.status, 302);
    const callback = new URL(approval.headers.get("location") as string);
    assert.equal(callback.origin, issuerB);

    if (ordinarySocialNoEmail) {
      await assert.rejects(
        callB(new Request(callback), `/callback/${providerId}`),
        { status: 403 }
      );
      return;
    }

    const finish = await callB(
      new Request(callback),
      `/callback/${providerId}`
    );
    assert.equal(finish.status, 302);
    const sessionCookie = cookieOf(finish);
    assert.match(sessionCookie, /session/i);
    const session = await callB(
      new Request(`${issuerB}/api/auth/get-session`, {
        headers: { cookie: sessionCookie },
      }),
      "/get-session"
    );
    assert.equal(session.status, 200);
    const sessionBody = (await session.json()) as {
      user?: { email?: string; id?: string; name?: string };
    };
    assert.equal(
      sessionBody.user?.email,
      unverifiedFederation ? null : issuerEmail
    );
    assert.equal(sessionBody.user?.name, "Issuer User");
    assert.ok(sessionBody.user?.id);
    assert.notEqual(sessionBody.user.id, issuerAccount.id);
    if (unverifiedFederation) {
      assert.notEqual(sessionBody.user.id, owner.id);
    }
    if (useIdentityConnection) {
      assert.ok(
        await storesB.getMember(organization.id, sessionBody.user.id)
      );
      assert.deepEqual(jitMemberAdds, [sessionBody.user.id]);
      const linkedAccount = await storesB.findAccountByProvider(
        providerId,
        issuerAccount.id
      );
      assert.ok(linkedAccount);
      await assert.rejects(
        callB(
          new Request(`${issuerB}/api/auth/link-social`, {
            body: JSON.stringify({
              callbackURL: `${issuerB}/dashboard`,
              provider: providerId,
            }),
            headers: {
              cookie: sessionCookie,
              "content-type": "application/json",
            },
            method: "POST",
          }),
          "/link-social"
        ),
        { status: 400 }
      );
      await assert.rejects(
        callB(
          new Request(`${issuerB}/api/auth/unlink-account`, {
            body: JSON.stringify({ accountId: linkedAccount.id }),
            headers: {
              cookie: sessionCookie,
              "content-type": "application/json",
            },
            method: "POST",
          }),
          "/unlink-account"
        ),
        { status: 400 }
      );
      assert.ok(await storesB.findAccountByProvider(providerId, issuerAccount.id));
    }
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.all([depsA.close(), depsB.close()]);
  }
}

test("Athena B uses its first-party provider against Athena A", () =>
  runAthenaConformance()
);

test("Identity Connection completes generic OIDC sign-in against Athena A", () =>
  runAthenaConformance(undefined, false, true)
);

test("unverified Identity Connection email does not link to an existing Athena user", () =>
  runAthenaConformance(undefined, false, true, true)
);

test("ordinary social account cannot bypass an SSO-required canonical user email", () =>
  runAthenaConformance(undefined, false, true, false, true)
);

test("first-party Athena sign-in uses verified ID-token claims without UserInfo", () =>
  runAthenaConformance(undefined, true)
);

const postgresUrl = (
  process.env.ATHENA_TEST_DATABASE_URL || process.env.DATABASE_URL || ""
).trim();
const postgresTest = /^postgres(?:ql)?:\/\//i.test(postgresUrl)
  ? test
  : test.skip;

postgresTest("Postgres issuer and isolated Memory RP complete first-party OIDC sign-in", () =>
  runAthenaConformance(postgresUrl)
);
