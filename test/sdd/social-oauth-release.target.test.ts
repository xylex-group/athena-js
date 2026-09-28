/**
 * Track C O19–O20 TARGET — packed-product / release closeout.
 * Deterministic OAuth fixture (no live Google/GitHub). Proves sign-in,
 * link, unlink, replay, redirect safety, Location firewall, and browser
 * secret isolation against source + emitted dist chunks.
 *
 * Spec: docs/sdd/xylex/athena-social-oauth-embedded-finality/SPEC.md
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/social-oauth-release.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { startOAuthProviderFixture } from "../fixtures/oauth-provider/index.ts";
import {
  assertNoBearerInLocation,
  cookieHeader,
  createFixtureSocialRuntime,
  followProviderAuthorization,
} from "./social-oauth-release-helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const repoRoot = join(pkgRoot, "..", "..");
const srcRoot = join(pkgRoot, "src");
const distRoot = join(pkgRoot, "dist");
const authUiSrc = join(repoRoot, "packages", "athena-auth-ui", "src");

const FIXTURE_FILES = [
  "server.ts",
  "authorization.ts",
  "token.ts",
  "userinfo.ts",
  "jwks.ts",
] as const;

const FORBIDDEN_BROWSER = [
  "OAuthTransactionStore",
  "codeVerifierCiphertext",
  "auth/social/server",
  "createAthenaSocialServerEngine",
  "encryptPkceVerifier",
] as const;

type JsonRecord = Record<string, unknown>;

async function jsonBody(response: Response): Promise<JsonRecord> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text) as JsonRecord;
}

function collectFiles(dir: string, suffix: RegExp): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, suffix));
      continue;
    }
    if (suffix.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test("T-SO19-FIXTURE: P?: deterministic OAuth provider fixture exists without live IdP", () => {
  const dir = join(pkgRoot, "test", "fixtures", "oauth-provider");
  for (const name of FIXTURE_FILES) {
    assert.equal(existsSync(join(dir, name)), true, name);
  }
});

test("T-SO19-SIGN-IN: P?: fixture authorization → callback mints canonical Athena session", async () => {
  const fixture = await startOAuthProviderFixture();
  const origin = "http://127.0.0.1:4179";
  const runtime = createFixtureSocialRuntime({ fixture, origin });
  try {
    const start = await runtime.handle(
      new Request(`${origin}/api/auth/sign-in/social`, {
        body: JSON.stringify({
          callbackURL: `${origin}/dashboard`,
          provider: "testProvider",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    assert.equal(start.status, 200, await start.clone().text());
    const started = await jsonBody(start);
    const { code, state } = await followProviderAuthorization(
      String(started.url)
    );
    assert.ok(code, "authorization code");
    assert.ok(state, "state");
    const callback = await runtime.handle(
      new Request(
        `${origin}/api/auth/callback/testProvider?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
      )
    );
    assert.equal(callback.status, 302, await callback.clone().text());
    const location = callback.headers.get("location");
    assert.equal(location, `${origin}/dashboard`);
    assertNoBearerInLocation(location);
    const cookie = cookieHeader(callback);
    assert.match(cookie, /session/i);
    const session = await jsonBody(
      await runtime.handle(
        new Request(`${origin}/api/auth/get-session`, {
          headers: { cookie },
        })
      )
    );
    assert.ok(session.user, JSON.stringify(session));
    assert.ok(session.session, JSON.stringify(session));
  } finally {
    await runtime.close();
    await fixture.close();
  }
});

test("T-SO19-LINK-UNLINK: P?: password user links fixture identity, unlinks while password remains, last method rejects", async () => {
  const fixture = await startOAuthProviderFixture();
  const origin = "http://127.0.0.1:4180";
  const runtime = createFixtureSocialRuntime({
    fixture,
    origin,
    second: true,
  });
  try {
    const signup = await runtime.handle(
      new Request(`${origin}/api/auth/sign-up/email`, {
        body: JSON.stringify({
          email: "link@oauth.test",
          name: "Link User",
          password: "Password123!",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    assert.equal(signup.status, 200);
    const cookie = cookieHeader(signup);
    const before = await jsonBody(
      await runtime.handle(
        new Request(`${origin}/api/auth/get-session`, { headers: { cookie } })
      )
    );
    const sessionId = (before.session as { id?: string } | undefined)?.id;
    const userId = (before.user as { id?: string } | undefined)?.id;
    assert.ok(sessionId && userId);

    const linkStart = await runtime.handle(
      new Request(`${origin}/api/auth/link-social`, {
        body: JSON.stringify({
          callbackURL: `${origin}/settings`,
          provider: "testProvider",
        }),
        headers: {
          "content-type": "application/json",
          cookie,
        },
        method: "POST",
      })
    );
    assert.equal(linkStart.status, 200, await linkStart.clone().text());
    const linked = await jsonBody(linkStart);
    const { code, state } = await followProviderAuthorization(
      String(linked.url)
    );
    const callback = await runtime.handle(
      new Request(
        `${origin}/api/auth/callback/testProvider?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
        { headers: { cookie } }
      )
    );
    assert.equal(callback.status, 302, await callback.clone().text());
    assertNoBearerInLocation(callback.headers.get("location"));
    const afterCookie = cookieHeader(callback) || cookie;
    const after = await jsonBody(
      await runtime.handle(
        new Request(`${origin}/api/auth/get-session`, {
          headers: { cookie: afterCookie },
        })
      )
    );
    assert.equal((after.session as { id?: string }).id, sessionId);
    assert.equal((after.user as { id?: string }).id, userId);
    const listed = await jsonBody(
      await runtime.handle(
        new Request(`${origin}/api/auth/list-accounts`, {
          headers: { cookie: afterCookie },
        })
      )
    );
    const rows = Array.isArray(listed)
      ? listed
      : ((listed.accounts as unknown[]) ?? []);
    assert.ok(
      rows.some((row) => {
        const record = row as { providerId?: string; provider_id?: string };
        return (
          record.providerId === "testProvider" ||
          record.provider_id === "testProvider"
        );
      }),
      JSON.stringify(listed)
    );

    const unlinkOk = await runtime.handle(
      new Request(`${origin}/api/auth/unlink-account`, {
        body: JSON.stringify({ providerId: "testProvider" }),
        headers: {
          "content-type": "application/json",
          cookie: afterCookie,
        },
        method: "POST",
      })
    );
    assert.equal(unlinkOk.status, 200, await unlinkOk.clone().text());

    const other = await runtime.handle(
      new Request(`${origin}/api/auth/sign-up/email`, {
        body: JSON.stringify({
          email: "other@oauth.test",
          name: "Other",
          password: "Password123!",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    const otherCookie = cookieHeader(other);
    const cross = await runtime.handle(
      new Request(`${origin}/api/auth/unlink-account`, {
        body: JSON.stringify({ accountId: userId, providerId: "credential" }),
        headers: {
          "content-type": "application/json",
          cookie: otherCookie,
        },
        method: "POST",
      })
    );
    assert.ok(cross.status >= 400, "cross-user unlink must reject");

    const last = await runtime.handle(
      new Request(`${origin}/api/auth/unlink-account`, {
        body: JSON.stringify({ providerId: "credential" }),
        headers: {
          "content-type": "application/json",
          cookie: afterCookie,
        },
        method: "POST",
      })
    );
    assert.ok(last.status >= 400, "last credential unlink must reject");
    const lastBody = await jsonBody(last);
    assert.match(String(lastBody.code ?? ""), /LAST|CREDENTIAL/i);
  } finally {
    await runtime.close();
    await fixture.close();
  }
});

test("T-SO19-REPLAY: P?: same state+code twice and hostile callback cases fail closed", async () => {
  const fixture = await startOAuthProviderFixture();
  const origin = "http://127.0.0.1:4181";
  const runtime = createFixtureSocialRuntime({ fixture, origin });
  try {
    const start = await runtime.handle(
      new Request(`${origin}/api/auth/sign-in/social`, {
        body: JSON.stringify({
          callbackURL: `${origin}/dashboard`,
          provider: "testProvider",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    const started = await jsonBody(start);
    const { code, state } = await followProviderAuthorization(
      String(started.url)
    );
    const target = `${origin}/api/auth/callback/testProvider?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    const first = await runtime.handle(new Request(target));
    assert.equal(first.status, 302, await first.clone().text());
    const second = await runtime.handle(new Request(target));
    assert.ok(second.status >= 400, await second.clone().text());

    const start2 = await runtime.handle(
      new Request(`${origin}/api/auth/sign-in/social`, {
        body: JSON.stringify({
          callbackURL: `${origin}/dashboard`,
          provider: "testProvider",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    const started2 = await jsonBody(start2);
    const dance = await followProviderAuthorization(String(started2.url));
    const [a, b] = await Promise.all([
      runtime.handle(
        new Request(
          `${origin}/api/auth/callback/testProvider?code=${encodeURIComponent(dance.code)}&state=${encodeURIComponent(dance.state)}`
        )
      ),
      runtime.handle(
        new Request(
          `${origin}/api/auth/callback/testProvider?code=${encodeURIComponent(dance.code)}&state=${encodeURIComponent(dance.state)}`
        )
      ),
    ]);
    const okCount = [a.status, b.status].filter(
      (status) => status < 400
    ).length;
    assert.equal(okCount, 1, "simultaneous consume has one winner");

    const wrongState = await runtime.handle(
      new Request(
        `${origin}/api/auth/callback/testProvider?code=x&state=not-a-state`
      )
    );
    assert.ok(wrongState.status >= 400);

    const start3 = await runtime.handle(
      new Request(`${origin}/api/auth/sign-in/social`, {
        body: JSON.stringify({
          callbackURL: `${origin}/dashboard`,
          provider: "testProvider",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    const started3 = await jsonBody(start3);
    const state3 = new URL(String(started3.url)).searchParams.get("state");
    const mixup = await runtime.handle(
      new Request(
        `${origin}/api/auth/callback/github?code=x&state=${encodeURIComponent(state3 ?? "")}`
      )
    );
    assert.ok(mixup.status >= 400);

    const { createRuntimeDependencies } = await import(
      "../../src/auth/local/runtime-dependencies.ts"
    );
    const { createAuthRouter } = await import("../../src/auth/local/router.ts");
    const { createAuthRequestMiddleware } = await import(
      "../../src/auth/local/request-middleware.ts"
    );
    const { createTestHasher } = await import(
      "./social-oauth-release-helpers.ts"
    );
    const deps = createRuntimeDependencies({
      autoMigrate: false,
      config: runtime.config,
      hasher: createTestHasher(),
      secret: "athena-social-oauth-release-secret-32!!",
    });
    const { handleRoute } = createAuthRouter(deps);
    const handle = createAuthRequestMiddleware({ deps, handleRoute });
    const expiredStart = await handle(
      new Request(`${origin}/api/auth/sign-in/social`, {
        body: JSON.stringify({
          callbackURL: `${origin}/dashboard`,
          provider: "testProvider",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    const expiredStarted = await jsonBody(expiredStart);
    const expiredAuth = await followProviderAuthorization(
      String(expiredStarted.url)
    );
    const social = await deps.getSocialRuntime();
    assert.ok(social);
    await social.store.expire(new Date(Date.now() + 11 * 60 * 1000));
    const expiredCb = await handle(
      new Request(
        `${origin}/api/auth/callback/testProvider?code=${encodeURIComponent(expiredAuth.code)}&state=${encodeURIComponent(expiredAuth.state)}`
      )
    );
    assert.ok(expiredCb.status >= 400, "expired state must fail closed");
    await deps.close();

    const nonceStart = await runtime.handle(
      new Request(`${origin}/api/auth/sign-in/social`, {
        body: JSON.stringify({
          callbackURL: `${origin}/dashboard`,
          provider: "testProvider",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    const nonceStarted = await jsonBody(nonceStart);
    const nonceDance = await followProviderAuthorization(
      String(nonceStarted.url),
      "wrong-nonce"
    );
    const nonceCb = await runtime.handle(
      new Request(
        `${origin}/api/auth/callback/testProvider?code=${encodeURIComponent(nonceDance.code)}&state=${encodeURIComponent(nonceDance.state)}`
      )
    );
    assert.ok(nonceCb.status >= 400, "wrong nonce must fail closed");

    const issStart = await runtime.handle(
      new Request(`${origin}/api/auth/sign-in/social`, {
        body: JSON.stringify({
          callbackURL: `${origin}/dashboard`,
          provider: "testProvider",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    const issStarted = await jsonBody(issStart);
    const issDance = await followProviderAuthorization(
      String(issStarted.url),
      "issuer-mismatch"
    );
    const issCb = await runtime.handle(
      new Request(
        `${origin}/api/auth/callback/testProvider?code=${encodeURIComponent(issDance.code)}&state=${encodeURIComponent(issDance.state)}`
      )
    );
    assert.ok(issCb.status >= 400, "wrong issuer must fail closed");

    const pkceStart = await runtime.handle(
      new Request(`${origin}/api/auth/sign-in/social`, {
        body: JSON.stringify({
          callbackURL: `${origin}/dashboard`,
          provider: "testProvider",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    const pkceStarted = await jsonBody(pkceStart);
    const pkceDance = await followProviderAuthorization(
      String(pkceStarted.url)
    );
    const tokenRes = await fetch(`${fixture.issuer}/oauth/token`, {
      body: new URLSearchParams({
        client_id: fixture.clientId,
        client_secret: fixture.clientSecret,
        code: pkceDance.code,
        code_verifier: "definitely-not-the-verifier",
        grant_type: "authorization_code",
        redirect_uri: `${origin}/api/auth/callback/testProvider`,
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    assert.ok(tokenRes.status >= 400, "wrong PKCE verifier is rejected");
  } finally {
    await runtime.close();
    await fixture.close();
  }
});

test("T-SO19-REDIRECT: P?: relative and trusted redirects accept; hostile URLs reject", async () => {
  const origin = "http://127.0.0.1:4182";
  const { validatePostAuthRedirect } = await import(
    "../../src/auth/social/server/redirect.ts"
  );
  const ctx = {
    origin,
    production: true,
    trustedOrigins: [origin, "https://app.example.test"],
  };
  assert.match(validatePostAuthRedirect("/settings", ctx), /\/settings$/);
  assert.match(
    validatePostAuthRedirect("https://app.example.test/app", ctx),
    /^https:\/\/app\.example\.test\/app/
  );
  assert.match(validatePostAuthRedirect(`${origin}/ok`, ctx), /\/ok$/);
  const rejected = [
    "https://evil.example/phish",
    "//evil.example",
    "javascript:alert(1)",
    "data:text/html,x",
    "https://user:pass@127.0.0.1:4182/x",
    "https://app.example.test.evil.com/x",
  ];
  for (const url of rejected) {
    await assert.rejects(async () =>
      Promise.resolve(validatePostAuthRedirect(url, ctx))
    );
  }
});

test("T-SO19-FIREWALL: P?: packed browser graphs omit social server secrets", () => {
  const surfaces = [
    join(srcRoot, "browser.ts"),
    join(srcRoot, "next", "client.ts"),
    ...collectFiles(join(srcRoot, "react-native"), /\.tsx?$/),
    ...collectFiles(authUiSrc, /\.tsx?$/),
    ...collectFiles(distRoot, /\.(js|cjs|mjs)$/).filter((file) => {
      const rel = relative(distRoot, file).replace(/\\/g, "/");
      return (
        rel === "browser.js" ||
        rel.startsWith("browser/") ||
        rel.startsWith("react/") ||
        rel.startsWith("react-native") ||
        rel.startsWith("next/client")
      );
    }),
  ];
  assert.ok(surfaces.some((file) => existsSync(file)));
  for (const file of surfaces) {
    if (!existsSync(file)) {
      continue;
    }
    const src = readFileSync(file, "utf8");
    const rel = relative(repoRoot, file).replace(/\\/g, "/");
    for (const needle of FORBIDDEN_BROWSER) {
      assert.equal(
        src.includes(needle),
        false,
        `${needle} must not appear in ${rel}`
      );
    }
    assert.equal(
      /from ["']pg["']|require\(["']pg["']\)/.test(src) &&
        /browser|next\/client|react-native|athena-auth-ui/.test(rel),
      false,
      `${rel} must not import pg`
    );
  }
});
