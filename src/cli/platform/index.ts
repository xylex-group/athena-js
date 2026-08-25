export { CLI_JSON_SCHEMA_VERSION, type CliOutputFormat, type CliVerbosity } from "./constants.ts";
export { defineCommand, type RegisteredCommand } from "./define-command.ts";
export { dispatchRegistered, sessionTitleFor } from "./execute.ts";
export {
	applyGlobalsToCommand,
} from "./apply-globals.ts";
export {
	type CliGlobalFlags,
	peelGlobalFlags,
} from "./globals.ts";
export {
	encodeCliJsonFailure,
	encodeCliJsonSuccess,
	stringifyCliJson,
	type CliJsonEnvelope,
} from "./json-protocol.ts";
export { exitCodeForError } from "./map-exit.ts";
export {
	booleanOption,
	enumOption,
	numberOption,
	pathOption,
	stringOption,
} from "./options.ts";
export { parseRegisteredCommand } from "./parse.ts";
export { CommandRegistry } from "./registry.ts";
export type { CliDiagnostic, CommandResult } from "./result.ts";
