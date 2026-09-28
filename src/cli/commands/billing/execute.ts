import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  importPolicyFromBillingConfig,
  runBillingCustomerImportWithPostgres,
} from "../../../billing/import/assemble.ts";
import {
  createBillingImportDatabaseFromManager,
  createBillingSqlExecutorFromManager,
  listActiveBillingImportConnections,
} from "../../../billing/import/postgres.ts";
import type { BillingImportRunReport } from "../../../billing/import/types.ts";
import { resolveBillingWebhookApplicationId } from "../../../billing/ingestion/application-id.ts";
import {
  normalizeAthenaBillingIngestion,
  signingSecretsFromWebhookConfig,
} from "../../../billing/ingestion/config.ts";
import {
  createPostgresBillingWebhookSecretStore,
  rememberConnectionSigningSecretSet,
  resolveBillingWebhookMasterKey,
  signingSecretsForConnection,
} from "../../../billing/ingestion/secrets/index.ts";
import {
  attachEventIngressRuntime,
  type EventIngressAttachHost,
} from "../../../billing/runtime/local/ingress/attach.ts";
import {
  classifyStuckBillingIngress,
  replayBillingIngressBatch,
} from "../../../billing/runtime/local/ingress/replay.ts";
import { createBillingProviderRegistry } from "../../../billing/runtime/local/providers/create-registry.ts";
import {
  applyGeneratorProjectEnv,
  findGeneratorConfigPath,
  loadGeneratorConfig,
} from "../../../generator/config.ts";
import type { ResolvedGeneratorDatabaseAuthority } from "../../../generator/database-authority.ts";
import { resolveGeneratorDatabaseAuthority } from "../../../generator/database-authority.ts";
import { ATHENA_MIGRATE_COMMAND } from "../../../migrations/commands.ts";
import {
  type AthenaPostgresRuntime,
  createAthenaPostgresRuntime,
} from "../../../postgres/owned-runtime.ts";
import { eventIngressDatabaseFromManager } from "../../../runtime/ingress/postgres.ts";
import type { EventIngressRuntime } from "../../../runtime/ingress/runtime.ts";
import { createSqlEventIngressPersistence } from "../../../runtime/ingress/sql.ts";
import type { AthenaBillingConfig } from "../../../v3-client-core.ts";
import { AthenaCliError } from "../../errors.ts";
import { CliExitCode } from "../../exit-code.ts";
import type {
  BillingIngressReplayCommand,
  BillingReconcileSubjectsCommand,
  BillingWebhooksCommand,
} from "../../types.ts";

export interface ExecuteBillingReconcileSubjectsInput {
  cwd: string;
  parsed: BillingReconcileSubjectsCommand;
}

function readOptionalBillingFromUnknown(
  value: unknown
): AthenaBillingConfig | undefined {
  if (value == null || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.billing != null && typeof record.billing === "object") {
    return record.billing as AthenaBillingConfig;
  }
  if (record.default != null) {
    return readOptionalBillingFromUnknown(record.default);
  }
  if (record.config != null) {
    return readOptionalBillingFromUnknown(record.config);
  }
}

async function loadProjectBillingConfig(input: {
  configPath?: string;
  cwd: string;
}): Promise<AthenaBillingConfig | undefined> {
  const resolved = input.configPath
    ? resolve(input.cwd, input.configPath)
    : findGeneratorConfigPath(input.cwd);
  if (!resolved) {
    return;
  }
  const module = await import(
    `${pathToFileURL(resolved).href}?cacheBust=${Date.now()}`
  );
  return readOptionalBillingFromUnknown(module);
}

async function resolveBillingDatabaseAuthority(input: {
  configPath?: string;
  cwd: string;
}): Promise<{
  authority: ResolvedGeneratorDatabaseAuthority;
  restoreEnv: () => void;
}> {
  const restoreEnv = applyGeneratorProjectEnv(input.cwd);
  try {
    const loaded = await loadGeneratorConfig({
      applyProjectEnv: false,
      configPath: input.configPath,
      cwd: input.cwd,
      restoreProjectEnv: false,
    });
    const authority = resolveGeneratorDatabaseAuthority({
      applyProjectEnv: false,
      cwd: input.cwd,
      loaded,
      mode: "direct",
    });
    return { authority, restoreEnv };
  } catch (error) {
    restoreEnv();
    throw error;
  }
}

async function withCliPostgresRuntime<T>(
  connectionString: string,
  fn: (runtime: AthenaPostgresRuntime) => Promise<T>
): Promise<T> {
  const runtime = createAthenaPostgresRuntime({ connectionString });
  try {
    return await fn(runtime);
  } finally {
    await runtime.close();
  }
}

