import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAuthModule } from "../../src/auth/client.ts";
import { createAuthCompatibilityAlias } from "../../src/auth/client/compatibility.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = join(pkgRoot, "src");
const fixturePath = join(pkgRoot, "test/fixtures/auth-client-api-shape.json");

function extractAuthIndexExports(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([\s\S]*?)\}/g)) {
    for (const part of match[1].split(",")) {
      const ident = part
        .replace(/\/\/[^\n]*/g, "")
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim()
        .split(/\s+/)[0];
      if (ident && /^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
        names.add(ident);
      }
    }
  }
  for (const match of source.matchAll(
    /export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/g
  )) {
    names.add(match[1]);
  }
  return [...names].sort();
}

function walk(value: unknown): unknown {
  if (typeof value === "function") {
    const fn = value as { length: number; name?: string };
    return { arity: fn.length, kind: "fn", name: fn.name || null };
  }
  if (!value || typeof value !== "object") {
    return { kind: typeof value };
  }
  const members: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    members[key] = walk((value as Record<string, unknown>)[key]);
  }
  return {
    keys: Object.keys(value).sort(),
    kind: "object",
    members,
  };
}

test("athena.auth public shape matches the frozen golden snapshot", () => {
  const expected = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    authKeys: string[];
    moduleKeys: string[];
    auth: unknown;
    module: unknown;
    declarationExports: string[];
  };
  const mod = createAuthModule();
  assert.deepEqual(Object.keys(mod).sort(), expected.moduleKeys);
  assert.deepEqual(Object.keys(mod.auth).sort(), expected.authKeys);
  assert.deepEqual(walk(mod.auth), expected.auth);
  assert.deepEqual(walk(mod), expected.module);
  const declarationExports = extractAuthIndexExports(
    readFileSync(join(srcRoot, "auth/index.ts"), "utf8")
  );
  assert.deepEqual(declarationExports, expected.declarationExports);
});

test("canonical social/account methods remain separate from deprecated aliases", () => {
  const { auth } = createAuthModule();
  assert.equal(auth.social.link, auth.linkSocial);
  assert.equal(auth.social.signIn, auth.signIn.social);
  assert.notEqual(auth.account.list, auth.listAccounts);
  assert.notEqual(auth.account.unlink, auth.unlinkAccount);
  assert.equal(auth.user.update, auth.updateUser);
  assert.notEqual(auth.session.list, auth.listSessions);
  assert.notEqual(auth.session.revoke, auth.revokeSession);
  assert.notEqual(auth.session.revokeOther, auth.revokeOtherSessions);
});

test("deprecated session aliases preserve canonical behavior", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ sessions: [{ id: "s1" }] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };

  try {
    const { auth } = createAuthModule(
      {
        baseUrl: "https://auth.example.com/api/auth",
      },
      { compatibilityWarnings: false }
    );
    const canonical = await auth.session.list();
    const alias = await auth.listSessions();

    assert.deepEqual(alias, canonical);
    assert.deepEqual(calls, [
      "https://auth.example.com/api/auth/list-sessions",
      "https://auth.example.com/api/auth/list-sessions",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deprecated session aliases warn once per alias", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings: string[] = [];
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ sessions: [] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    const { auth } = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });
    await auth.listSessions();
    await auth.listSessions();
    await auth.revokeSession({ token: "session-token" });
    await auth.revokeSession({ token: "session-token" });
    await auth.revokeOtherSessions();
    await auth.revokeOtherSessions();

    assert.equal(warnings.length, 3);
    assert.match(warnings[0] ?? "", /listSessions\(\)/);
    assert.match(warnings[1] ?? "", /revokeSession\(\)/);
    assert.match(warnings[2] ?? "", /revokeOtherSessions\(\)/);
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }
});

test("clearOtherSessions uses the canonical session method without warning", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings: string[] = [];
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    const client = createAuthModule({
      baseUrl: "https://auth.example.com/api/auth",
    });

    assert.equal(client.clearOtherSessions, client.auth.session.revokeOther);
    await client.clearOtherSessions();
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }
});

test("deprecated aliases return the exact canonical method value", () => {
  const owner = {};
  const returnValue = {};
  const canonical = () => returnValue;
  const alias = createAuthCompatibilityAlias(
    owner,
    "legacy",
    "canonical",
    canonical,
    { warn: false }
  );

  assert.equal(alias(), returnValue);
});

test("auth/client.ts is composition-only", () => {
  const text = readFileSync(join(srcRoot, "auth/client.ts"), "utf8");
  assert.equal(/\bfetch\s*\(/.test(text), false);
  assert.equal(/\bcallAuthEndpoint\b/.test(text), false);
  assert.equal(/\bparseHttpResponseBody\b/.test(text), false);
  assert.equal(/\bparseResponseBody\b/.test(text), false);
  assert.equal(/\bBetter Auth mapping\b/.test(text), false);
  assert.match(text, /createAuthTransport\(/);
  assert.match(text, /attachAuthCompatibilityAliases\(/);
});

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) {
    return files;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(path));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

function parseRelativeImports(source: string): string[] {
  const matches = source.matchAll(/from\s+["'](\.[^"']+)["']/g);
  return [...matches].map((match) => match[1]);
}

function resolveImport(fromFile: string, spec: string): string | undefined {
  const base = join(dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, join(base, "index.ts")];
  return candidates.find((path) => existsSync(path));
}

test("auth/client, auth/types, and auth/index have no import cycles", () => {
  const roots = [
    join(srcRoot, "auth/client.ts"),
    join(srcRoot, "auth/types.ts"),
    join(srcRoot, "auth/index.ts"),
    ...collectTsFiles(join(srcRoot, "auth/client")),
  ];
  const graph = new Map<string, string[]>();
  for (const file of roots) {
    const text = readFileSync(file, "utf8");
    const deps: string[] = [];
    for (const spec of parseRelativeImports(text)) {
      const resolved = resolveImport(file, spec);
      if (resolved?.startsWith(join(srcRoot, "auth"))) {
        deps.push(resolved);
      }
    }
    graph.set(file, deps);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[] = [];

  const visit = (file: string, stack: string[]): void => {
    if (visiting.has(file)) {
      const start = stack.indexOf(file);
      cycles.push(
        [...stack.slice(start), file]
          .map((path) => relative(srcRoot, path).replaceAll("\\", "/"))
          .join(" -> ")
      );
      return;
    }
    if (visited.has(file)) {
      return;
    }
    visiting.add(file);
    for (const dep of graph.get(file) ?? []) {
      if (!graph.has(dep)) {
        continue;
      }
      visit(dep, [...stack, file]);
    }
    visiting.delete(file);
    visited.add(file);
  };

  for (const file of graph.keys()) {
    visit(file, []);
  }
  assert.deepEqual(cycles, []);
});

test("auth/types.ts is a domain barrel", () => {
  const text = readFileSync(join(srcRoot, "auth/types.ts"), "utf8");
  assert.match(text, /export \* from "\.\/types\//);
  assert.equal(text.includes("export interface AthenaAuthBindings"), false);
});
