import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { Body, Html, Text } from "@react-email/components";
import { createElement } from "react";
import packageJson from "../package.json" with { type: "json" };
import { createAuthModule } from "../src/auth/client.ts";
import {
  ATHENA_AUTH_ADMIN_LIMITS,
  ATHENA_AUTH_MAX_ADMIN_JSON_BYTES,
  ATHENA_AUTH_MAX_ADMIN_JSON_DEPTH,
  ATHENA_AUTH_MAX_TEMPLATE_VARIABLE_LENGTH,
  ATHENA_AUTH_MAX_TEMPLATE_VARIABLES,
  defineAuthEmailTemplate,
  renderAthenaReactEmail,
  type AthenaAuthReactEmailComponent,
  type AthenaAuthReactEmailProps,
  type AthenaAuthReactEmailRenderInput,
} from "../src/auth/index.ts";
import { createClient } from "../src/v3-client.ts";

interface Captured {
  init?: RequestInit;
  url: string;
}

/** Binding-map tests ignore SSOT /get-session refreshes after mutations. */
function bindingCallUrls(calls: Captured[]): string[] {
  return calls
    .map((call) => call.url)
    .filter((url) => !url.includes("/get-session"));
}

function mockFetch(
  responseBody: unknown = { ok: true },
  responseInit: ResponseInit = { status: 200 }
) {
  const calls: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    const body =
      typeof responseBody === "string"
        ? responseBody
        : JSON.stringify(responseBody);
    return new Response(body, responseInit);
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** Compare URLs ignoring query param order (URLSearchParams is insertion-order). */
function assertSameUrlIgnoringQueryOrder(actual: string, expected: string) {
  const a = new URL(actual);
  const e = new URL(expected);
  assert.equal(a.origin + a.pathname, e.origin + e.pathname);
  assert.deepEqual(
    [...a.searchParams.entries()].sort(),
    [...e.searchParams.entries()].sort()
  );
}

function buildReactEmailElement(message: string) {
  return createElement(
    Html,
    { lang: "en" },
    createElement(Body, null, createElement(Text, null, message))
  );
}

type NewLoginDemoTemplateProps = AthenaAuthReactEmailProps & {
  dashboardUrl: string;
  name?: string;
};

const NewLoginDemoTemplate: AthenaAuthReactEmailComponent<NewLoginDemoTemplateProps> = (
  props
) =>
  createElement(
    Html,
    { lang: "en" },
    createElement(
      Body,
      null,
      createElement(
        Text,
        null,
        `We detected a new login${props.name ? `, ${props.name}` : ""}. Visit ${props.dashboardUrl}`
      )
    )
  );

const DynamicVariableTemplate: AthenaAuthReactEmailComponent<
  Record<string, string>
> = (props) => buildReactEmailElement(Object.values(props)[0] ?? "Athena");

test("auth admin limits stay aligned with backend constants", () => {
  assert.equal(ATHENA_AUTH_MAX_ADMIN_JSON_BYTES, 32 * 1024);
  assert.equal(ATHENA_AUTH_MAX_ADMIN_JSON_DEPTH, 8);
  assert.equal(ATHENA_AUTH_MAX_TEMPLATE_VARIABLES, 64);
  assert.equal(ATHENA_AUTH_MAX_TEMPLATE_VARIABLE_LENGTH, 128);
  assert.deepEqual(ATHENA_AUTH_ADMIN_LIMITS, {
    maxAdminJsonBytes: 32 * 1024,
    maxAdminJsonDepth: 8,
    maxTemplateVariableLength: 128,
    maxTemplateVariables: 64,
  });
});

test("createClient exposes auth namespace and routes auth calls to configured auth base URL", async () => {
  const { calls, restore } = mockFetch({
    session: { id: "s_1" },
    user: { email: "u@example.com", id: "u_1" },
  });
  try {
    const client = createClient({
      auth: {
        url: "https://auth.example.com/api/auth",
      },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
    });

    const result = await client.auth.getSession();
    assert.equal(result.ok, true);
    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/get-session?disableCookieCache=true"
    );
    assert.equal(calls[0].init?.method, "GET");
    assert.equal(calls[0].init?.body, undefined);
  } finally {
    restore();
  }
});

test("auth.getUser projects the current session into a user payload", async () => {
  const { calls, restore } = mockFetch({
    session: { id: "s_user" },
    user: { email: "user@example.com", id: "u_user" },
  });
  try {
    const client = createClient({
      auth: {
        url: "https://auth.example.com/api/auth",
      },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
    });

    const result = await client.auth.getUser();
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, {
      user: {
        email: "user@example.com",
        id: "u_user",
      },
    });
    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/get-session?disableCookieCache=true"
    );
    assert.equal(calls[0].init?.method, "GET");
  } finally {
    restore();
  }
});

test("createClient auth config binds auth context defaults onto client.auth requests", async () => {
  const { calls, restore } = mockFetch({ success: true });
  try {
    const client = createClient({
      auth: {
        credentials: "include",
        url: "https://auth.example.com/api/auth",
      },
      context: {
        bearerToken: "bearer-default",
        cookie: "athena-auth.session_token=session-default; theme=dark",
        sessionToken: "session-default",
      },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
    });

    const result = await client.auth.admin.hasPermission({
      permissions: ["admin:read"],
    });

    assert.equal(result.ok, true);
    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/admin/has-permission"
    );
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer bearer-default");
    assert.equal(
      headers.Cookie,
      "athena-auth.session_token=session-default; theme=dark"
    );
    assert.equal(headers["X-Athena-Auth-Session-Token"], "session-default");
    assert.equal(calls[0].init?.credentials, "include");
  } finally {
    restore();
  }
});

