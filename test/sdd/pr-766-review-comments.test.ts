/**
 * PR #766 review-comment regressions. Each title is `P?: <exact subject>`.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { createMemoryOAuthTransactionStore } from "../../src/auth/local/social/memory-store.ts";
import { openPkceEnvelope } from "../../src/auth/local/social/pkce-encryption.ts";
import { advertisedSocialProviderIds } from "../../src/auth/local/social/runtime.ts";
import { createAthenaSocialServerEngine } from "../../src/auth/social/server/engine.ts";
import { normalizeSocialAuthConfig } from "../../src/auth/social/server/social-config.ts";
import {
  type OAuthTransactionRecord,
  sha256Hex,
} from "../../src/auth/social/server/transaction-store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

const RUNTIME_SECRET = "athena-pr-766-review-secret";
const APP_ORIGIN = "https://app.example.test";
const LOCAL_ORIGIN = "http://app.local";
const DASHBOARD = `${APP_ORIGIN}/dashboard`;
const REDIRECT_URI = `${LOCAL_ORIGIN}/api/auth/callback/google`;

type JsonRecord = Record<string, unknown>;

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function createTestHasher() {
  return {
    async hash(password: string) {
      return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
    },
    needsRehash(hash: string) {
      return passwordHashNeedsRehash(hash, ATHENA_AUTH_DEFAULT_ARGON2);
    },
    async verify(password: string, hash: string) {
      return hash.endsWith(Buffer.from(password).toString("base64url"));
    },
  };
}

function unsignedJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" })
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

function socialConfig(extraGoogle: Record<string, unknown> = {}) {
  const social = {
    providers: {
      apple: {
        clientId: "apple-client",
        clientSecret: "apple-secret",
      },
      google: {
        clientId: "google-client",
        clientSecret: "google-secret",
        ...extraGoogle,
      },
    },
  };
  return {
    ...normalizeAthenaAuthConfig({
      basePath: "/api/auth",
      mode: "local",
      secret: RUNTIME_SECRET,
      security: {
        trustedOrigins: [APP_ORIGIN, LOCAL_ORIGIN],
      },
      social,
    }),
    social: normalizeSocialAuthConfig({ social }),
  };
}

function createSocialRuntime(extra?: {
  google?: Record<string, unknown>;
  hooks?: Parameters<typeof createAthenaAuthRuntime>[0]["hooks"];
}) {
  return createAthenaAuthRuntime({
    autoMigrate: false,
    config: socialConfig(extra?.google),
    hasher: createTestHasher(),
    hooks: extra?.hooks,
    secret: RUNTIME_SECRET,
  });
}

async function jsonBody(response: Response): Promise<JsonRecord> {
  return (await response.json()) as JsonRecord;
}

function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = /(?:^|,)\s*([^=]+=[^;]+)/.exec(header);
  return match?.[1] ?? header.split(";")[0] ?? "";
}

function withMockedTokenEndpoint(idToken: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (
      url.includes("oauth2.googleapis.com/token") ||
      url.includes("appleid.apple.com/auth/token") ||
      url.includes("id.twitch.tv/oauth2/token")
    ) {
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          id_token: idToken,
          token_type: "Bearer",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        }
      );
    }
    return original(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function startGoogleSignIn(
  runtime: ReturnType<typeof createSocialRuntime>,
  callbackURL = DASHBOARD
) {
  const response = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/sign-in/social`, {
      body: JSON.stringify({
        callbackURL,
        provider: "google",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  const body = await jsonBody(response);
  const authorize = new URL(String(body.url));
  const state = authorize.searchParams.get("state");
  const nonce = authorize.searchParams.get("nonce");
  assert.ok(state);
  assert.ok(nonce);
  return { nonce, state };
}

test("P?: Verify ID tokens before consuming their claims", async () => {
  const routesSrc = readSrc("auth/local/social/routes.ts");
  assert.match(
    routesSrc,
    /verifyIdToken\s*\(/,
    "callback must invoke provider.verifyIdToken, not only decodeJwt"
  );
  assert.ok(
    routesSrc.indexOf("verifyIdToken") < routesSrc.indexOf("getUserInfo"),
    "provider.verifyIdToken must run before getUserInfo"
  );

  const runtime = createSocialRuntime();
  const { nonce, state } = await startGoogleSignIn(runtime);
  const restore = withMockedTokenEndpoint(
    unsignedJwt({
      email: "forged@example.test",
      email_verified: true,
      iss: "https://evil.example",
      nonce,
      sub: "forged-google-sub",
    })
  );
  try {
    const callback = await runtime.handle(
      new Request(
        `${LOCAL_ORIGIN}/api/auth/callback/google?code=forged-code&state=${encodeURIComponent(state)}`
      )
    );
    assert.ok(
      callback.status >= 400,
      "unsigned ID tokens must be rejected before getUserInfo consumes claims"
    );
    const stores = await runtime.getStores();
    assert.equal(await stores.getUserByEmail("forged@example.test"), undefined);
  } finally {
    restore();
  }
});

test("P?: Move social account creation inside the mutation executor", async () => {
  const routesSrc = readSrc("auth/local/social/routes.ts");
  assert.match(
    routesSrc,
    /event:\s*"account\.link"[\s\S]{0,900}execute:[\s\S]{0,500}resolveOrCreateSocialAccount/,
    "account.link execute must create the account inside the mutation transaction"
  );
  assert.equal(
    routesSrc.includes("await resolveOrCreateSocialAccount(ctx"),
    false,
    "must not insert the social account before deps.mutate"
  );

  const runtime = createSocialRuntime({
    google: {
      verifyIdToken: async () => true,
    },
    hooks: {
      before: {
        "account.link": async () => {
          throw new Error("link veto");
        },
      },
    },
  });
  const signup = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: "linker@example.test",
        name: "Linker",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  const cookie = sessionCookie(signup);
  const start = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/link-social`, {
      body: JSON.stringify({
        callbackURL: `${APP_ORIGIN}/settings`,
        provider: "google",
      }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(start.status, 200);
  const started = await jsonBody(start);
  const authorize = new URL(String(started.url));
  const state = authorize.searchParams.get("state");
  const nonce = authorize.searchParams.get("nonce");
  assert.ok(state);
  assert.ok(nonce);
  const restore = withMockedTokenEndpoint(
    unsignedJwt({
      email: "linker@example.test",
      email_verified: true,
      nonce,
      sub: "google-link-sub",
    })
  );
  try {
    const callback = await runtime.handle(
      new Request(
        `${LOCAL_ORIGIN}/api/auth/callback/google?code=link-code&state=${encodeURIComponent(state)}`
      )
    );
    assert.ok(
      callback.status >= 400,
      "vetoing account.link must fail the callback"
    );
    const stores = await runtime.getStores();
    const user = await stores.getUserByEmail("linker@example.test");
    assert.ok(user);
    const accounts = await stores.listAccounts(user.id);
    assert.equal(
      accounts.some((row) => row.provider_id === "google"),
      false,
      "vetoed account.link must not leave a committed google account"
    );
  } finally {
    restore();
  }
});

test("P?: Reject social sign-in for banned users", async () => {
  const routesSrc = readSrc("auth/local/social/routes.ts");
  assert.match(routesSrc, /isUserEffectivelyBanned/);

  const runtime = createSocialRuntime({
    google: {
      verifyIdToken: async () => true,
    },
  });
  const signup = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: "banned@example.test",
        name: "Banned",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("banned@example.test");
  assert.ok(user);
  await stores.updateUser(user.id, {
    banExpires: null,
    banned: true,
    banReason: "review",
  });
  await stores.createAccount({
    accountId: "banned-google-sub",
    id: crypto.randomUUID(),
    providerId: "google",
    userId: user.id,
  });

  const { nonce, state } = await startGoogleSignIn(runtime);
  const restore = withMockedTokenEndpoint(
    unsignedJwt({
      email: "banned@example.test",
      email_verified: true,
      nonce,
      sub: "banned-google-sub",
    })
  );
  try {
    const callback = await runtime.handle(
      new Request(
        `${LOCAL_ORIGIN}/api/auth/callback/google?code=banned-code&state=${encodeURIComponent(state)}`
      )
    );
    assert.ok(
      callback.status >= 400,
      "effectively banned users must not mint a social session"
    );
    const session = await runtime.handle(
      new Request(`${LOCAL_ORIGIN}/api/auth/get-session`, {
        headers: {
          cookie: sessionCookie(callback),
        },
      })
    );
    const body = await jsonBody(session);
    assert.equal(body.session ?? body.user ?? null, null);
  } finally {
    restore();
  }
});

test("P?: Bound and durably store post-auth redirects", async () => {
  const runtimeSrc = readSrc("auth/local/social/runtime.ts");
  assert.equal(
    /new Map\s*</.test(runtimeSrc),
    false,
    "post-auth URLs must not live in an unbounded process-local Map"
  );
  const engineSrc = readSrc("auth/social/server/engine.ts");
  assert.match(engineSrc, /postAuthRedirect/);

  const store = createMemoryOAuthTransactionStore();
  const engine = createAthenaSocialServerEngine({
    secret: RUNTIME_SECRET,
    social: {
      providers: {
        google: {
          clientId: "google-client",
          clientSecret: "google-secret",
        },
      },
    },
    transactions: store,
  });
  const started = await engine.startAuthorization({
    intent: "sign-in",
    postAuthRedirect: DASHBOARD,
    provider: "google",
    redirectUri: REDIRECT_URI,
  });
  const stateHash = await sha256Hex(started.state);
  const row = await store.consume(stateHash);
  assert.ok(row);
  const envelope = await openPkceEnvelope(
    row.pkceVerifierCiphertext,
    RUNTIME_SECRET
  );
  assert.equal(
    envelope.postAuthRedirect,
    DASHBOARD,
    "post-auth URL must be stored with the expiring OAuth transaction"
  );
});

test("P?: Accept form-post callbacks for Apple", async () => {
  const routesSrc = readSrc("auth/local/social/routes.ts");
  assert.match(
    routesSrc,
    /method === "POST"[\s\S]{0,180}\/callback\/|POST[\s\S]{0,80}callback/
  );

  const runtime = createSocialRuntime();
  const response = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/callback/apple`, {
      body: "code=apple-code&state=apple-state",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    })
  );
  assert.notEqual(
    response.status,
    404,
    "Apple form_post callbacks must not fall through to 404"
  );
  assert.ok(
    response.status === 400 ||
      response.status === 302 ||
      response.status === 501,
    "POST /callback/apple must be recognized as a social callback"
  );
});

test("P1: Check the last credential inside the unlink transaction", () => {
  const routesSrc = readSrc("auth/local/social/routes.ts");
  const unlinkStart = routesSrc.indexOf("async function runAccountUnlink");
  assert.ok(unlinkStart >= 0, "runAccountUnlink must exist");
  const unlinkFn = routesSrc.slice(unlinkStart, unlinkStart + 1800);
  assert.match(
    unlinkFn,
    /event:\s*"account\.unlink"[\s\S]{0,500}execute:[\s\S]{0,700}countRemainingAuthenticationMethods\s*\(\s*scope\.stores/,
    "last-credential count must run inside the account.unlink transaction on scope.stores"
  );
  assert.match(
    unlinkFn,
    /execute:[\s\S]{0,900}listAccounts/,
    "account lookup must run inside the same mutate execute as deletion"
  );
  const handlerStart = routesSrc.indexOf('path === "/unlink-account"');
  assert.ok(handlerStart >= 0);
  const beforeMutate = routesSrc.slice(
    handlerStart,
    routesSrc.indexOf("runAccountUnlink", handlerStart)
  );
  assert.equal(
    /countRemainingAuthenticationMethods|remainingAuthenticationMethods/.test(
      beforeMutate
    ),
    false,
    "pre-transaction remaining-method count is the concurrent last-credential race"
  );
});

test("P1: Allow provider-originated form-post callbacks", async () => {
  const middlewareSrc = readSrc("auth/local/request-middleware.ts");
  assert.match(
    middlewareSrc,
    /callback/,
    "origin enforcement must special-case state-protected social callbacks"
  );

  const runtime = createSocialRuntime();
  const response = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/callback/apple`, {
      body: "code=apple-code&state=apple-state",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://appleid.apple.com",
      },
      method: "POST",
    })
  );
  assert.notEqual(
    response.status,
    403,
    "Apple form_post Origin appleid.apple.com must not be rejected before the state-protected callback"
  );
});

test("P1: Reject ID tokens from providers without a verifier", async () => {
  const routesSrc = readSrc("auth/local/social/routes.ts");
  assert.match(
    routesSrc,
    /tokens\.idToken[\s\S]{0,180}verifyIdToken/,
    "ID tokens must not skip verification when the provider has no verifier"
  );
  assert.equal(
    /if\s*\(\s*tokens\.idToken\s*&&\s*provider\.verifyIdToken\s*\)/.test(
      routesSrc
    ),
    false,
    "Twitch/Paybin decode idToken without verifyIdToken; skipping the verifier branch is the found case"
  );

  const social = {
    providers: {
      twitch: {
        clientId: "twitch-client",
        clientSecret: "twitch-secret",
      },
    },
  };
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    config: {
      ...normalizeAthenaAuthConfig({
        basePath: "/api/auth",
        mode: "local",
        secret: RUNTIME_SECRET,
        security: { trustedOrigins: [APP_ORIGIN, LOCAL_ORIGIN] },
        social,
      }),
      social: normalizeSocialAuthConfig({ social }),
    },
    hasher: createTestHasher(),
    secret: RUNTIME_SECRET,
  });
  const start = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/sign-in/social`, {
      body: JSON.stringify({
        callbackURL: DASHBOARD,
        provider: "twitch",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(start.status, 200);
  const started = await jsonBody(start);
  const authorize = new URL(String(started.url));
  const state = authorize.searchParams.get("state");
  assert.ok(state);
  const restore = withMockedTokenEndpoint(
    unsignedJwt({
      email: "twitch-forged@example.test",
      email_verified: true,
      sub: "twitch-forged-sub",
    })
  );
  try {
    const callback = await runtime.handle(
      new Request(
        `${LOCAL_ORIGIN}/api/auth/callback/twitch?code=forged-code&state=${encodeURIComponent(state)}`
      )
    );
    assert.ok(
      callback.status >= 400,
      "Twitch ID tokens must be rejected when no verifier exists"
    );
    const stores = await runtime.getStores();
    assert.equal(
      await stores.getUserByEmail("twitch-forged@example.test"),
      undefined
    );
  } finally {
    restore();
  }
});

test("P2: Advertise only provider IDs present in the registry", () => {
  const ids = advertisedSocialProviderIds({
    providers: {
      google: {
        clientId: "google-client",
        clientSecret: "google-secret",
      },
      "not-a-real-provider": {
        clientId: "typo-client",
        clientSecret: "typo-secret",
      },
    },
  });
  assert.deepEqual(ids, ["google"]);
  assert.equal(ids.includes("not-a-real-provider"), false);
});

test("P1: Require the ID token to contain the transaction nonce", async () => {
  const routesSrc = readSrc("auth/local/social/routes.ts");
  assert.equal(
    /if\s*\(\s*typeof claims\.nonce === "string"\s*&&\s*claims\.nonce\.length > 0\s*\)/.test(
      routesSrc
    ),
    false,
    "a missing nonce claim must not skip transaction binding"
  );

  const runtime = createSocialRuntime({
    google: {
      verifyIdToken: async () => true,
    },
  });
  const { state } = await startGoogleSignIn(runtime);
  const restore = withMockedTokenEndpoint(
    unsignedJwt({
      email: "nonce-missing@example.test",
      email_verified: true,
      sub: "google-nonce-missing",
    })
  );
  try {
    const callback = await runtime.handle(
      new Request(
        `${LOCAL_ORIGIN}/api/auth/callback/google?code=nonce-missing&state=${encodeURIComponent(state)}`
      )
    );
    assert.ok(
      callback.status >= 400,
      "ID tokens without a nonce claim must not authenticate"
    );
    const stores = await runtime.getStores();
    assert.equal(
      await stores.getUserByEmail("nonce-missing@example.test"),
      undefined
    );
  } finally {
    restore();
  }
});

test("P2: Advertise social providers only when encryption is available", async () => {
  const social = {
    providers: {
      google: {
        clientId: "google-client",
        clientSecret: "google-secret",
      },
    },
  };
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    config: {
      ...normalizeAthenaAuthConfig({
        basePath: "/api/auth",
        mode: "local",
        security: { trustedOrigins: [LOCAL_ORIGIN] },
        social,
      }),
      social: normalizeSocialAuthConfig({ social }),
    },
    hasher: createTestHasher(),
  });
  const ok = await runtime.handle(new Request(`${LOCAL_ORIGIN}/api/auth/ok`));
  assert.equal(ok.status, 200);
  const body = await jsonBody(ok);
  const capabilities = body.capabilities as
    | { social?: { providers?: unknown } }
    | undefined;
  const providers = capabilities?.social?.providers;
  assert.ok(Array.isArray(providers));
  assert.deepEqual(
    providers,
    ["google"],
    "/ok advertises configured social providers even when social runtime is null"
  );
  const start = await runtime.handle(
    new Request(`${LOCAL_ORIGIN}/api/auth/sign-in/social`, {
      body: JSON.stringify({
        callbackURL: `${LOCAL_ORIGIN}/dashboard`,
        provider: "google",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(
    start.status,
    501,
    "operational social (no encryption/runtime) belongs on social routes, not /ok"
  );
});

function sampleTransaction(
  overrides: Partial<OAuthTransactionRecord> = {}
): OAuthTransactionRecord {
  return {
    codeChallengeMethod: "S256",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    id: crypto.randomUUID(),
    intent: "sign-in",
    nonceHash: "nonce-hash",
    pkceVerifierCiphertext: "cipher",
    providerId: "google",
    redirectUri: REDIRECT_URI,
    stateHash: "state-hash",
    userId: null,
    ...overrides,
  };
}

test("P1: Expire abandoned OAuth transactions", async () => {
  const engineSrc = readSrc("auth/social/server/engine.ts");
  assert.match(
    engineSrc,
    /\.expire\s*\(/,
    "startAuthorization must invoke OAuthTransactionStore.expire so abandoned rows cannot grow unbounded"
  );

  const store = createMemoryOAuthTransactionStore();
  await store.create(
    sampleTransaction({
      expiresAt: new Date(Date.now() - 5000),
      stateHash: "abandoned-expired",
    })
  );
  assert.equal(await store.consume("abandoned-expired"), null);
  assert.equal(
    await store.expire(new Date()),
    0,
    "expired consume must delete the abandoned row, not leave it in memory"
  );

  let expireCalls = 0;
  const engine = createAthenaSocialServerEngine({
    secret: RUNTIME_SECRET,
    social: {
      providers: {
        google: {
          clientId: "google-client",
          clientSecret: "google-secret",
        },
      },
    },
    transactions: {
      consume: (stateHash) => store.consume(stateHash),
      create: (row) => store.create(row as OAuthTransactionRecord),
      expire: async (now?: Date) => {
        expireCalls += 1;
        return store.expire(now);
      },
    },
  });
  await engine.startAuthorization({
    intent: "sign-in",
    postAuthRedirect: DASHBOARD,
    provider: "google",
    redirectUri: REDIRECT_URI,
  });
  assert.ok(
    expireCalls >= 1,
    "engine start must expire abandoned transactions"
  );
});
