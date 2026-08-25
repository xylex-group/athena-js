/**
 * Project health check for the athena-js CLI (`athena-js doctor`).
 *
 * Aggregates tooling, config, env, and optional local Data Runtime inspect.
 * Read-only: never writes config or applies migrations.
 */
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { findGeneratorConfigPath } from "../../../generator/config.ts";
import { PACKAGE_VERSION } from "../../../sdk-version.ts";
import { resolveCliCapabilities } from "../../ui/capabilities.ts";
import { paint } from "../../ui/colors.ts";
import type { CliCapabilities } from "../../ui/types.ts";
import { type EnvCheckResult, validateProjectEnv } from "../env/project-env.ts";
import {
	type ValidationCheck,
	type ValidationReport,
	validateLocalRuntime,
} from "../validate/validate-local.ts";

const MIN_NODE_MAJOR = 18;

export type DoctorSeverity = "ok" | "warn" | "error" | "skip";
export type DoctorGroup = "tooling" | "project" | "env" | "runtime";

export interface DoctorCheck {
	detail?: string;
	group: DoctorGroup;
	id: string;
	status: DoctorSeverity;
	title: string;
}

export interface DoctorReport {
	checks: DoctorCheck[];
	cwd: string;
	errorCount: number;
	ok: boolean;
	resolvedMode: "direct" | "gateway" | "none";
	sdkVersion: string;
	title: string;
	warnCount: number;
}

export interface DoctorOptions {
	configPath?: string;
	cwd?: string;
	json?: boolean;
	plain?: boolean;
	skipRuntime?: boolean;
	strict?: boolean;
	validateEnv?: typeof validateProjectEnv;
	validateLocal?: typeof validateLocalRuntime;
}

function nodeMajor(version: string): number {
	const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
	return Number.isFinite(major) ? major : 0;
}

function displayPath(cwd: string, absolutePath: string): string {
	const rel = relative(cwd, absolutePath);
	if (!rel || rel.startsWith("..")) {
		return absolutePath;
	}
	return rel.replace(/\\/g, "/");
}

function tag(status: DoctorSeverity, capabilities: CliCapabilities): string {
	const raw =
		status === "ok"
			? "ok  "
			: status === "warn"
				? "warn"
				: status === "skip"
					? "skip"
					: "err ";
	const color =
		status === "ok"
			? "green"
			: status === "warn"
				? "yellow"
				: status === "skip"
					? "dim"
					: "red";
	return paint(raw, color, capabilities);
}

function toDoctorStatus(status: ValidationCheck["status"]): DoctorSeverity {
	return status;
}

export function formatDoctorReport(
	report: DoctorReport,
	capabilities: CliCapabilities = resolveCliCapabilities({ plain: true }),
): string {
	const lines: string[] = [paint(report.title, "bold", capabilities), ""];
	lines.push(
		`  ${paint("SDK        ", "dim", capabilities)}${report.sdkVersion}`,
	);
	lines.push(`  ${paint("cwd        ", "dim", capabilities)}${report.cwd}`);
	lines.push(
		`  ${paint("mode       ", "dim", capabilities)}${report.resolvedMode}`,
	);
	lines.push("");

	const titles: Record<DoctorGroup, string> = {
		env: "Environment",
		project: "Project",
		runtime: "Local runtime",
		tooling: "Tooling",
	};
	let currentGroup: DoctorGroup | undefined;
	for (const check of report.checks) {
		if (check.group !== currentGroup) {
			if (currentGroup) {
				lines.push("");
			}
			currentGroup = check.group;
			lines.push(paint(titles[check.group], "bold", capabilities));
			lines.push("");
		}
		lines.push(`  [${tag(check.status, capabilities)}] ${check.title}`);
		if (check.detail) {
			for (const line of check.detail.split("\n")) {
				lines.push(paint(`         ${line}`, "dim", capabilities));
			}
		}
	}

	lines.push("");
	lines.push(
		paint(
			`  ${report.errorCount} error(s) · ${report.warnCount} warning(s)`,
			"dim",
			capabilities,
		),
	);
	lines.push(report.ok ? "result: OK" : "result: FAILED");
	return lines.join("\n");
}

