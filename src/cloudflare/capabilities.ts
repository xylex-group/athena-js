import {
  D1_BATCH_TRANSACTION_CAPABILITIES,
  GATEWAY_POSTGRES_TRANSACTION_CAPABILITIES,
  POSTGRES_DIRECT_TRANSACTION_CAPABILITIES,
} from "../db/transaction/types.ts";
import type { AthenaClientCapabilities } from "./types.ts";

export function createGatewayCapabilities(options?: {
  engine?: AthenaClientCapabilities["db"]["engine"];
  authRemote?: boolean;
  /** When false/undefined, storage flags match an unconfigured storage namespace. */
  storageConfigured?: boolean;
  storageCatalogs?: boolean;
  storageBackups?: boolean;
}): AthenaClientCapabilities {
  const storageConfigured = options?.storageConfigured ?? true;
  return {
    auth: {
      remote: options?.authRemote ?? true,
    },
    db: {
      engine: options?.engine ?? "postgresql",
      layers: {
        findManyAst: true,
        flatCrud: true,
        query: true,
        relations: true,
        rpc: true,
      },
      local: false,
      transactions: GATEWAY_POSTGRES_TRANSACTION_CAPABILITIES,
    },
    mode: "gateway",
    storage: {
      backups: storageConfigured ? (options?.storageBackups ?? true) : false,
      catalogs: storageConfigured ? (options?.storageCatalogs ?? true) : false,
      local: false,
      objects: storageConfigured,
    },
  };
}

export function createCloudflareEdgeCapabilities(options: {
  hasR2: boolean;
  /** Hybrid remote Athena root / storage URL enables HTTP storage ports. */
  hasRemoteStorage?: boolean;
  authRemote: boolean;
  findManyAst?: boolean;
  flatCrud?: boolean;
  query?: boolean;
  relations?: boolean;
  rpc?: boolean;
}): AthenaClientCapabilities {
  const hasRemoteStorage = Boolean(options.hasRemoteStorage);
  const hasObjects = options.hasR2 || hasRemoteStorage;
  return {
    auth: {
      remote: options.authRemote,
    },
    db: {
      engine: "cloudflare-d1",
      layers: {
        findManyAst: options.findManyAst ?? true,
        flatCrud: options.flatCrud ?? true,
        query: options.query ?? true,
        relations: options.relations ?? true,
        rpc: options.rpc ?? false,
      },
      local: true,
      transactions: D1_BATCH_TRANSACTION_CAPABILITIES,
    },
    mode: "cloudflare-edge",
    storage: {
      // Catalogs/backups are HTTP product ports — only when remote storage is wired.
      backups: hasRemoteStorage,
      catalogs: hasRemoteStorage,
      // Local objects only when an R2 binding is present.
      local: options.hasR2,
      // Remote hybrid root can still expose storage.objects via the HTTP API.
      objects: hasObjects,
    },
  };
}

/**
 * Capabilities for Node direct PostgreSQL (`db.pgUri`).
 * Uses gateway mode string with local+engine discrimination (AD-02).
 */
export function createPostgresDirectCapabilities(options?: {
  authRemote?: boolean;
  storageConfigured?: boolean;
  findManyAst?: boolean;
  flatCrud?: boolean;
  query?: boolean;
  relations?: boolean;
  rpc?: boolean;
}): AthenaClientCapabilities {
  const storageConfigured = options?.storageConfigured ?? false;
  return {
    auth: {
      remote: options?.authRemote ?? false,
    },
    db: {
      engine: "postgresql",
      layers: {
        findManyAst: options?.findManyAst ?? true,
        flatCrud: options?.flatCrud ?? true,
        query: options?.query ?? true,
        relations: options?.relations ?? true,
        rpc: options?.rpc ?? true,
      },
      local: true,
      transactions: POSTGRES_DIRECT_TRANSACTION_CAPABILITIES,
    },
    mode: "gateway",
    storage: {
      backups: storageConfigured,
      catalogs: storageConfigured,
      local: false,
      objects: storageConfigured,
    },
  };
}
