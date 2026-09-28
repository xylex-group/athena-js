import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeAthenaAuthConfig } from "../../auth/config.ts";
import { createPasskeyRelyingPartySnapshot } from "../../auth/passkey/server/relying-party.ts";
import { DEFAULT_MIGRATIONS_DIRECTORY } from "../../migrations/constants.ts";
import { parseMigrationFilename } from "../../migrations/discovery.ts";
import { tryParseAthenaRightKey } from "../../rights/key.ts";
import type { AthenaClientInternals } from "../../runtime/client-internals.ts";
import { resolveRuntimePlan } from "../../runtime/plan/resolve.ts";
import { schemaIrFromModels } from "../../schema/ir/compatibility.ts";
import { collectModelsFromSqlInput } from "../../schema/model-sql.ts";
import { PACKAGE_VERSION } from "../../sdk-version.ts";
import {
  type AthenaBuildProvenance,
  readGitBuildProvenance,
} from "../build-provenance.ts";
import type {
  AthenaDevtoolsMigrationGeneratedBy,
  AthenaDevtoolsMigrationsInspector,
  AthenaDevtoolsModelRelation,
  AthenaDevtoolsModelsInspector,
  AthenaDevtoolsModelTable,
  AthenaDevtoolsPackageProvenance,
  AthenaDevtoolsPanelEntry,
  AthenaDevtoolsRedactedFact,
  AthenaDevtoolsSettingProvenance,
  AthenaDevtoolsSettingSource,
  AthenaDevtoolsSnapshot,
} from "../protocol/index.ts";
import {
  ATHENA_DEVTOOLS_PANEL_IDS,
  ATHENA_DEVTOOLS_PROTOCOL_VERSION,
} from "../protocol/index.ts";
import { sanitizeAthenaDevtoolsBillingInspector } from "../sanitize/billing.ts";
import {
  produceAthenaDevtoolsAuthorizationInspector,
  produceAthenaDevtoolsAuthorizationInspectorSync,
} from "./authorization.ts";
import { produceAthenaDevtoolsBillingInspector } from "./billing/index.ts";
import {
  projectAthenaCapabilitiesToDevtools,
} from "./capabilities.ts";
import { resolveAthenaCapabilities } from "../../capabilities/resolver.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function presence(set: boolean): "set" | "unset" {
  return set ? "set" : "unset";
}

function nested(
  input: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const value = input?.[key];
  return isRecord(value) ? value : undefined;
}

function unsetFact(): AthenaDevtoolsRedactedFact {
  return { kind: "unset" };
}

function structural(
  value: string | boolean | number | null
): AthenaDevtoolsRedactedFact {
  return { kind: "structural", value };
}

function hostnameFromOrigin(origin: string): string | undefined {
  try {
    const hostname = new URL(origin).hostname;
    return hostname || undefined;
  } catch {
    /* origin is not a URL */
  }
}

function uniqueExactHostname(origins: readonly string[]): string | undefined {
  const hosts = new Set<string>();
  for (const origin of origins) {
    if (!origin.trim()) {
      continue;
    }
    const hostname = hostnameFromOrigin(origin);
    if (hostname) {
      hosts.add(hostname);
    }
  }
  if (hosts.size !== 1) {
    return;
  }
  const [hostname] = hosts;
  return hostname;
}