function pushEnvChecks(checks: DoctorCheck[], env: EnvCheckResult): void {
	for (const field of env.checks) {
		checks.push({
			detail: field.message,
			group: "env",
			id: `env.${field.field}`,
			status: field.severity,
			title: field.sourceKey
				? `${field.field} (${field.sourceKey})`
				: field.field,
		});
	}
}

function pushRuntimeChecks(
	checks: DoctorCheck[],
	runtime: ValidationReport,
): void {
	for (const check of runtime.checks) {
		checks.push({
			detail: check.detail,
			group: "runtime",
			id: `runtime.${check.id}`,
			status: toDoctorStatus(check.status),
			title: check.title,
		});
	}
}

export async function runCliDoctor(
	options: DoctorOptions = {},
): Promise<DoctorReport> {
	const cwd = options.cwd ?? process.cwd();
	const checks: DoctorCheck[] = [];
	const runEnv = options.validateEnv ?? validateProjectEnv;
	const runLocal = options.validateLocal ?? validateLocalRuntime;

	checks.push({
		group: "tooling",
		id: "cli.sdk",
		status: "ok",
		title: `@xylex-group/athena ${PACKAGE_VERSION}`,
	});

	const major = nodeMajor(process.versions.node);
	checks.push({
		detail:
			major >= MIN_NODE_MAJOR
				? `Required: >=${MIN_NODE_MAJOR}.0.0`
				: `Athena JS requires Node.js ${MIN_NODE_MAJOR} or newer.`,
		group: "tooling",
		id: "cli.node",
		status: major >= MIN_NODE_MAJOR ? "ok" : "error",
		title: `Node.js ${process.versions.node}`,
	});

	const configuredPath = options.configPath
		? resolve(cwd, options.configPath)
		: findGeneratorConfigPath(cwd);
	if (configuredPath && existsSync(configuredPath)) {
		checks.push({
			detail: displayPath(cwd, configuredPath),
			group: "project",
			id: "project.config",
			status: "ok",
			title: "Generator config found",
		});
	} else if (options.configPath) {
		checks.push({
			detail: `Missing ${options.configPath}. Pass a real --config path or run athena-js init.`,
			group: "project",
			id: "project.config",
			status: "error",
			title: "Generator config missing",
		});
	} else {
		checks.push({
			detail:
				"No athena.config.ts (or compatible file) in cwd. Env-only generate still works; run athena-js init to commit one.",
			group: "project",
			id: "project.config",
			status: "warn",
			title: "Generator config not found",
		});
	}

	const env = runEnv({
		cwd,
		mode: "auto",
		strict: options.strict,
	});
	pushEnvChecks(checks, env);

	if (options.skipRuntime) {
		checks.push({
			detail: "Skipped (--skip-runtime).",
			group: "runtime",
			id: "runtime.inspect",
			status: "skip",
			title: "Local runtime inspect",
		});
	} else if (env.resolvedMode === "none") {
		checks.push({
			detail:
				"No DATABASE_URL / ATHENA_URL profile. Set env or config, then re-run doctor.",
			group: "runtime",
			id: "runtime.inspect",
			status: "skip",
			title: "Local runtime inspect",
		});
	} else if (env.resolvedMode === "gateway") {
		checks.push({
			detail:
				"Gateway mode: local Data Runtime inspect is skipped. Use generate against the gateway.",
			group: "runtime",
			id: "runtime.inspect",
			status: "skip",
			title: "Local runtime inspect",
		});
	} else {
		try {
			const runtime = await runLocal({
				configPath: options.configPath,
				cwd,
				json: options.json,
				plain: options.plain,
				strict: options.strict,
			});
			pushRuntimeChecks(checks, runtime);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Unknown runtime inspect error.";
			checks.push({
				detail: message,
				group: "runtime",
				id: "runtime.inspect",
				status: "error",
				title: "Local runtime inspect failed",
			});
		}
	}

	const errorCount = checks.filter((check) => check.status === "error").length;
	const warnCount = checks.filter((check) => check.status === "warn").length;
	return {
		checks,
		cwd,
		errorCount,
		ok: errorCount === 0,
		resolvedMode: env.resolvedMode,
		sdkVersion: PACKAGE_VERSION,
		title: "Athena JS · doctor",
		warnCount,
	};
}
