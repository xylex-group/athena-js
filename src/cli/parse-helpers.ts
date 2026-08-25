import {
	CLI_COMMAND_CATALOG,
	catalogOptionFlags,
	catalogOptionHelpHint,
	catalogRootCommands,
	formatExpectedCommandsLine,
} from "./commands-catalog.ts";
import { AthenaCliError } from "./errors.ts";
import { CliExitCode } from "./exit-code.ts";
import { closestMatches, formatDidYouMean } from "./suggest.ts";
import type { HelpCommand } from "./types.ts";

export function parseCsvList(raw: string): string[] {
	return raw
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

export function parseGatewayAdminFlags(
	rest: string[],
	startIndex: number,
): {
	adminKey?: string;
	index: number;
	json: boolean;
	consumed: Record<string, string | boolean | string[] | undefined>;
	url?: string;
} {
	let index = startIndex;
	let json = false;
	let url: string | undefined;
	let adminKey: string | undefined;
	const consumed: Record<string, string | boolean | string[] | undefined> = {};

	while (index < rest.length) {
		const token = rest[index];
		if (token === "--json") {
			json = true;
			index += 1;
			continue;
		}
		if (token === "--url") {
			const nextValue = rest[index + 1];
			if (!nextValue || nextValue.startsWith("-")) {
				throw new Error("Missing value for --url option.");
			}
			url = nextValue;
			index += 2;
			continue;
		}
		if (token === "--admin-key") {
			const nextValue = rest[index + 1];
			if (!nextValue || nextValue.startsWith("-")) {
				throw new Error("Missing value for --admin-key option.");
			}
			adminKey = nextValue;
			index += 2;
			continue;
		}

		// Leave specialized flags to the caller by stopping at unknown tokens
		// only when caller wants — here we collect common + pass unknown via index.
		break;
	}

	consumed.json = json;
	consumed.url = url;
	consumed.adminKey = adminKey;
	return { adminKey, consumed, index, json, url };
}

export function helpOrRejectUnknownFlags(
	rest: string[],
	startIndex: number,
	commandPath: string,
	topic: HelpCommand["topic"],
): HelpCommand | undefined {
	for (const token of rest.slice(startIndex)) {
		if (token === "--help" || token === "-h") {
			return { command: "help", topic };
		}
		throw unknownOptionError(token, commandPath);
	}
	return undefined;
}

export function catalogCommandNames(): string[] {
	const names = new Set<string>();
	for (const entry of CLI_COMMAND_CATALOG) {
		names.add(entry.command);
		const head = entry.command.split(" ")[0];
		if (head) {
			names.add(head);
		}
		for (const alias of entry.aliases ?? []) {
			if (!alias.startsWith("-")) {
				names.add(alias);
				const aliasHead = alias.split(" ")[0];
				if (aliasHead) {
					names.add(aliasHead);
				}
			}
		}
	}
	return [...names];
}

export function flagsForCommand(commandPath: string): string[] {
	return [
		...new Set([
			...catalogOptionFlags(commandPath),
			"--color",
			"--no-color",
			"--force-color",
		]),
	];
}

export function unknownCommandError(command: string): AthenaCliError {
	const suggestion = formatDidYouMean(
		closestMatches(command, catalogCommandNames()),
	);
	return new AthenaCliError({
		code: "CLI002",
		exitCode: CliExitCode.Usage,
		message: [
			`Unknown command "${command}".`,
			suggestion,
			formatExpectedCommandsLine(catalogRootCommands()),
			"Run `athena-js --help` for usage.",
		]
			.filter((line) => line.length > 0)
			.join("\n"),
	});
}

export function unknownOptionError(token: string, commandPath: string): AthenaCliError {
	const suggestion = formatDidYouMean(
		closestMatches(token, flagsForCommand(commandPath)),
	);
	return new AthenaCliError({
		code: "CLI003",
		exitCode: CliExitCode.Usage,
		message: [
			`Unknown option "${token}"${commandPath ? ` for ${commandPath}` : ""}.`,
			suggestion,
			formatExpectedCommandsLine(catalogOptionFlags(commandPath)),
			catalogOptionHelpHint(commandPath),
		]
			.filter((line) => line.length > 0)
			.join("\n"),
	});
}