function resolvePasskeyRpInspector(input: Record<string, unknown>): {
  configured: boolean;
  effective: boolean;
  inferred: "set" | "not-applicable";
  rpId: string;
  source: AthenaDevtoolsSettingSource;
} {
  const auth = nested(input, "auth");
  const passkey = nested(auth, "passkey");
  const explicit = typeof passkey?.rpId === "string" ? passkey.rpId.trim() : "";
  try {
    const normalized = normalizeAthenaAuthConfig(input.auth, {
      app: isRecord(input.app) ? input.app : undefined,
      env:
        input.env && typeof input.env === "object"
          ? (input.env as Record<string, string | undefined>)
          : undefined,
    });
    const environment =
      process.env.NODE_ENV === "production" ? "production" : "development";
    const relyingParty = createPasskeyRelyingPartySnapshot({
      appIdentity: normalized.appIdentity,
      environment,
      passkey: normalized.passkey,
      required: false,
      trustedOrigins: normalized.security.trustedOrigins,
    });
    const rpId = relyingParty.id.trim();
    if (!rpId) {
      return {
        configured: Boolean(explicit),
        effective: false,
        inferred: "not-applicable",
        rpId: "",
        source: explicit ? "createClient" : "unset",
      };
    }
    if (explicit) {
      return {
        configured: true,
        effective: true,
        inferred: "not-applicable",
        rpId,
        source: "createClient",
      };
    }
    const appHost = normalized.appIdentity?.hostname;
    const trustedHost = uniqueExactHostname(normalized.security.trustedOrigins);
    let source: AthenaDevtoolsSettingSource = "createClient";
    if (appHost && rpId === appHost) {
      source = "createClient";
    } else if (trustedHost && rpId === trustedHost) {
      source = "trustedOrigins";
    } else if (rpId === "localhost") {
      source = "localhost-dev-default";
    }
    return {
      configured: false,
      effective: true,
      inferred: "set",
      rpId,
      source,
    };
  } catch {
    return {
      configured: Boolean(explicit),
      effective: Boolean(explicit),
      inferred: "not-applicable",
      rpId: explicit,
      source: explicit ? "createClient" : "unset",
    };
  }
}

function secretFact(configured: boolean): AthenaDevtoolsRedactedFact {
  return { configured, kind: "secret" };
}

function setting(input: {
  configured: boolean;
  effective: boolean;
  inferred: AthenaDevtoolsSettingProvenance["inferred"];
  path: string;
  source: AthenaDevtoolsSettingSource;
  stages: AthenaDevtoolsSettingProvenance["stages"];
}): AthenaDevtoolsSettingProvenance {
  return {
    configured: presence(input.configured),
    effective: presence(input.effective),
    inferred: input.inferred,
    path: input.path,
    source: input.source,
    stages: input.stages,
  };
}

function nonemptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function billingCredentialConfigured(
  billing: Record<string, unknown> | undefined
): boolean {
  const providers = nested(billing, "providers");
  const mollie = nested(providers, "mollie") ?? nested(billing, "mollie");
  if (!mollie) {
    return false;
  }
  return (
    nonemptyString(mollie.apiKey) ||
    nonemptyString(mollie.testKey) ||
    nonemptyString(mollie.liveKey) ||
    nonemptyString(mollie.testToken) ||
    nonemptyString(mollie.liveToken) ||
    nonemptyString(mollie.accessToken)
  );
}

function configuredDatabaseUrl(input: Record<string, unknown>): boolean {
  const database = nested(input, "database");
  const db = nested(input, "db");
  return (
    nonemptyString(input.databaseUrl) ||
    nonemptyString(database?.url) ||
    nonemptyString(database?.pgUri) ||
    nonemptyString(db?.pgUri) ||
    nonemptyString(db?.url) ||
    nonemptyString(db?.databaseUrl)
  );
}

