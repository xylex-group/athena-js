/**
 * Resolve an internal AthenaRuntimePlan from createClient config.
 */

import {
  detectAthenaRuntimeEnvironment,
  inferEmbeddedAuthMode,
  type ResolveAthenaRuntimeOptions,
  type ResolveConfigInput,
  resolveAthenaRuntime,
  resolveDatabaseUri,
} from "../resolve.ts";
import { AthenaBillingProviderError } from "../../billing/errors.ts";
import {
  ATHENA_ENV_DB_URL_KEYS,
  ATHENA_ENV_URL_KEYS,
} from "../../env/index.ts";
import type { AthenaRuntimePlan } from "./types.ts";
import type { AthenaRuntimePlanBilling } from "./types.ts";

function resolveUnifiedRemoteRoot(input: ResolveConfigInput): string | undefined {
  return (
    trimOptional(input.url) ??
    ATHENA_ENV_URL_KEYS.map((key) => trimOptional(input.env?.[key])).find(
      (value): value is string => value !== undefined,
    )
  );
}

function trimOptional(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasConfiguredBillingProviders(
  providers: Record<string, unknown> | null | undefined
): boolean {
  return (
    providers != null &&
    Object.values(providers).some((provider) => provider !== null && provider !== undefined)
  );
}

function resolveBillingPlan(
  input: ResolveConfigInput,
  environment: ReturnType<typeof detectAthenaRuntimeEnvironment>,
  trustedNode: boolean
): AthenaRuntimePlanBilling {
  const billing = input.billing;
  const providers = hasConfiguredBillingProviders(billing?.providers);
  const mode = billing?.mode?.trim().toLowerCase();
  const explicitEndpoint =
    trimOptional(billing?.url) ?? trimOptional(billing?.endpoint);
  const databaseEndpoint =
    trimOptional(input.db?.url) ??
    ATHENA_ENV_DB_URL_KEYS.map((key) => trimOptional(input.env?.[key])).find(
      (value): value is string => value !== undefined
    );
  const unifiedRoot = trimOptional(resolveUnifiedRemoteRoot(input));
  const resolvedDatabaseEndpoint =
    databaseEndpoint ??
    (unifiedRoot ? `${unifiedRoot.replace(/\/+$/, "")}/db` : undefined);

  if (mode === "remote") {
    if (!explicitEndpoint && !resolvedDatabaseEndpoint) {
      return {
        configuredProviders: providers,
        kind: "unavailable",
        reason: "transport-unavailable",
      };
    }
    return {
      endpoint: explicitEndpoint ?? resolvedDatabaseEndpoint,
      configuredProviders: providers,
      kind: "remote",
      source: explicitEndpoint
        ? "explicit-url"
        : databaseEndpoint
          ? "db-url"
          : "unified-root",
    };
  }

  if (providers || mode === "local") {
    if (!trustedNode || environment === "browser" || environment === "react-native") {
      throw new AthenaBillingProviderError({
        code: "ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED",
        message:
          "Local Billing requires a trusted server runtime and cannot run in the browser or React Native.",
      });
    }
    return {
      configuredProviders: providers,
      kind: "local",
      modePreference: mode === "local" ? "local" : "auto",
      source: "configured-provider",
    };
  }

  if (mode === "remote" || explicitEndpoint || resolvedDatabaseEndpoint) {
    if (mode === "remote" && !explicitEndpoint && !unifiedRoot) {
      return {
        configuredProviders: providers,
        kind: "unavailable",
        reason: "transport-unavailable",
      };
    }
    return {
      endpoint: explicitEndpoint ?? resolvedDatabaseEndpoint,
      configuredProviders: providers,
      kind: "remote",
      source: explicitEndpoint
        ? "explicit-url"
        : databaseEndpoint
          ? "db-url"
        : environment === "browser" || environment === "react-native"
          ? "same-origin"
          : "unified-root",
    };
  }

  return {
    configuredProviders: providers,
    kind: "unavailable",
    reason: "not-configured",
  };
}

export function resolveRuntimePlan(
  config: unknown,
  options: ResolveAthenaRuntimeOptions = {}
): AthenaRuntimePlan {
  const input = (config ?? {}) as ResolveConfigInput;
  const environment = options.environment ?? detectAthenaRuntimeEnvironment();
  const trustedNode = options.trustedNode ?? environment === "node";
  const inferred = trustedNode ? inferEmbeddedAuthMode(input) : input;
  const snapshot = resolveAthenaRuntime(inferred, {
    environment,
    trustedNode,
  });
  const storage = inferred.storage;
  const root = trimOptional(storage?.root);
  const prefix = trimOptional(storage?.prefix);
  const bucket = trimOptional(storage?.bucket);
  const billing = resolveBillingPlan(inferred, environment, trustedNode);
  return {
    auth: { runtime: snapshot.auth.runtime },
    billing,
    chat: { transport: snapshot.chat.transport },
    db: {
      hasD1: inferred.db?.d1 !== undefined && inferred.db?.d1 !== null,
      hasSqlite:
        inferred.db?.sqlite !== undefined && inferred.db?.sqlite !== null,
      engine:
        snapshot.db.transport === "sqlite"
          ? "sqlite"
          : snapshot.db.transport === "postgres"
            ? "postgres"
            : undefined,
      hasPool: inferred.db?.pool !== undefined && inferred.db?.pool !== null,
      hasRemoteAuth: false,
      hasRemoteDbGateway: false,
      hasRemoteServices: false,
      hasRemoteStorage: false,
      modeIsGateway: snapshot.db.transport === "gateway",
      models: undefined,
      pgUri: resolveDatabaseUri(inferred),
      ownership:
        snapshot.db.transport === "sqlite"
          ? inferred.db?.sqlite &&
            typeof inferred.db.sqlite === "object" &&
            (inferred.db.sqlite as { ownership?: unknown }).ownership ===
              "owned"
            ? "owned"
            : "borrowed"
          : snapshot.db.transport === "postgres"
            ? "owned"
            : "none",
      profile:
        snapshot.db.transport === "sqlite"
          ? "sqlite-local"
          : snapshot.db.transport === "d1"
            ? "cloudflare-d1"
            : snapshot.db.transport === "postgres"
              ? "postgres"
              : snapshot.db.transport === "gateway"
                ? "gateway"
                : undefined,
      source:
        snapshot.db.transport === "sqlite"
          ? "local-executor"
          : resolveDatabaseUri(inferred) !== undefined
          ? "uri"
          : inferred.db?.pool !== undefined && inferred.db?.pool !== null
            ? "pool"
            : "none",
      transport: snapshot.db.transport,
    },
    environment,
    storage: {
      ...(bucket ? { bucket } : {}),
      hasR2: storage?.r2 !== undefined && storage?.r2 !== null,
      hasUrl: Boolean(trimOptional(storage?.url)),
      ...(prefix ? { prefix } : {}),
      ...(root ? { root } : {}),
      transport: snapshot.storage.transport,
      wantsLocal: storage?.provider === "local",
      wantsS3: storage?.provider === "s3",
    },
    trustedNode,
  };
}