test("auth.requireSession resolves the current session into a typed guard result", async () => {
  const { calls, restore } = mockFetch({
    session: { id: "s_guard", token: "token_guard" },
    user: { email: "guard@example.com", id: "u_guard" },
  });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const result = await client.auth.requireSession();

    assert.deepEqual(result, {
      ok: true,
      session: {
        session: { id: "s_guard", token: "token_guard" },
        user: { email: "guard@example.com", id: "u_guard" },
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/get-session?disableCookieCache=true"
    );
  } finally {
    restore();
  }
});

test("auth.admin.requirePermission resolves session and permission in one guard call", async () => {
  const original = globalThis.fetch;
  const calls: Captured[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    if (String(url).includes("/get-session")) {
      return new Response(
        JSON.stringify({
          session: { id: "s_admin", token: "token_admin" },
          user: { email: "admin@example.com", id: "u_admin" },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };

  try {
    const client = createClient({
      auth: {
        credentials: "include",
        url: "https://auth.example.com/api/auth",
      },
      context: { cookie: "athena-auth.session_token=token_admin" },
      db: { url: "https://gateway.example.com" },
      key: "gateway-key",
    });
    const result = await client.auth.admin.requirePermission({
      permissions: ["admin:read"],
    });

    assert.deepEqual(result, {
      ok: true,
      session: {
        session: { id: "s_admin", token: "token_admin" },
        user: { email: "admin@example.com", id: "u_admin" },
      },
    });
    assert.equal(calls.length, 2);
    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/get-session?disableCookieCache=true"
    );
    assert.equal(
      calls[1].url,
      "https://auth.example.com/api/auth/admin/has-permission"
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("auth.admin.requirePermission returns unauthorized when no current session is present", async () => {
  const original = globalThis.fetch;
  const calls: Captured[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
    });
  };

  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const result = await client.auth.admin.requirePermission({
      permissions: ["admin:read"],
    });

    assert.equal(result.ok, false);
    if (result.ok) {
      throw new Error("expected unauthorized guard result");
    }
    assert.equal(result.reason, "unauthorized");
    assert.equal(result.status, 401);
    assert.equal(result.error, "Unauthorized");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/get-session?disableCookieCache=true"
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("auth.admin.requirePermission returns forbidden when permission check denies access", async () => {
  const original = globalThis.fetch;
  const calls: Captured[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    if (String(url).includes("/get-session")) {
      return new Response(
        JSON.stringify({
          session: { id: "s_forbidden", token: "token_forbidden" },
          user: { email: "forbidden@example.com", id: "u_forbidden" },
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({ error: "Forbidden", success: false }),
      { status: 200 }
    );
  };

  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const result = await client.auth.admin.requirePermission({
      permissions: ["admin:read"],
    });

    assert.equal(result.ok, false);
    if (result.ok) {
      throw new Error("expected forbidden guard result");
    }
    assert.equal(result.reason, "forbidden");
    assert.equal(result.status, 403);
    assert.equal(result.error, "Forbidden");
    assert.equal(calls.length, 2);
    assert.equal(
      calls[1].url,
      "https://auth.example.com/api/auth/admin/has-permission"
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("auth.organization.requirePermission targets the organization permission route", async () => {
  const original = globalThis.fetch;
  const calls: Captured[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    if (String(url).includes("/get-session")) {
      return new Response(
        JSON.stringify({
          session: { id: "s_org", token: "token_org" },
          user: { email: "org@example.com", id: "u_org" },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };

  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const result = await client.auth.organization.requirePermission({
      permissions: ["org:manage"],
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(
      calls[1].url,
      "https://auth.example.com/api/auth/organization/has-permission"
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("auth requests include the package sdk version header", async () => {
  const { calls, restore } = mockFetch({
    session: { id: "s_1" },
    user: { email: "u@example.com", id: "u_1" },
  });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await client.getSession();

    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(
      headers["X-Athena-Sdk"],
      `xylex-group/athena-auth ${packageJson.version}`
    );
  } finally {
    restore();
  }
});

test("signIn.email posts to sign-in endpoint with payload", async () => {
  const { calls, restore } = mockFetch({
    redirect: false,
    token: "t",
    user: { email: "u@x.com", id: "u" },
  });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth/",
    });
    const response = await client.signIn.email({
      callbackURL: "https://app.example.com/callback",
      email: "u@x.com",
      password: "secret",
      rememberMe: true,
    });

    assert.equal(response.ok, true);
    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/sign-in/email"
    );
    assert.equal(calls[0].init?.method, "POST");
    const body = JSON.parse(calls[0].init?.body as string);
    assert.equal(body.email, "u@x.com");
    assert.equal(body.password, "secret");
    assert.equal(body.callbackURL, "https://app.example.com/callback");
    assert.equal(body.rememberMe, true);
  } finally {
    restore();
  }
});

test("signIn.username and signIn.social target correct endpoints", async () => {
  const { calls, restore } = mockFetch({
    token: "t",
    user: { email: "u@x.com", id: "u" },
  });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await client.signIn.username({
      password: "secret",
      rememberMe: true,
      username: "demo",
    });
    await client.signIn.social({
      callbackURL: "https://app.example.com/cb",
      provider: "google",
    });

    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/sign-in/username"
    );
    assert.equal(calls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      password: "secret",
      rememberMe: true,
      username: "demo",
    });

    assert.equal(
      calls[1].url,
      "https://auth.example.com/api/auth/sign-in/social"
    );
    assert.equal(calls[1].init?.method, "POST");
    assert.deepEqual(JSON.parse(calls[1].init?.body as string), {
      callbackURL: "https://app.example.com/cb",
      provider: "google",
    });
  } finally {
    restore();
  }
});

test("signOut and logout send empty object payload to sign-out endpoint", async () => {
  const { calls, restore } = mockFetch({ success: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await client.signOut();
    await client.logout();

    assert.equal(calls[0].url, "https://auth.example.com/api/auth/sign-out");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(calls[0].init?.body, "{}");

    assert.equal(calls[1].url, "https://auth.example.com/api/auth/sign-out");
    assert.equal(calls[1].init?.method, "POST");
    assert.equal(calls[1].init?.body, "{}");
  } finally {
    restore();
  }
});

test("getSession and listSessions use GET endpoints", async () => {
  const original = globalThis.fetch;
  const calls: Captured[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    if (String(url).includes("/get-session")) {
      return new Response(
        JSON.stringify({
          session: { id: "s1" },
          user: { email: "u@example.com", id: "u1" },
        }),
        {
          status: 200,
        }
      );
    }
    return new Response(JSON.stringify([{ id: "s1" }, { id: "s2" }]), {
      status: 200,
    });
  };

  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const sessionResponse = await client.getSession();
    const listResponse = await client.listSessions();

    assert.equal(sessionResponse.ok, true);
    assert.equal(sessionResponse.data?.session.id, "s1");
    assert.equal(listResponse.ok, true);
    assert.equal(listResponse.data?.length, 2);

    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/get-session?disableCookieCache=true"
    );
    assert.equal(calls[0].init?.method, "GET");
    assert.equal(calls[0].init?.body, undefined);

    assert.equal(
      calls[1].url,
      "https://auth.example.com/api/auth/list-sessions"
    );
    assert.equal(calls[1].init?.method, "GET");
    assert.equal(calls[1].init?.body, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("session revoke aliases target proper endpoints", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await client.revokeSession({ token: "tok-a" });
    await client.clearSession({ token: "tok-b" });
    await client.revokeSessions();
    await client.clearSessions();
    await client.revokeOtherSessions();
    await client.clearOtherSessions();

    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/revoke-session"
    );
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      token: "tok-a",
    });
    assert.equal(
      calls[1].url,
      "https://auth.example.com/api/auth/revoke-session"
    );
    assert.deepEqual(JSON.parse(calls[1].init?.body as string), {
      token: "tok-b",
    });
    assert.equal(
      calls[2].url,
      "https://auth.example.com/api/auth/revoke-sessions"
    );
    assert.equal(
      calls[3].url,
      "https://auth.example.com/api/auth/revoke-sessions"
    );
    assert.equal(
      calls[4].url,
      "https://auth.example.com/api/auth/revoke-other-sessions"
    );
    assert.equal(
      calls[5].url,
      "https://auth.example.com/api/auth/revoke-other-sessions"
    );
  } finally {
    restore();
  }
});

test("password and email lifecycle methods map to correct endpoints", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await client.forgetPassword({
      email: "u@example.com",
      redirectTo: "https://app/reset",
    });
    await client.resetPassword({ newPassword: "new-pass", token: "rtok" });
    await client.sendVerificationEmail({
      callbackURL: "https://app/verify",
      email: "u@example.com",
    });
    await client.changeEmail({
      callbackURL: "https://app/callback",
      newEmail: "new@example.com",
    });
    await client.changePassword({
      currentPassword: "old-pass",
      newPassword: "new-pass",
      revokeOtherSessions: true,
    });

    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/forget-password"
    );
    assert.equal(
      calls[1].url,
      "https://auth.example.com/api/auth/reset-password"
    );
    assert.equal(
      calls[2].url,
      "https://auth.example.com/api/auth/send-verification-email"
    );
    assert.equal(
      calls[3].url,
      "https://auth.example.com/api/auth/change-email"
    );
    assert.equal(
      calls[4].url,
      "https://auth.example.com/api/auth/change-password"
    );
  } finally {
    restore();
  }
});

test("user lifecycle methods map to correct endpoints", async () => {
  const { calls, restore } = mockFetch({
    message: "User deleted",
    success: true,
  });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await client.updateUser({
      image: "https://img.local/u.png",
      name: "Updated",
    });
    await client.deleteUser({ password: "secret" });
    await client.deleteUserCallback({
      callbackURL: "https://app/delete-callback",
      token: "cb-token",
    });

    assert.equal(calls[0].url, "https://auth.example.com/api/auth/update-user");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(calls[1].url, "https://auth.example.com/api/auth/delete-user");
    assert.equal(calls[1].init?.method, "POST");
    assertSameUrlIgnoringQueryOrder(
      calls[2].url,
      "https://auth.example.com/api/auth/delete-user/callback?token=cb-token&callbackURL=https%3A%2F%2Fapp%2Fdelete-callback"
    );
    assert.equal(calls[2].init?.method, "GET");
  } finally {
    restore();
  }
});

test("verifyEmail and resolveResetPasswordToken use query routes", async () => {
  const { calls, restore } = mockFetch({
    status: true,
    user: { email: "u@example.com", id: "u" },
  });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await client.verifyEmail({
      callbackURL: "https://app/verified",
      token: "email-token",
    });
    await client.resolveResetPasswordToken({
      callbackURL: "https://app/reset-password",
      token: "resettok",
    });

    assertSameUrlIgnoringQueryOrder(
      calls[0].url,
      "https://auth.example.com/api/auth/verify-email?token=email-token&callbackURL=https%3A%2F%2Fapp%2Fverified"
    );
    assert.equal(calls[0].init?.method, "GET");
    assertSameUrlIgnoringQueryOrder(
      calls[1].url,
      "https://auth.example.com/api/auth/reset-password/resettok?callbackURL=https%3A%2F%2Fapp%2Freset-password"
    );
    assert.equal(calls[1].init?.method, "GET");
  } finally {
    restore();
  }
});

test("account linking and token exchange methods map correctly", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await client.linkSocial({
      callbackURL: "https://app/callback",
      provider: "google",
    });
    await client.listAccounts();
    await client.unlinkAccount({ accountId: "acc_1", providerId: "google" });
    await client.refreshToken({
      accountId: "acc_1",
      providerId: "google",
      userId: "u_1",
    });
    await client.getAccessToken({
      accountId: "acc_1",
      providerId: "google",
      userId: "u_1",
    });

    assert.equal(calls[0].url, "https://auth.example.com/api/auth/link-social");
    assert.equal(
      calls[1].url,
      "https://auth.example.com/api/auth/list-accounts"
    );
    assert.equal(
      calls[2].url,
      "https://auth.example.com/api/auth/unlink-account"
    );
    assert.equal(
      calls[3].url,
      "https://auth.example.com/api/auth/refresh-token"
    );
    assert.equal(
      calls[4].url,
      "https://auth.example.com/api/auth/get-access-token"
    );
  } finally {
    restore();
  }
});

test("generic request infers methods safely and supports query", async () => {
  const { calls, restore } = mockFetch({ ok: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await client.request({
      endpoint: "/ok",
      query: { many: [1, 2], ping: "pong" },
    });
    await client.request({ endpoint: "/revoke-sessions" });
    await client.request({ endpoint: "/reset-password/resettok" });
    await client.request({ body: { message: "x" }, endpoint: "/error" });

    assertSameUrlIgnoringQueryOrder(
      calls[0].url,
      "https://auth.example.com/api/auth/ok?ping=pong&many=1&many=2"
    );
    assert.equal(calls[0].init?.method, "GET");
    assert.equal(
      calls[1].url,
      "https://auth.example.com/api/auth/revoke-sessions"
    );
    assert.equal(calls[1].init?.method, "POST");
    assert.equal(calls[1].init?.body, "{}");
    assert.equal(
      calls[2].url,
      "https://auth.example.com/api/auth/reset-password/resettok"
    );
    assert.equal(calls[2].init?.method, "GET");
    assert.equal(calls[3].url, "https://auth.example.com/api/auth/error");
    assert.equal(calls[3].init?.method, "POST");
    assert.deepEqual(JSON.parse(calls[3].init?.body as string), {
      message: "x",
    });
  } finally {
    restore();
  }
});

test("supports fetchOptions compatibility input and call overrides", async () => {
  const { calls, restore } = mockFetch({
    redirect: false,
    token: "t",
    user: { email: "u@x.com", id: "u" },
  });
  try {
    const client = createAuthModule({
      apiKey: "config-key",
      baseUrl: "https://auth.example.com/api/auth",
      cookie: "config_cookie=1",
      sessionToken: "config-session",
    });
    await client.signIn.email(
      {
        email: "u@x.com",
        fetchOptions: {
          bearerToken: "fetch-token",
          cookie: "fetch_cookie=1",
          headers: { "X-Fetch-Only": "yes" },
          sessionToken: "fetch-session",
        },
        password: "secret",
      },
      {
        bearerToken: "call-token",
        cookie: "call_cookie=1",
        credentials: "omit",
        headers: { "X-Call-Only": "yes" },
        sessionToken: "call-session",
      }
    );

    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer call-token");
    assert.equal(headers.Cookie, "call_cookie=1");
    assert.equal(headers["X-Athena-Auth-Session-Token"], "call-session");
    assert.equal(headers["X-Athena-Key"], "config-key");
    assert.equal(headers["X-Fetch-Only"], "yes");
    assert.equal(headers["X-Call-Only"], "yes");
    assert.equal(calls[0].init?.credentials, "omit");
  } finally {
    restore();
  }
});

test("non-2xx responses are normalized into HTTP_ERROR", async () => {
  const { restore } = mockFetch(
    { message: "unauthorized" },
    {
      headers: {
        "content-type": "application/json",
        "x-request-id": "auth_req_1",
      },
      status: 401,
    }
  );
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const response = await client.getSession();
    assert.equal(response.ok, false);
    assert.equal(response.status, 401);
    assert.equal(response.error, "unauthorized");
    assert.equal(response.errorDetails?.code, "HTTP_ERROR");
    assert.equal(response.errorDetails?.requestId, "auth_req_1");
    assert.equal(response.errorDetails?.endpoint, "/get-session");
    assert.equal(response.errorDetails?.method, "GET");
  } finally {
    restore();
  }
});

test("Cloudflare 1101 HTML is normalized into UPSTREAM_UNAVAILABLE", async () => {
  const html = `<!DOCTYPE html><html><head><title>Worker threw exception | auth.athena-auth.com | Cloudflare</title></head><body><h1><span class="cf-error-code">1101</span></h1><h2>Worker threw exception</h2></body></html>`;
  const { restore } = mockFetch(html, {
    headers: { "content-type": "text/html; charset=UTF-8" },
    status: 500,
  });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const response = await client.getSession();
    assert.equal(response.ok, false);
    assert.equal(response.status, 500);
    assert.equal(response.errorDetails?.code, "UPSTREAM_UNAVAILABLE");
    assert.match(response.error ?? "", /temporarily unavailable/i);
    assert.equal((response.error ?? "").includes("<!DOCTYPE"), false);
    assert.equal(response.raw, null);
  } finally {
    restore();
  }
});

test("HTML Worker error pages are not copied into result.error", async () => {
  const html = `<!DOCTYPE html><html><body>Worker threw exception</body></html>`;
  const { restore } = mockFetch(html, {
    headers: { "content-type": "text/html" },
    status: 500,
  });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const response = await client.getSession();
    assert.equal(response.ok, false);
    assert.equal(response.status, 500);
    assert.notEqual(response.error, html);
    assert.ok(!String(response.error ?? "").includes("<!DOCTYPE"));
    assert.equal(response.errorDetails?.code, "UPSTREAM_UNAVAILABLE");
    assert.equal(response.raw, null);
  } finally {
    restore();
  }
});

test("invalid JSON responses are normalized into INVALID_JSON", async () => {
  const { restore } = mockFetch('{"broken"', {
    headers: { "content-type": "application/json" },
    status: 200,
  });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const response = await client.getSession();
    assert.equal(response.ok, false);
    assert.equal(response.status, 200);
    assert.equal(response.error, "Auth server returned malformed JSON");
    assert.equal(response.errorDetails?.code, "INVALID_JSON");
  } finally {
    restore();
  }
});

test("network failures are normalized into NETWORK_ERROR", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("connect ECONNREFUSED");
  };
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const response = await client.listSessions();
    assert.equal(response.ok, false);
    assert.equal(response.status, 0);
    assert.equal(response.errorDetails?.code, "NETWORK_ERROR");
    assert.equal(response.errorDetails?.endpoint, "/list-sessions");
    assert.equal(response.errorDetails?.method, "GET");
    assert.match(
      response.error ?? "",
      /Network error while calling GET \/list-sessions/
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("auth namespace exposes session-level bindings", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await client.auth.getSession();
    await client.auth.signOut();

    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/get-session?disableCookieCache=true"
    );
    assert.equal(calls[0].init?.method, "GET");
    assert.equal(calls[1].url, "https://auth.example.com/api/auth/sign-out");
    assert.equal(calls[1].init?.method, "POST");
  } finally {
    restore();
  }
});

test("auth namespace exposes Better Auth flat aliases (linkSocial, listAccounts, …)", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await client.auth.linkSocial({
      callbackURL: "https://app/callback",
      provider: "google",
    });
    await client.auth.listAccounts();
    await client.auth.unlinkAccount({
      accountId: "acc_1",
      providerId: "google",
    });
    await client.auth.listSessions();
    await client.auth.revokeOtherSessions();
    await client.auth.updateUser({ name: "Ada" });

    assert.equal(calls[0].url, "https://auth.example.com/api/auth/link-social");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(
      calls[1].url,
      "https://auth.example.com/api/auth/list-accounts"
    );
    assert.equal(calls[1].init?.method, "GET");
    assert.equal(
      calls[2].url,
      "https://auth.example.com/api/auth/unlink-account"
    );
    assert.equal(
      calls[3].url,
      "https://auth.example.com/api/auth/list-sessions"
    );
    assert.equal(
      calls[4].url,
      "https://auth.example.com/api/auth/revoke-other-sessions"
    );
    assert.equal(calls[5].url, "https://auth.example.com/api/auth/update-user");
  } finally {
    restore();
  }
});

