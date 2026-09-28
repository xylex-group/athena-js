import { parseAthenaRightKey } from "../../../rights/key.ts";
import type { CommandContext } from "../../command-context.ts";
import {
  catalogSubcommands,
  catalogSubcommandTokens,
  formatCatalogTopicUsage,
  formatExpectedCommandsLine,
} from "../../commands-catalog.ts";
import { setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import {
  createGatewayApiKeyRight,
  formatApiKeyRights,
  formatRightsCatalog,
  listGatewayApiKeyRights,
  listGatewayRightsCatalog,
  resolveGatewayAdminCredentials,
} from "../../gateway-admin.ts";
import {
  helpOrRejectUnknownFlags,
  parseGatewayAdminFlags,
  unknownOptionError,
} from "../../parse-helpers.ts";
import { exitCodeForError } from "../../platform/map-exit.ts";
import { closestMatches, formatDidYouMean } from "../../suggest.ts";
import type {
  CliCommand,
  RightsCatalogCommand,
  RightsCreateCommand,
  RightsListCommand,
} from "../../types.ts";

export { rightsCatalog, rightsCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["rights"];

export function parse(rest: string[]): CliCommand {
  if (
    rest.length === 0 ||
    rest[0] === "help" ||
    rest[0] === "--help" ||
    rest[0] === "-h"
  ) {
    return { command: "help", topic: "rights" };
  }

  const sub = rest[0];
  if (sub === "list" || sub === "ls") {
    const common = parseGatewayAdminFlags(rest, 1);
    const help = helpOrRejectUnknownFlags(
      rest,
      common.index,
      "rights list",
      "rights"
    );
    if (help) {
      return help;
    }
    return {
      adminKey: common.adminKey,
      command: "rights-list",
      json: common.json,
      url: common.url,
    };
  }

  if (sub === "catalog" || sub === "all") {
    const common = parseGatewayAdminFlags(rest, 1);
    const help = helpOrRejectUnknownFlags(
      rest,
      common.index,
      "rights catalog",
      "rights"
    );
    if (help) {
      return help;
    }
    return {
      adminKey: common.adminKey,
      command: "rights-catalog",
      json: common.json,
      url: common.url,
    };
  }

  if (sub === "create") {
    let index = 1;
    let name: string | undefined;
    let description: string | undefined;
    let json = false;
    let url: string | undefined;
    let adminKey: string | undefined;

    while (index < rest.length) {
      const token = rest[index];
      index += 1;
      if (token === "--help" || token === "-h") {
        return { command: "help", topic: "rights" };
      }
      if (token === "--json") {
        json = true;
        continue;
      }
      if (token === "--name") {
        const nextValue = rest[index];
        if (!nextValue || nextValue.startsWith("-")) {
          throw new Error("Missing value for --name option.");
        }
        name = nextValue;
        index += 1;
        continue;
      }
      if (token === "--description") {
        const nextValue = rest[index];
        if (!nextValue || nextValue.startsWith("-")) {
          throw new Error("Missing value for --description option.");
        }
        description = nextValue;
        index += 1;
        continue;
      }
      if (token === "--url") {
        const nextValue = rest[index];
        if (!nextValue || nextValue.startsWith("-")) {
          throw new Error("Missing value for --url option.");
        }
        url = nextValue;
        index += 1;
        continue;
      }
      if (token === "--admin-key") {
        const nextValue = rest[index];
        if (!nextValue || nextValue.startsWith("-")) {
          throw new Error("Missing value for --admin-key option.");
        }
        adminKey = nextValue;
        index += 1;
        continue;
      }
      throw unknownOptionError(token, "rights create");
    }

    if (!name) {
      throw new Error(
        "rights create requires --name <right>. Example: athena-js rights create --name gateway.query"
      );
    }

    return {
      adminKey,
      command: "rights-create",
      description,
      json,
      name: parseAthenaRightKey(name),
      url,
    };
  }

  throw new Error(
    [
      `Unknown rights subcommand "${sub}".`,
      formatDidYouMean(closestMatches(sub, catalogSubcommandTokens("rights"))),
      formatExpectedCommandsLine(catalogSubcommands("rights")),
    ]
      .filter((line) => line.length > 0)
      .join("\n")
  );
}

export function usage(): string {
  return formatCatalogTopicUsage("rights");
}

export function sessionTitle(
  _parsed: RightsListCommand | RightsCatalogCommand | RightsCreateCommand
): string {
  return "athena-js rights";
}

export async function run(
  ctx: CommandContext,
  parsed: RightsListCommand | RightsCatalogCommand | RightsCreateCommand
): Promise<void> {
  const { capabilities, errorLog, log, runtime } = ctx;
  try {
    const credentials = resolveGatewayAdminCredentials({
      adminKey: parsed.adminKey,
      baseUrl: parsed.url,
      cwd: runtime.cwd,
    });
    const clientOptions = {
      ...credentials,
      fetchImpl: runtime.fetchImpl,
      logger: ctx.logger,
      trace: ctx.trace,
    };

    if (parsed.command === "rights-list") {
      const rights = await listGatewayApiKeyRights(clientOptions);
      if (parsed.json) {
        log(JSON.stringify({ rights }, null, 2));
      } else {
        log(
          `[admin] url=${credentials.urlSource} key=${credentials.adminKeySource}`
        );
        log(formatApiKeyRights(rights));
      }
      return;
    }

    if (parsed.command === "rights-catalog") {
      const catalog = await listGatewayRightsCatalog(clientOptions);
      if (parsed.json) {
        log(JSON.stringify(catalog, null, 2));
      } else {
        log(
          `[admin] url=${credentials.urlSource} key=${credentials.adminKeySource}`
        );
        log(formatRightsCatalog(catalog));
      }
      return;
    }

    const right = await createGatewayApiKeyRight({
      ...clientOptions,
      input: {
        description: parsed.description,
        name: parsed.name,
      },
    });
    if (parsed.json) {
      log(JSON.stringify({ right }, null, 2));
    } else {
      log(
        `Created API key right name=${right.name}${right.id ? ` id=${right.id}` : ""}`
      );
      if (right.description) {
        log(`description: ${right.description}`);
      }
    }
  } catch (error) {
    ctx.reportError(error, {
      commandId: parsed.command,
      phase: "command",
    });
    logCliError(formatGeneratorError(error), errorLog, capabilities);
    setCliExitCode(exitCodeForError(error));
  }
}