function produceConfiguration(
  input: Record<string, unknown>
): AthenaDevtoolsSettingProvenance[] {
  const databaseUrl = configuredDatabaseUrl(input);
  const auth = nested(input, "auth");
  const authMode = typeof auth?.mode === "string" ? auth.mode.trim() : "";
  const plan = resolveRuntimePlan(input);
  const planAuthRuntime = plan.auth.runtime;
  const inferredEmbedded = !authMode && planAuthRuntime === "embedded";
  const authEffective = Boolean(authMode) || inferredEmbedded;
  const authRuntimeFact =
    planAuthRuntime === "disabled"
      ? unsetFact()
      : inferredEmbedded || authMode
        ? structural(
            inferredEmbedded ? "embedded" : authMode || planAuthRuntime
          )
        : unsetFact();
  const rp = resolvePasskeyRpInspector(input);
  const security = nested(auth, "security");
  const trustedOrigins = Array.isArray(security?.trustedOrigins)
    ? security.trustedOrigins.filter(
        (origin): origin is string => typeof origin === "string"
      )
    : [];
  const modelsPresent = input.models != null;
  const migrations = nested(input, "migrations");
  const migrationsDirectory =
    typeof migrations?.directory === "string"
      ? migrations.directory.trim()
      : "";
  const storage = nested(input, "storage");
  const storageConfigured = Boolean(storage);
  const billing = nested(input, "billing");
  const billingSecret = billingCredentialConfigured(billing);

  return [
    setting({
      configured: databaseUrl,
      effective: databaseUrl,
      inferred: "not-applicable",
      path: "database",
      source: databaseUrl ? "createClient" : "unset",
      stages: {
        inference: unsetFact(),
        normalization: databaseUrl ? structural("uri-configured") : unsetFact(),
        runtime: secretFact(databaseUrl),
        source: secretFact(databaseUrl),
      },
    }),
    setting({
      configured: Boolean(authMode),
      effective: authEffective,
      inferred: authMode
        ? "not-applicable"
        : inferredEmbedded
          ? "set"
          : "unset",
      path: "auth.mode",
      source: authMode
        ? "createClient"
        : inferredEmbedded
          ? "runtime-plan"
          : "unset",
      stages: {
        inference: inferredEmbedded ? structural("embedded") : unsetFact(),
        normalization: authMode ? structural(authMode) : unsetFact(),
        runtime: authRuntimeFact,
        source: authMode ? structural(authMode) : unsetFact(),
      },
    }),
    setting({
      configured: rp.configured,
      effective: rp.effective,
      inferred: rp.inferred,
      path: "auth.passkey.rpId",
      source: rp.source,
      stages: {
        inference: rp.inferred === "set" ? structural(rp.rpId) : unsetFact(),
        normalization: rp.rpId ? structural(rp.rpId) : unsetFact(),
        runtime: rp.rpId ? structural(rp.rpId) : unsetFact(),
        source: rp.rpId ? structural(rp.rpId) : unsetFact(),
      },
    }),
    setting({
      configured: trustedOrigins.length > 0,
      effective: trustedOrigins.length > 0,
      inferred: "not-applicable",
      path: "auth.security.trustedOrigins",
      source: trustedOrigins.length > 0 ? "trustedOrigins" : "unset",
      stages: {
        inference: unsetFact(),
        normalization: structural(trustedOrigins.length),
        runtime: structural(trustedOrigins.length),
        source: structural(trustedOrigins.length),
      },
    }),
    setting({
      configured: modelsPresent,
      effective: modelsPresent,
      inferred: "not-applicable",
      path: "models",
      source: modelsPresent ? "createClient" : "unset",
      stages: {
        inference: unsetFact(),
        normalization: structural(modelsPresent),
        runtime: structural(modelsPresent),
        source: structural(modelsPresent),
      },
    }),
    setting({
      configured: Boolean(migrationsDirectory),
      effective: Boolean(migrationsDirectory),
      inferred: migrationsDirectory ? "not-applicable" : "set",
      path: "migrations",
      source: migrationsDirectory ? "createClient" : "athena.config.ts",
      stages: {
        inference: migrationsDirectory
          ? unsetFact()
          : structural(DEFAULT_MIGRATIONS_DIRECTORY),
        normalization: structural(
          migrationsDirectory || DEFAULT_MIGRATIONS_DIRECTORY
        ),
        runtime: structural(
          migrationsDirectory || DEFAULT_MIGRATIONS_DIRECTORY
        ),
        source: migrationsDirectory
          ? structural(migrationsDirectory)
          : unsetFact(),
      },
    }),
    setting({
      configured: storageConfigured,
      effective: storageConfigured,
      inferred: "not-applicable",
      path: "storage",
      source: storageConfigured ? "createClient" : "unset",
      stages: {
        inference: unsetFact(),
        normalization: storageConfigured
          ? structural(storage?.local === true ? "local" : "configured")
          : unsetFact(),
        runtime: storageConfigured
          ? structural(storage?.local === true ? "local" : "configured")
          : unsetFact(),
        source: storageConfigured
          ? structural(storage?.local === true ? "local" : "configured")
          : unsetFact(),
      },
    }),
    setting({
      configured: Boolean(billing),
      effective: Boolean(billing),
      inferred: "not-applicable",
      path: "billing",
      source: billing ? "createClient" : "unset",
      stages: {
        inference: unsetFact(),
        normalization: billing ? structural("configured") : unsetFact(),
        runtime: secretFact(billingSecret),
        source: secretFact(billingSecret),
      },
    }),
  ];
}