test("auth namespace user/session/oauth bindings map to expected endpoints", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await client.auth.setPassword({ newPassword: "new-pass" });
    await client.auth.changeEmailVerify({ query: { token: "email-token" } });
    await client.auth.deleteUserVerify({ query: { token: "delete-token" } });
    await client.auth.user.update({ name: "Updated" });
    await client.auth.user.delete({ password: "secret" });
    await client.auth.user.email.list();
    await client.auth.social.link({ provider: "google" });
    await client.auth.account.list();
    await client.auth.account.unlink({
      accountId: "acc_1",
      providerId: "google",
    });
    await client.auth.deleteUser.callback({ token: "cb-token" });
    await client.auth.refreshToken({
      accountId: "acc_1",
      providerId: "google",
      userId: "u_1",
    });
    await client.auth.getAccessToken({
      accountId: "acc_1",
      providerId: "google",
      userId: "u_1",
    });
    await client.auth.health();
    await client.auth.ok();
    await client.auth.error();

    const urls = bindingCallUrls(calls);
    assert.equal(urls[0], "https://auth.example.com/api/auth/set-password");
    assert.equal(
      urls[1],
      "https://auth.example.com/api/auth/change-email/verify?token=email-token"
    );
    assert.equal(
      urls[2],
      "https://auth.example.com/api/auth/delete-user/verify?token=delete-token"
    );
    assert.equal(urls[3], "https://auth.example.com/api/auth/update-user");
    assert.equal(urls[4], "https://auth.example.com/api/auth/delete-user");
    assert.equal(urls[5], "https://auth.example.com/api/auth/email/list");
    assert.equal(urls[6], "https://auth.example.com/api/auth/link-social");
    assert.equal(urls[7], "https://auth.example.com/api/auth/list-accounts");
    assert.equal(urls[8], "https://auth.example.com/api/auth/unlink-account");
    assert.equal(
      urls[9],
      "https://auth.example.com/api/auth/delete-user/callback?token=cb-token"
    );
    assert.equal(urls[10], "https://auth.example.com/api/auth/refresh-token");
    assert.equal(urls[11], "https://auth.example.com/api/auth/get-access-token");
    assert.equal(urls[12], "https://auth.example.com/api/auth/health");
    assert.equal(urls[13], "https://auth.example.com/api/auth/ok");
    assert.equal(urls[14], "https://auth.example.com/api/auth/error");
  } finally {
    restore();
  }
});