export async function executeBillingReconcileSubjects(
  input: ExecuteBillingReconcileSubjectsInput
): Promise<BillingImportRunReport> {
  const cwd = input.cwd;
  const { authority, restoreEnv } = await resolveBillingDatabaseAuthority({
    configPath: input.parsed.configPath,
    cwd,
  });
  try {
    const provider = authority.provider;
    if (provider.kind !== "postgres" || provider.mode !== "direct") {
      throw new AthenaCliError({
        code: "BILLING001",
        exitCode: CliExitCode.Runtime,
        hint: `Use the same athena.config.ts / DATABASE_URL that \`${ATHENA_MIGRATE_COMMAND}\` uses.`,
        message: `billing reconcile-subjects requires postgres/direct (got ${provider.kind}/${provider.mode}).`,
      });
    }
    if (!provider.connectionString) {
      throw new AthenaCliError({
        code: "BILLING001",
        exitCode: CliExitCode.Runtime,
        hint: "Set DATABASE_URL or provider.connectionString, then retry.",
        message: "billing reconcile-subjects requires a reachable database.",
      });
    }
    const billing = await loadProjectBillingConfig({
      configPath: input.parsed.configPath,
      cwd,
    });
    return await withCliPostgresRuntime(
      provider.connectionString,
      async (runtime) => {
        const manager = await runtime.getPoolManager();
        const sql = createBillingSqlExecutorFromManager(manager);
        return runBillingCustomerImportWithPostgres({
          configuredProviders: billing?.providers,
          connectionId: input.parsed.connectionId,
          cursor: input.parsed.cursor,
          customerId: input.parsed.customerId,
          database: createBillingImportDatabaseFromManager(manager),
          dryRun: input.parsed.dryRun,
          includeAmbiguous: input.parsed.includeAmbiguous,
          limit: input.parsed.limit,
          limits: {
            maxCustomers: input.parsed.maxCustomers,
            maxDurationMs: input.parsed.maxDurationMs,
            maxPages: input.parsed.maxPages,
            pageSize: input.parsed.limit,
          },
          policy: importPolicyFromBillingConfig(billing),
          provider: input.parsed.provider,
          sql,
          subjectId: input.parsed.subjectId,
          testMode: billing?.testMode,
          trigger: "manual",
        });
      }
    );
  } finally {
    restoreEnv();
  }
}

export interface ExecuteBillingWebhooksInput {
  cwd: string;
  parsed: BillingWebhooksCommand;
}

export async function executeBillingWebhooks(
  input: ExecuteBillingWebhooksInput
): Promise<Record<string, unknown>> {
  const restoreEnv = applyGeneratorProjectEnv(input.cwd);
  try {
    const billing = await loadProjectBillingConfig({
      configPath: input.parsed.configPath,
      cwd: input.cwd,
    });
    const { normalizeAthenaBillingIngestion } = await import(
      "../../../billing/ingestion/config.ts"
    );
    const { resolveBillingIngressEndpoints } = await import(
      "../../../billing/ingestion/urls.ts"
    );
    const ingestion = normalizeAthenaBillingIngestion(billing?.ingestion);
    const endpoints = resolveBillingIngressEndpoints({
      appUrl: undefined,
      publicBaseUrl: ingestion.webhooks.publicBaseUrl,
    });
    if (input.parsed.action !== "reconcile" || input.parsed.dryRun) {
      return {
        action: input.parsed.action,
        classicUrl: endpoints?.classicUrl,
        connectionId: input.parsed.connectionId,
        dryRun: input.parsed.dryRun,
        eventsUrl: endpoints?.eventsUrl,
        management: ingestion.webhooks.management,
        provider: input.parsed.provider ?? "mollie",
      };
    }
    const loaded = await loadGeneratorConfig({
      applyProjectEnv: false,
      configPath: input.parsed.configPath,
      cwd: input.cwd,
      restoreProjectEnv: false,
    });
    const authority = resolveGeneratorDatabaseAuthority({
      applyProjectEnv: false,
      cwd: input.cwd,
      loaded,
      mode: "direct",
    });
    const provider = authority.provider;
    if (provider.kind !== "postgres" || provider.mode !== "direct") {
      throw new AthenaCliError({
        code: "BILLING001",
        exitCode: CliExitCode.Runtime,
        hint: `Use the same athena.config.ts / DATABASE_URL that \`${ATHENA_MIGRATE_COMMAND}\` uses.`,
        message: `billing webhooks requires postgres/direct (got ${provider.kind}/${provider.mode}).`,
      });
    }
    if (!provider.connectionString) {
      throw new AthenaCliError({
        code: "BILLING001",
        exitCode: CliExitCode.Runtime,
        hint: "Set DATABASE_URL or provider.connectionString, then retry.",
        message: "billing webhooks requires a reachable database.",
      });
    }
    return await withCliPostgresRuntime(
      provider.connectionString,
      async (runtime) => {
        const manager = await runtime.getPoolManager();
        const sql = createBillingSqlExecutorFromManager(manager);
        const { runAutomaticBillingWebhookReconcileIfEnabled } = await import(
          "../../../billing/ingestion/automatic.ts"
        );
        const applicationId = resolveBillingWebhookApplicationId({
          client: process.env.ATHENA_CLIENT,
        });
        if (applicationId == null) {
          throw new AthenaCliError({
            code: "BILLING001",
            exitCode: CliExitCode.Runtime,
            hint: "Set ATHENA_CLIENT or createClient({ app: { id } }). Do not use a display name.",
            message:
              "billing webhooks reconcile requires a stable application id (ATHENA_CLIENT).",
          });
        }
        await runAutomaticBillingWebhookReconcileIfEnabled({
          applicationId,
          appUrl: ingestion.webhooks.publicBaseUrl,
          configuredProviders: billing?.providers,
          sql,
          testMode: billing?.testMode,
          trigger: "manual",
          webhooks: ingestion.webhooks,
        });
        return {
          action: "reconcile",
          connectionId: input.parsed.connectionId,
          dryRun: false,
          provider: input.parsed.provider ?? "mollie",
        };
      }
    );
  } finally {
    restoreEnv();
  }
}

