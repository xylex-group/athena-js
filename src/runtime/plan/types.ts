/**
 * Internal AthenaRuntimePlan. Not a public config surface.
 */

import type {
  AthenaAuthRuntime,
  AthenaDbTransport,
  AthenaRuntimeEnvironment,
  AthenaStorageTransport,
  ResolvedAthenaRuntime,
} from "../resolve.ts";
import type {
  AthenaAuthConfig,
  AthenaChatConfig,
  AthenaRequestContext,
  AthenaRequestContextProvider,
} from "../../client/contracts.ts";
import type { AthenaClientCapabilities } from "../../cloudflare/types.ts";
import type { AthenaBillingConfig } from "../../billing/create-client-config.ts";
import type { AthenaClientModelsInput } from "../../schema/types.ts";

export interface AthenaRuntimePlanAuth {
  runtime: AthenaAuthRuntime;
  config?: false | AthenaAuthConfig | null;
}

export interface AthenaRuntimePlanDb {
  capabilities?: AthenaClientCapabilities;
  engine?: "postgres" | "sqlite" | "unknown";
  findManyAst?: boolean;
  hasD1: boolean;
  hasSqlite?: boolean;
  hasPool: boolean;
  hasRemoteAuth: boolean;
  hasRemoteDbGateway: boolean;
  hasRemoteServices: boolean;
  hasRemoteStorage: boolean;
  modeIsGateway: boolean;
  models?: AthenaClientModelsInput;
  pgUri?: string;
  remoteRoot?: string;
  requestedKey?: string;
  ownership?: "owned" | "borrowed" | "none";
  profile?: "postgres" | "cloudflare-d1" | "sqlite-local" | "gateway";
  source: "none" | "pool" | "uri" | "local-executor";
  transport: AthenaDbTransport;
}

export interface AthenaRuntimePlanStorage {
  bucket?: string;
  hasR2: boolean;
  hasUrl: boolean;
  prefix?: string;
  root?: string;
  transport: AthenaStorageTransport;
  wantsLocal: boolean;
  wantsS3: boolean;
}

export type AthenaRuntimePlanBilling = {
  configuredProviders: boolean;
  apiKey?: string;
  applicationId?: string;
  appUrl?: string;
  catalog?: AthenaBillingConfig["catalog"];
  client?: string | null;
  providers?: AthenaBillingConfig["providers"];
  customerImport?: AthenaBillingConfig["import"];
  headers?: Record<string, string>;
  ingestion?: AthenaBillingConfig["ingestion"];
  mode?: AthenaBillingConfig["mode"];
  observability?: AthenaBillingConfig["observability"];
  selfEnrollment?: AthenaBillingConfig["selfEnrollment"];
  testMode?: boolean;
} & (
  | {
      kind: "local";
      modePreference: "auto" | "local";
      source: "configured-provider";
    }
  | {
      kind: "remote";
      endpoint?: string;
      source:
        | "db-url"
        | "explicit-url"
        | "same-origin"
        | "unified-root";
    }
  | {
      kind: "unavailable";
      reason:
        | "environment-unsupported"
        | "not-configured"
        | "transport-unavailable";
    }
);

/**
 * Construction intent + resolved transports + environment.
 * Provider SDK handles are produced by materializers, not stored as config.
 */
export interface AthenaRuntimePlan {
  auth: AthenaRuntimePlanAuth;
  billing: AthenaRuntimePlanBilling;
  chat: {
    auth?: false | AthenaAuthConfig | null;
    callOptions?: AthenaChatConfig;
    clusterUrl?: string;
    context?: AthenaRequestContext | AthenaRequestContextProvider;
    databaseUrl?: string;
    transport: ResolvedAthenaRuntime["chat"]["transport"];
  };
  db: AthenaRuntimePlanDb;
  environment: AthenaRuntimeEnvironment;
  storage: AthenaRuntimePlanStorage;
  trustedNode: boolean;
}

export function toResolvedAthenaRuntime(
  plan: AthenaRuntimePlan
): ResolvedAthenaRuntime {
  return {
    auth: { runtime: plan.auth.runtime },
    chat: { transport: plan.chat.transport },
    db: { transport: plan.db.transport },
    runtime: { environment: plan.environment },
    storage: { transport: plan.storage.transport },
  };
}