test("auth.user.email.list falls back to legacy route on 404", async () => {
  const original = globalThis.fetch;
  const calls: Captured[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ message: "Not found" }), {
        headers: { "content-type": "application/json" },
        status: 404,
      });
    }
    return new Response(JSON.stringify({ emails: [{ id: "email_1" }] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };

  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const response = await client.auth.user.email.list();

    assert.equal(response.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://auth.example.com/api/auth/email/list");
    assert.equal(calls[1].url, "https://auth.example.com/api/auth/email-list");
    assert.equal(calls[0].init?.method, "GET");
    assert.equal(calls[1].init?.method, "GET");
  } finally {
    globalThis.fetch = original;
  }
});

test("auth.health falls back to ok route on 404", async () => {
  const original = globalThis.fetch;
  const calls: Captured[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ message: "Not found" }), {
        headers: { "content-type": "application/json" },
        status: 404,
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };

  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const response = await client.auth.health();

    assert.equal(response.ok, true);
    assert.equal(response.data?.status, "ok");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://auth.example.com/api/auth/health");
    assert.equal(calls[1].url, "https://auth.example.com/api/auth/ok");
    assert.equal(calls[0].init?.method, "GET");
    assert.equal(calls[1].init?.method, "GET");
  } finally {
    globalThis.fetch = original;
  }
});

