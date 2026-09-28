import type {
  CliCatalogFlag,
  CliCommandEntry,
} from "../../commands-catalog.ts";

const reconcileFlags = [
  "--config <path>",
  "--connection <id>",
  "--subject <id>",
  "--provider <name>",
  "--customer <id>",
  "--limit <n>",
  "--max-pages <n>",
  "--max-customers <n>",
  "--max-duration <ms>",
  "--cursor <cursor>",
  "--include-ambiguous",
  "--dry-run",
  "--apply",
  "--json",
  "-h",
] as const satisfies readonly CliCatalogFlag[];

export const billingCatalog: readonly CliCommandEntry[] = [
  {
    command: "billing reconcile-subjects",
    description:
      "Import provider customers onto Athena subjects (dry-run default; email is never identity)",
    examples: [
      "athena-js billing reconcile-subjects --connection <id> --dry-run",
      "athena-js billing reconcile-subjects --connection <id> --apply --json",
    ],
    flags: reconcileFlags,
    group: "runtime",
    helpTopic: "billing",
    notes: [
      "Does not bind ownership by email unless unique-email auto-bind is enabled.",
      "Provider metadata subject IDs outrank email.",
      "Does not auto-merge duplicate provider customers.",
    ],
  },
  {
    command: "billing webhooks status",
    description:
      "Show owned billing webhook registration, route, and delivery health",
    examples: [
      "athena-js billing webhooks status --json",
      "athena-js billing webhooks status --connection <id>",
    ],
    flags: [
      "--config <path>",
      "--connection <id>",
      "--provider <name>",
      "--json",
      "-h",
    ],
    group: "runtime",
    helpTopic: "billing",
  },
  {
    command: "billing ingestion health",
    description: "Show recent webhook ingress accept/reject rates",
    examples: [
      "athena-js billing ingestion health --json",
      "athena-js billing ingestion health --connection <id>",
    ],
    flags: [
      "--config <path>",
      "--connection <id>",
      "--provider <name>",
      "--json",
      "-h",
    ],
    group: "runtime",
    helpTopic: "billing",
  },
  {
    command: "billing webhooks reconcile",
    description:
      "Reconcile Athena-owned Mollie webhook registrations (dry-run default)",
    examples: [
      "athena-js billing webhooks reconcile --dry-run",
      "athena-js billing webhooks reconcile --apply --connection <id>",
    ],
    flags: [
      "--config <path>",
      "--connection <id>",
      "--provider <name>",
      "--dry-run",
      "--apply",
      "--json",
      "-h",
    ],
    group: "runtime",
    helpTopic: "billing",
    notes: [
      "Never mutates foreign provider webhook registrations.",
      "--dry-run prints the desired-state diff without calling Mollie.",
    ],
  },
  {
    command: "billing webhooks verify",
    description: "Verify Athena-owned billing webhook registrations",
    examples: ["athena-js billing webhooks verify --connection <id>"],
    flags: [
      "--config <path>",
      "--connection <id>",
      "--provider <name>",
      "--json",
      "-h",
    ],
    group: "runtime",
    helpTopic: "billing",
  },
  {
    command: "billing ingress replay",
    description:
      "Classify stuck resolving rows and replay retryable billing ingress",
    examples: [
      "athena-js billing ingress replay --dry-run --json",
      "athena-js billing ingress replay --classify-only --limit 50",
    ],
    flags: [
      "--config <path>",
      "--limit <n>",
      "--classify-only",
      "--dry-run",
      "--json",
      "-h",
    ],
    group: "runtime",
    helpTopic: "billing",
    notes: [
      "Stuck resolving rows are classified as retryable or terminal. They are never marked processed.",
    ],
  },
];