declare const __ATHENA_JS_BUILD_PROVENANCE__: AthenaBuildProvenance | undefined;

function athenaJsPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8")
      ) as { name?: string };
      if (pkg.name === "@xylex-group/athena") {
        return dir;
      }
    } catch {
      // Walk toward the filesystem root.
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return dirname(fileURLToPath(import.meta.url));
}

function producePackages(): readonly AthenaDevtoolsPackageProvenance[] {
  const stamped =
    typeof __ATHENA_JS_BUILD_PROVENANCE__ === "undefined"
      ? null
      : __ATHENA_JS_BUILD_PROVENANCE__;
  const provenance =
    stamped ??
    readGitBuildProvenance({
      cwd: athenaJsPackageRoot(),
      version: PACKAGE_VERSION,
    });
  return [
    {
      buildRevision: provenance.buildRevision,
      buildTimestamp: provenance.buildTimestamp,
      dirty: provenance.dirty,
      name: "@xylex-group/athena",
      version: provenance.version,
    },
  ];
}

function producePanels(): AthenaDevtoolsPanelEntry[] {
  const stubs = new Set(["queries", "policy", "storage", "diagnostics"]);
  return ATHENA_DEVTOOLS_PANEL_IDS.map((panelId) => {
    if (panelId === "billing" || panelId === "authorization") {
      return { panelId, phase: "P0", status: "ready" };
    }
    if (stubs.has(panelId)) {
      return {
        panelId,
        phase: panelId === "storage" ? "P2" : "P1",
        status: "stub",
      };
    }
    return { panelId, phase: "P0", status: "ready" };
  });
}

type LiveCatalogTable = {
  fields: { name: string; type: string }[];
  identity: string;
};

function liveTableIdentity(row: Record<string, unknown>): string | null {
  if (nonemptyString(row.identity)) {
    return String(row.identity).trim();
  }
  if (nonemptyString(row.schemaTable)) {
    return String(row.schemaTable).trim();
  }
  const schema = nonemptyString(row.schema)
    ? String(row.schema).trim()
    : "public";
  const table = nonemptyString(row.table)
    ? String(row.table).trim()
    : nonemptyString(row.name)
      ? String(row.name).trim()
      : "";
  if (!table) {
    return null;
  }
  return table.includes(".") ? table : `${schema}.${table}`;
}

function liveColumnName(field: Record<string, unknown>): string {
  if (nonemptyString(field.name)) {
    return String(field.name).trim();
  }
  if (nonemptyString(field.logicalName)) {
    return String(field.logicalName).trim();
  }
  const identity = isRecord(field.identity) ? field.identity : undefined;
  const logical = identity
    ? isRecord(identity.logical)
      ? identity.logical
      : identity
    : undefined;
  if (isRecord(logical) && nonemptyString(logical.name)) {
    return String(logical.name).trim();
  }
  if (identity && nonemptyString(identity.logical)) {
    return String(identity.logical).trim();
  }
  return "";
}

function liveColumnType(field: Record<string, unknown>): string {
  if (nonemptyString(field.type)) {
    return String(field.type).trim();
  }
  if (isRecord(field.type)) {
    const columnType = field.type;
    if (nonemptyString(columnType.semantic)) {
      return String(columnType.semantic).trim();
    }
    if (nonemptyString(columnType.name)) {
      return String(columnType.name).trim();
    }
    const native = isRecord(columnType.native) ? columnType.native : undefined;
    if (native && nonemptyString(native.name)) {
      return String(native.name).trim();
    }
    if (nonemptyString(columnType.kind)) {
      return String(columnType.kind).trim();
    }
  }
  if (nonemptyString(field.kind)) {
    return String(field.kind).trim();
  }
  if (nonemptyString(field.semantic)) {
    return String(field.semantic).trim();
  }
  return "";
}

function liveFields(
  row: Record<string, unknown>
): { name: string; type: string }[] {
  const raw = Array.isArray(row.fields)
    ? row.fields
    : Array.isArray(row.columns)
      ? row.columns
      : [];
  const fields: { name: string; type: string }[] = [];
  for (const field of raw) {
    if (!isRecord(field)) {
      continue;
    }
    const name = liveColumnName(field);
    if (!name) {
      continue;
    }
    fields.push({ name, type: liveColumnType(field) });
  }
  return fields;
}

