import type { CliExitCode } from "../exit-code.ts";

export interface CliDiagnostic {
	code: string;
	level: "info" | "warn" | "error";
	message: string;
	hint?: string;
	details?: Record<string, unknown>;
}

export interface CommandResultMeta {
	command: string;
	durationMs: number;
}

export interface CommandResult<T = unknown> {
	data: T;
	warnings: CliDiagnostic[];
	meta: CommandResultMeta;
	exitCode?: CliExitCode;
	ok?: boolean;
}
