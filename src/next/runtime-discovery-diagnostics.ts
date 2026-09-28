import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { normalizeAthenaAuthConfig } from "../auth/config.ts";
import { createPasskeyRelyingPartySnapshot } from "../auth/passkey/server/relying-party.ts";
import { normalizeAthenaBillingWebhooks } from "../billing/ingestion/config.ts";
import {
  BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH,
  BILLING_MOLLIE_EVENTS_WEBHOOK_PATH,
} from "../billing/ingestion/urls.ts";
import type { AthenaRuntimeDiscoveryDiagnostics } from "../gateway/discovery-types.ts";
import { findGeneratorConfigPath } from "../generator/config.ts";
import { DEFAULT_MIGRATIONS_DIRECTORY } from "../migrations/constants.ts";
import type { AthenaClientInternals } from "../runtime/client-internals.ts";
import {
  resolveDatabaseUri,
  toAthenaRuntimeDiagnostics,
} from "../runtime/resolve.ts";
import type { AthenaBillingConfig } from "../v3-client-core.ts";

const MIGRATION_SQL_RE = /^\d+_.+\.sql$/i;
const MAX_AUTH_WARNINGS = 8;

function hasAttachedModels(models: unknown): boolean {
  if (models == null) {
    return false;
  }
  if (Array.isArray(models)) {
    return models.length > 0;
  }
  if (typeof models === "object") {
    return Object.keys(models).length > 0;
  }
  return true;
}

function countLocalMigrationFiles(cwd: string, directory: string): number {
  const absolute = join(cwd, directory);
  if (!existsSync(absolute)) {
    return 0;
  }
  try {
    return readdirSync(absolute).filter((name) => MIGRATION_SQL_RE.test(name))
      .length;
  } catch {
    return 0;
  }
}

export function buildAthenaRuntimeDiscoveryDiagnostics(
  internals: AthenaClientInternals
): AthenaRuntimeDiscoveryDiagnostics {
  const snapshot = toAthenaRuntimeDiagnostics(internals.plan);
  const auth = normalizeAthenaAuthConfig(internals.config.auth, {
    app: internals.config.app,
    env: internals.config.env,
  });
  const passkeyEnvironment =
    process.env.NODE_ENV === "production" ? "production" : "development";
  let rpId = auth.passkey.rpId;
  let rpName = auth.passkey.rpName;
  let origins = [...auth.passkey.origins];
  let relatedOrigins = [...auth.passkey.relatedOrigins];
  if (passkeyEnvironment === "development" || auth.passkeyConfigured) {
    try {
      const relyingParty = createPasskeyRelyingPartySnapshot({
        appIdentity: auth.appIdentity,
        environment: passkeyEnvironment,
        passkey: auth.passkey,
        required: auth.passkey.enabled,
        trustedOrigins: auth.security.trustedOrigins,
      });
      rpId = relyingParty.id;
      rpName = relyingParty.name;
      origins = [...relyingParty.origins];
      relatedOrigins = [...relyingParty.relatedOrigins];
    } catch {
      // Keep normalized config fields when the snapshot fails closed.
    }
  }
  const cwd = process.cwd();
  const generatorPath = findGeneratorConfigPath(cwd);
  const migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY;
  const migrationsDirectoryFound = existsSync(join(cwd, migrationsDirectory));
  const storageBucket = internals.config.storage?.bucket?.trim();
  const billingIngress = billingIngressDiagnostics(internals.config.billing);
  return {
    auth: snapshot.auth,
    ...(billingIngress ? { billingIngress } : {}),
    config: {
      authWarnings: auth.warnings.slice(0, MAX_AUTH_WARNINGS),
      autoMigrate: auth.autoMigrate,
      databaseConfigured: Boolean(resolveDatabaseUri(internals.config)),
      generatorConfigFile: generatorPath ? basename(generatorPath) : null,
      localMigrationFiles: countLocalMigrationFiles(cwd, migrationsDirectory),
      migrationsDirectory,
      migrationsDirectoryFound,
      modelsAttached: hasAttachedModels(internals.config.models),
    },
    database: snapshot.database,
    passkey: {
      authenticatorAttachment:
        auth.passkey.registration.authenticatorAttachment,
      configured: auth.passkeyConfigured,
      enabled: auth.passkey.enabled,
      onboardingEnabled: auth.passkey.onboardingEnabled,
      origins,
      relatedOrigins,
      residentKey: auth.passkey.registration.residentKey,
      rpId,
      rpName,
      timeoutMs: auth.passkey.challengeTtlSeconds * 1000,
      userVerification: auth.passkey.authentication.userVerification,
    },
    runtime: snapshot.runtime,
    storage: snapshot.storage,
    ...(storageBucket ? { storageBucket } : {}),
  };
}

function billingIngressDiagnostics(
  billing: AthenaBillingConfig | undefined
): AthenaRuntimeDiscoveryDiagnostics["billingIngress"] {
  const webhooks = normalizeAthenaBillingWebhooks(billing?.ingestion?.webhooks);
  if (!webhooks.enabled) {
    return;
  }
  return {
    enabled: true,
    endpoints: {
      classic: BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH,
      nextGen: BILLING_MOLLIE_EVENTS_WEBHOOK_PATH,
    },
    execution: webhooks.execution === "external" ? "remote" : "embedded",
    verification: {
      classic: "authoritative_refetch",
      nextGen: "signature_and_refetch",
    },
  };
}