function parseLiveCatalog(
  live: Record<string, unknown> | undefined
): LiveCatalogTable[] | null {
  if (!live) {
    return null;
  }
  if (Array.isArray(live.tables)) {
    const tables: LiveCatalogTable[] = [];
    for (const row of live.tables) {
      if (!isRecord(row)) {
        continue;
      }
      const identity = liveTableIdentity(row);
      if (!identity) {
        continue;
      }
      tables.push({ fields: liveFields(row), identity });
    }
    return tables;
  }
  if (live.kind === "athena.schema" && Array.isArray(live.databases)) {
    const tables: LiveCatalogTable[] = [];
    for (const database of live.databases) {
      if (!(isRecord(database) && Array.isArray(database.namespaces))) {
        continue;
      }
      for (const namespace of database.namespaces) {
        if (!(isRecord(namespace) && Array.isArray(namespace.tables))) {
          continue;
        }
        for (const table of namespace.tables) {
          if (!isRecord(table)) {
            continue;
          }
          const logical = isRecord(table.identity)
            ? nested(table.identity, "logical")
            : undefined;
          const schemaName =
            typeof logical?.namespace === "string" && logical.namespace.trim()
              ? logical.namespace.trim()
              : "public";
          const tableName =
            typeof logical?.name === "string" ? logical.name.trim() : "";
          if (!tableName) {
            continue;
          }
          tables.push({
            fields: liveFields(table),
            identity: `${schemaName}.${tableName}`,
          });
        }
      }
    }
    return tables;
  }
  return null;
}

function compareLiveCatalog(
  irTables: AthenaDevtoolsModelTable[],
  live: Record<string, unknown> | undefined
): Pick<AthenaDevtoolsModelsInspector, "drift" | "liveCatalog"> {
  const catalog = parseLiveCatalog(live);
  if (!catalog) {
    return { drift: [], liveCatalog: "unavailable" };
  }
  const drift: AthenaDevtoolsModelsInspector["drift"] = [];
  const liveById = new Map(catalog.map((table) => [table.identity, table]));
  for (const ir of irTables) {
    const liveTable = liveById.get(ir.identity);
    if (!liveTable) {
      drift.push({ kind: "missing-table", object: ir.identity });
      continue;
    }
    const liveFieldMap = new Map(
      liveTable.fields.map((field) => [field.name, field])
    );
    const irFieldMap = new Map(ir.fields.map((field) => [field.name, field]));
    for (const field of ir.fields) {
      const liveField = liveFieldMap.get(field.name);
      if (!liveField) {
        drift.push({
          kind: "missing-column",
          object: `${ir.identity}.${field.name}`,
        });
        continue;
      }
      if (
        liveField.type &&
        field.type &&
        liveField.type.trim().toLowerCase() !== field.type.trim().toLowerCase()
      ) {
        drift.push({
          kind: "type-mismatch",
          object: `${ir.identity}.${field.name}`,
        });
      }
    }
    for (const field of liveTable.fields) {
      if (!irFieldMap.has(field.name)) {
        drift.push({
          kind: "orphan-column",
          object: `${ir.identity}.${field.name}`,
        });
      }
    }
  }
  return { drift, liveCatalog: "available" };
}

function produceModels(
  input: Record<string, unknown>
): AthenaDevtoolsModelsInspector {
  const models = input.models;
  const live = isRecord(input.liveCatalog) ? input.liveCatalog : undefined;
  if (models == null) {
    const compared = compareLiveCatalog([], live);
    return {
      drift: compared.drift,
      liveCatalog: compared.liveCatalog,
      tables: [],
    };
  }
  const resolved = collectModelsFromSqlInput(
    models as Parameters<typeof collectModelsFromSqlInput>[0]
  );
  void schemaIrFromModels(models);
  const tables: AthenaDevtoolsModelTable[] = resolved.map((table) => {
    const schemaName = table.schemaName?.trim() || "public";
    const tableName = table.tableName;
    const identity = `${schemaName}.${tableName}`;
    const relations: AthenaDevtoolsModelRelation[] = Object.entries(
      table.model.meta.relations ?? {}
    ).map(([name, relation]) => ({
      kind: relation.kind,
      name,
      targetModel: relation.targetModel,
    }));
    return {
      fields: table.columns.map((column) => ({
        name: column.logicalName,
        type: column.kind,
      })),
      identity,
      name: identity,
      primaryKey: [...table.primaryKey],
      relations,
      schema: schemaName,
      schemaTable: identity,
      table: tableName,
    };
  });
  const compared = compareLiveCatalog(tables, live);
  return {
    drift: compared.drift,
    liveCatalog: compared.liveCatalog,
    tables,
  };
}

