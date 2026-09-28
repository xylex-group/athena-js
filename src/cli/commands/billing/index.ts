import { formatBillingImportReport } from "../../../billing/import/report.ts";
import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { AthenaCliError, formatAthenaCliError } from "../../errors.ts";
import { setCliExitCode } from "../../exit-code.ts";
import { formatGeneratorError, logCliError } from "../../format-error.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import {
  encodeCliJsonSuccess,
  stringifyCliJson,
} from "../../platform/index.ts";
import { exitCodeForError } from "../../platform/map-exit.ts";
import type {
  BillingIngressReplayCommand,
  BillingWebhooksCommand,
  CliCommand,
} from "../../types.ts";
import {
  executeBillingIngressReplay,
  executeBillingReconcileSubjects,
  executeBillingWebhooks,
} from "./execute.ts";

export { billingCatalog, billingCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["billing"];

export interface BillingReconcileSubjectsCommand {
  apply: boolean;
  command: "billing-reconcile-subjects";
  configPath?: string;
  connectionId?: string;
  cursor?: string;
  customerId?: string;
  dryRun: boolean;
  includeAmbiguous: boolean;
  json: boolean;
  limit?: number;
  maxCustomers?: number;
  maxDurationMs?: number;
  maxPages?: number;
  provider?: string;
  subjectId?: string;
}

export function parse(rest: string[]): CliCommand {
  const head = rest[0];
  if (
    head === undefined ||
    head === "help" ||
    head === "--help" ||
    head === "-h"
  ) {
    return { command: "help", topic: "billing" };
  }
  if (
    head !== "reconcile-subjects" &&
    head !== "webhooks" &&
    head !== "ingestion" &&
    head !== "ingress"
  ) {
    throw unknownOptionError(head, "billing");
  }
  if (head === "ingress") {
    if (rest[1] !== "replay") {
      throw unknownOptionError(rest[1] ?? "ingress", "billing ingress");
    }
    return parseBillingIngressReplay(rest.slice(2));
  }
  if (head === "ingestion") {
    if (rest[1] !== "health") {
      throw unknownOptionError(rest[1] ?? "ingestion", "billing ingestion");
    }
    return parseBillingWebhooksFlags("status", rest.slice(2));
  }
  if (head === "webhooks") {
    return parseBillingWebhooks(rest.slice(1));
  }
  let apply = false;
  let configPath: string | undefined;
  let connectionId: string | undefined;
  let cursor: string | undefined;
  let customerId: string | undefined;
  let dryRun = true;
  let includeAmbiguous = false;
  let json = false;
  let limit: number | undefined;
  let maxCustomers: number | undefined;
  let maxDurationMs: number | undefined;
  let maxPages: number | undefined;
  let provider: string | undefined;
  let subjectId: string | undefined;
  const flags = rest.slice(1);
  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index];
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "billing" };
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--apply") {
      apply = true;
      dryRun = false;
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
      apply = false;
      continue;
    }
    if (token === "--include-ambiguous") {
      includeAmbiguous = true;
      continue;
    }
    if (
      token === "--config" ||
      token === "--connection" ||
      token === "--subject" ||
      token === "--provider" ||
      token === "--customer" ||
      token === "--limit" ||
      token === "--max-pages" ||
      token === "--max-customers" ||
      token === "--max-duration" ||
      token === "--cursor"
    ) {
      const nextValue = flags[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error(`Missing value for ${token} option.`);
      }
      if (token === "--config") {
        configPath = nextValue;
      } else if (token === "--connection") {
        connectionId = nextValue;
      } else if (token === "--subject") {
        subjectId = nextValue;
      } else if (token === "--provider") {
        provider = nextValue;
      } else if (token === "--customer") {
        customerId = nextValue;
      } else if (token === "--limit") {
        const parsedLimit = Number.parseInt(nextValue, 10);
        if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
          throw new Error("Missing value for --limit option.");
        }
        limit = parsedLimit;
      } else if (token === "--max-pages") {
        const parsedPages = Number.parseInt(nextValue, 10);
        if (!Number.isFinite(parsedPages) || parsedPages < 1) {
          throw new Error("Missing value for --max-pages option.");
        }
        maxPages = parsedPages;
      } else if (token === "--max-customers") {
        const parsedCustomers = Number.parseInt(nextValue, 10);
        if (!Number.isFinite(parsedCustomers) || parsedCustomers < 1) {
          throw new Error("Missing value for --max-customers option.");
        }
        maxCustomers = parsedCustomers;
      } else if (token === "--max-duration") {
        const parsedDuration = Number.parseInt(nextValue, 10);
        if (!Number.isFinite(parsedDuration) || parsedDuration < 1) {
          throw new Error("Missing value for --max-duration option.");
        }
        maxDurationMs = parsedDuration;
      } else {
        cursor = nextValue;
      }
      index += 1;
      continue;
    }
    throw unknownOptionError(token ?? "", "billing reconcile-subjects");
  }
  return {
    apply,
    command: "billing-reconcile-subjects",
    configPath,
    connectionId,
    cursor,
    customerId,
    dryRun,
    includeAmbiguous,
    json,
    limit,
    maxCustomers,
    maxDurationMs,
    maxPages,
    provider,
    subjectId,
  } as CliCommand;
}

