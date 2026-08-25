import type { CliOutputFormat, CliVerbosity } from "./platform/constants.ts";
import type { CliGlobalFlags } from "./platform/globals.ts";
import type { CliRuntime } from "./types.ts";
import type { CliCapabilities } from "./ui/types.ts";

export interface CommandContext {
	capabilities: CliCapabilities;
	cwd: string;
	errorLog: (message: string) => void;
	globals: CliGlobalFlags;
	log: (message: string) => void;
	logRaw: (message: string) => void;
	output: CliOutputFormat;
	presentation: { forceColor?: boolean; noColor?: boolean };
	runtime: CliRuntime;
	verbosity: CliVerbosity;
}
