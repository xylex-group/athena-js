import type { CommandContext } from "../command-context.ts";
import type { CliCommand } from "../types.ts";

export interface RegisteredCommand {
	/** Dotted id used in the JSON protocol (`migrate.plan`). */
	id: string;
	/** Canonical invocation path (`["migrate", "plan"]`). */
	path: readonly string[];
	/**
	 * Alternate first-token spellings (`key` for `api-key`, `-v` for version).
	 * Full-path aliases use {@link aliasPaths}.
	 */
	aliases?: readonly string[];
	/** Extra full paths (`["env", "validate"]` for `env check`). */
	aliasPaths?: readonly (readonly string[])[];
	legacy: CliCommand["command"] | readonly CliCommand["command"][];
	parse: (rest: string[]) => CliCommand;
	run: (ctx: CommandContext, parsed: CliCommand) => Promise<void>;
	usage: () => string;
	sessionTitle?: (parsed: CliCommand) => string | undefined;
}

export interface DefineCommandOptions {
	path: readonly string[];
	id?: string;
	aliases?: readonly string[];
	aliasPaths?: readonly (readonly string[])[];
	legacy: RegisteredCommand["legacy"];
	parse: RegisteredCommand["parse"];
	run: RegisteredCommand["run"];
	usage: RegisteredCommand["usage"];
	sessionTitle?: RegisteredCommand["sessionTitle"];
}

export function commandIdFromPath(path: readonly string[]): string {
	return path.join(".");
}

export function defineCommand(
	options: DefineCommandOptions,
): RegisteredCommand {
	return {
		id: options.id ?? commandIdFromPath(options.path),
		path: options.path,
		aliases: options.aliases,
		aliasPaths: options.aliasPaths,
		legacy: options.legacy,
		parse: options.parse,
		run: options.run,
		usage: options.usage,
		sessionTitle: options.sessionTitle,
	};
}

export function legacyIds(command: RegisteredCommand): CliCommand["command"][] {
	const { legacy } = command;
	if (typeof legacy === "string") {
		return [legacy];
	}
	return [...legacy];
}