function parseBillingWebhooks(rest: string[]): BillingWebhooksCommand {
  const actionToken = rest[0];
  if (
    actionToken !== "status" &&
    actionToken !== "reconcile" &&
    actionToken !== "verify"
  ) {
    throw unknownOptionError(actionToken ?? "webhooks", "billing webhooks");
  }
  return parseBillingWebhooksFlags(actionToken, rest.slice(1));
}

export function parseBillingIngressReplay(
  flags: readonly string[]
): CliCommand {
  let classifyOnly = false;
  let configPath: string | undefined;
  let dryRun = false;
  let json = false;
  let limit: number | undefined;
  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index];
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "billing" };
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--classify-only") {
      classifyOnly = true;
      continue;
    }
    if (token === "--config" || token === "--limit") {
      const nextValue = flags[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error(`Missing value for ${token} option.`);
      }
      if (token === "--config") {
        configPath = nextValue;
      } else {
        const parsedLimit = Number.parseInt(nextValue, 10);
        if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
          throw new Error("Missing value for --limit option.");
        }
        limit = parsedLimit;
      }
      index += 1;
      continue;
    }
    throw unknownOptionError(token ?? "", "billing ingress replay");
  }
  return {
    classifyOnly,
    command: "billing-ingress-replay",
    configPath,
    dryRun,
    json,
    limit,
  };
}

export function parseBillingWebhooksFlags(
  action: "status" | "reconcile" | "verify",
  flags: readonly string[]
): BillingWebhooksCommand {
  let configPath: string | undefined;
  let connectionId: string | undefined;
  let dryRun = action === "reconcile";
  let json = false;
  let provider: string | undefined;
  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index];
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--apply") {
      dryRun = false;
      continue;
    }
    if (
      token === "--config" ||
      token === "--connection" ||
      token === "--provider"
    ) {
      const nextValue = flags[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error(`Missing value for ${token} option.`);
      }
      if (token === "--config") {
        configPath = nextValue;
      } else if (token === "--connection") {
        connectionId = nextValue;
      } else {
        provider = nextValue;
      }
      index += 1;
      continue;
    }
    throw unknownOptionError(token ?? "", "billing webhooks");
  }
  return {
    action,
    command: "billing-webhooks",
    configPath,
    connectionId,
    dryRun,
    json,
    provider,
  };
}

export function usage(): string {
  return formatCatalogTopicUsage("billing");
}

function spanCli<T>(
  ctx: CommandContext,
  name: string,
  metadata: Record<string, unknown>,
  operation: () => Promise<T> | T
): Promise<T> {
  if (ctx.trace == null) {
    return Promise.resolve(operation());
  }
  return ctx.trace.span(name, metadata, operation);
}

export async function run(
  ctx: CommandContext,
  parsed:
    | BillingReconcileSubjectsCommand
    | BillingWebhooksCommand
    | BillingIngressReplayCommand
): Promise<void> {
  const { capabilities, errorLog, log, runtime } = ctx;
  try {
    if (parsed.command === "billing-ingress-replay") {
      const report = await spanCli(
        ctx,
        "billing.ingress.replay",
        {
          dryRun: parsed.dryRun,
          limit: parsed.limit,
        },
        () =>
          executeBillingIngressReplay({
            cwd: runtime.cwd ?? ctx.cwd,
            parsed,
          })
      );
      if (parsed.json || ctx.output === "json") {
        log(
          stringifyCliJson(
            encodeCliJsonSuccess("billing.ingress.replay", report)
          )
        );
        return;
      }
      ctx.logRaw(JSON.stringify(report, null, 2));
      return;
    }
    if (parsed.command === "billing-webhooks") {
      const report = await spanCli(
        ctx,
        "billing.webhooks",
        { action: parsed.action, dryRun: parsed.dryRun },
        () =>
          executeBillingWebhooks({
            cwd: runtime.cwd ?? ctx.cwd,
            parsed,
          })
      );
      if (parsed.json || ctx.output === "json") {
        log(stringifyCliJson(encodeCliJsonSuccess("billing.webhooks", report)));
        return;
      }
      ctx.logRaw(
        typeof report === "string" ? report : JSON.stringify(report, null, 2)
      );
      return;
    }
    const execute =
      runtime.runBillingReconcileSubjects ?? executeBillingReconcileSubjects;
    const report = await spanCli(
      ctx,
      "billing.reconcile-subjects",
      { dryRun: parsed.dryRun, provider: parsed.provider },
      () =>
        execute({
          cwd: runtime.cwd ?? ctx.cwd,
          parsed,
        })
    );
    if (parsed.json || ctx.output === "json") {
      log(
        stringifyCliJson(
          encodeCliJsonSuccess("billing.reconcile-subjects", report)
        )
      );
      return;
    }
    ctx.logRaw(formatBillingImportReport(report));
  } catch (error) {
    ctx.reportError(error, {
      commandId: parsed.command,
      phase: "command",
    });
    setCliExitCode(exitCodeForError(error));
    if (error instanceof AthenaCliError) {
      logCliError(formatAthenaCliError(error), errorLog, capabilities);
      return;
    }
    logCliError(formatGeneratorError(error), errorLog, capabilities);
  }
}
