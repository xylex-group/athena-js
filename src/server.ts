/**
 * Node/server runtime ownership.
 *
 * Resolves directly to the Node-capable client. Never use browser
 * conditional exports — import this entry for `databaseUrl` roots.
 *
 *   import { createClient } from "@xylex-group/athena/server"
 *
 * Browser / Client Components must use `@xylex-group/athena/next/client`
 * or `@xylex-group/athena/browser` instead.
 */

import "server-only";

export type {
  AthenaRequestClient,
  AthenaRequestClientBrand,
  AthenaRootClient,
  AthenaRootClientBrand,
} from "./client-brands.ts";
export {
  consoleEmailProvider,
  consoleEmailProvider as createConsoleEmailProvider,
} from "./email/providers/console.ts";
export { athenaNotificationCatalogDemo } from "./notifications/catalog.ts";
export type { AthenaRuntimeDiagnostics } from "./runtime/client-internals.ts";
export {
  AthenaRuntimeOwnershipError,
  getAthenaRuntimeDiagnostics,
} from "./runtime/client-internals.ts";
export {
  createAthenaCanonicalInspectionPort,
  hasAthenaCanonicalInspection,
} from "./devtools/server-ir.ts";
export type {
  AthenaCanonicalArtifactCategory,
  AthenaCanonicalArtifactDescriptor,
  AthenaCanonicalArtifactId,
  AthenaCanonicalArtifactSnapshot,
  AthenaCanonicalInspectionPort,
} from "./devtools/server-ir.ts";
export { defineAthenaRights } from "./runtime/data/rights-resolution.ts";
export type {
  AthenaClient,
  AthenaClientConfig,
  AthenaClientConfigWithR2,
  AthenaClientRuntimeConfig,
  AthenaClientServicesConfig,
  AthenaClientWithR2Storage,
  AthenaRequestContext,
} from "./v3-client.ts";
export {
  AthenaConfigurationError,
  createClient,
} from "./v3-client.ts";
