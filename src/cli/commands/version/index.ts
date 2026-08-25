import { PACKAGE_VERSION } from "../../../sdk-version.ts";
import type { CommandContext } from "../../command-context.ts";
import { formatCatalogCommandUsage } from "../../commands-catalog.ts";
import type { CliCommand, VersionCommand } from "../../types.ts";

export { versionCatalog, versionCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["-v", "--version", "version", "v"];

export function isVersionToken(token: string | undefined): boolean {
	return (
		token === "-v" ||
		token === "--version" ||
		token === "version" ||
		token === "v"
	);
}

export function parse(rest: string[]): CliCommand {
	if (rest[0] === "--help" || rest[0] === "-h") {
		return { command: "help", topic: "version" };
	}
	return {
		command: "version",
		short: rest.includes("--short") || rest.includes("-q"),
	};
}

export function usage(): string {
	return formatCatalogCommandUsage("version");
}

export function sessionTitle(_parsed: VersionCommand): undefined {
	return undefined;
}

export async function run(
	ctx: CommandContext,
	parsed: VersionCommand,
): Promise<void> {
	if (parsed.short) {
		ctx.log(PACKAGE_VERSION);
	} else {
		ctx.log(`@xylex-group/athena ${PACKAGE_VERSION}`);
	}
}
