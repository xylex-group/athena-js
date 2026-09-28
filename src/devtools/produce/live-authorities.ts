import { createAthenaPostgresRuntime } from "../../postgres/owned-runtime.ts";
import { schemaIrFromIntrospection } from "../../schema/ir/compatibility.ts";
import { createPostgresIntrospectionProvider } from "../../schema/postgres-provider.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nested(
  input: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const value = input?.[key];
  return isRecord(value) ? value : undefined;
}

export type AthenaDevtoolsLiveAuthorities = {
  appliedMigrations?: readonly {
    name?: string;
    version?: number;
  }[];
  liveCatalog?: unknown;
};

export function extractAthenaDevtoolsDatabaseUrl(
  input: Record<string, unknown>
): string | undefined {
  const database = nested(input, "database");
  const db = nested(input, "db");
  const candidates = [
    input.databaseUrl,
    database?.url,
    database?.pgUri,
    db?.pgUri,
    db?.url,
    db?.databaseUrl,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
}

function hasLiveCatalog(input: Record<string, unknown>): boolean {
  return isRecord(input.liveCatalog);
}

function hasAppliedLedger(input: Record<string, unknown>): boolean {
  return (
    Array.isArray(input.appliedMigrations) ||
    Array.isArray(nested(input, "migrations")?.ledger)
  );
}

export async function loadAthenaDevtoolsPostgresAuthorities(
  databaseUrl: string
): Promise<AthenaDevtoolsLiveAuthorities> {
  const live: AthenaDevtoolsLiveAuthorities = {};
  const [catalogResult, ledgerResult] = await Promise.allSettled([
    loadLiveCatalog(databaseUrl),
    loadAppliedMigrations(databaseUrl),
  ]);
  if (catalogResult.status === "fulfilled") {
    live.liveCatalog = catalogResult.value;
  }
  if (ledgerResult.status === "fulfilled") {
    live.appliedMigrations = ledgerResult.value;
  }
  return live;
}

async function loadLiveCatalog(databaseUrl: string): Promise<unknown> {
  const provider = createPostgresIntrospectionProvider({
    connectionString: databaseUrl,
  });
  const snapshot = await provider.inspect();
  return schemaIrFromIntrospection(snapshot);
}

async function loadAppliedMigrations(
  databaseUrl: string
): Promise<AthenaDevtoolsLiveAuthorities["appliedMigrations"]> {
  const runtime = createAthenaPostgresRuntime({
    connectionString: databaseUrl,
  });
  try {
    const result = await runtime.query<{
      name: string;
      version: string | number | bigint;
    }>(
      `
				SELECT version, name
				FROM athena.schema_migrations
				ORDER BY version ASC
			`
    );
    return result.rows.map((row) => ({
      name: row.name,
      version:
        typeof row.version === "number"
          ? row.version
          : Number.parseInt(String(row.version), 10),
    }));
  } finally {
    await runtime.close();
  }
}

export async function resolveAthenaDevtoolsProduceInput(
  input: Record<string, unknown>,
  options?: {
    loadLiveAuthorities?: (
      databaseUrl: string
    ) => Promise<AthenaDevtoolsLiveAuthorities>;
  }
): Promise<Record<string, unknown>> {
  const hasLive = hasLiveCatalog(input);
  const hasLedger = hasAppliedLedger(input);
  if (hasLive && hasLedger) {
    return input;
  }
  const databaseUrl = extractAthenaDevtoolsDatabaseUrl(input);
  const load = options?.loadLiveAuthorities;
  if (!(databaseUrl && load)) {
    return input;
  }
  try {
    const live = await load(databaseUrl);
    return {
      ...input,
      ...(hasLive || live.liveCatalog == null
        ? {}
        : { liveCatalog: live.liveCatalog }),
      ...(hasLedger || live.appliedMigrations == null
        ? {}
        : { appliedMigrations: live.appliedMigrations }),
    };
  } catch {
    return input;
  }
}
