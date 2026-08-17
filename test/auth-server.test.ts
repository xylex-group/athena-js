import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { parseSetCookieHeader } from "../src/cookies/index.ts";
import { athenaAuth, defineAthenaAuthConfig } from "../src/index.ts";

function createCookieAfterPlugin() {
  return {
    hooks: {
      after: [
        {
          async handler(ctx: {
            auth: ReturnType<typeof athenaAuth>;
            headers?: Headers;
            context: Record<string, unknown>;
          }) {
            await ctx.auth.applyResponseCookies({
              context: ctx.context,
              headers: ctx.headers,
            });
          },
          matcher: () => true,
        },
      ],
    },
    id: "cookie-after-plugin",
    version: "test",
  };
}

test("defineAthenaAuthConfig keeps auth bootstrap config typed", () => {
  const db = { kind: "d1" };
  const config = defineAthenaAuthConfig({
    baseURL: "https://app.example.com",
    database: db,
    plugins: [createCookieAfterPlugin()],
    secret: "secret",
    socialProviders: {
      github: {
        clientId: "github-client-id",
        clientSecret: "github-client-secret",
        scope: ["repo", "read:org", "user:email"],
      },
    },
  });

  assert.equal(config.database.kind, "d1");
  assert.equal(config.socialProviders.github.scope?.[0], "repo");
});

test("athenaAuth resolves database factories and secure cookie defaults from baseURL", () => {
  const db = { binding: "DB" };
  const auth = athenaAuth({
    baseURL: "https://app.example.com",
    database: () => db,
    secret: "secret",
  });

  assert.equal(auth.database, db);
  assert.equal(
    auth.cookies.sessionToken.name,
    "__Secure-athena-auth.session_token"
  );
});

test("athenaAuth exposes the Better Auth-style top-level contract", () => {
  const database = { binding: "DB" };
  const auth = athenaAuth({
    baseURL: "https://app.example.com",
    database,
    plugins: [createCookieAfterPlugin()],
    secret: "secret",
  });

  assert.equal(auth.database, database);
  assert.equal(auth.options, auth.config);
  assert.equal(typeof auth.handler, "function");
  assert.equal(typeof auth.api.setSession, "function");
  assert.equal(auth.plugins[0]?.id, "cookie-after-plugin");
  assert.equal(
    auth.cookies.sessionToken.name,
    "__Secure-athena-auth.session_token"
  );
  assert.equal(
    auth.$ERROR_CODES.HANDLER_NOT_CONFIGURED,
    "HANDLER_NOT_CONFIGURED"
  );
});

test("athenaAuth context resolves trusted origins/providers", async () => {
  const auth = athenaAuth({
    baseURL: "https://app.example.com",
    database: { binding: "DB" },
    secret: "secret",
    socialProviders: {
      github: {
        clientId: "github-client-id",
        clientSecret: "github-client-secret",
      },
    },
    trustedOrigins: ["https://frontend.example.com"],
    trustedProviders: ["google"],
  });

  const context = await auth.$context;

  assert.equal(context.baseURL, "https://app.example.com");
  assert.deepEqual(context.trustedOrigins, [
    "https://app.example.com",
    "https://frontend.example.com",
  ]);
  assert.deepEqual(context.trustedProviders, ["github", "google"]);
});

test("athenaAuth handler resolves dynamic baseURL and applies cookie hooks to handler results", async () => {
  const auth = athenaAuth({
    baseURL: {
      allowedHosts: ["app.example.com"],
      protocol: "https",
    },
    database: { binding: "DB" },
    handler: async (ctx) => {
      assert.equal(ctx.baseURL, "https://app.example.com");
      assert.deepEqual(ctx.trustedOrigins, [
        "https://app.example.com",
        "https://frontend.example.com",
      ]);
      return {
        response: new Response("ok"),
        setSession: {
          session: {
            id: "session_1",
            token: "session_token_value",
          },
          user: {
            email: "demo@example.com",
            id: "user_1",
          },
        },
      };
    },
    plugins: [createCookieAfterPlugin()],
    secret: "secret",
    trustedOrigins: async (request) => [
      request?.headers.get("origin") ?? "https://frontend.example.com",
    ],
  });

  const response = await auth.handler(
    new Request("https://app.example.com/api/auth/session", {
      headers: {
        origin: "https://frontend.example.com",
      },
    })
  );

  assert.equal(await response.text(), "ok");
  const parsed = parseSetCookieHeader(response.headers.get("set-cookie") ?? "");
  assert.equal(
    parsed.get("__Secure-athena-auth.session_token")?.value,
    "session_token_value"
  );
});

test("athenaAuth applyResponseCookies sets session cookies using native cookie helpers", async () => {
  const auth = athenaAuth({
    baseURL: "https://app.example.com",
    database: { binding: "DB" },
    secret: "secret",
    session: {
      cookieCache: {
        enabled: true,
      },
    },
  });
  const responseHeaders = new Headers();

  await auth.applyResponseCookies({
    context: {
      responseHeaders,
      setSession: {
        session: {
          id: "session_1",
          token: "session_token_value",
        },
        user: {
          email: "demo@example.com",
          id: "user_1",
        },
      },
    },
    headers: new Headers(),
  });

  const parsed = parseSetCookieHeader(responseHeaders.get("set-cookie") ?? "");
  const sessionCookie = parsed.get("__Secure-athena-auth.session_token");
  assert.equal(sessionCookie?.value, "session_token_value");
  assert.equal(parsed.has("__Secure-athena-auth.session_data"), true);
});

test("custom after plugin can apply auth response cookies through after hooks", async () => {
  const auth = athenaAuth({
    baseURL: "https://app.example.com",
    database: { binding: "DB" },
    plugins: [createCookieAfterPlugin()],
    secret: "secret",
  });
  const responseHeaders = new Headers();

  await auth.runAfterHooks({
    context: {
      responseHeaders,
      setSession: {
        session: {
          id: "session_1",
          token: "session_token_value",
        },
        user: {
          email: "demo@example.com",
          id: "user_1",
        },
      },
    },
    headers: new Headers(),
  });

  const parsed = parseSetCookieHeader(responseHeaders.get("set-cookie") ?? "");
  assert.equal(
    parsed.get("__Secure-athena-auth.session_token")?.value,
    "session_token_value"
  );
});

test("custom after plugin can clear auth cookies through after hooks", async () => {
  const auth = athenaAuth({
    baseURL: "https://app.example.com",
    database: { binding: "DB" },
    plugins: [createCookieAfterPlugin()],
    secret: "secret",
  });
  const responseHeaders = new Headers();

  await auth.runAfterHooks({
    context: {
      clearSession: true,
      responseHeaders,
    },
    headers: new Headers({
      cookie: "__Secure-athena-auth.session_token=session_token_value",
    }),
  });

  const parsed = parseSetCookieHeader(responseHeaders.get("set-cookie") ?? "");
  assert.equal(
    parsed.get("__Secure-athena-auth.session_token")?.["max-age"],
    0
  );
  assert.equal(parsed.get("__Secure-athena-auth.session_data")?.["max-age"], 0);
});