test("auth.session.revoke collapses single and list payloads to correct endpoints", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });

    await client.auth.session.revoke({ token: "tok-1" });
    await client.auth.session.revoke([{ token: "tok-2" }]);
    await client.auth.session.revoke([{ token: "tok-3" }, { token: "tok-4" }]);
    await client.auth.session.revoke({ tokens: ["tok-5", "tok-6"] });

    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/revoke-session"
    );
    assert.equal(
      calls[1].url,
      "https://auth.example.com/api/auth/revoke-session"
    );
    assert.equal(
      calls[2].url,
      "https://auth.example.com/api/auth/revoke-sessions"
    );
    assert.equal(
      calls[3].url,
      "https://auth.example.com/api/auth/revoke-sessions"
    );
    assert.equal(calls[0].init?.body, JSON.stringify({ token: "tok-1" }));
    assert.equal(calls[1].init?.body, JSON.stringify({ token: "tok-2" }));
    assert.equal(calls[2].init?.body, JSON.stringify({}));
    assert.equal(calls[3].init?.body, JSON.stringify({}));
  } finally {
    restore();
  }
});

test("auth.twoFactor and auth.passkey bindings map to expected endpoints", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });

    await client.auth.twoFactor.getTotpUri({ password: "secret" });
    await client.auth.twoFactor.verifyTotp({ code: "123456" });
    await client.auth.twoFactor.sendOtp();
    await client.auth.twoFactor.verifyOtp({ code: "654321" });
    await client.auth.twoFactor.verifyBackupCode({ code: "backup-code" });
    await client.auth.twoFactor.generateBackupCodes({ password: "secret" });
    await client.auth.twoFactor.enable({ password: "secret" });
    await client.auth.twoFactor.disable({ password: "secret" });

    await client.auth.passkey.generateRegisterOptions();
    await client.auth.passkey.generateAuthenticateOptions();
    await client.auth.passkey.verifyRegistration({
      response: "webauthn-registration-response",
    });
    await client.auth.passkey.verifyAuthentication({
      response: "webauthn-authentication-response",
    });
    await client.auth.passkey.listUserPasskeys();
    await client.auth.passkey.deletePasskey({ id: "pk_1" });
    await client.auth.passkey.updatePasskey({ id: "pk_1", name: "Laptop Key" });
    await client.auth.passkey.getRelatedOrigins();

    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/two-factor/get-totp-uri"
    );
    assert.equal(
      calls[7].url,
      "https://auth.example.com/api/auth/two-factor/disable"
    );
    assert.equal(
      calls[8].url,
      "https://auth.example.com/api/auth/passkey/generate-register-options"
    );
    assert.equal(
      calls[12].url,
      "https://auth.example.com/api/auth/passkey/list-user-passkeys"
    );
    assert.equal(
      calls[15].url,
      "https://auth.example.com/api/auth/.well-known/webauthn"
    );
  } finally {
    restore();
  }
});

