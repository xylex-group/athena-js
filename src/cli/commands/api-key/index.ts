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
  createGatewayApiKey,
  formatApiKeyRecords,
  formatCreatedApiKey,
  listGatewayApiKeys,
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
  ApiKeyCreateCommand,
  ApiKeyGenerateCommand,
  ApiKeyListCommand,
  CliCommand,
} from "../../types.ts";
import {
  assertGenerateDoesNotWriteGatewayAppKey,
  GENERATE_DEFAULT_ENV_KEY,
  generateApiKey,
  writeApiKeyToEnvFile,
} from "./secret.ts";

export { apiKeyCatalog, apiKeyCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["api-key", "key"];

function parseApiKeyGenerateFlags(
  rest: string[],
  startIndex: number
): CliCommand {
  let index = startIndex;
  let bytes = 32;
  let prefix = "";
  let write = false;
  let force = false;
  let envFile: string | undefined;
  let envKey = GENERATE_DEFAULT_ENV_KEY;

  while (index < rest.length) {
    const token = rest[index];
    index += 1;
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "api-key" };
    }
    if (token === "--write") {
      write = true;
      continue;
    }
    if (token === "--force") {
      force = true;
      continue;
    }
    if (token === "--bytes") {
      const nextValue = rest[index];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --bytes option.");
      }
      const parsed = Number(nextValue);
      if (!Number.isInteger(parsed)) {
        throw new Error(`Invalid --bytes value "${nextValue}".`);
      }
      bytes = parsed;
      index += 1;
      continue;
    }
    if (token === "--prefix") {
      const nextValue = rest[index];
      if (nextValue === undefined || nextValue.startsWith("-")) {
        if (nextValue === "") {
          prefix = "";
          index += 1;
          continue;
        }
        throw new Error("Missing value for --prefix option.");
      }
      prefix = nextValue;
      index += 1;
      continue;
    }
    if (token === "--env-file") {
      const nextValue = rest[index];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --env-file option.");
      }
      envFile = nextValue;
      write = true;
      index += 1;
      continue;
    }
    if (token === "--env-key") {
      const nextValue = rest[index];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --env-key option.");
      }
      envKey = nextValue;
      index += 1;
      continue;
    }
    throw unknownOptionError(token, "api-key generate");
  }

  return {
    bytes,
    command: "api-key-generate",
    envFile,
    envKey,
    force,
    prefix,
    write,
  };
}

function parseApiKeyCreateFlags(
  rest: string[],
  startIndex: number
): CliCommand {
  let index = startIndex;
  let name: string | undefined;
  let clientName: string | undefined;
  let description: string | undefined;
  let expiresAt: string | undefined;
  let rights: string[] = [];
  let write = false;
  let force = false;
  let envFile: string | undefined;
  let envKey = "ATHENA_API_KEY";
  let json = false;
  let url: string | undefined;
  let adminKey: string | undefined;

  while (index < rest.length) {
    const token = rest[index];
    index += 1;
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "api-key" };
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--write") {
      write = true;
      continue;
    }
    if (token === "--force") {
      force = true;
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
    if (token === "--client-name") {
      const nextValue = rest[index];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --client-name option.");
      }
      clientName = nextValue;
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
    if (token === "--expires-at") {
      const nextValue = rest[index];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --expires-at option.");
      }
      expiresAt = nextValue;
      index += 1;
      continue;
    }
    if (token === "--rights") {
      const nextValue = rest[index];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --rights option.");
      }
      rights = nextValue.split(",").map((token) => parseAthenaRightKey(token));
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
    if (token === "--env-file") {
      const nextValue = rest[index];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --env-file option.");
      }
      envFile = nextValue;
      write = true;
      index += 1;
      continue;
    }
    if (token === "--env-key") {
      const nextValue = rest[index];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --env-key option.");
      }
      envKey = nextValue;
      index += 1;
      continue;
    }
    throw unknownOptionError(token, "api-key create");
  }

  if (!name) {
    throw new Error(
      "api-key create requires --name <name>. Example: athena-js api-key create --name app --rights gateway.query"
    );
  }

  return {
    adminKey,
    clientName,
    command: "api-key-create",
    description,
    envFile,
    envKey,
    expiresAt,
    force,
    json,
    name,
    rights,
    url,
    write,
  };
}

