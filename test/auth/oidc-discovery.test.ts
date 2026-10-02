import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  resetOidcDiscoveryCache,
  resolveOidcProviderEndpoints,
} from "../../src/auth/oidc-discovery.ts";
import { athena } from "../../src/auth/social-providers/athena.ts";
import { AthenaConfigurationError } from "../../src/config/errors.ts";

test("OIDC discovery requires exact issuer match and caches metadata", async () => {
  resetOidcDiscoveryCache();
  let fetches = 0;
  const fetchImpl: typeof fetch = async (input) => {
    fetches += 1;
    assert.equal(
      String(input),
      "https://idp.example/.well-known/openid-configuration"
    );
    return new Response(
      JSON.stringify({
        authorization_endpoint: "https://idp.example/oauth/authorize",
        issuer: "https://idp.example",
        jwks_uri: "https://idp.example/.well-known/jwks.json",
        token_endpoint: "https://idp.example/oauth/token",
      }),
      { headers: { "content-type": "application/json" }, status: 200 }
    );
  };
  const first = await resolveOidcProviderEndpoints({
    fetch: fetchImpl,
    issuer: "https://idp.example",
  });
  const second = await resolveOidcProviderEndpoints({
    fetch: fetchImpl,
    issuer: "https://idp.example",
  });
  assert.equal(fetches, 1);
  assert.equal(
    first.authorizationEndpoint,
    "https://idp.example/oauth/authorize"
  );
  assert.equal(first.tokenEndpoint, "https://idp.example/oauth/token");
  assert.equal(second.authorizationEndpoint, first.authorizationEndpoint);
});

test("OIDC endpoints require HTTPS except development loopback", async () => {
  await assert.rejects(
    resolveOidcProviderEndpoints({
      cache: new Map(),
      issuer: "http://idp.example",
      fetch: async () => {
        throw new Error("insecure issuer must be rejected before discovery");
      },
    }),
    AthenaConfigurationError
  );
  await assert.rejects(
    resolveOidcProviderEndpoints({
      cache: new Map(),
      issuer: "https://idp.example",
      fetch: async () =>
        Response.json({
          authorization_endpoint: "http://idp.example/authorize",
          issuer: "https://idp.example",
          token_endpoint: "https://idp.example/token",
        }),
    }),
    AthenaConfigurationError
  );
  if (process.env.NODE_ENV !== "production") {
    const local = await resolveOidcProviderEndpoints({
      cache: new Map(),
      issuer: "http://localhost:8080",
      fetch: async () =>
        Response.json({
          authorization_endpoint: "http://localhost:8080/authorize",
          issuer: "http://localhost:8080",
          token_endpoint: "http://localhost:8080/token",
        }),
    });
    assert.equal(local.tokenEndpoint, "http://localhost:8080/token");
  }
});

test("OIDC discovery rejects issuer mismatch and missing endpoints", async () => {
  await assert.rejects(
    () =>
      resolveOidcProviderEndpoints({
        cache: new Map(),
        fetch: async () =>
          new Response(
            JSON.stringify({
              authorization_endpoint: "https://idp.example/oauth/authorize",
              issuer: "https://other.example",
              token_endpoint: "https://idp.example/oauth/token",
            }),
            { status: 200 }
          ),
        issuer: "https://idp.example",
      }),
    AthenaConfigurationError
  );
  await assert.rejects(
    () =>
      resolveOidcProviderEndpoints({
        cache: new Map(),
        fetch: async () =>
          new Response(
            JSON.stringify({
              issuer: "https://idp.example",
              token_endpoint: "https://idp.example/oauth/token",
            }),
            { status: 200 }
          ),
        issuer: "https://idp.example",
      }),
    AthenaConfigurationError
  );
});

test("OIDC discovery preserves a configured trailing-slash issuer exactly", async () => {
  const resolved = await resolveOidcProviderEndpoints({
    cache: new Map(),
    fetch: async (input) => {
      assert.equal(
        String(input),
        "https://idp.example/.well-known/openid-configuration"
      );
      return new Response(
        JSON.stringify({
          authorization_endpoint: "https://idp.example/oauth/authorize",
          issuer: "https://idp.example/",
          token_endpoint: "https://idp.example/oauth/token",
        }),
        { status: 200 }
      );
    },
    issuer: "https://idp.example/",
  });
  assert.equal(resolved.issuer, "https://idp.example/");
});

