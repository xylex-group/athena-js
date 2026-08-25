import { CliExitCode } from "./exit-code.ts";

export interface AthenaCliErrorOptions {
	code: string;
	message: string;
	hint?: string;
	cause?: unknown;
	metadata?: Record<string, unknown>;
	exitCode?: CliExitCode;
}

export class AthenaCliError extends Error {
	readonly code: string;
	readonly hint?: string;
	readonly metadata?: Record<string, unknown>;
	readonly exitCode: CliExitCode;

	constructor(options: AthenaCliErrorOptions) {
		super(
			options.message,
			options.cause !== undefined ? { cause: options.cause } : undefined,
		);
		this.name = "AthenaCliError";
		this.code = options.code;
		this.hint = options.hint;
		this.metadata = options.metadata;
		this.exitCode = options.exitCode ?? CliExitCode.Unexpected;
	}
}

export function formatAthenaCliError(
	error: AthenaCliError,
	logPath?: string,
): string {
	const lines = [error.message];
	lines.push("", `  ${error.code}`);
	if (error.hint) {
		lines.push(
			"",
			...error.hint.split("\n").map((line) => (line ? `  ${line}` : "")),
		);
	}
	if (logPath) {
		lines.push("", `  Log  ${logPath}`);
	}
	return lines.join("\n");
}
