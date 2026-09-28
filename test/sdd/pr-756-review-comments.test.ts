/**
 * PR #756 review-comment regressions. Each title is `P?: <exact subject>`.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AthenaConfigurationError, createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function extractInterfaceBody(src: string, name: string): string {
  const header = new RegExp(`export interface ${name}\\b`);
  const match = header.exec(src);
  assert.ok(match, `missing export interface ${name}`);
  const brace = src.indexOf("{", match.index);
  assert.ok(brace >= 0, `missing body for ${name}`);
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return src.slice(match.index, i + 1);
      }
    }
  }
  assert.fail(`unclosed interface ${name}`);
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}

function resolveImport(fromFile: string, spec: string): string | undefined {
  if (!(spec.startsWith("./") || spec.startsWith("../"))) {
    return;
  }
  const raw = join(dirname(fromFile), spec);
  const candidates = [raw, `${raw}.ts`, `${raw}.tsx`, join(raw, "index.ts")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return normalize(candidate);
    }
  }
}

const VALUE_FROM =
  /(?:^|\n)(?:import|export)(?!\s+type\b)[\s\S]*?\bfrom\s+["']([^"']+)["']/g;

function collectValueImportGraph(entryRel: string): string[] {
  const entry = normalize(join(srcRoot, entryRel));
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file) || !existsSync(file)) {
      continue;
    }
    seen.add(file);
    const src = readFileSync(file, "utf8");
    VALUE_FROM.lastIndex = 0;
    let match = VALUE_FROM.exec(src);
    while (match) {
      const resolved = resolveImport(file, match[1] ?? "");
      if (resolved && !seen.has(resolved)) {
        queue.push(resolved);
      }
      match = VALUE_FROM.exec(src);
    }
  }
  return [...seen];
}

test("P?: Expose social options on the actual createClient config", () => {
  const body = extractInterfaceBody(
    readSrc("client/contracts.ts"),
    "AthenaAuthConfig"
  );
  assert.match(
    body,
    /\bsocial\??\s*:/,
    "AthenaAuthConfig must declare social for createClient({ auth })"
  );
  assert.match(
    body,
    /\boauth\??\s*:/,
    "AthenaAuthConfig must declare oauth alias for createClient({ auth })"
  );
  assert.match(
    body,
    /\bsocialProviders\??\s*:/,
    "AthenaAuthConfig must declare socialProviders alias for createClient({ auth })"
  );
  const client = createClient({
    auth: {
      mode: "remote",
      oauth: {
        github: { clientId: "gh", clientSecret: "ghs" },
      },
      social: {
        providers: {
          google: { clientId: "g", clientSecret: "gs" },
        },
      },
      socialProviders: {
        apple: { clientId: "a", clientSecret: "as" },
      },
      url: "https://auth.example.test",
    },
    env: {},
  });
  assert.ok(client);
});

test("P?: Keep provider secrets out of the browser import graph", () => {
  const graph = collectValueImportGraph("browser.ts");
  assert.ok(graph.length > 1, "browser.ts must have a value-import graph");
  const leaked = graph.filter((file) => {
    const rel = relative(srcRoot, file).replace(/\\/g, "/");
    if (
      rel.startsWith("auth/social/server/") ||
      rel.startsWith("auth/local/social/")
    ) {
      return true;
    }
    const src = readFileSync(file, "utf8");
    return (
      src.includes("function normalizeSocialAuthConfig") ||
      /clientSecret:\s*asString\(\s*record\.clientSecret\s*\)/.test(src)
    );
  });
  assert.deepEqual(
    leaked.map((file) => relative(pkgRoot, file).replace(/\\/g, "/")),
    [],
    "browser value imports must not include the social secret normalizer or social/server tree"
  );
});

test("P?: Account for environment-derived services before waiving the key", () => {
  assert.throws(
    () =>
      createClient({
        auth: {
          mode: "remote",
          url: "https://auth.example",
        },
        env: {
          ATHENA_URL: "https://gateway.example",
        },
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_API_KEY_REQUIRED",
    "env ATHENA_URL must require an API key even when only auth.url is explicit"
  );
});

test("P?: Reject providers that omit the client secret", async () => {
  const engineMod = (await import(
    pathToFileURL(join(srcRoot, "auth/social/server/engine.ts")).href
  )) as {
    createAthenaSocialServerEngine: (ports: unknown) => {
      startAuthorization: (input: unknown) => Promise<unknown>;
    };
  };
  let created = 0;
  const engine = engineMod.createAthenaSocialServerEngine({
    encryptionKey: "athena-social-oauth-engine-secret",
    secret: "athena-social-oauth-engine-secret",
    social: {
      providers: {
        github: { clientId: "id", clientSecret: "" },
      },
    },
    transactions: {
      consume: async () => null,
      create: async () => {
        created += 1;
      },
    },
  });
  await assert.rejects(
    () =>
      engine.startAuthorization({
        intent: "sign-in",
        provider: "github",
        redirectUri: "https://app.example.test/api/auth/callback/github",
      }),
    (error: unknown) => {
      const code = errorCode(error);
      return (
        code === "ATHENA_AUTH_OAUTH_CLIENT_SECRET_REQUIRED" ||
        code === "ATHENA_AUTH_OAUTH_PROVIDER_UNKNOWN"
      );
    }
  );
  assert.equal(
    created,
    0,
    "must not persist a transaction before the secret exists"
  );
});

test("P?: Support PKCE for every declared registry provider", async () => {
  const engineMod = (await import(
    pathToFileURL(join(srcRoot, "auth/social/server/engine.ts")).href
  )) as {
    createAthenaSocialServerEngine: (ports: unknown) => {
      startAuthorization: (input: unknown) => Promise<{
        authorizationURL?: string;
        url?: string;
      }>;
    };
  };
  for (const provider of ["apple", "discord"] as const) {
    const created: unknown[] = [];
    const engine = engineMod.createAthenaSocialServerEngine({
      encryptionKey: "athena-social-oauth-engine-secret",
      secret: "athena-social-oauth-engine-secret",
      social: {
        providers: {
          [provider]: {
            clientId: `${provider}-id`,
            clientSecret: `${provider}-secret`,
          },
        },
      },
      transactions: {
        consume: async () => null,
        create: async (row: unknown) => {
          created.push(row);
        },
      },
    });
    const started = await engine.startAuthorization({
      intent: "sign-in",
      provider,
      redirectUri: `https://app.example.test/api/auth/callback/${provider}`,
    });
    const url = new URL(String(started.authorizationURL ?? started.url ?? ""));
    assert.equal(
      url.searchParams.get("code_challenge_method"),
      "S256",
      `${provider} authorization URL must emit PKCE S256`
    );
    assert.ok(
      url.searchParams.get("code_challenge"),
      `${provider} authorization URL must include code_challenge`
    );
    assert.equal(created.length, 1, `${provider} must persist a transaction`);
  }
});

test("P?: Keep user IDs out of sign-in transactions", async () => {
  const engineMod = (await import(
    pathToFileURL(join(srcRoot, "auth/social/server/engine.ts")).href
  )) as {
    createAthenaSocialServerEngine: (ports: unknown) => {
      startAuthorization: (input: unknown) => Promise<unknown>;
    };
  };
  const created: Array<{ userId?: unknown; user_id?: unknown }> = [];
  const engine = engineMod.createAthenaSocialServerEngine({
    encryptionKey: "athena-social-oauth-engine-secret",
    secret: "athena-social-oauth-engine-secret",
    social: {
      providers: {
        github: { clientId: "gh-id", clientSecret: "gh-secret" },
      },
    },
    transactions: {
      consume: async () => null,
      create: async (row: { userId?: unknown; user_id?: unknown }) => {
        created.push(row);
      },
    },
  });
  await engine.startAuthorization({
    intent: "sign-in",
    provider: "github",
    redirectUri: "https://app.example.test/api/auth/callback/github",
    user_id: "attacker-user-snake",
    userId: "attacker-user",
  });
  assert.equal(created.length, 1, "sign-in must persist a transaction");
  assert.equal(
    created[0]?.userId ?? created[0]?.user_id ?? null,
    null,
    "sign-in must not persist a caller-controlled user id"
  );
});