export interface ExecuteBillingIngressReplayInput {
  cwd: string;
  parsed: BillingIngressReplayCommand;
}

export async function executeBillingIngressReplay(
  input: ExecuteBillingIngressReplayInput
): Promise<Record<string, unknown>> {
  const cwd = input.cwd;
  const { authority, restoreEnv } = await resolveBillingDatabaseAuthority({
    configPath: input.parsed.configPath,
    cwd,
  });
  try {
    const provider = authority.provider;
    if (provider.kind !== "postgres" || provider.mode !== "direct") {
      throw new AthenaCliError({
        code: "BILLING001",
        exitCode: CliExitCode.Runtime,
        hint: `Use the same athena.config.ts / DATABASE_URL that \`${ATHENA_MIGRATE_COMMAND}\` uses.`,
        message: `billing ingress replay requires postgres/direct (got ${provider.kind}/${provider.mode}).`,
      });
    }
    if (!provider.connectionString) {
      throw new AthenaCliError({
        code: "BILLING001",
        exitCode: CliExitCode.Runtime,
        hint: "Set DATABASE_URL or provider.connectionString, then retry.",
        message: "billing ingress replay requires a reachable database.",
      });
    }
    const billing = await loadProjectBillingConfig({
      configPath: input.parsed.configPath,
      cwd,
    });
    return await withCliPostgresRuntime(
      provider.connectionString,
      async (runtime) => {
        const manager = await runtime.getPoolManager();
        const database = eventIngressDatabaseFromManager(manager);
        const persistence = createSqlEventIngressPersistence();
        const classified = await classifyStuckBillingIngress({
          database,
          dryRun: input.parsed.dryRun,
          limit: input.parsed.limit,
          persistence,
        });
        if (input.parsed.dryRun || input.parsed.classifyOnly) {
          return {
            action: "classify",
            ...classified,
            dryRun: input.parsed.dryRun,
          };
        }
        const sql = createBillingSqlExecutorFromManager(manager);
        const ingestion = normalizeAthenaBillingIngestion(billing?.ingestion);
        const secretCache = new Map<string, string[]>();
        const masterKey = resolveBillingWebhookMasterKey({
          configured: ingestion.webhooks.secretMasterKey,
          databaseUrl: provider.connectionString,
        });
        if (masterKey) {
          const secretStore = createPostgresBillingWebhookSecretStore({
            masterKey,
            sql,
          });
          try {
            const connections = await listActiveBillingImportConnections(
              sql,
              "mollie"
            );
            for (const connection of connections) {
              try {
                rememberConnectionSigningSecretSet(
                  secretCache,
                  connection.id,
                  await secretStore.resolve(connection.id)
                );
              } catch {
                /* secrets table may be missing until billing 0015 */
              }
            }
            if (connections.length === 1) {
              const only = connections[0];
              if (only) {
                rememberConnectionSigningSecretSet(
                  secretCache,
                  only.id,
                  signingSecretsFromWebhookConfig(ingestion.webhooks)
                );
              }
            }
          } catch {
            /* connection list is optional for classify-only paths */
          }
        }
        const internals: EventIngressAttachHost = {
          postgresRuntime: runtime,
        };
        attachEventIngressRuntime(internals, {
          configuredProviders: billing?.providers,
          registry: createBillingProviderRegistry(
            billing?.providers,
            billing?.catalog
          ),
          resolveSigningSecrets: (connectionId) =>
            signingSecretsForConnection(secretCache, connectionId),
          testMode: billing?.testMode,
        });
        const eventRuntime =
          internals.eventIngressRuntime as EventIngressRuntime;
        const replayed = await replayBillingIngressBatch({
          database,
          limit: input.parsed.limit,
          persistence,
          runtime: eventRuntime,
        });
        return {
          action: "replay",
          classified,
          replayed,
        };
      }
    );
  } finally {
    restoreEnv();
  }
}
