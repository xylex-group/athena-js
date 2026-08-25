import { ATHENA_AUTH_SCHEMA_GENERATION } from "../../../auth/contract/index.ts";
import { resolveCliCapabilities } from "../../ui/capabilities.ts";
import { paint } from "../../ui/colors.ts";
import { frameBlock } from "../../ui/rail.ts";
import type { CliCapabilities } from "../../ui/types.ts";
import {
	type AuthCapabilityRow,
	buildAuthCapabilityMatrix,
	formatAuthCapabilityMatrix,
} from "./capabilities-report.ts";

export interface AuthStatusFacts {
	auditLog?: boolean;
	currentGeneration?: number | null;
	databaseLabel?: string;
	mode?: "embedded" | "remote" | "unknown";
	providerLabel?: string;
	traces?: boolean;
}

export interface AuthStatusReport {
	capabilities: AuthCapabilityRow[];
	currentGeneration: number | null;
	databaseLabel?: string;
	expectedGeneration: number;
	mode: "embedded" | "remote" | "unknown";
	ok: boolean;
	providerLabel?: string;
	observability: {
		auditLog: boolean | "unknown";
		traces: boolean | "unknown";
	};
}

export function buildAuthStatusReport(
	facts: AuthStatusFacts = {},
): AuthStatusReport {
	const current =
		facts.currentGeneration === undefined ? null : facts.currentGeneration;
	const generationOk =
		current == null || current === ATHENA_AUTH_SCHEMA_GENERATION;
	return {
		capabilities: buildAuthCapabilityMatrix(),
		currentGeneration: current,
		databaseLabel: facts.databaseLabel,
		expectedGeneration: ATHENA_AUTH_SCHEMA_GENERATION,
		mode: facts.mode ?? "unknown",
		ok: generationOk,
		providerLabel: facts.providerLabel,
		observability: {
			auditLog: facts.auditLog ?? "unknown",
			traces: facts.traces ?? "unknown",
		},
	};
}

function obs(
	value: boolean | "unknown",
	capabilities: CliCapabilities,
): string {
	if (value === true) {
		return paint("✓", "green", capabilities);
	}
	if (value === false) {
		return paint("missing", "red", capabilities);
	}
	return paint("unknown", "dim", capabilities);
}

function modeColor(
	mode: AuthStatusReport["mode"],
): "green" | "cyan" | "yellow" {
	if (mode === "embedded") {
		return "green";
	}
	if (mode === "remote") {
		return "cyan";
	}
	return "yellow";
}

export function formatAuthStatusText(
	report: AuthStatusReport,
	capabilities: CliCapabilities = resolveCliCapabilities({ plain: true }),
): string {
	const generationValue = report.currentGeneration ?? "n/a";
	const generationColor =
		report.currentGeneration == null
			? "yellow"
			: report.ok
				? "green"
				: "red";
	const label = (text: string) => paint(text.padEnd(18), "dim", capabilities);
	const lines = [
		paint("Athena Auth status", "bold", capabilities),
		"",
		`${label("Mode")}${paint(report.mode, modeColor(report.mode), capabilities)}`,
	];
	if (report.providerLabel) {
		lines.push(`${label("Database")}${report.providerLabel}`);
	}
	if (report.databaseLabel) {
		lines.push(`${label("Target")}${report.databaseLabel}`);
	}
	lines.push(
		`${label("Schema generation")}${paint(String(generationValue), generationColor, capabilities)} ${paint(`(expected ${report.expectedGeneration})`, "dim", capabilities)}`,
		"",
		formatAuthCapabilityMatrix(report.capabilities, capabilities, {
			framed: false,
		}).trimEnd(),
		"",
		paint("Observability", "bold", capabilities),
		`  ${paint("audit_log_auth", "dim", capabilities)}  ${obs(report.observability.auditLog, capabilities)}`,
		`  ${paint("traces_auth", "dim", capabilities)}     ${obs(report.observability.traces, capabilities)}`,
	);
	return `${frameBlock(lines.join("\n"), capabilities)}\n`;
}
