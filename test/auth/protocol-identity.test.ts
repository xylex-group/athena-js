import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import {
  hasProcessTokenKeyStore,
  resetProcessTokenKeyStores,
} from "../../src/auth/local/token-key-store.ts";
import {
  createAthenaAuthProtocolIdentity,
  tryCreateAthenaAuthProtocolIdentity,
} from "../../src/auth/protocol-identity.ts";
import { AthenaConfigurationError } from "../../src/config/errors.ts";

const ISSUER = "https://issuer.example";

function hasher() {
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

test("protocol identity rejects pathful issuers", () => {
  assert.throws(
    () =>
      createAthenaAuthProtocolIdentity({
        appIdentity: {
          hostname: "issuer.example",
          name: "app",
          origin: "https://issuer.example",
        },
        authorizationServer: {
          ...normalizeAthenaAuthConfig({
            authorizationServer: {
              enabled: true,
              issuer: "https://issuer.example",
            },
          }).authorizationServer,
          issuer: "https://issuer.example/auth",
        },
        basePath: "/api/auth",
      }),
    AthenaConfigurationError
  );
  assert.throws(
    () =>
      normalizeAthenaAuthConfig({
        authorizationServer: {
          enabled: true,
          issuer: "https://issuer.example/tenant",
        },
      }),
    /origin-only|pathful/
  );
});

test("hostile Host Origin and X-Forwarded-Host cannot change protocol identity", async () => {
  const runtime = createAthenaAuthRuntime({
    app: { url: ISSUER },
    autoMigrate: false,
    hasher: hasher(),
  });
  try {
    const signUp = await runtime.handle(
      new Request(`${ISSUER}/api/auth/sign-up/email`, {
        body: JSON.stringify({
          email: "identity@example.com",
          name: "Identity",
          password: "Password123!",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    assert.equal(signUp.status, 200, await signUp.clone().text());
    const cookie = (signUp.headers.get("set-cookie") ?? "").split(";")[0];
    const hostileHeaders = {
      "content-type": "application/json",
      cookie,
      host: "evil.example",
      origin: "https://evil.example",
      "x-forwarded-host": "spoofed.example",
    };
    const [discovery, jwks, token] = await Promise.all([
      runtime.handle(
        new Request(
          "https://evil.example/api/auth/.well-known/openid-configuration",
          {
            headers: hostileHeaders,
          }
        )
      ),
      runtime.handle(
        new Request("https://evil.example/api/auth/.well-known/jwks.json", {
          headers: hostileHeaders,
        })
      ),
      runtime.handle(
        new Request("https://evil.example/api/auth/token", {
          body: JSON.stringify({ audience: "athena" }),
          headers: hostileHeaders,
          method: "POST",
        })
      ),
    ]);
    assert.equal(discovery.status, 200);
    const document = (await discovery.json()) as {
      issuer: string;
      jwks_uri: string;
      token_endpoint: string;
      userinfo_endpoint?: string;
      response_types_supported: string[];
    };
    assert.equal(document.issuer, ISSUER);
    assert.equal(document.jwks_uri, `${ISSUER}/api/auth/.well-known/jwks.json`);
    assert.equal(document.token_endpoint, `${ISSUER}/api/auth/token`);
    assert.equal(document.userinfo_endpoint, undefined);
    assert.deepEqual(document.response_types_supported, []);
    assert.equal("id_token_signing_alg_values_supported" in document, false);
    assert.equal(jwks.status, 200);
    assert.equal(token.status, 200, await token.clone().text());
    const issued = (await token.json()) as { issuer: string; token: string };
    assert.equal(issued.issuer, ISSUER);
    const payload = JSON.parse(
      Buffer.from(issued.token.split(".")[1] ?? "", "base64url").toString()
    ) as { iss: string };
    assert.equal(payload.iss, ISSUER);
  } finally {
    await runtime.close();
  }
});

test("protocol identity never uses trustedOrigins as the issuer", () => {
  const identity = tryCreateAthenaAuthProtocolIdentity({
    appIdentity: null,
    authorizationServer: normalizeAthenaAuthConfig({}).authorizationServer,
    basePath: "/api/auth",
    environment: "production",
  });
  assert.equal(identity, null);
  assert.throws(
    () =>
      createAthenaAuthProtocolIdentity({
        appIdentity: null,
        authorizationServer: normalizeAthenaAuthConfig({
          security: { trustedOrigins: ["https://app.example"] },
        }).authorizationServer,
        basePath: "/api/auth",
        environment: "production",
      }),
    AthenaConfigurationError
  );
});

test("protocol identity fails at construction in production without an init-time URL", () => {
  assert.throws(
    () =>
      createAthenaAuthProtocolIdentity({
        appIdentity: null,
        authorizationServer: normalizeAthenaAuthConfig({}).authorizationServer,
        basePath: "/api/auth",
        environment: "production",
      }),
    AthenaConfigurationError
  );
});

test("production Embedded Auth starts without protocol identity", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const runtime = createAthenaAuthRuntime({
      autoMigrate: false,
      env: {},
      hasher: hasher(),
    });
    try {
      const jwks = await runtime.handle(
        new Request("https://auth.example/api/auth/.well-known/jwks.json")
      );
      assert.equal(jwks.status, 500);
      const body = (await jwks.json()) as { code?: string };
      assert.equal(body.code, "ATHENA_RUNTIME_CONFIG_INVALID");
    } finally {
      await runtime.close();
    }
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("production memory Auth refuses ephemeral JWT signing keys", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  resetProcessTokenKeyStores();
  try {
    const runtime = createAthenaAuthRuntime({
      autoMigrate: false,
      config: normalizeAthenaAuthConfig({
        app: { url: "https://auth.example" },
        authorizationServer: {
          enabled: true,
          issuer: "https://auth.example",
          resources: {
            "https://resource.example": {
              scopes: { "invoice:read": {} },
            },
          },
        },
        mode: "local",
      }),
      hasher: hasher(),
    });
    try {
      const origin = "https://auth.example/api/auth";
      const responses = await Promise.all([
        runtime.handle(new Request(`${origin}/.well-known/jwks.json`)),
        runtime.handle(
          new Request(`${origin}/.well-known/openid-configuration`)
        ),
        runtime.handle(
          new Request(`${origin}/token`, {
            body: JSON.stringify({ audience: "athena" }),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        ),
        runtime.handle(
          new Request(`${origin}/.well-known/oauth-authorization-server`)
        ),
      ]);
      for (const response of responses) {
        assert.equal(response.status, 500, await response.clone().text());
        const body = (await response.json()) as { code?: string };
        assert.equal(body.code, "ATHENA_AUTH_TOKEN_STORE_REQUIRED");
      }
      assert.equal(hasProcessTokenKeyStore("https://auth.example"), false);
    } finally {
      await runtime.close();
    }
  } finally {
    process.env.NODE_ENV = previous;
    resetProcessTokenKeyStores();
  }
});

test("legacy discovery is jwt capability not oidc", async () => {
  const { ATHENA_AUTH_OPERATIONS } = await import(
    "../../src/auth/contract/operations.generated.ts"
  );
  const discovery = ATHENA_AUTH_OPERATIONS.find(
    (operation) => operation.path === "/.well-known/openid-configuration"
  );
  assert.ok(discovery);
  assert.equal(discovery.capability, "jwt");
  assert.equal(discovery.id, "jwt.discovery");
  const oidcOps = ATHENA_AUTH_OPERATIONS.filter(
    (operation) => operation.capability === "oidc"
  );
  assert.equal(oidcOps.length, 0);
});
