import type { CliCommand } from "../types.ts";
import {
	type RegisteredCommand,
	legacyIds,
} from "./define-command.ts";

function pathEquals(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((token, index) => token === right[index]);
}

function argvStartsWith(argv: readonly string[], path: readonly string[]): boolean {
	if (argv.length < path.length) {
		return false;
	}
	return path.every((token, index) => argv[index] === token);
}

export class CommandRegistry {
	readonly commands: readonly RegisteredCommand[];

	constructor(commands: readonly RegisteredCommand[]) {
		this.commands = commands;
	}

	match(argv: readonly string[]): { command: RegisteredCommand; rest: string[] } | undefined {
		let best: { command: RegisteredCommand; length: number } | undefined;
		for (const command of this.commands) {
			const paths = [command.path, ...(command.aliasPaths ?? [])];
			for (const path of paths) {
				if (argvStartsWith(argv, path) && path.length > (best?.length ?? 0)) {
					best = { command, length: path.length };
				}
			}
			if (command.path.length === 1) {
				const head = argv[0];
				if (
					head &&
					command.aliases?.includes(head) &&
					1 > (best?.length ?? 0)
				) {
					best = { command, length: 1 };
				}
			}
		}
		if (!best) {
			return undefined;
		}
		return {
			command: best.command,
			rest: argv.slice(best.length),
		};
	}

	findByLegacy(legacy: CliCommand["command"]): RegisteredCommand | undefined {
		for (const command of this.commands) {
			if (legacyIds(command).includes(legacy)) {
				return command;
			}
		}
		return undefined;
	}

	findByPath(path: readonly string[]): RegisteredCommand | undefined {
		return this.commands.find((command) => pathEquals(command.path, path));
	}

	ids(): string[] {
		return this.commands.map((command) => command.id);
	}
}
