/**
 * Required packed next-minimal golden path:
 * empty PostgreSQL → packed migrate (Auth first) → organization create →
 * owner snapshot proves org owner ≠ platform admin → member role N→N+1→N+2
 * revoke without restart → persisted platform_customer / platform_admin with
 * exact capability separation → cross-process Postgres revision authority →
 * Billing/Storage outcomes → assignment-store failure fails closed.
 */
import { strict as assert } from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  assertBillingOutcome,
  assertSessionFailsClosedWithoutRoleFallback,
  assertStorageOutcome,
  expectedAuthorizationSnapshot,
  injectAssignmentStoreFailure,
  normalizeAuthorizationSnapshot,
  persistPlatformRoleAssignment,
  readPersistedAssignmentKeys,
} from "./golden-authorization-assignments.ts";
import type { GoldenPreferenceItem } from "./golden-notification-preference-buffer.ts";
import { GoldenNotificationPreferenceWriteBuffer } from "./golden-notification-preference-buffer.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = join(pkgRoot, "test", "fixtures", "next-minimal-golden");
const APP_MIGRATION = "0001_next_minimal_auth_directory.sql";

function requireDatabaseUrl(): string {
  const url = (
    process.env.ATHENA_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      "fail-closed: next-minimal golden-path requires ATHENA_TEST_DATABASE_URL or DATABASE_URL (orchestrator auto-launches Postgres)"
    );
  }
  return url;
}

function databaseNameFromUrl(databaseUrl: string): string | undefined {
  try {
    const url = new URL(databaseUrl.replace(/^postgresql:/i, "postgres:"));
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    return name.length > 0 ? name : undefined;
  } catch {
    /* invalid DATABASE_URL */
  }
}

/** Keep migrate/CLI `provider.database` on the same catalog as DATABASE_URL. */
function postgresTargetEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const database = databaseNameFromUrl(databaseUrl);
  return {
    ...process.env,
    ATHENA_TEST_DATABASE_URL: databaseUrl,
    CI: "true",
    DATABASE_URL: databaseUrl,
    ...(database
      ? {
        ATHENA_DATABASE: database,
        ATHENA_GENERATOR_DB: database,
        PGDATABASE: database,
      }
      : {}),
  };
}

function assertPackedInstall(): void {
  const require = createRequire(join(fixtureRoot, "package.json"));
  let resolved: string;
  try {
    resolved = require.resolve("@xylex-group/athena/server");
  } catch (error) {
    throw new Error(
      `packed @xylex-group/athena missing in test/fixtures/next-minimal-golden (install .tmp/packages/*.tgz): ${String(error)}`
    );
  }
  if (resolved.replaceAll("\\", "/").includes("/packages/athena-js/src/")) {
    throw new Error("E2E must not resolve the SDK from src/");
  }
}