test("OIDC discovery rejects a slash-normalized document for a trailing-slash issuer", async () => {
  await assert.rejects(
    () =>
      resolveOidcProviderEndpoints({
        cache: new Map(),
        fetch: async () =>
          new Response(
            JSON.stringify({
              authorization_endpoint: "https://idp.example/oauth/authorize",
              issuer: "https://idp.example",
              token_endpoint: "https://idp.example/oauth/token",
            }),
            { status: 200 }
          ),
        issuer: "https://idp.example/",
      }),
    AthenaConfigurationError
  );
});

test("OIDC discovery rejects a trailing-slash issuer that is not byte-identical", async () => {
  await assert.rejects(
    () =>
      resolveOidcProviderEndpoints({
        cache: new Map(),
        fetch: async () =>
          new Response(
            JSON.stringify({
              authorization_endpoint: "https://idp.example/oauth/authorize",
              issuer: "https://idp.example/",
              token_endpoint: "https://idp.example/oauth/token",
            }),
            { status: 200 }
          ),
        issuer: "https://idp.example",
      }),
    AthenaConfigurationError
  );
});

test("generic OIDC provider resolves endpoints from discovery, not synthesized paths", async () => {
  const { createGenericOidcSocialProvider } = await import(
    "../../src/auth/social/server/generic-oidc-provider.ts"
  );
  const originalFetch = globalThis.fetch;
  let discoveryFetches = 0;
  globalThis.fetch = (async (input) => {
    if (String(input).includes("openid-configuration")) {
      discoveryFetches += 1;
      return new Response(
        JSON.stringify({
          authorization_endpoint: "https://generic.example/real/authorize",
          issuer: "https://generic.example",
          token_endpoint: "https://generic.example/real/token",
        }),
        { status: 200 }
      );
    }
    return originalFetch(input);
  }) as typeof fetch;
  try {
    const provider = createGenericOidcSocialProvider("custom-oidc", {
      clientId: "cid",
      clientSecret: "secret",
      issuer: "https://generic.example",
    });
    const url = await provider.createAuthorizationURL({
      codeVerifier: "verifier-012345678901234567890123456789",
      redirectURI: "https://app.example.com/callback",
      state: "state",
    });
    assert.equal(url.pathname, "/real/authorize");
    assert.equal(discoveryFetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit Athena endpoint overrides skip discovery fetch", async () => {
  let fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error("discovery must not run");
  }) as typeof fetch;
  try {
    const provider = athena({
      authorizationEndpoint: "https://idp.example/oauth/authorize",
      clientId: "cid",
      clientSecret: "secret",
      issuer: "https://idp.example",
      tokenEndpoint: "https://idp.example/oauth/token",
    });
    const url = await provider.createAuthorizationURL({
      codeVerifier: "verifier-012345678901234567890123456789",
      redirectURI: "https://app.example.com/callback",
      state: "state",
    });
    assert.equal(url.pathname, "/oauth/authorize");
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Athena provider resolves authorize and token from discovery", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    if (String(input).includes("openid-configuration")) {
      return new Response(
        JSON.stringify({
          authorization_endpoint: "https://athena.example/oauth/authorize",
          issuer: "https://athena.example",
          token_endpoint: "https://athena.example/oauth/token",
        }),
        { status: 200 }
      );
    }
    return originalFetch(input);
  }) as typeof fetch;
  try {
    const provider = athena({
      clientId: "cid",
      clientSecret: "secret",
      issuer: "https://athena.example",
    });
    const url = await provider.createAuthorizationURL({
      codeVerifier: "verifier-012345678901234567890123456789",
      redirectURI: "https://app.example.com/callback",
      state: "state",
    });
    assert.equal(url.origin, "https://athena.example");
    assert.equal(url.pathname, "/oauth/authorize");
    assert.doesNotMatch(url.pathname, /oauth2/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
