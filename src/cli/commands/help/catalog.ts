import type {
  CliCatalogFlag,
  CliCommandEntry,
} from "../../commands-catalog.ts";

const helpFlags = ["[<topic>]"] as const satisfies readonly CliCatalogFlag[];

export const helpCatalog: readonly CliCommandEntry[] = [
  {
    aliases: ["-h", "--help", "help"],
    command: "help",
    description: "Show root help (or help <topic>)",
    flags: helpFlags,
    group: "global",
    helpTopic: "root",
  },
];