function classifyGeneratedBy(
  filename: string,
  directory: string
): AthenaDevtoolsMigrationGeneratedBy {
  const blob = `${directory}/${filename}`.toLowerCase();
  if (blob.includes("/auth/") || blob.includes("managed/auth")) {
    return "Auth";
  }
  if (blob.includes("billing")) {
    return "Billing";
  }
  if (blob.includes("storage")) {
    return "Storage";
  }
  return "Manual";
}

function resolveProjectPath(directory: string, cwd: string): string {
  return isAbsolute(directory) ? directory : resolve(cwd, directory);
}

function produceMigrations(
  input: Record<string, unknown>,
  cwd: string
): AthenaDevtoolsMigrationsInspector {
  const migrations = nested(input, "migrations");
  const configured =
    typeof migrations?.directory === "string" && migrations.directory.trim()
      ? migrations.directory.trim()
      : DEFAULT_MIGRATIONS_DIRECTORY;
  const directory = resolveProjectPath(configured, cwd);
  const files: AthenaDevtoolsMigrationsInspector["files"] = [];
  if (existsSync(directory)) {
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile()) {
          continue;
        }
        const parsed = parseMigrationFilename(entry.name);
        if (!parsed) {
          continue;
        }
        files.push({
          filename: entry.name,
          generatedBy: classifyGeneratedBy(entry.name, directory),
          name: parsed.name,
          version: parsed.version,
        });
      }
    } catch {
      // best-effort local filesystem; inspector stays structural
    }
  }
  const generatedBy = [...new Set(files.map((file) => file.generatedBy))];
  const ledger = parseAppliedMigrationLedger(input);
  let applied: AthenaDevtoolsMigrationsInspector["applied"] = [];
  let pending: AthenaDevtoolsMigrationsInspector["pending"] = [];
  let latestApplied: string | number | null = null;
  let schemaVersion = 0;
  if (ledger) {
    const appliedVersions = new Set(
      ledger
        .map((row) => row.version)
        .filter((version): version is number => typeof version === "number")
    );
    applied = ledger;
    pending = files.filter(
      (file) =>
        typeof file.version !== "number" || !appliedVersions.has(file.version)
    );
    const maxApplied = Math.max(0, ...appliedVersions);
    latestApplied = appliedVersions.size > 0 ? maxApplied : null;
    schemaVersion = typeof latestApplied === "number" ? latestApplied : 0;
  }
  return {
    applied,
    files,
    generatedBy,
    latestApplied,
    localFileCount: files.length,
    pending,
    schemaVersion,
    subsystems: {
      auth: { generatedBy: "Auth", status: "unknown" },
      billing: { generatedBy: "Billing", status: "unknown" },
      storage: { generatedBy: "Storage", status: "unknown" },
    },
    version: schemaVersion,
  };
}

function parseAppliedMigrationLedger(
  input: Record<string, unknown>
): AthenaDevtoolsMigrationsInspector["applied"] | null {
  const raw = Array.isArray(input.appliedMigrations)
    ? input.appliedMigrations
    : Array.isArray(nested(input, "migrations")?.ledger)
      ? nested(input, "migrations")?.ledger
      : undefined;
  if (!Array.isArray(raw)) {
    return null;
  }
  const rows: AthenaDevtoolsMigrationsInspector["applied"] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const generatedBy = parseGeneratedBy(entry.generatedBy);
    rows.push({
      filename: typeof entry.filename === "string" ? entry.filename : undefined,
      generatedBy: generatedBy ?? "Manual",
      name: typeof entry.name === "string" ? entry.name : undefined,
      version: typeof entry.version === "number" ? entry.version : undefined,
    });
  }
  return rows;
}

