import assert from "node:assert/strict";
import { test } from "node:test";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";
import { AuthRequestTiming } from "../src/auth/local/request-timing.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";

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

function createRuntime() {
  return createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
}

function parseSqlCount(header: string): number {
  const match = /(?:^|,\s*)sql_count;desc="(\d+)"/.exec(header);
  return Number(match?.[1] ?? Number.NaN);
}

test("Server-Timing header includes required metrics and sql_count desc", () => {
  const timing = new AuthRequestTiming();
  timing.addSpan("parse", 1);
  timing.addSpan("session_lookup", 12);
  timing.addSpan("authz", 3);
  timing.addSqlAcquire(40);
  timing.addSqlExec(8);
  timing.addSqlCount(4);
  const header = timing.toServerTimingHeader(55);
  assert.match(header, /parse;dur=1/);
  assert.match(header, /session_lookup;dur=12/);
  assert.match(header, /sql_acquire;dur=40/);
  assert.match(header, /sql_exec;dur=8/);
  assert.match(header, /sql_pool;desc="total=0 idle=0 waiting=0"/);
  assert.match(header, /total;dur=55/);
  assert.match(header, /sql_count;desc="4"/);
});

test("get-session and org metadata routes expose Server-Timing and sql_count", async () => {
  const runtime = createRuntime();
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "timing@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  const cookie = signup.headers.get("set-cookie") ?? "";

  const created = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Timed", slug: "timed-org" }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const organization = (
    (await created.json()) as { organization: { id: string } }
  ).organization;

  const options = await runtime.handle(
    new Request("http://app.local/api/auth/organization/list", {
      method: "OPTIONS",
    })
  );
  assert.equal(options.status, 204);
  assert.match(
    options.headers.get("access-control-expose-headers") ?? "",
    /Server-Timing/i
  );

  const routes: Array<{
    label: string;
    url: string;
    expectAuthz?: boolean;
  }> = [
    { label: "get-session", url: "http://app.local/api/auth/get-session" },
    {
      label: "organization/list",
      url: "http://app.local/api/auth/organization/list",
    },
    {
      expectAuthz: true,
      label: "list-members",
      url: `http://app.local/api/auth/organization/list-members?organizationId=${organization.id}`,
    },
    {
      expectAuthz: true,
      label: "list-invitations",
      url: `http://app.local/api/auth/organization/list-invitations?organizationId=${organization.id}`,
    },
    {
      label: "list-user-invitations",
      url: "http://app.local/api/auth/organization/list-user-invitations",
    },
    {
      expectAuthz: true,
      label: "get-full-organization",
      url: `http://app.local/api/auth/organization/get-full-organization?organizationId=${organization.id}`,
    },
  ];

  const counts: Record<string, number> = {};
  for (const route of routes) {
    const response = await runtime.handle(
      new Request(route.url, { headers: { cookie } })
    );
    assert.equal(response.status, 200, route.label);
    const header = response.headers.get("server-timing") ?? "";
    assert.ok(header.includes("session_lookup;dur="), route.label);
    assert.ok(header.includes("total;dur="), route.label);
    assert.ok(response.headers.get("x-athena-time")?.endsWith("ms"));
    assert.match(
      response.headers.get("access-control-expose-headers") ?? "",
      /Server-Timing/i
    );
    const sqlCount = parseSqlCount(header);
    assert.ok(
      sqlCount >= 1,
      `${route.label} sql_count=${sqlCount} header=${header}`
    );
    if (route.expectAuthz) {
      assert.ok(header.includes("authz;dur="), route.label);
    }
    counts[route.label] = sqlCount;
  }

  // Memory-store baseline (logical store ops counted as sql_count):
  // get-session: session + user
  // organization/list: session + user + list orgs
  // list-members / list-invitations: session + user + membership + list
  // list-user-invitations: session + user + invitations-for-email
  // get-full-organization: session + user + membership + org + members (parallel after authz)
  assert.ok(
    (counts["list-members"] ?? 0) >= (counts["get-session"] ?? 0),
    `list-members (${counts["list-members"]}) should issue at least as many store reads as get-session (${counts["get-session"]})`
  );
});
