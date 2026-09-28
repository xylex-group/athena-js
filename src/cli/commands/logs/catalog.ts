import type {
  CliCatalogFlag,
  CliCommandEntry,
} from "../../commands-catalog.ts";

const logsFlags = [
  "--errors",
  "--limit <n>",
  "--older-than <duration>",
  "--out <path>",
  "--json",
  "-h",
] as const satisfies readonly CliCatalogFlag[];

export const logsCatalog: readonly CliCommandEntry[] = [
  {
    command: "logs",
    description: "Inspect, export, and prune local CLI invocation logs",
    examples: [
      "athena-js logs path",
      "athena-js logs list --limit 5",
      "athena-js logs latest",
      "athena-js logs export <invocation-id> --out athena-support-log.jsonl",
    ],
    flags: logsFlags,
    group: "runtime",
    helpTopic: "logs",
    notes: [
      "Logs are stored under the per-user Athena home and are redacted before persistence.",
      "`logs export` applies a second redaction pass and writes a support-safe copy.",
    ],
  },
];
