/**
 * Fail closed on conflicting local/remote runtime intent.
 */

import { AthenaBillingProviderError } from "../../billing/errors.ts";
import { AthenaConfigurationError } from "../../config/errors.ts";
import type { AthenaRuntimePlan } from "./types.ts";

export function validateRuntimePlan<TPlan extends AthenaRuntimePlan>(
  plan: TPlan,
): TPlan {
  if (!plan || typeof plan !== "object") {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      "AthenaRuntimePlan is missing; construction cannot continue.",
    );
  }
  const next = plan;
  if (next.billing == null || typeof next.billing.kind !== "string") {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      "AthenaRuntimePlan.billing is missing; construction cannot continue.",
    );
  }
  if (next.billing?.kind === "remote" && next.billing.configuredProviders) {
    throw new AthenaBillingProviderError({
      code: "ATHENA_BILLING_CONFIG_CONFLICT",
      message:
        'billing.mode="remote" cannot be combined with billing.providers. Provider bindings belong to the runtime executing Billing locally.',
    });
  }
  const storage = next.storage;
  if (
    storage?.wantsLocal &&
    (storage.hasUrl || storage.hasR2 || storage.wantsS3)
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      'storage.provider "local" cannot be combined with storage.url, storage.r2, or storage.provider "s3". Embedded ObjectStore and managed HTTP/R2/S3 are separate modes.',
      "storage",
    );
  }
  if (
    storage?.wantsS3 &&
    (storage.hasUrl || storage.hasR2 || storage.wantsLocal || storage.root)
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      'storage.provider "s3" cannot be combined with storage.url, storage.r2, or a local filesystem root. Direct S3 and other storage modes are exclusive.',
      "storage",
    );
  }
  const localDbAuthorityCount = [
    next.db?.hasD1,
    next.db?.hasSqlite,
    Boolean(next.db?.pgUri),
    next.db?.hasPool,
  ].filter(Boolean).length;
  if (localDbAuthorityCount > 1) {
    throw new AthenaConfigurationError(
      "ATHENA_NO_SERVICE_CONFIGURED",
      next.db.hasSqlite
        ? "Athena cannot combine SQLite Local with D1 or PostgreSQL direct execution. Configure exactly one local database backend."
        : "Athena cannot use db.d1 and db.pgUri together. Configure exactly one local DB binding, or set mode/prefer to select a single execution backend.",
      "db",
    );
  }
  return next;
}
