/**
 * SUPERSEDED by test/sdd/athena-notifications-preferences.target.test.ts
 *
 * Former characterization of freeze-HEAD defects (no createClient().notifications,
 * no src/notifications/, gen 28, no 9000 band, snapshot write authority).
 * Retired after steps 1–8 target GREEN (2026-08-25). Not collected by pnpm test
 * (superseded/ is skipped).
 *
 * Target suite is the CI source of truth. Do not invert titles in place.
 *
 * Spec: docs/sdd/xylex/athena-notifications-and-auth-ui-domains/SPEC.md
 * Dual-suite: docs/sdd/xylex/athena-notifications-and-auth-ui-domains/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	ATHENA_AUTH_SCHEMA_GENERATION,
	ATHENA_AUTH_TABLES,
} from "../../../src/auth/contract/index.ts";
import { ATHENA_AUTH_MIGRATION_EXPECTATIONS } from "../../../src/auth/local/schema-manifest.ts";
import * as rootBarrel from "../../../src/index.ts";
import { createClient } from "../../../src/v3-client.ts";
import { createSddMockR2 } from "../sdd-mocks.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");
const repoRoot = join(pkgRoot, "..", "..");
const authUiSrc = join(repoRoot, "packages", "athena-auth-ui", "src");
const contractsRoot = join(repoRoot, "contracts");
const notificationsSrcDir = join(srcRoot, "notifications");

type PackageJsonShape = {
	exports?: Record<string, unknown>;
};

function readPkgRel(rel: string): string {
	return readFileSync(join(pkgRoot, rel), "utf8");
}

function readUi(rel: string): string {
	return readFileSync(join(authUiSrc, rel), "utf8");
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

function srcMentions(pattern: RegExp): boolean {
	return collectTsFiles(srcRoot).some((file) =>
		pattern.test(readFileSync(file, "utf8")),
	);
}

function uiMentions(pattern: RegExp): boolean {
	return collectTsFiles(authUiSrc).some((file) =>
		pattern.test(readFileSync(file, "utf8")),
	);
}

function loadPackageJson(): PackageJsonShape {
	return JSON.parse(readPkgRel("package.json")) as PackageJsonShape;
}

function exportedCtor(name: string): boolean {
	return (
		name in rootBarrel &&
		typeof (rootBarrel as Record<string, unknown>)[name] === "function"
	);
}

test("B-NP-NO-CLIENT: P?: AthenaClient has admin/auth/billing/cache/chat/db/email — no notifications", () => {
	const core = readPkgRel("src/v3-client-core.ts");
	assert.match(core, /export interface AthenaClient</);
	assert.match(core, /readonly admin:/);
	assert.match(core, /readonly auth: AthenaAuthBindings/);
	assert.match(core, /readonly billing: AthenaBillingModule/);
	assert.match(core, /readonly cache: AthenaQueryClient/);
	assert.match(core, /readonly chat: AthenaChatModule/);
	assert.match(core, /readonly db: AthenaDbModule/);
	assert.match(core, /readonly email: AthenaEmailModule/);
	assert.match(core, /readonly storage: AthenaStorageModule/);
	assert.equal(/\breadonly notifications\b/.test(core), false);
	assert.equal(/\bnotifications\s*:/.test(core), false);

	const r2 = createSddMockR2();
	const client = createClient({
		storage: { prefix: "np-baseline/", r2 },
	});
	assert.equal("admin" in client, true);
	assert.equal("auth" in client, true);
	assert.equal("billing" in client, true);
	assert.equal("cache" in client, true);
	assert.equal("chat" in client, true);
	assert.equal("db" in client, true);
	assert.equal("email" in client, true);
	assert.equal("storage" in client, true);
	assert.equal("notifications" in client, false);
	assert.equal("notifications" in client.auth, false);
});

test("B-NP-NO-DIR: P?: src/notifications/ does not exist", () => {
	assert.equal(existsSync(notificationsSrcDir), false);
	assert.equal(existsSync(join(srcRoot, "notifications", "catalog.ts")), false);
	assert.equal(
		existsSync(join(srcRoot, "notifications", "index.ts")),
		false,
	);
});

test("B-NP-NO-CREATE: P?: createNotificationsClient does not exist", () => {
	assert.equal(srcMentions(/\bcreateNotificationsClient\b/), false);
	assert.equal(exportedCtor("createNotificationsClient"), false);
	assert.equal(readPkgRel("package.json").includes("createNotificationsClient"), false);
});

test("B-NP-NO-AUTH-NS: P?: no athena.auth.notifications namespace", () => {
	const authTypes = readPkgRel("src/auth/types.ts");
	assert.match(authTypes, /export interface AthenaAuthBindings \{/);
	assert.equal(/\bnotifications\b/.test(authTypes), false);
	assert.equal(srcMentions(/\bathena\.auth\.notifications\b/), false);
});

test("B-NP-ASSEMBLE: P?: assembleAthenaClient attaches local auth and billing only", () => {
	const assembled = readPkgRel("src/v3-client.ts");
	assert.match(assembled, /function assembleAthenaClient</);
	assert.match(assembled, /attachLocalAuthRuntime\(/);
	assert.match(assembled, /attachLocalBillingRuntime\(/);
	assert.equal(/attachLocalNotifications/.test(assembled), false);
	assert.equal(/notifications/.test(assembled), false);
});

test("B-NP-GEN-28: P?: ATHENA_AUTH_SCHEMA_GENERATION === 28 and no notification_preferences", () => {
	assert.equal(ATHENA_AUTH_SCHEMA_GENERATION, 28);
	assert.equal("oauthTransactions" in ATHENA_AUTH_TABLES, true);
	assert.equal(
		ATHENA_AUTH_TABLES.oauthTransactions,
		"athena.oauth_transactions",
	);
	assert.equal("notificationPreferences" in ATHENA_AUTH_TABLES, false);
	assert.equal(
		Object.values(ATHENA_AUTH_TABLES).includes(
			"athena.notification_preferences",
		),
		false,
	);
});

test("B-NP-NO-TABLE: P?: ATHENA_AUTH_TABLES has no notification_preferences", () => {
	const contract = readPkgRel("src/auth/contract/index.ts");
	assert.equal(contract.includes("notificationPreferences"), false);
	assert.equal(contract.includes("notification_preferences"), false);
	assert.equal(contract.includes("notifications_preferences"), false);
});

test("B-NP-MANIFEST-28: P?: schema-manifest max key is 28 with oauth_transactions", () => {
	const keys = Object.keys(ATHENA_AUTH_MIGRATION_EXPECTATIONS).map(Number);
	assert.equal(Math.max(...keys), 28);
	assert.equal(29 in ATHENA_AUTH_MIGRATION_EXPECTATIONS, false);
	const gen28 = ATHENA_AUTH_MIGRATION_EXPECTATIONS[28] ?? [];
	assert.ok(
		gen28.some((entry) => entry.object === "athena.oauth_transactions"),
	);
	assert.equal(
		gen28.some((entry) => entry.object.includes("notification_preferences")),
		false,
	);
});

test("B-NP-SCHEMA-028: P?: last embedded auth migration is 028_oauth_transactions", () => {
	const schema = readPkgRel("src/auth/schema/migrations.ts");
	assert.match(schema, /name:\s*"028_oauth_transactions"/);
	assert.match(schema, /version:\s*28/);
	assert.equal(/029_notification_preferences/.test(schema), false);
	assert.equal(/athena\.notification_preferences/.test(schema), false);
	assert.equal(/CREATE TABLE IF NOT EXISTS athena\.notifications\b/.test(schema), false);
});

test("B-NP-NO-9000: P?: contracts have no notifications 9000 error band", () => {
	assert.equal(existsSync(join(contractsRoot, "notifications")), false);
	assert.equal(
		existsSync(join(contractsRoot, "notifications", "errors.json")),
		false,
	);
	const catalogReadme = readFileSync(
		join(contractsRoot, "README.md"),
		"utf8",
	);
	assert.equal(/9000/.test(catalogReadme), false);
	assert.equal(/notifications/.test(catalogReadme), false);

	const authErrors = JSON.parse(
		readFileSync(join(contractsRoot, "auth", "errors.json"), "utf8"),
	) as {
		band?: string;
		codes?: Array<{ code?: string; errorNumber?: number }>;
	};
	assert.equal(authErrors.band, "8000-8999");
	const numbers = (authErrors.codes ?? [])
		.map((entry) => entry.errorNumber)
		.filter((value): value is number => typeof value === "number");
	assert.equal(Math.max(...numbers), 8029);
	assert.ok(
		(authErrors.codes ?? []).some(
			(entry) =>
				entry.code === "ATHENA_AUTH_AUDIT_INVALID_RESULT" &&
				entry.errorNumber === 8029,
		),
	);
	assert.equal(
		(authErrors.codes ?? []).some((entry) =>
			(entry.code ?? "").startsWith("ATHENA_NOTIFICATIONS_"),
		),
		false,
	);
});

test("B-NP-NO-CTOR: P?: no createNotificationsClient", () => {
	assert.equal(exportedCtor("createNotificationsClient"), false);
	assert.equal(srcMentions(/\bcreateNotificationsClient\b/), false);
});

test("B-NP-NO-STORAGE-CTOR: P?: no createStorageClient", () => {
	assert.equal(exportedCtor("createStorageClient"), false);
	assert.equal(readPkgRel("package.json").includes("createStorageClient"), false);
	for (const file of collectTsFiles(srcRoot)) {
		const text = readFileSync(file, "utf8");
		assert.equal(
			/\bexport\s+(?:async\s+)?function\s+createStorageClient\b/.test(text),
			false,
			file,
		);
	}
});

test("B-NP-NO-POLICY-CTOR: P?: no createPolicyClient", () => {
	assert.equal(exportedCtor("createPolicyClient"), false);
	assert.equal(readPkgRel("package.json").includes("createPolicyClient"), false);
	for (const file of collectTsFiles(srcRoot)) {
		const text = readFileSync(file, "utf8");
		assert.equal(
			/\bexport\s+(?:async\s+)?function\s+createPolicyClient\b/.test(text),
			false,
			file,
		);
	}
});

test("B-NP-NO-NUCLEUS-EXPORT: P?: Data Nucleus is not a public package export", () => {
	const pkg = loadPackageJson();
	const exportsMap = pkg.exports ?? {};
	assert.equal("./runtime" in exportsMap, true);
	assert.equal("./nucleus" in exportsMap, false);
	assert.equal("./runtime/data/nucleus" in exportsMap, false);
	assert.equal(readPkgRel("package.json").includes("runtime/data/nucleus"), false);
});

test("B-NP-GEN-FROM-CONTRACT: P?: ATHENA_AUTH_SCHEMA_GENERATION is exported from auth contract", () => {
	const contract = readPkgRel("src/auth/contract/index.ts");
	assert.match(
		contract,
		/export const ATHENA_AUTH_SCHEMA_GENERATION = /,
	);
	assert.equal(typeof ATHENA_AUTH_SCHEMA_GENERATION, "number");
	assert.equal(Number.isInteger(ATHENA_AUTH_SCHEMA_GENERATION), true);
});

test("B-NP-ONE-CREATE-CLIENT: P?: createClient remains the public constructor", () => {
	assert.equal(typeof rootBarrel.createClient, "function");
	assert.equal(typeof createClient, "function");
	assert.match(readPkgRel("src/v3-client.ts"), /export function createClient</);
});

test("B-NUI-SNAPSHOT: P?: WorkspacePreferenceSnapshot.notificationPreferences is write authority via localStorage", () => {
	const runtime = readUi("components/auth/workspace/workspace-runtime.ts");
	assert.match(runtime, /writeWorkspacePreferenceSnapshot\(/);
	assert.match(runtime, /createWorkspacePreferenceSnapshot\(/);
	assert.match(runtime, /readWorkspacePreferenceSnapshot\(/);
	assert.match(
		runtime,
		/useState<\s*NotificationPreference\[\]\s*>/,
	);

	const utils = readUi("components/auth/workspace/utils.ts");
	assert.match(utils, /export function writeWorkspacePreferenceSnapshot/);
	assert.match(utils, /window\.localStorage\.setItem/);
	assert.match(
		utils,
		/notificationPreferences:\s*NotificationPreference\[\]/,
	);

	const types = readUi("components/auth/workspace/types.ts");
	assert.match(types, /export interface WorkspacePreferenceSnapshot \{/);
	assert.match(types, /notificationPreferences: NotificationPreference\[\]/);
});

test("B-NUI-KEY: P?: localStorage key is athena-auth-ui:workspace-preferences:${userId}", () => {
	const utils = readUi("components/auth/workspace/utils.ts");
	assert.match(
		utils,
		/const WORKSPACE_PREFERENCES_STORAGE_PREFIX =\s*"athena-auth-ui:workspace-preferences:"/,
	);
	assert.match(
		utils,
		/`\$\{WORKSPACE_PREFERENCES_STORAGE_PREFIX\}\$\{userId\}`/,
	);
});

test("B-NUI-UI-SHAPE: P?: NotificationPreference is id label description enabled with defaults security invitations digest product", () => {
	const types = readUi("components/auth/workspace/types.ts");
	assert.match(types, /export interface NotificationPreference \{/);
	assert.match(types, /description\?: string/);
	assert.match(types, /enabled: boolean/);
	assert.match(types, /id: string/);
	assert.match(types, /label: string/);

	const utils = readUi("components/auth/workspace/utils.ts");
	assert.match(utils, /export function buildDefaultNotificationPreferences/);
	assert.match(utils, /id:\s*"security"/);
	assert.match(utils, /id:\s*"invitations"/);
	assert.match(utils, /id:\s*"digest"/);
	assert.match(utils, /id:\s*"product"/);
	assert.equal(/security\.login/.test(utils), false);
	assert.equal(/organization\.invitation/.test(utils), false);
});

test("B-NUI-TOGGLES: P?: WorkspaceFeatureToggles inboxDigest notifyCriticalOnly realtimeAuditAlerts weeklySecurityDigest exists", () => {
	const types = readUi("components/auth/workspace/types.ts");
	assert.match(types, /export interface WorkspaceFeatureToggles \{/);
	assert.match(types, /inboxDigest: boolean/);
	assert.match(types, /notifyCriticalOnly: boolean/);
	assert.match(types, /realtimeAuditAlerts: boolean/);
	assert.match(types, /weeklySecurityDigest: boolean/);

	const controls = readUi(
		"components/auth/workspace/workspace-controls-card.tsx",
	);
	assert.match(controls, /featureToggles\.inboxDigest/);
	assert.match(controls, /featureToggles\.notifyCriticalOnly/);
	assert.match(controls, /featureToggles\.realtimeAuditAlerts/);
	assert.match(controls, /featureToggles\.weeklySecurityDigest/);
	assert.match(controls, /title="Notification Preferences"/);
});

test("B-NUI-PROBE: P?: useWorkspaceNotificationsQuery probes admin auth workspace notification(s).list", () => {
	const hooks = readUi("components/auth/workspace/hooks.ts");
	assert.match(hooks, /export function useWorkspaceNotificationsQuery/);
	assert.match(hooks, /\["admin", "notification", "list"\]/);
	assert.match(hooks, /\["admin", "notifications", "list"\]/);
	assert.match(hooks, /\["auth", "admin", "notification", "list"\]/);
	assert.match(hooks, /\["auth", "admin", "notifications", "list"\]/);
	assert.match(hooks, /\["workspace", "notification", "list"\]/);
	assert.match(hooks, /\["workspace", "notifications", "list"\]/);
	assert.match(hooks, /\["notification", "list"\]/);
	assert.match(hooks, /\["notifications", "list"\]/);
	assert.match(hooks, /queryKey:\s*\["athena", "workspace", "notifications"\]/);
	assert.equal(/client\.notifications\.list/.test(hooks), false);
});

test("B-NUI-UMBRELLA: P?: WorkspaceSettings is the umbrella view=workspace", () => {
	const settings = readUi(
		"components/auth/workspace/workspace-settings.tsx",
	);
	assert.match(settings, /export function WorkspaceSettings/);
	assert.match(settings, /view="workspace"/);
	assert.match(settings, /id: "operations"/);
	assert.match(settings, /id: "security"/);
	assert.match(settings, /id: "communications"/);
	assert.match(settings, /id: "notifications"/);
	assert.match(settings, /id: "documents"/);
	assert.match(settings, /id: "logs"/);
	assert.match(settings, /id: "sdkLab"/);
	assert.match(settings, /WorkspaceNotificationsPanel/);
});

test("B-NUI-PUBLIC: P?: WorkspaceNotificationsPanel and WorkspaceSettings are public names", () => {
	const index = readUi("components/auth/workspace/index.ts");
	assert.match(index, /export \* from "\.\/workspace-notifications-panel"/);
	assert.match(index, /export \* from "\.\/workspace-settings"/);
	const plugins = readUi("plugins.ts");
	assert.match(plugins, /export \* from "\.\/components\/auth\/workspace\/index\.js"/);
	assert.match(plugins, /workspacePlugin/);
	const plugin = readUi("lib/auth/workspace/workspace-plugin.ts");
	assert.match(plugin, /export const workspacePlugin = createAuthPlugin\(\s*"workspace"/);
	assert.match(plugin, /view: "workspace"/);
	assert.match(plugin, /WorkspaceNotificationsSettings/);
});

test("B-NUI-NO-HOOK: P?: useNotificationPreferences does not exist", () => {
	assert.equal(uiMentions(/\buseNotificationPreferences\b/), false);
});

test("B-NUI-NO-CARD: P?: NotificationPreferencesCard does not exist", () => {
	assert.equal(uiMentions(/\bNotificationPreferencesCard\b/), false);
	assert.equal(
		existsSync(
			join(
				authUiSrc,
				"components",
				"auth",
				"notifications",
				"notification-preferences-card.tsx",
			),
		),
		false,
	);
});

test("B-NUI-EMPTY: P?: WorkspaceEmptyState is AuthEmptyState alias", () => {
	const alias = readUi(
		"components/auth/empty-state/auth-empty-state.tsx",
	);
	assert.match(alias, /export const WorkspaceEmptyState = AuthEmptyState/);
	const wrapper = readUi(
		"components/auth/empty-state/workspace-empty-state.tsx",
	);
	assert.match(
		wrapper,
		/AuthEmptyState as WorkspaceEmptyState/,
	);
});

test("B-NUI-SESSION: P?: workspace runtime reads useAthenaSession", () => {
	const runtime = readUi("components/auth/workspace/workspace-runtime.ts");
	assert.match(
		runtime,
		/import \{ useAthenaSession \} from "@\/components\/auth\/use-athena-session"/,
	);
	assert.match(runtime, /const session = useAthenaSession\(\)/);
	assert.equal(/writeSessionQueryData/.test(runtime), false);
});

test("B-NUI-LINKER: P?: athena-js-workspace SDD remains the pnpm linker suite", () => {
	assert.equal(
		existsSync(
			join(
				repoRoot,
				"packages",
				"athena-auth-ui",
				"tests",
				"sdd",
				"athena-js-workspace.baseline.test.ts",
			),
		),
		true,
	);
	assert.equal(
		existsSync(
			join(
				repoRoot,
				"packages",
				"athena-auth-ui",
				"tests",
				"sdd",
				"athena-js-workspace.target.test.ts",
			),
		),
		true,
	);
	const linker = readFileSync(
		join(
			repoRoot,
			"packages",
			"athena-auth-ui",
			"tests",
			"sdd",
			"athena-js-workspace.baseline.test.ts",
		),
		"utf8",
	);
	assert.match(linker, /Git-root workspace linker/);
	assert.match(linker, /B-WS-ROOT/);
});
