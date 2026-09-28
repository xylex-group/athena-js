/**
 * Target: Athena notifications event/delivery runtime (ADR 0069).
 * RED on freeze HEAD until schema, stores, dispatcher, and HTTP contract land.
 *
 * Spec: docs/sdd/xylex/athena-notifications-runtime-finality/SPEC.md
 *
 * Host:
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/athena-notifications-runtime-finality.target.test.ts
 *
 * Frozen in RED_CONTRACT_FREEZE until GREEN. Never pnpm test:sdd while RED.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ATHENA_AUTH_SCHEMA_GENERATION,
  ATHENA_AUTH_TABLES,
} from "../../src/auth/contract/index.ts";
import { ATHENA_AUTH_MIGRATION_EXPECTATIONS } from "../../src/auth/local/schema-manifest.ts";
import { listAthenaAuthCanonicalMigrations } from "../../src/auth/schema/migrations.ts";
import * as rootBarrel from "../../src/index.ts";

type AuthTables = typeof ATHENA_AUTH_TABLES & {
  notificationDeliveries?: string;
  notificationEvents?: string;
};

const tables = ATHENA_AUTH_TABLES as AuthTables;

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const notificationsDir = join(srcRoot, "notifications");
const v3ClientPath = join(srcRoot, "v3-client.ts");
const eventsStorePath = join(notificationsDir, "events-store.ts");
const errorsPath = join(notificationsDir, "errors.ts");
const typesPath = join(notificationsDir, "types.ts");

test("NRF-001: ATHENA_AUTH_TABLES names notification events", () => {
  assert.equal(tables.notificationEvents, "athena.notification_events");
});

test("NRF-002: ATHENA_AUTH_TABLES names notification deliveries", () => {
  assert.equal(tables.notificationDeliveries, "athena.notification_deliveries");
});

test("NRF-003: Auth schema generation 34 includes events and deliveries migrations", () => {
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION, 34);
  const migrations = listAthenaAuthCanonicalMigrations();
  const names = migrations.map((row) => row.name);
  assert.equal(names.includes("033_notification_events"), true);
  assert.equal(names.includes("034_notification_deliveries"), true);
  assert.equal(Array.isArray(ATHENA_AUTH_MIGRATION_EXPECTATIONS[33]), true);
  assert.equal(Array.isArray(ATHENA_AUTH_MIGRATION_EXPECTATIONS[34]), true);
});

test("NRF-004: event store has create and no seed side channel", () => {
  const source = readFileSync(eventsStorePath, "utf8");
  assert.match(source, /create:\s*(async\s*)?\(/);
  assert.equal(source.includes("seedMemoryNotificationEvent"), false);
  assert.equal(source.includes("__seed"), false);
});

test("NRF-005: Postgres notification event store module exists", () => {
  assert.equal(
    existsSync(join(notificationsDir, "postgres-events-store.ts")),
    true
  );
});

test("NRF-006: local attach replaces the event store on Postgres", () => {
  const source = readFileSync(v3ClientPath, "utf8");
  assert.match(source, /attachLocalNotificationsRuntime/);
  assert.match(source, /PostgresNotificationEventStore|postgres-events-store/);
});

test("NRF-007: dispatcher module exists", () => {
  assert.equal(existsSync(join(notificationsDir, "dispatcher.ts")), true);
});

test("NRF-008: notification HTTP operations SSOT exists", () => {
  assert.equal(
    existsSync(join(notificationsDir, "contract", "operations.ts")),
    true
  );
});

test("NRF-009: public API has no createNotificationsClient", () => {
  assert.equal("createNotificationsClient" in rootBarrel, false);
});

test("NRF-010: error catalog includes EVENT_INVALID 9007", () => {
  const source = readFileSync(errorsPath, "utf8");
  assert.match(source, /ATHENA_NOTIFICATIONS_EVENT_INVALID/);
  assert.match(source, /9007/);
});

test("NRF-011: public module includes unreadCount and archive", () => {
  const source = readFileSync(typesPath, "utf8");
  assert.match(source, /unreadCount/);
  assert.match(source, /archive/);
});

test("NRF-012: events migration has partial unique dedupe index", () => {
  const events = listAthenaAuthCanonicalMigrations().find(
    (row) => row.name === "033_notification_events"
  );
  assert.equal(events != null, true);
  assert.match(events?.sql ?? "", /uq_notification_events_dedupe_key/);
  assert.match(events?.sql ?? "", /visible_in_app/);
});