test("auth.admin and auth.apiKey bindings map to expected endpoints", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });

    await client.auth.admin.role.set({ role: "admin", userId: "u_1" });
    await client.auth.admin.user.list();
    await client.auth.admin.user.create({
      email: "new@example.com",
      name: "New User",
      password: "secret",
    });
    await client.auth.admin.user.unban({ userId: "u_1" });
    await client.auth.admin.user.ban({ banReason: "abuse", userId: "u_2" });
    await client.auth.admin.user.impersonate({ userId: "u_3" });
    await client.auth.admin.user.stopImpersonating({ userId: "u_3" });
    await client.auth.admin.user.session.list({ userId: "u_3" });
    await client.auth.admin.user.session.revoke({
      sessionToken: "s_1",
      userId: "u_3",
    });
    await client.auth.admin.user.session.revoke([
      { sessionToken: "s_2", userId: "u_3" },
      { sessionToken: "s_3", userId: "u_3" },
    ]);
    await client.auth.admin.user.session.revoke({
      sessions: [{ sessionToken: "s_4", userId: "u_3" }],
    });
    await client.auth.admin.user.session.revoke({ userId: "u_3" });
    await client.auth.admin.user.remove({ userId: "u_4" });
    await client.auth.admin.user.setPassword({
      newPassword: "new-pass",
      userId: "u_4",
    });
    await client.auth.admin.hasPermission({
      permissions: { users: ["manage"] },
    });
    await client.auth.admin.apiKey.create({
      expiresIn: 3600,
      name: "test-key",
    });
    await client.auth.admin.athenaClient.create({ clientName: "demo-client" });
    await client.auth.admin.athenaClient.list();
    await client.auth.admin.auditLog.list();
    await client.auth.admin.email.get({ query: { id: "email_1" } });
    await client.auth.admin.email.create({
      fromAddress: "no-reply@example.com",
      provider: "resend",
      recipientEmail: "to@example.com",
      subject: "Welcome",
    });
    await client.auth.admin.email.update({
      id: "email_1",
      subject: "Welcome Updated",
    });
    await client.auth.admin.email.delete({ id: "email_1" });
    await client.auth.admin.email.failure.list();
    await client.auth.admin.email.failure.get({ query: { id: "failure_1" } });
    await client.auth.admin.email.failure.create({
      errorMessage: "bounce",
      flow: "transactional",
      recipientEmail: "to@example.com",
    });
    await client.auth.admin.email.failure.update({
      id: "failure_1",
      resolved: true,
    });
    await client.auth.admin.email.failure.delete({ id: "failure_1" });
    await client.auth.admin.email.template.create({
      subject_template: "Welcome",
      template_key: "welcome",
    });
    await client.auth.admin.email.template.get({ query: { id: "tmpl_1" } });
    await client.auth.admin.email.template.delete({ id: "tmpl_1" });
    await client.auth.admin.email.template.list();
    await client.auth.admin.email.template.update({
      id: "tmpl_1",
      subject_template: "Welcome 2",
    });
    await client.auth.admin.email.template.send({
      attachment_failure_mode: "skip",
      attachments: [
        {
          file_url: "https://cdn.example.com/invoice.pdf",
          filename: "invoice.pdf",
        },
      ],
      recipient_email: "to@example.com",
      template_id: "tmpl_1",
    });
    await client.auth.admin.email.eventType.list();
    await client.auth.admin.email.list();
    await client.auth.admin.emailTemplate.create({
      subject_template: "Legacy",
      template_key: "legacy",
    });
    await client.auth.admin.emailTemplate.get({
      query: { id: "legacy_tmpl_1" },
    });
    await client.auth.admin.emailTemplate.delete({ id: "legacy_tmpl_1" });
    await client.auth.admin.emailTemplate.list();
    await client.auth.admin.emailTemplate.update({
      id: "legacy_tmpl_1",
      subject_template: "Legacy 2",
    });
    await client.auth.admin.emailTemplate.send({
      attachment_failure_mode: "fail" as unknown as "fail",
      attachments: {
        filename: "legacy.pdf",
        fileUrl: "https://cdn.example.com/legacy.pdf",
      } as unknown as { file_url: string; filename?: string },
      recipient_email: "legacy@example.com",
      template_id: "legacy_tmpl_1",
    });
    await client.auth.admin.emailEventType.list();

    await client.auth.apiKey.create({
      expiresIn: "3600",
      name: "user-key",
      remaining: "1000",
    });
    await client.auth.apiKey.get({ query: { id: "key_1" } });
    await client.auth.apiKey.update({
      expiresIn: "3600",
      keyId: "key_1",
      name: "updated",
      permissions: "{}",
    });
    await client.auth.apiKey.delete({ keyId: "key_1" });
    await client.auth.apiKey.list();
    await client.auth.apiKey.verify({ key: "prefix.secret" });
    await client.auth.apiKey.deleteAllExpired();

    const requestedUrls = calls.map((call) => call.url);

    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/admin/set-role"
    );
    assert.equal(
      calls[1].url,
      "https://auth.example.com/api/auth/admin/list-users"
    );
    assert.equal(
      calls[8].url,
      "https://auth.example.com/api/auth/admin/revoke-user-session"
    );
    assert.equal(
      calls[9].url,
      "https://auth.example.com/api/auth/admin/revoke-user-sessions"
    );
    assert.equal(
      calls[10].url,
      "https://auth.example.com/api/auth/admin/revoke-user-session"
    );
    assert.equal(
      calls[11].url,
      "https://auth.example.com/api/auth/admin/revoke-user-sessions"
    );
    assert.equal(
      calls[17].url,
      "https://auth.example.com/api/auth/admin/athena-client/list"
    );
    assert.equal(
      calls[8].init?.body,
      JSON.stringify({ sessionToken: "s_1", userId: "u_3" })
    );
    assert.equal(calls[9].init?.body, JSON.stringify({ userId: "u_3" }));
    assert.equal(
      calls[10].init?.body,
      JSON.stringify({ sessionToken: "s_4", userId: "u_3" })
    );
    assert.equal(calls[11].init?.body, JSON.stringify({ userId: "u_3" }));
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email/get?id=email_1"
      )
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email/create"
      )
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email/update"
      )
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email/delete"
      )
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email-failure/list"
      )
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email-failure/get?id=failure_1"
      )
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email-failure/create"
      )
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email-failure/update"
      )
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email-failure/delete"
      )
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email-template/get?id=tmpl_1"
      )
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email-template/get?id=legacy_tmpl_1"
      )
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email-template/update"
      )
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email-template/send"
      )
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/admin/email-event-type/list"
      )
    );
    assert.ok(
      requestedUrls.includes("https://auth.example.com/api/auth/api-key/create")
    );
    assert.ok(
      requestedUrls.includes(
        "https://auth.example.com/api/auth/api-key/delete-all-expired-api-keys"
      )
    );

    assert.equal(
      calls.find(
        (call) =>
          call.url ===
          "https://auth.example.com/api/auth/admin/email/get?id=email_1"
      )?.init?.method,
      "GET"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url === "https://auth.example.com/api/auth/admin/email/create"
      )?.init?.method,
      "POST"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url === "https://auth.example.com/api/auth/admin/email/update"
      )?.init?.method,
      "POST"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url === "https://auth.example.com/api/auth/admin/email/delete"
      )?.init?.method,
      "POST"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url ===
          "https://auth.example.com/api/auth/admin/email-failure/list"
      )?.init?.method,
      "GET"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url ===
          "https://auth.example.com/api/auth/admin/email-failure/get?id=failure_1"
      )?.init?.method,
      "GET"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url ===
          "https://auth.example.com/api/auth/admin/email-failure/create"
      )?.init?.method,
      "POST"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url ===
          "https://auth.example.com/api/auth/admin/email-failure/update"
      )?.init?.method,
      "POST"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url ===
          "https://auth.example.com/api/auth/admin/email-failure/delete"
      )?.init?.method,
      "POST"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url ===
          "https://auth.example.com/api/auth/admin/email-template/get?id=tmpl_1"
      )?.init?.method,
      "GET"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url ===
          "https://auth.example.com/api/auth/admin/email-template/list"
      )?.init?.method,
      "GET"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url ===
          "https://auth.example.com/api/auth/admin/email-template/create"
      )?.init?.method,
      "POST"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url ===
          "https://auth.example.com/api/auth/admin/email-template/update"
      )?.init?.method,
      "POST"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url ===
          "https://auth.example.com/api/auth/admin/email-template/delete"
      )?.init?.method,
      "POST"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url ===
          "https://auth.example.com/api/auth/admin/email-template/send"
      )?.init?.method,
      "POST"
    );
    assert.equal(
      calls.find(
        (call) =>
          call.url ===
          "https://auth.example.com/api/auth/admin/email-event-type/list"
      )?.init?.method,
      "GET"
    );

    const sendCalls = calls.filter(
      (call) =>
        call.url ===
        "https://auth.example.com/api/auth/admin/email-template/send"
    );
    assert.equal(sendCalls.length, 2);
    assert.deepEqual(JSON.parse(sendCalls[0].init?.body as string), {
      attachment_failure_mode: "skip",
      attachments: [
        {
          file_url: "https://cdn.example.com/invoice.pdf",
          filename: "invoice.pdf",
        },
      ],
      recipient_email: "to@example.com",
      template_id: "tmpl_1",
    });
    assert.deepEqual(JSON.parse(sendCalls[1].init?.body as string), {
      attachment_failure_mode: "fail",
      attachments: {
        file_url: "https://cdn.example.com/legacy.pdf",
        filename: "legacy.pdf",
      },
      recipient_email: "legacy@example.com",
      template_id: "legacy_tmpl_1",
    });
  } finally {
    restore();
  }
});

