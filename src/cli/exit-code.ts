/**
 * Stable process exit-code taxonomy for `athena-js`.
 *
 * 0 success
 * 1 unexpected/internal failure
 * 2 CLI usage / invalid arguments
 * 3 configuration invalid
 * 4 connectivity/runtime unavailable
 * 5 validation failure
 * 6 migration conflict/drift
 * 7 authentication/authorization failure
 * 8 operation refused by a safety gate
 */

export const CliExitCode = {
	Success: 0,
	Unexpected: 1,
	Usage: 2,
	Configuration: 3,
	Runtime: 4,
	Validation: 5,
	Conflict: 6,
	Authorization: 7,
	SafetyRefusal: 8,
} as const;

export type CliExitCode = (typeof CliExitCode)[keyof typeof CliExitCode];

export function setCliExitCode(code: number): void {
	const proc = (globalThis as { process?: { exitCode?: number } }).process;
	if (proc) {
		proc.exitCode = code;
	}
}

export function isCliExitCode(value: number): value is CliExitCode {
	return (
		value === CliExitCode.Success ||
		value === CliExitCode.Unexpected ||
		value === CliExitCode.Usage ||
		value === CliExitCode.Configuration ||
		value === CliExitCode.Runtime ||
		value === CliExitCode.Validation ||
		value === CliExitCode.Conflict ||
		value === CliExitCode.Authorization ||
		value === CliExitCode.SafetyRefusal
	);
}
