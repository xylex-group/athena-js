import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadGeneratorConfig } from "../../../generator/config.ts";
import { resolveGeneratorDatabaseAuthority } from "../../../generator/database-authority.ts";
import { resolveGeneratorProvider } from "../../../generator/providers.ts";
import { resolveProviderSchemas } from "../../../generator/schema-selection.ts";
import { reportAthenaPolicySchemaImpact } from "../../../policy/schema-impact.ts";
import {
  type AthenaSchemaSnapshot,
  diffSchemas,
  normalizeSchemaSnapshot,
  schemaSnapshotFromIntrospection,
  validateSchemaSnapshot,
} from "../../../schema/diff/index.ts";
import { AthenaCliError } from "../../errors.ts";
import { CliExitCode } from "../../exit-code.ts";
import { loadPolicyDocument } from "../policy/load.ts";
import {
  formatProposedMigration,
  formatSchemaDiffText,
  isDestructiveSchemaOperation,
} from "./format.ts";
import { resolveSchemaSnapshotPath } from "./paths.ts";

export interface SchemaDiffReport {
  /** True when this run wrote the first snapshot because none existed. */
  baselineWritten?: boolean;
  destructiveCount: number;
  diff: ReturnType<typeof diffSchemas>;
  fromPath?: string;
  ok: boolean;
  policyImpact?: ReturnType<typeof reportAthenaPolicySchemaImpact>;
  proposedMigration?: string;
  text: string;
}

export async function inspectPhysicalSchemaSnapshot(options: {
  configPath?: string;
  cwd: string;
  inspect?: () => Promise<AthenaSchemaSnapshot>;
}): Promise<AthenaSchemaSnapshot> {
  if (options.inspect) {
    return normalizeSchemaSnapshot(await options.inspect());
  }

  const loaded = await loadGeneratorConfig({
    configPath: options.configPath,
    cwd: options.cwd,
  });
  const authority = resolveGeneratorDatabaseAuthority({
    applyProjectEnv: false,
    cwd: options.cwd,
    loaded,
    mode: "direct",
  });
  try {
    const provider = resolveGeneratorProvider(
      authority.provider,
      loaded.config.experimental
    );
    const introspection = await provider.inspect({
      schemas:
        authority.provider.kind === "postgres"
          ? resolveProviderSchemas(authority.provider)
          : undefined,
    });
    return schemaSnapshotFromIntrospection(introspection);
  } finally {
    authority.restoreEnv();
  }
}

export function readSchemaSnapshotFile(path: string): AthenaSchemaSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      throw error;
    }
    throw new AthenaCliError({
      code: "SCHEMA001",
      exitCode: CliExitCode.Configuration,
      hint: error instanceof Error ? error.message : String(error),
      message: `Could not read schema snapshot "${path}".`,
    });
  }
  validateSchemaSnapshot(parsed as AthenaSchemaSnapshot);
  return normalizeSchemaSnapshot(parsed as AthenaSchemaSnapshot);
}

export function writeSchemaSnapshotFile(
  path: string,
  snapshot: AthenaSchemaSnapshot
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}`, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export async function runSchemaDiff(options: {
  configPath?: string;
  cwd: string;
  fromPath?: string;
  inspect?: () => Promise<AthenaSchemaSnapshot>;
  migration?: boolean;
  policies?: unknown;
  policyImpact?: boolean;
}): Promise<SchemaDiffReport> {
  const fromPath = resolveSchemaSnapshotPath(options.cwd, options.fromPath);
  let from: AthenaSchemaSnapshot;
  try {
    from = readSchemaSnapshotFile(fromPath);
  } catch (error) {
    const missing =
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT";
    if (missing) {
      const current = await inspectPhysicalSchemaSnapshot(options);
      writeSchemaSnapshotFile(fromPath, current);
      const diff = diffSchemas({ from: current, to: current });
      return {
        baselineWritten: true,
        destructiveCount: 0,
        diff,
        fromPath,
        ok: true,
        text: [
          "Wrote first schema snapshot",
          `  ${fromPath}`,
          "No prior snapshot — captured the physical database as the baseline (0 operations).",
          "",
        ].join("\n"),
      };
    }
    if (error instanceof AthenaCliError && error.code === "SCHEMA001") {
      throw new AthenaCliError({
        code: "SCHEMA002",
        exitCode: CliExitCode.Configuration,
        hint: "Run `athena-js schema snapshot` to capture the physical database, then diff again.",
        message: `No schema snapshot at "${fromPath}".`,
      });
    }
    throw error;
  }
  const to = await inspectPhysicalSchemaSnapshot(options);
  const diff = diffSchemas({ from, to });
  const destructiveCount = diff.operations.filter(
    isDestructiveSchemaOperation
  ).length;
  let policyImpact: SchemaDiffReport["policyImpact"];
  if (options.policyImpact) {
    const policies =
      options.policies ??
      (
        await loadPolicyDocument({
          configPath: options.configPath,
          cwd: options.cwd,
        })
      ).document;
    policyImpact = reportAthenaPolicySchemaImpact({
      operations: diff.operations,
      policies,
    });
  }
  return {
    destructiveCount,
    diff,
    fromPath,
    ok: diff.operations.length === 0,
    ...(options.policyImpact ? { policyImpact: policyImpact ?? [] } : {}),
    proposedMigration: options.migration
      ? formatProposedMigration(diff)
      : undefined,
    text: formatSchemaDiffText(diff),
  };
}

export async function runSchemaSnapshot(options: {
  check?: boolean;
  configPath?: string;
  cwd: string;
  inspect?: () => Promise<AthenaSchemaSnapshot>;
  outPath?: string;
}): Promise<{
  check: boolean;
  destructiveCount: number;
  diff?: ReturnType<typeof diffSchemas>;
  ok: boolean;
  path: string;
  text: string;
}> {
  const path = resolveSchemaSnapshotPath(options.cwd, options.outPath);
  const current = await inspectPhysicalSchemaSnapshot(options);
  if (options.check) {
    let committed: AthenaSchemaSnapshot;
    try {
      committed = readSchemaSnapshotFile(path);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        throw new AthenaCliError({
          code: "SCHEMA002",
          exitCode: CliExitCode.Configuration,
          hint: "Run `athena-js schema snapshot` first.",
          message: `No schema snapshot at "${path}".`,
        });
      }
      throw error;
    }
    const diff = diffSchemas({ from: committed, to: current });
    const destructiveCount = diff.operations.filter(
      isDestructiveSchemaOperation
    ).length;
    return {
      check: true,
      destructiveCount,
      diff,
      ok: diff.operations.length === 0,
      path,
      text: formatSchemaDiffText(diff),
    };
  }
  writeSchemaSnapshotFile(path, current);
  return {
    check: false,
    destructiveCount: 0,
    ok: true,
    path,
    text: `Wrote schema snapshot\n  ${path}\n`,
  };
}