test("auth.admin.email.create renders react email payload into htmlBody/textBody", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });

    await client.auth.admin.email.create({
      fromAddress: "no-reply@example.com",
      provider: "resend",
      react: {
        element: buildReactEmailElement("Welcome to Athena"),
      },
      recipientEmail: "to@example.com",
      subject: "React Email",
    });

    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/admin/email/create"
    );
    const body = JSON.parse(calls[0].init?.body as string);
    assert.equal(typeof body.htmlBody, "string");
    assert.equal(body.htmlBody.includes("Welcome to Athena"), true);
    assert.equal(typeof body.textBody, "string");
    assert.equal(body.textBody.includes("Welcome to Athena"), true);
    assert.equal(Object.hasOwn(body, "react"), false);
  } finally {
    restore();
  }
});

test("auth admin email-template routes reject variables above the published SDK limits", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });

    await assert.rejects(
      () =>
        client.auth.admin.email.template.create({
          subject_template: "Welcome",
          template_key: "welcome",
          variables: Array.from(
            { length: ATHENA_AUTH_MAX_TEMPLATE_VARIABLES + 1 },
            (_, index) => `variable_${index}`
          ),
        }),
      /cannot contain more than 64 entries/
    );

    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("auth admin email-template routes reject derived variable names above the published SDK limits", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    const longVariableName = "v".repeat(
      ATHENA_AUTH_MAX_TEMPLATE_VARIABLE_LENGTH + 1
    );

    await assert.rejects(
      () =>
        client.auth.admin.email.template.create({
          react: {
            component: DynamicVariableTemplate as AthenaAuthReactEmailComponent,
            props: {
              [longVariableName]: "Ava",
            },
          },
          subject_template: "Welcome",
          template_key: "welcome",
        }),
      /cannot contain entries longer than 128 characters/
    );

    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("auth.admin email-template routes render react email payload and preserve explicit text template", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });

    await client.auth.admin.email.template.update({
      id: "tmpl_1",
      react: {
        component: NewLoginDemoTemplate,
        props: {
          dashboardUrl: "https://ikiform.com/dashboard",
          name: "Ava",
        },
      } as AthenaAuthReactEmailRenderInput,
      text_template: "Explicit text template override",
    });

    await client.auth.admin.emailTemplate.create({
      react: {
        element: buildReactEmailElement("Legacy alias path"),
        includePlainText: false,
      },
      subject_template: "Welcome",
      template_key: "welcome",
    });

    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/admin/email-template/update"
    );
    const updateBody = JSON.parse(calls[0].init?.body as string);
    assert.equal(
      updateBody.html_template.includes("We detected a new login, Ava."),
      true
    );
    assert.equal(
      updateBody.html_template.includes("https://ikiform.com/dashboard"),
      true
    );
    assert.equal(updateBody.text_template, "Explicit text template override");
    assert.deepEqual(updateBody.variables, ["dashboardUrl", "name"]);
    assert.equal(Object.hasOwn(updateBody, "react"), false);

    assert.equal(
      calls[1].url,
      "https://auth.example.com/api/auth/admin/email-template/create"
    );
    const createBody = JSON.parse(calls[1].init?.body as string);
    assert.equal(createBody.html_template.includes("Legacy alias path"), true);
    assert.equal(Object.hasOwn(createBody, "text_template"), false);
    assert.equal(Object.hasOwn(createBody, "react"), false);
  } finally {
    restore();
  }
});

test("defineAuthEmailTemplate builds create/update payloads with component props", () => {
  const template = defineAuthEmailTemplate<NewLoginDemoTemplateProps>({
    component: NewLoginDemoTemplate,
    defaults: {
      includePlainText: false,
    },
    subjectTemplate: "New Login to Ikiform",
    templateKey: "new_login",
  });

  const createPayload = template.toTemplateCreate({
    props: {
      dashboardUrl: "https://ikiform.com/dashboard",
      name: "Ava",
    },
  });

  const updatePayload = template.toTemplateUpdate({
    id: "tmpl_1",
    props: {
      dashboardUrl: "https://ikiform.com/dashboard",
    },
    subject_template: "New Login alert",
  });

  // Runtime payload uses snake_case wire keys; assertions accept either alias.
  const createRecord = createPayload as unknown as Record<string, unknown> & {
    react?: {
      component?: unknown;
      props?: unknown;
      includePlainText?: boolean;
    };
  };
  const updateRecord = updatePayload as unknown as Record<string, unknown> & {
    react?: { component?: unknown; props?: unknown };
  };
  assert.equal(
    createRecord.templateKey ?? createRecord.template_key,
    "new_login"
  );
  assert.equal(
    createRecord.subjectTemplate ?? createRecord.subject_template,
    "New Login to Ikiform"
  );
  assert.equal(createRecord.react?.component, NewLoginDemoTemplate);
  assert.deepEqual(createRecord.react?.props, {
    dashboardUrl: "https://ikiform.com/dashboard",
    name: "Ava",
  });
  assert.equal(createRecord.react?.includePlainText, false);

  assert.equal(updateRecord.id, "tmpl_1");
  assert.equal(
    updateRecord.subjectTemplate ?? updateRecord.subject_template,
    "New Login alert"
  );
  assert.equal(updateRecord.react?.component, NewLoginDemoTemplate);
  assert.deepEqual(updateRecord.react?.props, {
    dashboardUrl: "https://ikiform.com/dashboard",
  });
});

test("react email runtime defaults and observer events are applied for admin email payloads", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const events: Array<{
      phase: string;
      route?: string;
      durationMs?: number;
      error?: string;
      timestamp?: string;
    }> = [];
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
      reactEmail: {
        defaults: {
          includePlainText: false,
        },
        observe: (event) => {
          events.push({
            durationMs: event.durationMs,
            error: event.error,
            phase: event.phase,
            route: event.route,
            timestamp: event.timestamp,
          });
        },
      },
    });

    await client.auth.admin.email.create({
      fromAddress: "no-reply@example.com",
      provider: "resend",
      react: {
        component: NewLoginDemoTemplate,
        props: {
          dashboardUrl: "https://ikiform.com/dashboard",
        },
      } as AthenaAuthReactEmailRenderInput,
      recipientEmail: "to@example.com",
      subject: "Runtime defaults",
    });

    const body = JSON.parse(calls[0].init?.body as string);
    assert.equal(typeof body.htmlBody, "string");
    assert.equal(body.htmlBody.includes("https://ikiform.com/dashboard"), true);
    assert.equal(Object.hasOwn(body, "textBody"), false);

    assert.equal(events.length >= 2, true);
    assert.equal(events[0].phase, "render:start");
    assert.equal(events[0].route, "/admin/email/create");
    const successEvent = events.find(
      (event) => event.phase === "render:success"
    );
    assert.equal(Boolean(successEvent), true);
    assert.equal(successEvent?.route, "/admin/email/create");
    assert.equal(typeof successEvent?.durationMs, "number");
    assert.equal(Boolean(successEvent?.timestamp), true);
  } finally {
    restore();
  }
});

