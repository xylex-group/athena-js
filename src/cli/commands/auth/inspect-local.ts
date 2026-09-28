import {
  type AthenaAuthDatabase,
  createPostgresAuthDatabase,
} from "../../../auth/local/database.ts";
import { planAthenaAuthSchema } from "../../../auth/local/schema.ts";
import { loadGeneratorConfig } from "../../../generator/config.ts";
import { resolveGeneratorDatabaseAuthority } from "../../../generator/database-authority.ts";
import { ATHENA_MIGRATE_COMMAND } from "../../../migrations/commands.ts";
import {
  databaseLabel,
  providerLabel,
} from "../../../migrations/application/authority.ts";
import { AthenaCliError } from "../../errors.ts";
import { CliExitCode } from "../../exit-code.ts";
import type { AuthAuditRow, AuthTraceRow } from "../../types.ts";
import type { AuthStatusFacts } from "./status-report.ts";

export interface LocalAuthInspectOptions {
  configPath?: string;
  cwd?: string;
}

interface DirectAuthConnection {
  connectionString: string;
  databaseLabel: string;
  providerLabel: string;
}

async function resolveDirectAuthConnection(
  options: LocalAuthInspectOptions
): Promise<DirectAuthConnection> {
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadGeneratorConfig({
    configPath: options.configPath,
    cwd,
  });
  const authority = resolveGeneratorDatabaseAuthority({
    applyProjectEnv: false,
    cwd,
    loaded,
    mode: "direct",
  });
  const config = {
    ...loaded.config,
    provider: authority.provider,
  };
  authority.restoreEnv();
  const { provider } = config;
  if (provider.kind !== "postgres" || provider.mode !== "direct") {
    throw new AthenaCliError({
      code: "AUTH001",
      exitCode: CliExitCode.Runtime,
      hint: `Use the same athena.config.ts / DATABASE_URL that \`${ATHENA_MIGRATE_COMMAND}\` uses.`,
      message: `Embedded Auth CLI requires postgres/direct (got ${provider.kind}/${provider.mode}).`,
    });
  }
  if (!provider.connectionString) {
    throw new AthenaCliError({
      code: "AUTH001",
      exitCode: CliExitCode.Runtime,
      hint: "Set DATABASE_URL or provider.connectionString, then retry.",
      message: "auth commands require a reachable Embedded Auth database.",
    });
  }
  return {
    connectionString: provider.connectionString,
    databaseLabel: databaseLabel(config),
    providerLabel: providerLabel(config),
  };
}

async function tableExists(
  database: { query: AthenaAuthDatabase["query"] },
  qualified: string
): Promise<boolean> {
  const result = await database.query("SELECT to_regclass($1) AS name", [
    qualified,
  ]);
  const name = result.rows[0]?.name;
  return typeof name === "string" && name.length > 0;
}

export async function inspectLocalAuthStatus(
  options: LocalAuthInspectOptions = {}
): Promise<AuthStatusFacts> {
  const connection = await resolveDirectAuthConnection(options);
  const database = await createPostgresAuthDatabase(
    connection.connectionString
  );
  try {
    const plan = await planAthenaAuthSchema(database, { inspectSchema: false });
    const applied = plan.entries.filter((entry) => entry.action !== "apply");
    const currentGeneration =
      applied.length === 0
        ? null
        : Math.max(...applied.map((entry) => entry.version));
    const auditLog = await tableExists(database, "athena.audit_log_auth");
    const traces = await tableExists(database, "athena.traces_auth");
    return {
      auditLog,
      currentGeneration,
      databaseLabel: connection.databaseLabel,
      mode: "embedded",
      providerLabel: connection.providerLabel,
      traces,
    };
  } finally {
    await database.close?.();
  }
}

export async function queryLocalAuthAudit(
  options: LocalAuthInspectOptions & {
    action: "list" | "show";
    limit: number;
    target?: string;
  }
): Promise<AuthAuditRow[]> {
  const connection = await resolveDirectAuthConnection(options);
  const database = await createPostgresAuthDatabase(
    connection.connectionString
  );
  try {
    if (!(await tableExists(database, "athena.audit_log_auth"))) {
      throw new AthenaCliError({
        code: "AUTH001",
        exitCode: CliExitCode.Runtime,
        hint: `Run \`${ATHENA_MIGRATE_COMMAND}\` so Embedded Auth generation 023+ is applied.`,
        message: "auth audit requires table athena.audit_log_auth.",
      });
    }
    const result = options.target
      ? await database.query<{
          actor_user_id: string | null;
          created_at: Date | string;
          event: string;
          id: string;
        }>(
          `
SELECT id, event, actor_user_id, created_at
FROM athena.audit_log_auth
WHERE id = $1 OR event_id = $1
LIMIT 1
`,
          [options.target]
        )
      : await database.query<{
          actor_user_id: string | null;
          created_at: Date | string;
          event: string;
          id: string;
        }>(
          `
SELECT id, event, actor_user_id, created_at
FROM athena.audit_log_auth
ORDER BY created_at DESC
LIMIT $1
`,
          [options.limit]
        );
    return result.rows.map((row) => ({
      actor: row.actor_user_id ?? undefined,
      at:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
      event: row.event,
      id: row.id,
    }));
  } finally {
    await database.close?.();
  }
}

export async function queryLocalAuthTraces(
  options: LocalAuthInspectOptions & {
    action: "list" | "show";
    errorsOnly: boolean;
    limit: number;
    target?: string;
  }
): Promise<AuthTraceRow[]> {
  const connection = await resolveDirectAuthConnection(options);
  const database = await createPostgresAuthDatabase(
    connection.connectionString
  );
  try {
    if (!(await tableExists(database, "athena.traces_auth"))) {
      throw new AthenaCliError({
        code: "AUTH002",
        exitCode: CliExitCode.Runtime,
        hint: `Run \`${ATHENA_MIGRATE_COMMAND}\` so Embedded Auth observability is applied.`,
        message: "auth traces requires table athena.traces_auth.",
      });
    }
    const result = options.target
      ? await database.query<{
          method: string;
          path: string;
          status_code: number | null;
          total_ms: number | null;
          trace_id: string | null;
        }>(
          `
SELECT method, path, status_code, total_ms, trace_id
FROM athena.traces_auth
WHERE id = $1 OR trace_id = $1
LIMIT 1
`,
          [options.target]
        )
      : await database.query<{
          method: string;
          path: string;
          status_code: number | null;
          total_ms: number | null;
          trace_id: string | null;
        }>(
          options.errorsOnly
            ? `
SELECT method, path, status_code, total_ms, trace_id
FROM athena.traces_auth
WHERE outcome <> 'success' OR COALESCE(status_code, 0) >= 400
ORDER BY started_at DESC
LIMIT $1
`
            : `
SELECT method, path, status_code, total_ms, trace_id
FROM athena.traces_auth
ORDER BY started_at DESC
LIMIT $1
`,
          [options.limit]
        );
    return result.rows.map((row) => ({
      method: row.method,
      path: row.path,
      statusCode: row.status_code ?? undefined,
      totalMs: row.total_ms ?? undefined,
      traceId: row.trace_id ?? undefined,
    }));
  } finally {
    await database.close?.();
  }
}