function parseGeneratedBy(
  value: unknown
): AthenaDevtoolsMigrationGeneratedBy | undefined {
  if (
    value === "Manual" ||
    value === "Auth" ||
    value === "Billing" ||
    value === "Storage"
  ) {
    return value;
  }
}

export type ProduceAthenaDevtoolsSnapshotOptions = {
  internals?: AthenaClientInternals;
  principalRights?: readonly string[];
  sessionAuthenticated?: boolean;
  subject?: {
    organizationId?: string | null;
    sessionId?: string | null;
    userId?: string | null;
  } | null;
};

async function produceSnapshotFromInput(
  input: Record<string, unknown>,
  options?: ProduceAthenaDevtoolsSnapshotOptions
): Promise<AthenaDevtoolsSnapshot> {
  const cwd =
    typeof input.cwd === "string" && input.cwd.trim()
      ? input.cwd.trim()
      : process.cwd();
  const billing = sanitizeAthenaDevtoolsBillingInspector(
    produceAthenaDevtoolsBillingInspector({
      config: input,
      internals: options?.internals,
    })
  );
  const packages = producePackages();
  const capabilities = options?.internals?.capabilitiesIr
    ? projectAthenaCapabilitiesToDevtools(options.internals.capabilitiesIr)
    : projectAthenaCapabilitiesToDevtools(resolveAthenaCapabilities([]));
  return {
    authorization: await produceAthenaDevtoolsAuthorizationInspector({
      internals: options?.internals,
      principalRights: (options?.principalRights ?? []).flatMap((key) => {
        const parsed = tryParseAthenaRightKey(key);
        return parsed ? [parsed] : [];
      }),
      sessionAuthenticated: options?.sessionAuthenticated,
      subject: options?.subject,
    }),
    billing,
    capabilities,
    configuration: {
      settings: produceConfiguration(input),
    },
    migrations: produceMigrations(input, cwd),
    models: produceModels(input),
    overview: {
      packages,
      protocolVersion: ATHENA_DEVTOOLS_PROTOCOL_VERSION,
    },
    packages,
    panels: producePanels(),
    protocolVersion: ATHENA_DEVTOOLS_PROTOCOL_VERSION,
  };
}

export async function produceAthenaDevtoolsSnapshot(
  input: Record<string, unknown> = {},
  options?: ProduceAthenaDevtoolsSnapshotOptions
): Promise<AthenaDevtoolsSnapshot> {
  return produceSnapshotFromInput(input, options);
}

export function produceAthenaDevtoolsSnapshotSync(
  input: Record<string, unknown> = {},
  options?: ProduceAthenaDevtoolsSnapshotOptions
): AthenaDevtoolsSnapshot {
  const cwd =
    typeof input.cwd === "string" && input.cwd.trim()
      ? input.cwd.trim()
      : process.cwd();
  const billing = sanitizeAthenaDevtoolsBillingInspector(
    produceAthenaDevtoolsBillingInspector({
      config: input,
      internals: options?.internals,
    })
  );
  const packages = producePackages();
  const capabilities = options?.internals?.capabilitiesIr
    ? projectAthenaCapabilitiesToDevtools(options.internals.capabilitiesIr)
    : projectAthenaCapabilitiesToDevtools(resolveAthenaCapabilities([]));
  return {
    authorization: produceAthenaDevtoolsAuthorizationInspectorSync(),
    billing,
    capabilities,
    configuration: {
      settings: produceConfiguration(input),
    },
    migrations: produceMigrations(input, cwd),
    models: produceModels(input),
    overview: {
      packages,
      protocolVersion: ATHENA_DEVTOOLS_PROTOCOL_VERSION,
    },
    packages,
    panels: producePanels(),
    protocolVersion: ATHENA_DEVTOOLS_PROTOCOL_VERSION,
  };
}

export type { AthenaDevtoolsLiveAuthorities } from "./live-authorities.ts";
export {
  extractAthenaDevtoolsDatabaseUrl,
  loadAthenaDevtoolsPostgresAuthorities,
  resolveAthenaDevtoolsProduceInput,
} from "./live-authorities.ts";