test("renderAthenaReactEmail supports runtime observer and default includePlainText", async () => {
  const events: Array<{ phase: string; route?: string }> = [];
  const rendered = await renderAthenaReactEmail(
    {
      component: NewLoginDemoTemplate,
      props: {
        dashboardUrl: "https://ikiform.com/dashboard",
        name: "Ava",
      },
    } as AthenaAuthReactEmailRenderInput,
    {
      defaults: {
        includePlainText: false,
      },
      observe: (event) => {
        events.push({
          phase: event.phase,
          route: event.route,
        });
      },
      route: "/admin/email-template/create",
    }
  );

  assert.equal(rendered.html.includes("We detected a new login, Ava."), true);
  assert.equal(Object.hasOwn(rendered, "text"), false);
  assert.equal(events[0]?.phase, "render:start");
  assert.equal(
    events.find((event) => event.phase === "render:success")?.route,
    "/admin/email-template/create"
  );
});

test("auth.admin.user.session.revoke enforces non-empty userId and a single plural userId", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });

    assert.throws(
      () =>
        client.auth.admin.user.session.revoke([
          { sessionToken: "s_1", userId: "u_1" },
          { sessionToken: "s_2", userId: "u_2" },
        ]),
      /same userId across plural payloads/
    );

    assert.throws(
      () =>
        client.auth.admin.user.session.revoke({
          sessionToken: "s_1",
        } as unknown as Parameters<
          typeof client.auth.admin.user.session.revoke
        >[0]),
      /non-empty userId/
    );

    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("auth.organization bindings map to expected endpoints", async () => {
  const { calls, restore } = mockFetch({ status: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });

    await client.auth.organization.create({ name: "Acme", slug: "acme" });
    await client.auth.organization.update({
      data: { name: "Acme 2" },
      organizationId: "org_1",
    });
    await client.auth.organization.delete({ organizationId: "org_1" });
    await client.auth.organization.setActive({ organizationId: "org_1" });
    await client.auth.organization.list();
    await client.auth.organization.getFull({
      query: { organizationId: "org_1" },
    });
    await client.auth.organization.invitation.cancel({ invitationId: "inv_1" });
    await client.auth.organization.invitation.accept({ invitationId: "inv_1" });
    await client.auth.organization.invitation.get({ query: { id: "inv_1" } });
    await client.auth.organization.invitation.reject({ invitationId: "inv_1" });
    await client.auth.organization.checkSlug({ slug: "acme" });
    await client.auth.organization.member.remove({
      memberIdOrEmail: "user@example.com",
    });
    await client.auth.organization.member.updateRole({
      memberId: "mem_1",
      role: "admin",
    });
    await client.auth.organization.member.invite({
      email: "user@example.com",
      role: "member",
    });
    await client.auth.organization.member.getActive();
    await client.auth.organization.member.list();
    await client.auth.organization.leave({ organizationId: "org_1" });
    await client.auth.organization.invitation.list();
    await client.auth.organization.listUserInvitations();
    await client.auth.organization.hasPermission({
      permissions: ["org:manage"],
    });

    const urls = bindingCallUrls(calls);
    assert.equal(urls[0], "https://auth.example.com/api/auth/organization/create");
    assert.equal(urls[1], "https://auth.example.com/api/auth/organization/update");
    assert.equal(urls[2], "https://auth.example.com/api/auth/organization/delete");
    assert.equal(
      urls[3],
      "https://auth.example.com/api/auth/organization/set-active"
    );
    assert.equal(urls[4], "https://auth.example.com/api/auth/organization/list");
    assert.equal(
      urls[5],
      "https://auth.example.com/api/auth/organization/get-full-organization?organizationId=org_1"
    );
    assert.equal(
      urls[6],
      "https://auth.example.com/api/auth/organization/cancel-invitation"
    );
    assert.equal(
      urls[7],
      "https://auth.example.com/api/auth/organization/accept-invitation"
    );
    assert.equal(
      urls[8],
      "https://auth.example.com/api/auth/organization/get-invitation?id=inv_1"
    );
    assert.equal(
      urls[9],
      "https://auth.example.com/api/auth/organization/reject-invitation"
    );
    assert.equal(
      urls[10],
      "https://auth.example.com/api/auth/organization/check-slug"
    );
    assert.equal(
      urls[11],
      "https://auth.example.com/api/auth/organization/remove-member"
    );
    assert.equal(
      urls[12],
      "https://auth.example.com/api/auth/organization/update-member-role"
    );
    assert.equal(
      urls[13],
      "https://auth.example.com/api/auth/organization/invite-member"
    );
    assert.equal(
      urls[14],
      "https://auth.example.com/api/auth/organization/get-active-member"
    );
    assert.equal(
      urls[15],
      "https://auth.example.com/api/auth/organization/list-members"
    );
    assert.equal(urls[16], "https://auth.example.com/api/auth/organization/leave");
    assert.equal(
      urls[17],
      "https://auth.example.com/api/auth/organization/list-invitations"
    );
    assert.equal(
      urls[18],
      "https://auth.example.com/api/auth/organization/list-user-invitations"
    );
    assert.equal(
      urls[19],
      "https://auth.example.com/api/auth/organization/has-permission"
    );
  } finally {
    restore();
  }
});

test("getSession and session.refresh bypass cookie cache so setActive is not overwritten", async () => {
  const original = globalThis.fetch;
  const calls: Captured[] = [];
  let persistedOrganizationId = "org-a";

  globalThis.fetch = async (url, init) => {
    const href = String(url);
    calls.push({ init, url: href });

    if (href.includes("/organization/set-active")) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      persistedOrganizationId =
        typeof body.organizationId === "string" ? body.organizationId : "org-a";
      return new Response(JSON.stringify({ status: true }), { status: 200 });
    }

    if (href.includes("/get-session")) {
      const parsed = new URL(href);
      const fresh =
        parsed.searchParams.get("disableCookieCache") === "true";
      return new Response(
        JSON.stringify({
          session: {
            activeOrganizationId: fresh ? persistedOrganizationId : "org-a",
            id: "sess-1",
          },
          user: { email: "a@example.com", id: "user-1" },
        }),
        { status: 200 }
      );
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });

    const seeded = await client.auth.getSession();
    assert.equal(seeded.ok, true);
    assert.equal(
      client.auth.session.getSnapshot().session?.session.activeOrganizationId,
      "org-a"
    );
    assert.match(calls[0].url, /disableCookieCache=true/);

    await client.auth.organization.setActive({ organizationId: "org-b" });
    await client.auth.session.refresh();

    assert.equal(
      client.auth.session.getSnapshot().session?.session.activeOrganizationId,
      "org-b"
    );
    const getSessionUrls = calls
      .map((call) => call.url)
      .filter((url) => url.includes("/get-session"));
    assert.ok(getSessionUrls.length >= 2);
    for (const url of getSessionUrls) {
      assert.match(url, /disableCookieCache=true/);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("auth.callback.provider resolves dynamic provider endpoint", async () => {
  const { calls, restore } = mockFetch({ ok: true });
  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await client.auth.callback.provider({
      code: "oauth-code",
      provider: "github",
      state: "oauth-state",
    });
    assert.equal(
      calls[0].url,
      "https://auth.example.com/api/auth/callback/github?code=oauth-code&state=oauth-state"
    );
    assert.equal(calls[0].init?.method, "GET");
  } finally {
    restore();
  }
});
