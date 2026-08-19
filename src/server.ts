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

export {
  AthenaConfigurationError,
  createClient,
} from "./v3-client.ts";

export type {
  AthenaClient,
  AthenaClientConfig,
  AthenaClientConfigWithR2,
  AthenaClientWithR2Storage,
  AthenaRequestContext,
} from "./v3-client.ts";

export type {
  AthenaRequestClient,
  AthenaRequestClientBrand,
  AthenaRootClient,
  AthenaRootClientBrand,
} from "./client-brands.ts";

export {
  AthenaRuntimeOwnershipError,
  getAthenaRuntimeDiagnostics,
} from "./runtime/client-internals.ts";
export type { AthenaRuntimeDiagnostics } from "./runtime/client-internals.ts";
