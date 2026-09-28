import { expandEqualsArgv, peelPresentationFlags } from "./argv.ts";
import { CLI_COMMAND_REGISTRY } from "./commands/register.ts";
import { sanitizeCliArgv } from "./logging/redact.ts";
import {
  applyGlobalsToCommand,
  parseRegisteredCommandResolved,
  peelGlobalFlags,
} from "./platform/index.ts";
import type { CliCommand } from "./types.ts";

export function parseCommand(inputArgv: string[]): CliCommand {
  return parseCommandResolved(inputArgv).value;
}

export function parseCommandResolved(inputArgv: string[]) {
  const { argv: peeled } = peelPresentationFlags(inputArgv);
  const argv = expandEqualsArgv(peeled);
  const { argv: withoutGlobals, globals } = peelGlobalFlags(argv);
  const resolved = parseRegisteredCommandResolved(
    CLI_COMMAND_REGISTRY,
    withoutGlobals,
    sanitizeCliArgv(withoutGlobals, {
      secretFlags: CLI_COMMAND_REGISTRY.secretFlagsFor(withoutGlobals),
    })
  );
  return {
    ...resolved,
    value: applyGlobalsToCommand(resolved.value, globals),
  };
}