async function resetEmptyDatabase(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
			DROP TABLE IF EXISTS athena_billing_migrations;
			DROP TABLE IF EXISTS athena_event_ingress_migrations;
			DROP SCHEMA IF EXISTS athena CASCADE;
			DROP SCHEMA IF EXISTS billing CASCADE;
			DROP SCHEMA IF EXISTS public CASCADE;
			CREATE SCHEMA public;
			GRANT ALL ON SCHEMA public TO PUBLIC;
		`);
  } finally {
    await client.end();
  }
}

function packedCliBin(): string {
  return join(
    fixtureRoot,
    "node_modules",
    "@xylex-group",
    "athena",
    "bin",
    "athena-js.js"
  );
}

function runPackedMigrate(databaseUrl: string): string {
  const result = spawnSync(
    process.execPath,
    [packedCliBin(), "migrate", "--plain"],
    {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: postgresTargetEnv(databaseUrl),
      shell: false,
    }
  );
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(
      `packed athena-js migrate failed (${result.status}):\n${log}`
    );
  }
  return log;
}

function assertAuthAppliesBeforeApplication(log: string): void {
  const authApplying = log.indexOf("Embedded Auth schema applying");
  const authApplied = log.indexOf("Embedded Auth schema applied");
  const appApplying = log.indexOf(`${APP_MIGRATION} applying`);
  assert.ok(authApplying >= 0, `Auth applying missing:\n${log}`);
  assert.ok(
    authApplied > authApplying,
    `Auth applied before applying:\n${log}`
  );
  assert.ok(
    appApplying > authApplied,
    `application SQL must run after Embedded Auth:\n${log}`
  );
}

async function listenPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitHttp(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status > 0) {
        return;
      }
    } catch {
      await delay(200);
    }
  }
  throw new Error(`next-minimal-golden did not become ready at ${url}`);
}

async function readOk(
  response: Response,
  expectedStatus = 200
): Promise<{ json: Record<string, unknown>; text: string }> {
  const text = await response.text();
  assert.equal(response.status, expectedStatus, text);
  if (text.trim().length === 0) {
    return { json: {}, text };
  }
  try {
    return { json: JSON.parse(text) as Record<string, unknown>, text };
  } catch {
    throw new Error(`expected JSON body, got: ${text.slice(0, 2000)}`);
  }
}

function cookieHeader(response: Response): string {
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const cookies =
    typeof getSetCookie === "function"
      ? getSetCookie.call(response.headers)
      : [];
  if (cookies.length > 0) {
    return cookies
      .map((entry) => entry.split(";", 1)[0])
      .filter(Boolean)
      .join("; ");
  }
  const single = response.headers.get("set-cookie");
  return single ? (single.split(";", 1)[0] ?? "") : "";
}

const APPLY_MANY = "notifications.preferences.applyMany";
const PREFERENCES_LIST = "notifications.preferences.list";

const TOGGLE_PAIRS = [
  { channel: "email", topic: "security.login" },
  { channel: "email", topic: "security.session" },
  { channel: "email", topic: "billing.invoice" },
  { channel: "in_app", topic: "billing.payment" },
] as const;

async function notificationsPost(
  origin: string,
  cookie: string,
  operation: string,
  payload: Record<string, unknown>
): Promise<{ json: Record<string, unknown>; status: number; text: string }> {
  const response = await fetch(`${origin}/api/athena/notifications`, {
    body: JSON.stringify({ operation, payload }),
    headers: {
      "content-type": "application/json",
      cookie,
      origin,
    },
    method: "POST",
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  if (text.trim().length > 0) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(
        `notifications JSON expected, got: ${text.slice(0, 2000)}`
      );
    }
  }
  return { json, status: response.status, text };
}

function preferenceItems(
  json: Record<string, unknown>
): GoldenPreferenceItem[] {
  const data = json.data as { items?: GoldenPreferenceItem[] } | undefined;
  return Array.isArray(data?.items) ? data.items : [];
}

function enabledFor(
  items: readonly GoldenPreferenceItem[],
  topic: string,
  channel: string
): boolean | undefined {
  return items.find((item) => item.topic === topic && item.channel === channel)
    ?.enabled;
}

async function listStoredOverrides(
  databaseUrl: string,
  userId: string
): Promise<Array<{ channel: string; enabled: boolean; topic: string }>> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{
      channel: string;
      enabled: boolean;
      topic: string;
    }>(
      `SELECT topic, channel, enabled
			 FROM athena.notification_preferences
			 WHERE user_id = $1
			 ORDER BY topic, channel`,
      [userId]
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

async function assertNotificationPreferenceGoldenPath(input: {
  cookie: string;
  databaseUrl: string;
  origin: string;
}): Promise<void> {
  const session = (
    await readOk(
      await fetch(`${input.origin}/api/auth/get-session`, {
        headers: { cookie: input.cookie },
      })
    )
  ).json;
  const userId = (session.user as { id?: string } | undefined)?.id;
  assert.ok(userId, "notifications golden-path user id");

  const listed = await notificationsPost(
    input.origin,
    input.cookie,
    PREFERENCES_LIST,
    {}
  );
  assert.equal(listed.status, 200, listed.text);
  let items = preferenceItems(listed.json);
  assert.ok(items.length > 0, "catalog-projected preferences");
  const catalogSnapshot = items.map((item) => ({ ...item }));

  let flushError: unknown;
  const buffer = new GoldenNotificationPreferenceWriteBuffer({
    getItems: () => items,
    onFlushError: (error) => {
      flushError = error;
    },
    persist: async (mutations) => {
      const result = await notificationsPost(
        input.origin,
        input.cookie,
        APPLY_MANY,
        { mutations }
      );
      if (result.status !== 200 || result.json.ok !== true) {
        throw new Error(`applyMany failed (${result.status}): ${result.text}`);
      }
      return { items: preferenceItems(result.json) };
    },
    setItems: (next) => {
      items = next;
    },
  });

  for (const pair of TOGGLE_PAIRS) {
    buffer.enqueueSet({
      channel: pair.channel,
      enabled: false,
      topic: pair.topic,
    });
  }
  assert.equal(enabledFor(items, "security.login", "email"), false);

  buffer.discardPending();
  for (const item of items) {
    buffer.bump(item.topic, item.channel);
  }
  const resetResult = await notificationsPost(
    input.origin,
    input.cookie,
    APPLY_MANY,
    {
      mutations: TOGGLE_PAIRS.map((pair) => ({
        channel: pair.channel,
        operation: "reset",
        topic: pair.topic,
      })),
    }
  );
  assert.equal(resetResult.status, 200, resetResult.text);
  items = mergeAuthoritativeFromList(
    catalogSnapshot,
    preferenceItems(resetResult.json)
  );
  assert.equal(enabledFor(items, "security.login", "email"), true);
  assert.equal(
    (await listStoredOverrides(input.databaseUrl, userId)).length,
    0,
    "Reset while buffered must not persist discarded toggles"
  );

  for (const pair of TOGGLE_PAIRS.slice(0, 3)) {
    buffer.enqueueSet({
      channel: pair.channel,
      enabled: false,
      topic: pair.topic,
    });
  }
  await buffer.flushNow();
  assert.equal(flushError, undefined, String(flushError));
  const storedAfterFlush = await listStoredOverrides(input.databaseUrl, userId);
  assert.equal(storedAfterFlush.length, 3, JSON.stringify(storedAfterFlush));
  assert.equal(
    storedAfterFlush.every((row) => row.enabled === false),
    true
  );

  const beforeFailed = items.map((item) => ({ ...item }));
  buffer.enqueueSet({
    channel: "email",
    enabled: false,
    topic: "billing.payment",
  });
  buffer.enqueueSet({
    channel: "email",
    enabled: false,
    topic: "billing.subscription",
  });
  await buffer.flushNow();
  assert.ok(flushError, "injected applyMany must fail once");
  assert.equal(
    enabledFor(items, "billing.payment", "email"),
    enabledFor(beforeFailed, "billing.payment", "email"),
    "failed applyMany must revision-rollback the flushed pairs"
  );
  assert.equal(
    enabledFor(items, "billing.subscription", "email"),
    enabledFor(beforeFailed, "billing.subscription", "email")
  );
  const storedAfterFail = await listStoredOverrides(input.databaseUrl, userId);
  assert.equal(
    storedAfterFail.length,
    3,
    "failed applyMany must not persist a partial batch"
  );

  const mixed = await notificationsPost(
    input.origin,
    input.cookie,
    APPLY_MANY,
    {
      mutations: [
        {
          channel: "email",
          operation: "reset",
          topic: "security.login",
        },
        {
          channel: "email",
          enabled: false,
          operation: "set",
          topic: "billing.invoice",
        },
      ],
    }
  );
  assert.equal(mixed.status, 200, mixed.text);
  const storedAfterMixed = await listStoredOverrides(input.databaseUrl, userId);
  const loginRow = storedAfterMixed.find(
    (row) => row.topic === "security.login" && row.channel === "email"
  );
  const invoiceRow = storedAfterMixed.find(
    (row) => row.topic === "billing.invoice" && row.channel === "email"
  );
  assert.equal(loginRow, undefined, "mixed applyMany reset is atomic");
  assert.equal(invoiceRow?.enabled, false);

  const reconciled = await notificationsPost(
    input.origin,
    input.cookie,
    PREFERENCES_LIST,
    {}
  );
  assert.equal(reconciled.status, 200, reconciled.text);
  const live = preferenceItems(reconciled.json);
  assert.equal(enabledFor(live, "security.login", "email"), true);
  assert.equal(enabledFor(live, "billing.invoice", "email"), false);
}

async function assertExactPackedSnapshot(input: {
  activeOrganizationId: string | null;
  cookie: string;
  databaseUrl: string;
  origin: string;
  userId: string;
}): Promise<void> {
  const packed = (
    await readOk(
      await fetch(`${input.origin}/api/auth/authorization/snapshot`, {
        headers: { cookie: input.cookie },
      })
    )
  ).json;
  const expected = await expectedAuthorizationSnapshot({
    activeOrganizationId: input.activeOrganizationId,
    databaseUrl: input.databaseUrl,
    userId: input.userId,
  });
  assert.deepEqual(
    normalizeAuthorizationSnapshot(packed),
    normalizeAuthorizationSnapshot(expected)
  );
}

function mergeAuthoritativeFromList(
  previous: GoldenPreferenceItem[],
  nextItems: GoldenPreferenceItem[]
): GoldenPreferenceItem[] {
  const byKey = new Map(
    nextItems.map((item) => [`${item.topic}\u0000${item.channel}`, item])
  );
  return previous.map(
    (item) => byKey.get(`${item.topic}\u0000${item.channel}`) ?? item
  );
}

test("packed next-minimal golden path: empty DB, Auth-first migrate, snapshot revision, assignment fail-closed, notification applyMany", {
  timeout: 180_000,
}, async () => {
  assertPackedInstall();
  const databaseUrl = requireDatabaseUrl();
  await resetEmptyDatabase(databaseUrl);

  const firstLog = runPackedMigrate(databaseUrl);
  assertAuthAppliesBeforeApplication(firstLog);

  const catalog = new pg.Client({ connectionString: databaseUrl });
  await catalog.connect();
  try {
    const view = await catalog.query(
      "SELECT to_regclass('public.next_minimal_auth_directory') AS name"
    );
    assert.equal(view.rows[0]?.name ?? null, null);
    const billing = await catalog.query(
      "SELECT to_regclass('billing.billing_provider_connections') AS name"
    );
    assert.notEqual(
      billing.rows[0]?.name ?? null,
      null,
      "packed migrate applies Embedded Billing before runtime boot"
    );
  } finally {
    await catalog.end();
  }

  const secondLog = runPackedMigrate(databaseUrl);
  assert.match(secondLog, /Application migrations are up to date/, secondLog);
  assert.doesNotMatch(
    secondLog,
    new RegExp(`${APP_MIGRATION} applying`),
    secondLog
  );

  const port = await listenPort();
  const origin = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(
    process.execPath,
    [join(fixtureRoot, "server.mjs")],
    {
      cwd: fixtureRoot,
      env: {
        ...postgresTargetEnv(databaseUrl),
        ATHENA_GOLDEN_FAIL_APPLY_MANY_ON: "3",
        HOST: "127.0.0.1",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const childLogs: string[] = [];
  child.stdout?.on("data", (chunk) => childLogs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => childLogs.push(String(chunk)));
  try {
    try {
      await waitHttp(`${origin}/api/auth/ok`);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : error}\n${childLogs.join("")}`
      );
    }

    const ownerSignUp = await fetch(`${origin}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: "golden-owner@example.com",
        name: "Golden Owner",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await readOk(ownerSignUp);
    const ownerCookie = cookieHeader(ownerSignUp);

    const createdOrg = await fetch(`${origin}/api/auth/organization/create`, {
      body: JSON.stringify({
        name: "Golden Org",
        slug: "golden-org",
      }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    });
    const orgBody = (await readOk(createdOrg)).json;
    const organizationId =
      (orgBody.id as string | undefined) ||
      ((orgBody.organization as { id?: string } | undefined)?.id ?? "");
    assert.ok(organizationId, "organization id");

    const setActive = await fetch(
      `${origin}/api/auth/organization/set-active`,
      {
        body: JSON.stringify({ organizationId }),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        method: "POST",
      }
    );
    const setActiveCookie = cookieHeader(setActive);
    const ownerSnapshotCookie =
      setActiveCookie.length > 0 ? setActiveCookie : ownerCookie;
    await readOk(setActive);

    const ownerSnapshot = (
      await readOk(
        await fetch(`${origin}/api/auth/authorization/snapshot`, {
          headers: { cookie: ownerSnapshotCookie },
        })
      )
    ).json;
    const ownerCaps = ownerSnapshot.capabilities as
      | {
        canManageOrganizationRoles?: boolean;
        canManagePlatformRoles?: boolean;
      }
      | undefined;
    assert.equal(
      ownerCaps?.canManagePlatformRoles,
      false,
      "organization owner is not a platform administrator"
    );
    assert.equal(
      ownerCaps?.canManageOrganizationRoles,
      true,
      "organization owner manages organization roles"
    );

    const memberSignUp = await fetch(`${origin}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: "golden-member@example.com",
        name: "Golden Member",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await readOk(memberSignUp);
    const memberCookie = cookieHeader(memberSignUp);
    const memberSession = (
      await readOk(
        await fetch(`${origin}/api/auth/get-session`, {
          headers: { cookie: memberCookie },
        })
      )
    ).json;
    const memberUserId = (memberSession.user as { id?: string } | undefined)
      ?.id;
    assert.ok(memberUserId, "member user id");

    const added = await fetch(`${origin}/api/auth/organization/add-member`, {
      body: JSON.stringify({
        organizationId,
        role: "member",
        userId: memberUserId,
      }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    });
    await readOk(added);

    const setMemberOrg = await fetch(
      `${origin}/api/auth/organization/set-active`,
      {
        body: JSON.stringify({ organizationId }),
        headers: {
          "content-type": "application/json",
          cookie: memberCookie,
        },
        method: "POST",
      }
    );
    await readOk(setMemberOrg);
    const memberOrgCookie = cookieHeader(setMemberOrg);
    const memberSnapshotCookie =
      memberOrgCookie.length > 0 ? memberOrgCookie : memberCookie;

    const listed = (
      await readOk(
        await fetch(
          `${origin}/api/auth/organization/list-members?organizationId=${encodeURIComponent(organizationId)}`,
          { headers: { cookie: ownerCookie } }
        )
      )
    ).json;
    const members = listed.members as Array<{
      id?: string;
      userId?: string;
    }>;
    const membership = members.find((row) => row.userId === memberUserId);
    assert.ok(membership?.id, "membership id");

    const beforeSnapshot = (
      await readOk(
        await fetch(`${origin}/api/auth/authorization/snapshot`, {
          headers: { cookie: memberSnapshotCookie },
        })
      )
    ).json;
    const beforeCaps = beforeSnapshot.capabilities as
      | { canInviteMembers?: boolean }
      | undefined;
    assert.equal(
      beforeCaps?.canInviteMembers,
      false,
      JSON.stringify(beforeSnapshot)
    );
    const beforeRevision = Number(beforeSnapshot.revision);
    assert.ok(Number.isFinite(beforeRevision), "revision before");

    const roleUpdate = await fetch(
      `${origin}/api/auth/organization/update-member-role`,
      {
        body: JSON.stringify({
          memberId: membership.id,
          organizationId,
          role: "admin",
        }),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        method: "POST",
      }
    );
    await readOk(roleUpdate);

    const afterSnapshot = (
      await readOk(
        await fetch(`${origin}/api/auth/authorization/snapshot`, {
          headers: { cookie: memberSnapshotCookie },
        })
      )
    ).json;
    const afterCaps = afterSnapshot.capabilities as
      | { canInviteMembers?: boolean }
      | undefined;
    assert.equal(
      afterCaps?.canInviteMembers,
      true,
      "UI capability state must change on the next snapshot read"
    );
    assert.ok(
      Number(afterSnapshot.revision) > beforeRevision,
      `revision must increment (before=${beforeRevision} after=${String(afterSnapshot.revision)})`
    );
    const afterRevision = Number(afterSnapshot.revision);

    const roleRevoke = await fetch(
      `${origin}/api/auth/organization/update-member-role`,
      {
        body: JSON.stringify({
          memberId: membership.id,
          organizationId,
          role: "member",
        }),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        method: "POST",
      }
    );
    await readOk(roleRevoke);

    const revokedSnapshot = (
      await readOk(
        await fetch(`${origin}/api/auth/authorization/snapshot`, {
          headers: { cookie: memberSnapshotCookie },
        })
      )
    ).json;
    const revokedCaps = revokedSnapshot.capabilities as
      | { canInviteMembers?: boolean }
      | undefined;
    assert.equal(
      revokedCaps?.canInviteMembers,
      false,
      "capability must disappear on revoke without restart"
    );
    assert.ok(
      Number(revokedSnapshot.revision) > afterRevision,
      `revision must increment on revoke (after=${afterRevision} revoked=${String(revokedSnapshot.revision)})`
    );

    const customerSignUp = await fetch(`${origin}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: "golden-customer@example.com",
        name: "Golden Customer",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await readOk(customerSignUp);
    const customerCookie = cookieHeader(customerSignUp);
    const customerSession = (
      await readOk(
        await fetch(`${origin}/api/auth/get-session`, {
          headers: { cookie: customerCookie },
        })
      )
    ).json;
    const customerUserId = (customerSession.user as { id?: string } | undefined)
      ?.id;
    assert.ok(customerUserId, "customer user id");

    const operatorSignUp = await fetch(`${origin}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: "golden-operator@example.com",
        name: "Golden Operator",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await readOk(operatorSignUp);
    const operatorCookie = cookieHeader(operatorSignUp);
    const operatorSession = (
      await readOk(
        await fetch(`${origin}/api/auth/get-session`, {
          headers: { cookie: operatorCookie },
        })
      )
    ).json;
    const operatorUserId = (operatorSession.user as { id?: string } | undefined)
      ?.id;
    assert.ok(operatorUserId, "operator user id");

    await persistPlatformRoleAssignment({
      databaseUrl,
      roleKey: "platform_customer",
      userId: customerUserId,
      usersRole: "admin",
    });
    await persistPlatformRoleAssignment({
      databaseUrl,
      roleKey: "platform_admin",
      userId: operatorUserId,
      usersRole: "customer",
    });

    assert.deepEqual(
      await readPersistedAssignmentKeys({
        databaseUrl,
        userId: customerUserId,
      }),
      { memberRoleKeys: [], platformRoleKeys: ["platform_customer"] }
    );
    assert.deepEqual(
      await readPersistedAssignmentKeys({
        databaseUrl,
        userId: operatorUserId,
      }),
      { memberRoleKeys: [], platformRoleKeys: ["platform_admin"] }
    );
    assert.deepEqual(
      await readPersistedAssignmentKeys({
        databaseUrl,
        memberId: membership.id,
        userId: memberUserId,
      }),
      {
        memberRoleKeys: ["organization_member"],
        platformRoleKeys: ["platform_customer"],
      }
    );

    await assertExactPackedSnapshot({
      activeOrganizationId: null,
      cookie: customerCookie,
      databaseUrl,
      origin,
      userId: customerUserId,
    });
    await assertExactPackedSnapshot({
      activeOrganizationId: null,
      cookie: operatorCookie,
      databaseUrl,
      origin,
      userId: operatorUserId,
    });
    await assertExactPackedSnapshot({
      activeOrganizationId: organizationId,
      cookie: memberSnapshotCookie,
      databaseUrl,
      origin,
      userId: memberUserId,
    });

    const customerPacked = (
      await readOk(
        await fetch(`${origin}/api/auth/authorization/snapshot`, {
          headers: { cookie: customerCookie },
        })
      )
    ).json;
    assert.equal(
      (customerPacked.capabilities as { canManagePlatformRoles?: boolean })
        .canManagePlatformRoles,
      false
    );
    assert.equal(
      (
        customerPacked.capabilities as {
          canManageOrganizationRoles?: boolean;
        }
      ).canManageOrganizationRoles,
      false
    );

    const operatorPacked = (
      await readOk(
        await fetch(`${origin}/api/auth/authorization/snapshot`, {
          headers: { cookie: operatorCookie },
        })
      )
    ).json;
    assert.equal(
      (operatorPacked.capabilities as { canManagePlatformRoles?: boolean })
        .canManagePlatformRoles,
      true
    );
    const operatorRevision = Number(operatorPacked.revision);
    assert.ok(Number.isFinite(operatorRevision), "operator revision");

    const crossProcess = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(pkgRoot, "test/finality/cross-process-authorization-mutate.ts"),
      ],
      {
        cwd: pkgRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          ATHENA_CROSS_PROCESS_ROLE_KEY: "platform_customer",
          ATHENA_CROSS_PROCESS_USER_ID: operatorUserId,
          ATHENA_CROSS_PROCESS_USERS_ROLE: "admin",
          ATHENA_TEST_DATABASE_URL: databaseUrl,
          DATABASE_URL: databaseUrl,
        },
      }
    );
    assert.equal(
      crossProcess.status,
      0,
      crossProcess.stderr ||
      crossProcess.stdout ||
      "cross-process mutate failed"
    );

    const operatorAfterChild = (
      await readOk(
        await fetch(`${origin}/api/auth/authorization/snapshot`, {
          headers: { cookie: operatorCookie },
        })
      )
    ).json;
    assert.equal(
      (
        operatorAfterChild.capabilities as {
          canManagePlatformRoles?: boolean;
        }
      ).canManagePlatformRoles,
      false,
      "Process A must observe Process B assignment without in-memory invalidation"
    );
    assert.ok(
      Number(operatorAfterChild.revision) > operatorRevision,
      "Postgres revision must be authoritative across processes"
    );

    await persistPlatformRoleAssignment({
      databaseUrl,
      roleKey: "platform_admin",
      userId: operatorUserId,
      usersRole: "customer",
    });

    await assertBillingOutcome({
      allowed: true,
      cookie: customerCookie,
      operation: "products.list",
      origin,
    });
    await assertBillingOutcome({
      allowed: false,
      cookie: customerCookie,
      operation: "payments.list",
      origin,
    });
    await assertStorageOutcome({
      allowed: true,
      cookie: customerCookie,
      operation: "list",
      origin,
    });
    await assertStorageOutcome({
      allowed: false,
      cookie: customerCookie,
      operation: "put",
      origin,
    });

    await assertBillingOutcome({
      allowed: true,
      cookie: operatorCookie,
      operation: "products.list",
      origin,
    });
    await assertBillingOutcome({
      allowed: true,
      cookie: operatorCookie,
      operation: "payments.list",
      origin,
    });
    await assertStorageOutcome({
      allowed: true,
      cookie: operatorCookie,
      operation: "list",
      origin,
    });
    await assertStorageOutcome({
      allowed: true,
      cookie: operatorCookie,
      operation: "put",
      origin,
    });

    await assertBillingOutcome({
      allowed: true,
      cookie: memberSnapshotCookie,
      operation: "products.list",
      origin,
    });
    await assertBillingOutcome({
      allowed: false,
      cookie: memberSnapshotCookie,
      operation: "payments.list",
      origin,
    });
    await assertStorageOutcome({
      allowed: true,
      cookie: memberSnapshotCookie,
      operation: "list",
      origin,
    });
    await assertStorageOutcome({
      allowed: false,
      cookie: memberSnapshotCookie,
      operation: "put",
      origin,
    });

    await assertNotificationPreferenceGoldenPath({
      cookie: ownerCookie,
      databaseUrl,
      origin,
    });

    await injectAssignmentStoreFailure(databaseUrl);
    await assertSessionFailsClosedWithoutRoleFallback({
      cookie: operatorCookie,
      origin,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n\nGolden server logs:\n${childLogs.join("")}`, {
      cause: error,
    });
  } finally {
    if (child.pid) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
  }
});
