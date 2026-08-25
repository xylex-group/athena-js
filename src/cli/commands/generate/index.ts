import {
	isCurrentAthenaGeneratedPath,
	isLegacyFlatAthenaGeneratedPath,
} from "../../../generator/config.ts";
import { runSchemaGenerator } from "../../../generator/pipeline.ts";
import type {
	RunGeneratorResult,
	SkippedGeneratedArtifact,
	WrittenGeneratedArtifact,
} from "../../../generator/types.ts";
import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { isDebugEnabled } from "../../debug.ts";
import { setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import { exitCodeForError } from "../../platform/map-exit.ts";
import type { CliCommand, GenerateCommand } from "../../types.ts";

export { generateCatalog, generateCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["generate"];

export function parse(rest: string[]): CliCommand {
	let configPath: string | undefined;
	let dryRun = false;
	let writeConfig = true;
	let discoverSchemas = true;

	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (token === "--help" || token === "-h") {
			return { command: "help", topic: "generate" };
		}

		if (token === "--dry-run") {
			dryRun = true;
			continue;
		}

		if (token === "--no-write-config") {
			writeConfig = false;
			continue;
		}

		if (token === "--write-config") {
			writeConfig = true;
			continue;
		}

		if (token === "--no-discover-schemas") {
			discoverSchemas = false;
			continue;
		}

		if (token === "--config") {
			const nextValue = rest[index + 1];
			if (!nextValue || nextValue.startsWith("-")) {
				throw new Error("Missing value for --config option.");
			}
			configPath = nextValue;
			index += 1;
			continue;
		}

		throw unknownOptionError(token, "generate");
	}

	return {
		command: "generate",
		configPath,
		discoverSchemas,
		dryRun,
		writeConfig,
	};
}

export function usage(): string {
	return formatCatalogTopicUsage("generate");
}

function normalizePath(pathValue: string): string {
	return pathValue.replace(/\\/g, "/");
}

function isLegacyConfigRegistryTarget(target: string): boolean {
	return isLegacyFlatAthenaGeneratedPath(target);
}

function isFlatSchemaTarget(target: string): boolean {
	return normalizePath(target) === "athena/schema.ts";
}

function isCanonicalRegistryTarget(target: string): boolean {
	return isCurrentAthenaGeneratedPath(target);
}

function formatProviderLine(result: RunGeneratorResult): string {
	const { provider } = result.config;
	if (provider.kind === "postgres") {
		const schemaList = Array.isArray(provider.schemas)
			? provider.schemas.join(",")
			: typeof provider.schemas === "string"
				? provider.schemas
				: "public";
		const database = provider.database ? ` database=${provider.database}` : "";
		const backend =
			provider.mode === "gateway" && provider.backend
				? ` backend=${provider.backend}`
				: "";
		return `[provider] kind=${provider.kind} mode=${provider.mode}${database}${backend} schemas=${schemaList}`;
	}

	const datacenter = provider.datacenter
		? ` datacenter=${provider.datacenter}`
		: "";
	return `[provider] kind=${provider.kind} mode=${provider.mode} keyspace=${provider.keyspace} contactPoints=${provider.contactPoints.join(",")}${datacenter}`;
}

function formatFilterLine(result: RunGeneratorResult): string | undefined {
	const { includeTables, excludeTables } = result.config.filter;
	if (includeTables.length === 0 && excludeTables.length === 0) {
		return;
	}

	return `[filter] include=${includeTables.length > 0 ? includeTables.join(",") : "-"} exclude=${excludeTables.length > 0 ? excludeTables.join(",") : "-"}`;
}

function formatGeneratorModeLines(result: RunGeneratorResult): string[] {
	const lines = [
		`[mode] preset=${result.config.output.preset} format=${result.config.output.format} modelTarget=${result.config.output.targets.model}`,
		formatProviderLine(result),
		`[targets] schema=${result.config.output.targets.schema} database=${result.config.output.targets.database} registry=${result.config.output.targets.registry}`,
	];
	const filterLine = formatFilterLine(result);
	if (filterLine) {
		lines.push(filterLine);
	}

	if (result.config.output.format === "define-model") {
		lines.push(
			'[note] Legacy define-model compatibility output is active. Set output.format="table-builder" or ATHENA_GENERATOR_OUTPUT_FORMAT=table-builder to emit table(...).schema(...).columns(...).primaryKey(...).',
		);
	}

	if (result.config.output.preset === "legacy") {
		lines.push(
			'[note] Legacy (N-1) preset is active — flat athena/* output. Prefer output.preset="athena-direct" for athena/generated/* (or src/lib/athena/generated/*).',
		);
	}

	lines.push(
		"[note] Default generator mode is preset=athena-direct + format=table-builder → athena/generated/ (next to athena/migrations). src/lib/athena/generated remains accepted. findManyAst only affects runtime findMany(...) transport and does not enable generator table output.",
	);

	if (
		isLegacyConfigRegistryTarget(result.config.output.targets.registry) &&
		!isCanonicalRegistryTarget(result.config.output.targets.registry)
	) {
		lines.push(
			'[warn] Registry target is a legacy N-1 path (flat athena/*). Prefer athena/generated/registry.ts (or src/lib/athena/generated/registry.ts).',
		);
	}

	if (isFlatSchemaTarget(result.config.output.targets.schema)) {
		lines.push(
			"[warn] Schema target points at athena/schema.ts. Prefer schema-scoped output under athena/generated/schema/{schema_kebab}.ts.",
		);
	}

	return lines;
}

function formatSkippedArtifactLine(artifact: SkippedGeneratedArtifact): string {
	if (artifact.reason === "protected-existing-file") {
		return ` [skip] ${artifact.path} (existing ${artifact.kind} artifacts are protected from overwrite; set output.artifactWrite.${artifact.kind}="merge"|"overwrite" or delete/retarget the file)`;
	}

	if (artifact.reason === "already-current") {
		const custom =
			artifact.preservedCustom && artifact.preservedCustom.length > 0
				? `; preserves ${artifact.preservedCustom.length} non-generated unit(s)`
				: "";
		return ` [ok] ${artifact.path} (already current${custom})`;
	}

	if (artifact.reason === "merge-conflict") {
		return ` [skip] ${artifact.path} (merge conflict: ${artifact.detail ?? "see conflicts"}; file left unchanged)`;
	}

	if (artifact.reason === "merge-lint-failed") {
		return ` [skip] ${artifact.path} (merge lint failed: ${artifact.detail ?? "invalid merged TypeScript"}; file left unchanged)`;
	}

	if (artifact.reason === "merge-unparseable") {
		return ` [skip] ${artifact.path} (existing ${artifact.kind} artifact is not mergeable; delete, retarget, or set output.artifactWrite.${artifact.kind}="overwrite")`;
	}

	return ` [skip] ${artifact.path}`;
}

function formatWrittenArtifactLine(artifact: WrittenGeneratedArtifact): string {
	if (artifact.reason === "merged") {
		const added =
			artifact.added && artifact.added.length > 0
				? ` +${artifact.added.length}: ${artifact.added.slice(0, 4).join(", ")}${artifact.added.length > 4 ? "…" : ""}`
				: "";
		const custom =
			artifact.preservedCustom && artifact.preservedCustom.length > 0
				? `; preserves ${artifact.preservedCustom.length} non-generated unit(s)`
				: "";
		return ` [merge] ${artifact.path}${added}${custom}`;
	}

	if (artifact.reason === "overwritten") {
		return ` [write] ${artifact.path} (overwritten)`;
	}

	return ` - ${artifact.path}`;
}

function formatCustomPreserveWarnings(result: RunGeneratorResult): string[] {
	const lines: string[] = [];
	for (const artifact of result.writtenDetails) {
		if (artifact.preservedCustom && artifact.preservedCustom.length > 0) {
			lines.push(
				` [warn] ${artifact.path} preserves non-generated unit(s): ${artifact.preservedCustom.slice(0, 3).join("; ")}${artifact.preservedCustom.length > 3 ? "…" : ""}`,
			);
		}
	}
	for (const artifact of result.skippedFiles) {
		if (
			artifact.reason === "already-current" &&
			artifact.preservedCustom &&
			artifact.preservedCustom.length > 0
		) {
			lines.push(
				` [warn] ${artifact.path} preserves non-generated unit(s): ${artifact.preservedCustom.slice(0, 3).join("; ")}${artifact.preservedCustom.length > 3 ? "…" : ""}`,
			);
		}
	}
	return lines;
}

function formatConfigEnsureLines(result: RunGeneratorResult): string[] {
	if (!result.configEnsure) {
		return [];
	}

	const { action, path, schemas, reason, changes } = result.configEnsure;
	const lines = [
		`[config] ${action} ${path} schemas=${schemas.join(",") || "-"}`,
	];
	if (reason) {
		lines.push(`[config] reason: ${reason}`);
	}
	if (changes.length > 0 && action !== "unchanged") {
		lines.push(
			`[config] changes: ${changes.slice(0, 4).join("; ")}${changes.length > 4 ? "…" : ""}`,
		);
	}
	return lines;
}

export function sessionTitle(parsed: GenerateCommand): string {
	return parsed.dryRun ? "athena-js generate · dry-run" : "athena-js generate";
}

export async function run(
	ctx: CommandContext,
	parsed: GenerateCommand,
): Promise<void> {
	const { capabilities, errorLog, log, runtime } = ctx;
	const runGenerator = runtime.runGenerator ?? runSchemaGenerator;
	let result: RunGeneratorResult;
	try {
		if (isDebugEnabled()) {
			errorLog(
				`[athena-js] generate starting (dryRun=${parsed.dryRun} writeConfig=${parsed.writeConfig} discoverSchemas=${parsed.discoverSchemas}${parsed.configPath ? ` config=${parsed.configPath}` : ""})`,
			);
		}
		result = await runGenerator({
			configPath: parsed.configPath,
			discoverSchemas: parsed.discoverSchemas,
			dryRun: parsed.dryRun,
			writeConfig: parsed.writeConfig,
		});
	} catch (error) {
		const formatted = formatGeneratorError(error, parsed.configPath);
		logCliError(formatted, errorLog, capabilities);
		setCliExitCode(exitCodeForError(error));
		return;
	}

	if (parsed.dryRun) {
		log(
			`[dry-run] Generated ${result.files.length} files from ${result.configPath}`,
		);
		for (const line of formatGeneratorModeLines(result)) {
			log(line);
		}
		for (const line of formatConfigEnsureLines(result)) {
			log(line);
		}
		for (const file of result.files) {
			log(` - ${file.path}`);
		}
		if (result.writtenDetails?.length || result.skippedFiles?.length) {
			for (const artifact of result.writtenDetails ?? []) {
				if (artifact.kind === "database" || artifact.kind === "registry") {
					log(formatWrittenArtifactLine(artifact));
				}
			}
			for (const artifact of result.skippedFiles ?? []) {
				if (artifact.kind === "database" || artifact.kind === "registry") {
					log(formatSkippedArtifactLine(artifact));
				}
			}
			for (const line of formatCustomPreserveWarnings(result)) {
				log(line);
			}
		}
		return;
	}

	log(
		`Generated ${result.writtenFiles.length} files from ${result.configPath}`,
	);
	for (const line of formatGeneratorModeLines(result)) {
		log(line);
	}
	for (const line of formatConfigEnsureLines(result)) {
		log(line);
	}
	const detailByPath = new Map<string, WrittenGeneratedArtifact>();
	for (const detail of result.writtenDetails ?? []) {
		detailByPath.set(detail.path, detail);
	}
	for (const filePath of result.writtenFiles) {
		const detail = detailByPath.get(filePath);
		if (
			detail &&
			(detail.reason === "merged" || detail.reason === "overwritten")
		) {
			log(formatWrittenArtifactLine(detail));
		} else {
			log(` - ${filePath}`);
		}
	}
	for (const artifact of result.skippedFiles) {
		log(formatSkippedArtifactLine(artifact));
	}
	for (const line of formatCustomPreserveWarnings(result)) {
		log(line);
	}
}