function parseApiKeyListFlags(rest: string[], startIndex: number): CliCommand {
  const common = parseGatewayAdminFlags(rest, startIndex);
  const help = helpOrRejectUnknownFlags(
    rest,
    common.index,
    "api-key list",
    "api-key"
  );
  if (help) {
    return help;
  }
  return {
    adminKey: common.adminKey,
    command: "api-key-list",
    json: common.json,
    url: common.url,
  };
}

export function parse(rest: string[]): CliCommand {
  if (
    rest.length === 0 ||
    rest[0] === "help" ||
    rest[0] === "--help" ||
    rest[0] === "-h"
  ) {
    return { command: "help", topic: "api-key" };
  }

  const sub = rest[0];
  if (sub === "generate" || sub === "gen" || sub === "new") {
    return parseApiKeyGenerateFlags(rest, 1);
  }
  if (sub === "create") {
    return parseApiKeyCreateFlags(rest, 1);
  }
  if (sub === "list" || sub === "ls") {
    return parseApiKeyListFlags(rest, 1);
  }
  if (sub.startsWith("-")) {
    return parseApiKeyGenerateFlags(rest, 0);
  }

  throw new Error(
    [
      `Unknown api-key subcommand "${sub}".`,
      formatDidYouMean(closestMatches(sub, catalogSubcommandTokens("api-key"))),
      formatExpectedCommandsLine(catalogSubcommands("api-key")),
    ]
      .filter((line) => line.length > 0)
      .join("\n")
  );
}

export function usage(): string {
  return formatCatalogTopicUsage("api-key");
}

export function sessionTitle(
  _parsed: ApiKeyGenerateCommand | ApiKeyListCommand | ApiKeyCreateCommand
): string {
  return "athena-js api-key";
}

export async function run(
  ctx: CommandContext,
  parsed: ApiKeyGenerateCommand | ApiKeyListCommand | ApiKeyCreateCommand
): Promise<void> {
  const { capabilities, errorLog, log, runtime } = ctx;
  try {
    if (parsed.command === "api-key-generate") {
      const generated = generateApiKey({
        bytes: parsed.bytes,
        prefix: parsed.prefix,
      });
      if (parsed.write) {
        assertGenerateDoesNotWriteGatewayAppKey(parsed.envKey);
        const written = writeApiKeyToEnvFile({
          cwd: runtime.cwd,
          envKey: parsed.envKey,
          filePath: parsed.envFile,
          force: parsed.force,
          key: generated.key,
        });
        log(
          `Static admin secret ${written.action} in ${written.absolutePath} (${written.envKey})`
        );
        log(
          "Set the same value on the gateway process. This is not a store-backed ATHENA_API_KEY."
        );
        log(
          "For a registered app key: athena-js api-key create --name <name> --rights gateway.query --write"
        );
      } else {
        log(generated.key);
        log(
          "Tip: athena-js api-key generate --write  # saves to .env.local as ATHENA_KEY_12"
        );
        log(
          "For a store-backed gateway app key: athena-js api-key create --name <name> --rights gateway.query --write"
        );
      }
      return;
    }

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

    if (parsed.command === "api-key-list") {
      const records = await listGatewayApiKeys(clientOptions);
      if (parsed.json) {
        log(JSON.stringify({ api_keys: records }, null, 2));
      } else {
        log(
          `[admin] url=${credentials.urlSource} key=${credentials.adminKeySource}`
        );
        log(formatApiKeyRecords(records));
      }
      return;
    }

    const created = await createGatewayApiKey({
      ...clientOptions,
      input: {
        client_name: parsed.clientName,
        description: parsed.description,
        expires_at: parsed.expiresAt,
        name: parsed.name,
        rights: parsed.rights,
      },
    });
    if (parsed.write && created.api_key) {
      const written = writeApiKeyToEnvFile({
        cwd: runtime.cwd,
        envKey: parsed.envKey,
        filePath: parsed.envFile,
        force: parsed.force,
        key: created.api_key,
      });
      if (parsed.json) {
        log(
          JSON.stringify(
            {
              ...created,
              envWrite: written,
            },
            null,
            2
          )
        );
      } else {
        log(formatCreatedApiKey(created));
        log(
          `Saved plaintext to ${written.absolutePath} as ${written.envKey} (${written.action})`
        );
      }
    } else if (parsed.json) {
      log(JSON.stringify(created, null, 2));
    } else {
      log(formatCreatedApiKey(created));
      if (parsed.write && !created.api_key) {
        log(
          "Warning: response had no plaintext api_key; nothing written to env file."
        );
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
