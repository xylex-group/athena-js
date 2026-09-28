/**
 * Target: Athena JS notifications kernel DESIRED after steps 1–8.
 * GREEN after catalog, gen 29 preference overrides, public
 * createClient().notifications, Memory inbox, 9000 errors.
 * Former characterization baseline retired to
 * test/sdd/superseded/athena-notifications-preferences.baseline.superseded.ts.
 *
 * Spec: docs/sdd/xylex/athena-notifications-and-auth-ui-domains/SPEC.md
 * Dual-suite: docs/sdd/xylex/athena-notifications-and-auth-ui-domains/dual-suite/dual-suite-spec.md
 *
 * Host:
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/athena-notifications-preferences.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ATHENA_AUTH_SCHEMA_GENERATION,
  ATHENA_AUTH_TABLES,
} from "../../src/auth/contract/index.ts";
import { ATHENA_AUTH_MIGRATION_EXPECTATIONS } from "../../src/auth/local/schema-manifest.ts";
import * as rootBarrel from "../../src/index.ts";
import { NOTIFICATION_CATALOG } from "../../src/notifications/catalog.ts";
import { createClient } from "../../src/v3-client.ts";
import { createSddMockR2 } from "./sdd-mocks.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const repoRoot = join(pkgRoot, "..", "..");
const notificationsSrcDir = join(srcRoot, "notifications");
const catalogPath = join(notificationsSrcDir, "catalog.ts");
const resolvePath = join(notificationsSrcDir, "resolve.ts");
const memoryStorePath = join(notificationsSrcDir, "memory-store.ts");
const migrationsPath = join(srcRoot, "auth", "schema", "migrations.ts");
const errorsContractPath = join(
  repoRoot,
  "contracts",
  "notifications",
  "errors.json"
);

const REQUIRED_TOPICS = [
  "security.login",
  "security.session",
  "security.passkey",
  "security.password",
  "organization.invitation",
  "organization.membership",
  "billing.invoice",
  "billing.payment",
  "billing.subscription",
  "system.maintenance",
] as const;

const REQUIRED_CHANNELS = ["in_app", "email", "push", "webhook"] as const;

const REQUIRED_ERROR_CODES = [
  { code: "ATHENA_NOTIFICATIONS_UNAUTHENTICATED", errorNumber: 9000 },
  { code: "ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN", errorNumber: 9001 },
  { code: "ATHENA_NOTIFICATIONS_CHANNEL_UNKNOWN", errorNumber: 9002 },
  { code: "ATHENA_NOTIFICATIONS_DIGEST_INVALID", errorNumber: 9003 },
  { code: "ATHENA_NOTIFICATIONS_SCOPE_INVALID", errorNumber: 9004 },
  { code: "ATHENA_NOTIFICATIONS_EVENT_NOT_FOUND", errorNumber: 9005 },
  { code: "ATHENA_NOTIFICATIONS_UNAVAILABLE", errorNumber: 9006 },
] as const;

const SECRET_FIELD_PATTERN =
  /\b(password|challenge|webhookSecret|pkce_verifier|sessionToken|privateKey)\b/;

type EffectivePreference = {
  channel: string;
  description?: string;
  digest: string | null;
  enabled: boolean;
  label?: string;
  source: string;
  topic: string;
};

type PreferenceOverride = {
  channel: string;
  digest?: string | null;
  enabled: boolean;
  organizationId?: string | null;
  topic: string;
  userId?: string;
};

type NotificationsApi = {
  list: (input?: { unread?: boolean }) => Promise<{ items: unknown[] }>;
  markAllRead: () => Promise<{ ok: true }>;
  markRead: (input: { id: string }) => Promise<{ ok: true }>;
  preferences: {
    list: (input?: {
      organizationId?: string | null;
    }) => Promise<{ items: EffectivePreference[] }>;
    reset: (input: {
      channel: string;
      organizationId?: string | null;
      topic: string;
    }) => Promise<{ item: EffectivePreference }>;
    update: (input: {
      channel: string;
      digest?: string | null;
      enabled: boolean;
      organizationId?: string | null;
      topic: string;
    }) => Promise<{ item: EffectivePreference }>;
  };
  catalog: {
    list: () => Promise<{ items: Array<{ channel: string; topic: string }> }>;
  };
};

type ResolveFn = (input: {
  catalog: unknown;
  organizationId?: string | null;
  overrides: readonly PreferenceOverride[];
}) => EffectivePreference[];

function readPkgRel(rel: string): string {
  return readFileSync(join(pkgRoot, rel), "utf8");
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function srcBlob(dir = srcRoot): string {
  return collectTsFiles(dir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorCode(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }
  if (typeof value.code === "string") {
    return value.code;
  }
  if (typeof value.error === "string") {
    return value.error;
  }
  return "";
}

function notificationsOf(client: unknown): NotificationsApi {
  assert.equal(
    client !== null && typeof client === "object" && "notifications" in client,
    true,
    "createClient().notifications must exist"
  );
  const ns = (client as { notifications: unknown }).notifications;
  assert.equal(ns !== null && typeof ns === "object", true);
  const record = ns as Record<string, unknown>;
  assert.equal(isRecord(record.preferences), true);
  const preferences = record.preferences as Record<string, unknown>;
  assert.equal(typeof preferences.list, "function");
  assert.equal(typeof preferences.update, "function");
  assert.equal(typeof preferences.reset, "function");
  assert.equal(typeof record.list, "function");
  assert.equal(typeof record.markRead, "function");
  assert.equal(typeof record.markAllRead, "function");
  assert.equal(isRecord(record.catalog), true);
  assert.equal(typeof (record.catalog as { list?: unknown }).list, "function");
  return ns as NotificationsApi;
}

function createTargetClient(): ReturnType<typeof createClient> {
  return createClient({
    notifications: { catalog: NOTIFICATION_CATALOG },
    storage: { prefix: "np-target/", r2: createSddMockR2() },
  });
}

async function importNotificationsRel(
  rel: string
): Promise<Record<string, unknown>> {
  const full = join(notificationsSrcDir, rel);
  assert.equal(
    existsSync(full),
    true,
    `expected packages/athena-js/src/notifications/${rel}`
  );
  return (await import(pathToFileURL(full).href)) as Record<string, unknown>;
}

function catalogEntries(mod: Record<string, unknown>): Array<{
  channel: string;
  defaultEnabled: boolean;
  topic: string;
}> {
  const catalog = mod.NOTIFICATION_CATALOG ?? mod.notificationCatalog;
  assert.equal(Array.isArray(catalog), true, "NOTIFICATION_CATALOG must exist");
  const rows = (catalog as unknown[]).filter(isRecord).map((row) => {
    assert.equal(typeof row.topic, "string");
    assert.equal(typeof row.channel, "string");
    assert.equal(typeof row.defaultEnabled, "boolean");
    return {
      channel: row.channel as string,
      defaultEnabled: row.defaultEnabled as boolean,
      topic: row.topic as string,
    };
  });
  assert.ok(rows.length > 0);
  return rows;
}

function findEffective(
  items: readonly EffectivePreference[],
  topic: string,
  channel: string
): EffectivePreference {
  const match = items.find(
    (item) => item.topic === topic && item.channel === channel
  );
  assert.ok(match, `missing effective ${topic}/${channel}`);
  return match;
}

test("T-NP-001: P?: createClient().notifications exists and is not athena.auth.notifications", () => {
  const core = readPkgRel("src/client/contracts.ts");
  assert.match(core, /readonly notifications:/);
  const authTypes = readPkgRel("src/auth/types.ts");
  const bindings = authTypes.slice(
    authTypes.indexOf("export interface AthenaAuthBindings {")
  );
  assert.ok(bindings.length > 0);
  assert.equal(
    /\breadonly notifications\b/.test(bindings.slice(0, 4000)),
    false
  );

  const client = createTargetClient();
  assert.equal("notifications" in client, true);
  assert.equal("notifications" in client.auth, false);
});

test("T-NP-002: P?: no createNotificationsClient", () => {
  assert.equal("createNotificationsClient" in rootBarrel, false);
  const pkg = JSON.parse(readPkgRel("package.json")) as {
    exports?: Record<string, unknown>;
  };
  assert.equal("./notifications" in (pkg.exports ?? {}), false);
  for (const file of collectTsFiles(srcRoot)) {
    const text = readFileSync(file, "utf8");
    assert.equal(
      /\bexport\s+(?:async\s+)?function\s+createNotificationsClient\b/.test(
        text
      ),
      false,
      file
    );
  }
});

test("T-NP-003: P?: preferences.list and preferences.update exist", async () => {
  assert.equal(existsSync(notificationsSrcDir), true);
  const blob = srcBlob(notificationsSrcDir);
  assert.match(blob, /preferences/);
  assert.match(blob, /\.list\b/);
  assert.match(blob, /\.update\b/);

  const ns = notificationsOf(createTargetClient());
  const listed = await ns.preferences.list();
  assert.equal(Array.isArray(listed.items), true);
  assert.equal(
    listed.items.length,
    REQUIRED_TOPICS.length * REQUIRED_CHANNELS.length
  );
  const loginEmail = findEffective(listed.items, "security.login", "email");
  assert.equal(loginEmail.enabled, true);
  assert.equal(loginEmail.source, "catalog");
  assert.equal(typeof loginEmail.label, "string");
  assert.equal(loginEmail.topic, "security.login");
});

test("T-NP-004: P?: list unread markRead markAllRead exist", async () => {
  const blob = srcBlob(notificationsSrcDir);
  assert.match(blob, /markRead/);
  assert.match(blob, /markAllRead/);
  assert.match(blob, /unread/);

  const ns = notificationsOf(createTargetClient());
  const listed = await ns.list({ unread: true });
  assert.equal(Array.isArray(listed.items), true);
  await assert.rejects(() => ns.markAllRead());
  assert.equal(typeof ns.markRead, "function");
});

test("T-NP-005: P?: catalog includes security.login session passkey password organization.invitation membership billing.invoice payment subscription system.maintenance", async () => {
  assert.equal(existsSync(catalogPath), true);
  const catalog = readFileSync(catalogPath, "utf8");
  for (const topic of REQUIRED_TOPICS) {
    assert.match(catalog, new RegExp(topic.replace(".", "\\.")));
  }
  const mod = await importNotificationsRel("catalog.ts");
  const entries = catalogEntries(mod);
  for (const topic of REQUIRED_TOPICS) {
    assert.ok(
      entries.some((entry) => entry.topic === topic),
      `catalog missing topic ${topic}`
    );
  }
});

test("T-NP-006: P?: channels are in_app email push webhook", async () => {
  assert.equal(existsSync(catalogPath), true);
  const catalog = readFileSync(catalogPath, "utf8");
  for (const channel of REQUIRED_CHANNELS) {
    assert.match(catalog, new RegExp(`["']${channel}["']`));
  }
  const mod = await importNotificationsRel("catalog.ts");
  const entries = catalogEntries(mod);
  for (const channel of REQUIRED_CHANNELS) {
    assert.ok(
      entries.some((entry) => entry.channel === channel),
      `catalog missing channel ${channel}`
    );
  }

  const ns = notificationsOf(createTargetClient());
  await assert.rejects(
    () =>
      ns.preferences.update({
        channel: "sms",
        enabled: true,
        topic: "security.login",
      }),
    (error: unknown) =>
      errorCode(error) === "ATHENA_NOTIFICATIONS_CHANNEL_UNKNOWN"
  );
});

test("T-NP-007: P?: athena.notification_preferences table exists and is not notifications_preferences", () => {
  assert.equal("notificationPreferences" in ATHENA_AUTH_TABLES, true);
  assert.equal(
    (ATHENA_AUTH_TABLES as { notificationPreferences?: string })
      .notificationPreferences,
    "athena.notification_preferences"
  );
  const migrations = readFileSync(migrationsPath, "utf8");
  assert.match(migrations, /athena\.notification_preferences/);
  assert.equal(/notifications_preferences/.test(migrations), false);
  const schema = readPkgRel("src/auth/local/schema.ts");
  assert.equal(/notifications_preferences/.test(schema), false);
});

test("T-NP-008: P?: tests assert ATHENA_AUTH_SCHEMA_GENERATION from the contract (not a stale 28)", () => {
  assert.equal(typeof ATHENA_AUTH_SCHEMA_GENERATION, "number");
  assert.notEqual(ATHENA_AUTH_SCHEMA_GENERATION, 28);
  const keys = Object.keys(ATHENA_AUTH_MIGRATION_EXPECTATIONS).map(Number);
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION, Math.max(...keys));
  assert.equal(29 in ATHENA_AUTH_MIGRATION_EXPECTATIONS, true);
  const gen29 = ATHENA_AUTH_MIGRATION_EXPECTATIONS[29] ?? [];
  assert.ok(
    gen29.some((entry) => entry.object === "athena.notification_preferences")
  );
  const migrations = readFileSync(migrationsPath, "utf8");
  assert.match(migrations, /name:\s*"029_notification_preferences"/);
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION >= 29, true);
});

test("T-NP-009: P?: signup creates zero notification_preferences rows", async () => {
  assert.equal(existsSync(memoryStorePath), true);
  const storeMod = await importNotificationsRel("memory-store.ts");
  const createStore = storeMod.createMemoryNotificationPreferenceStore;
  assert.equal(typeof createStore, "function");
  const store = (
    createStore as () => {
      list: (input: { userId: string }) => Promise<unknown[]>;
    }
  )();
  const rows = await store.list({ userId: "signup-user" });
  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.length, 0);

  const catalogMod = await importNotificationsRel("catalog.ts");
  const resolveMod = await importNotificationsRel("resolve.ts");
  const resolve = resolveMod.resolveEffectiveNotificationPreferences as
    | ResolveFn
    | undefined;
  assert.equal(typeof resolve, "function");
  const effective = resolve({
    catalog: catalogMod.NOTIFICATION_CATALOG,
    organizationId: null,
    overrides: [],
  });
  assert.equal(
    effective.length,
    REQUIRED_TOPICS.length * REQUIRED_CHANNELS.length
  );
  assert.ok(effective.every((item) => item.source === "catalog"));
});

test("T-NP-010: P?: rows are overrides not UI id label description enabled", () => {
  const migrations = readFileSync(migrationsPath, "utf8");
  assert.match(
    migrations,
    /CREATE TABLE IF NOT EXISTS athena\.notification_preferences/
  );
  assert.match(migrations, /user_id TEXT NOT NULL/);
  assert.match(migrations, /organization_id TEXT NULL/);
  assert.match(migrations, /channel TEXT NOT NULL/);
  assert.match(migrations, /topic TEXT NOT NULL/);
  assert.match(migrations, /enabled BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(migrations, /digest TEXT NULL/);
  assert.match(migrations, /metadata JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  const tableSql = migrations.slice(
    migrations.indexOf(
      "CREATE TABLE IF NOT EXISTS athena.notification_preferences"
    )
  );
  const end = tableSql.indexOf(";");
  const create = end >= 0 ? tableSql.slice(0, end) : tableSql.slice(0, 1200);
  assert.equal(/\blabel\b/.test(create), false);
  assert.equal(/\bdescription\b/.test(create), false);
});

test("T-NP-011: P?: effective is organization override then user override then catalog default", async () => {
  assert.equal(existsSync(resolvePath), true);
  const catalogMod = await importNotificationsRel("catalog.ts");
  const resolveMod = await importNotificationsRel("resolve.ts");
  const resolve = resolveMod.resolveEffectiveNotificationPreferences as
    | ResolveFn
    | undefined;
  assert.equal(typeof resolve, "function");

  const orgScope = resolve({
    catalog: catalogMod.NOTIFICATION_CATALOG,
    organizationId: "org-1",
    overrides: [
      {
        channel: "email",
        enabled: true,
        organizationId: null,
        topic: "security.login",
      },
      {
        channel: "email",
        enabled: false,
        organizationId: "org-1",
        topic: "security.login",
      },
    ],
  });
  const orgLogin = findEffective(orgScope, "security.login", "email");
  assert.equal(orgLogin.enabled, false);
  assert.equal(orgLogin.source, "organization");

  const userScope = resolve({
    catalog: catalogMod.NOTIFICATION_CATALOG,
    organizationId: null,
    overrides: [
      {
        channel: "email",
        enabled: true,
        organizationId: null,
        topic: "security.login",
      },
      {
        channel: "email",
        enabled: false,
        organizationId: "org-1",
        topic: "security.login",
      },
    ],
  });
  const userLogin = findEffective(userScope, "security.login", "email");
  assert.equal(userLogin.enabled, true);
  assert.equal(userLogin.source, "user");

  const catalogFallback = findEffective(userScope, "billing.invoice", "email");
  assert.equal(catalogFallback.source, "catalog");
});

test("T-NP-012: P?: organization_id NULL is user scope never a magical global org id", async () => {
  const blob = srcBlob(notificationsSrcDir);
  assert.match(blob, /organizationId/);
  assert.match(blob, /ATHENA_NOTIFICATIONS_SCOPE_INVALID/);
  assert.equal(/["']global["']/.test(blob), false);

  const ns = notificationsOf(createTargetClient());
  await assert.rejects(
    () =>
      ns.preferences.update({
        channel: "email",
        enabled: false,
        organizationId: "",
        topic: "security.login",
      }),
    (error: unknown) =>
      errorCode(error) === "ATHENA_NOTIFICATIONS_SCOPE_INVALID"
  );
});

test("T-NP-013: P?: NULL-safe unique indexes on user_id channel topic", () => {
  const migrations = readFileSync(migrationsPath, "utf8");
  assert.match(migrations, /uq_notification_preferences_user_channel_topic/);
  assert.match(
    migrations,
    /uq_notification_preferences_user_org_channel_topic/
  );
  assert.match(migrations, /WHERE organization_id IS NULL/);
  assert.match(migrations, /WHERE organization_id IS NOT NULL/);
  const gen29 = ATHENA_AUTH_MIGRATION_EXPECTATIONS[29] ?? [];
  assert.ok(
    gen29.some((entry) =>
      entry.object.includes("uq_notification_preferences_user_channel_topic")
    )
  );
  assert.ok(
    gen29.some((entry) =>
      entry.object.includes(
        "uq_notification_preferences_user_org_channel_topic"
      )
    )
  );
});

test("T-NP-014: P?: no athena.notifications events table this slice", () => {
  const migrations = readFileSync(migrationsPath, "utf8");
  assert.match(migrations, /athena\.notification_preferences/);
  assert.equal(
    /CREATE TABLE IF NOT EXISTS athena\.notifications\b/.test(migrations),
    false
  );
  assert.equal(existsSync(join(notificationsSrcDir, "events-store.ts")), true);
  const events = readFileSync(
    join(notificationsSrcDir, "events-store.ts"),
    "utf8"
  );
  assert.match(events, /Memory|memory/);
});

test("T-NP-015: P?: unknown topic fails ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN", async () => {
  const blob = srcBlob(notificationsSrcDir);
  assert.match(blob, /ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN/);
  const ns = notificationsOf(createTargetClient());
  await assert.rejects(
    () =>
      ns.preferences.update({
        channel: "email",
        enabled: true,
        topic: "product",
      }),
    (error: unknown) =>
      errorCode(error) === "ATHENA_NOTIFICATIONS_TOPIC_UNKNOWN"
  );
});

test("T-NP-016: P?: notifications errors use band 9000 not auth 8030", () => {
  assert.equal(existsSync(errorsContractPath), true);
  const errors = JSON.parse(readFileSync(errorsContractPath, "utf8")) as {
    errors?: Array<{ code?: string; errorNumber?: number }>;
    codes?: Array<{ code?: string; errorNumber?: number }>;
  };
  const entries = errors.errors ?? errors.codes ?? [];
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.equal((entry.code ?? "").startsWith("ATHENA_NOTIFICATIONS_"), true);
    assert.ok((entry.errorNumber ?? 0) >= 9000);
    assert.ok((entry.errorNumber ?? 0) <= 9999);
  }
  for (const required of REQUIRED_ERROR_CODES) {
    assert.ok(
      entries.some(
        (entry) =>
          entry.code === required.code &&
          entry.errorNumber === required.errorNumber
      ),
      required.code
    );
  }
  const authErrors = JSON.parse(
    readFileSync(join(repoRoot, "contracts", "auth", "errors.json"), "utf8")
  ) as { codes?: Array<{ code?: string; errorNumber?: number }> };
  assert.equal(
    (authErrors.codes ?? []).some((entry) =>
      (entry.code ?? "").startsWith("ATHENA_NOTIFICATIONS_")
    ),
    false
  );
});

test("T-NP-017: P?: preference and event payloads contain no secrets", async () => {
  assert.equal(existsSync(notificationsSrcDir), true);
  const blob = srcBlob(notificationsSrcDir);
  assert.ok(blob.length > 0);
  assert.equal(SECRET_FIELD_PATTERN.test(blob), false);
  const typesMod = await importNotificationsRel("types.ts");
  const typeSrc = JSON.stringify(Object.keys(typesMod));
  assert.equal(SECRET_FIELD_PATTERN.test(typeSrc), false);
});

test("T-NP-018: P?: embedded and remote expose the same public notifications methods", async () => {
  const blob = srcBlob(notificationsSrcDir);
  assert.match(blob, /AthenaNotificationsModule/);
  assert.match(blob, /preferences/);
  assert.match(blob, /markRead/);
  assert.match(blob, /markAllRead/);
  const ns = notificationsOf(createTargetClient());
  assert.equal(typeof ns.preferences.list, "function");
  assert.equal(typeof ns.preferences.update, "function");
  assert.equal(typeof ns.preferences.reset, "function");
  assert.equal(typeof ns.catalog.list, "function");
  assert.equal(typeof ns.list, "function");
  assert.equal(typeof ns.markRead, "function");
  assert.equal(typeof ns.markAllRead, "function");
  assert.match(blob, /remote|embedded|gateway/i);
});

test("T-NP-019: P?: assembleAthenaClient attaches notifications without a second constructor", () => {
  const assembled = readPkgRel("src/v3-client.ts");
  assert.match(assembled, /notifications/);
  assert.equal(/\bcreateNotificationsClient\b/.test(assembled), false);
  assert.equal(typeof rootBarrel.createClient, "function");
  const core = readPkgRel("src/client/contracts.ts");
  assert.match(core, /readonly notifications:/);
});

test("T-NP-ARCH-001: P?: catalog owns topics and channels; UI does not invent them", async () => {
  assert.equal(existsSync(catalogPath), true);
  const catalog = readFileSync(catalogPath, "utf8");
  assert.match(catalog, /security\.login/);
  assert.match(catalog, /in_app/);
  const mod = await importNotificationsRel("catalog.ts");
  const entries = catalogEntries(mod);
  assert.ok(entries.some((entry) => entry.topic === "security.login"));
  assert.ok(entries.some((entry) => entry.channel === "in_app"));
  assert.equal(
    entries.some((entry) => entry.topic === "product"),
    false
  );
});

test("T-NP-ARCH-002: P?: no public Data Nucleus and no createNotificationsClient", () => {
  const pkg = JSON.parse(readPkgRel("package.json")) as {
    exports?: Record<string, unknown>;
  };
  assert.equal("./nucleus" in (pkg.exports ?? {}), false);
  assert.equal("createNotificationsClient" in rootBarrel, false);
  assert.equal(
    readPkgRel("package.json").includes("runtime/data/nucleus"),
    false
  );
  assert.equal("createStorageClient" in rootBarrel, false);
  assert.equal("createPolicyClient" in rootBarrel, false);
});

test("T-NP-020: P?: createClient without catalog fail-closes notifications", async () => {
  const client = createClient({
    storage: { prefix: "np-empty/", r2: createSddMockR2() },
  });
  const ns = notificationsOf(client);
  await assert.rejects(
    () => ns.preferences.list(),
    (error: unknown) => errorCode(error) === "ATHENA_NOTIFICATIONS_UNAVAILABLE"
  );
  await assert.rejects(
    () => ns.catalog.list(),
    (error: unknown) => errorCode(error) === "ATHENA_NOTIFICATIONS_UNAVAILABLE"
  );
});

test("T-NP-021: P?: catalog.list returns the app catalog", async () => {
  const listed = await notificationsOf(createTargetClient()).catalog.list();
  assert.equal(
    listed.items.length,
    REQUIRED_TOPICS.length * REQUIRED_CHANNELS.length
  );
  assert.ok(
    listed.items.some(
      (entry) => entry.topic === "security.login" && entry.channel === "email"
    )
  );
});

test("T-NP-022: P?: preferences.reset DELETEs the sparse row and restores catalog", async () => {
  const client = createTargetClient().withContext({ userId: "user-reset" });
  const ns = notificationsOf(client);
  await ns.preferences.update({
    channel: "email",
    enabled: false,
    topic: "security.login",
  });
  const afterUpdate = findEffective(
    (await ns.preferences.list()).items,
    "security.login",
    "email"
  );
  assert.equal(afterUpdate.enabled, false);
  assert.equal(afterUpdate.source, "user");

  const reset = await ns.preferences.reset({
    channel: "email",
    topic: "security.login",
  });
  assert.equal(reset.item.source, "catalog");
  assert.equal(reset.item.enabled, true);

  const afterReset = findEffective(
    (await ns.preferences.list()).items,
    "security.login",
    "email"
  );
  assert.equal(afterReset.source, "catalog");
  assert.equal(afterReset.enabled, true);
});

test("T-NP-023: P?: reset and update require a session user and stay on that user", async () => {
  const ns = notificationsOf(createTargetClient());
  await assert.rejects(
    () =>
      ns.preferences.reset({
        channel: "email",
        topic: "security.login",
      }),
    (error: unknown) =>
      errorCode(error) === "ATHENA_NOTIFICATIONS_UNAUTHENTICATED"
  );

  const alice = notificationsOf(
    createTargetClient().withContext({ userId: "alice" })
  );
  const bob = notificationsOf(
    createTargetClient().withContext({ userId: "bob" })
  );
  await alice.preferences.update({
    channel: "email",
    enabled: false,
    topic: "security.login",
  });
  const bobLogin = findEffective(
    (await bob.preferences.list()).items,
    "security.login",
    "email"
  );
  assert.equal(bobLogin.source, "catalog");
  assert.equal(bobLogin.enabled, true);
});

test("T-NP-024: P?: org-scoped override does not leak into user scope", async () => {
  const ns = notificationsOf(
    createTargetClient().withContext({ userId: "org-user" })
  );
  await ns.preferences.update({
    channel: "email",
    enabled: false,
    organizationId: "org-a",
    topic: "security.login",
  });
  const userScope = findEffective(
    (await ns.preferences.list()).items,
    "security.login",
    "email"
  );
  assert.equal(userScope.source, "catalog");
  const orgScope = findEffective(
    (await ns.preferences.list({ organizationId: "org-a" })).items,
    "security.login",
    "email"
  );
  assert.equal(orgScope.source, "organization");
  assert.equal(orgScope.enabled, false);
  const otherOrg = findEffective(
    (await ns.preferences.list({ organizationId: "org-b" })).items,
    "security.login",
    "email"
  );
  assert.equal(otherOrg.source, "catalog");
});

test("T-NP-025: P?: demo preset is opt-in and includes product topics", async () => {
  const catalog = readFileSync(catalogPath, "utf8");
  assert.match(catalog, /athenaNotificationCatalogDemo/);
  assert.match(catalog, /product\.announcement/);
  const mod = await importNotificationsRel("catalog.ts");
  assert.equal("athenaNotificationCatalogDemo" in mod, true);
  assert.equal("athenaNotificationCatalogDemo" in rootBarrel, true);
  const demo = catalogEntries({
    NOTIFICATION_CATALOG: mod.athenaNotificationCatalogDemo,
  });
  assert.ok(demo.some((entry) => entry.topic === "product.announcement"));
  assert.ok(demo.some((entry) => entry.topic === "security.login"));
});
