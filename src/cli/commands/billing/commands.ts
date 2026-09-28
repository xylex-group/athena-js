import type { CommandContext } from "../../command-context.ts";
import { defineCommand } from "../../platform/define-command.ts";
import type {
  BillingIngressReplayCommand,
  BillingWebhooksCommand,
  CliCommand,
} from "../../types.ts";
import {
  type BillingReconcileSubjectsCommand,
  parse,
  parseBillingIngressReplay,
  parseBillingWebhooksFlags,
  run,
  usage,
} from "./index.ts";

export const billingCommands = [
  defineCommand({
    legacy: "billing-reconcile-subjects" as CliCommand["command"],
    parse,
    path: ["billing"],
    run: (ctx: CommandContext, parsed: CliCommand) =>
      run(
        ctx,
        parsed as
          | BillingReconcileSubjectsCommand
          | BillingWebhooksCommand
          | BillingIngressReplayCommand
      ),
    usage,
  }),
  defineCommand({
    legacy: "billing-reconcile-subjects" as CliCommand["command"],
    parse,
    path: ["billing", "reconcile-subjects"],
    run: (ctx: CommandContext, parsed: CliCommand) =>
      run(ctx, parsed as BillingReconcileSubjectsCommand),
    usage,
  }),
  defineCommand({
    legacy: "billing-webhooks" as CliCommand["command"],
    parse: (rest) => parseBillingWebhooksFlags("status", rest),
    path: ["billing", "webhooks", "status"],
    run: (ctx: CommandContext, parsed: CliCommand) =>
      run(ctx, parsed as BillingWebhooksCommand),
    usage,
  }),
  defineCommand({
    legacy: "billing-webhooks" as CliCommand["command"],
    parse: (rest) => parseBillingWebhooksFlags("reconcile", rest),
    path: ["billing", "webhooks", "reconcile"],
    run: (ctx: CommandContext, parsed: CliCommand) =>
      run(ctx, parsed as BillingWebhooksCommand),
    usage,
  }),
  defineCommand({
    legacy: "billing-webhooks" as CliCommand["command"],
    parse: (rest) => parseBillingWebhooksFlags("status", rest),
    path: ["billing", "ingestion", "health"],
    run: (ctx: CommandContext, parsed: CliCommand) =>
      run(ctx, parsed as BillingWebhooksCommand),
    usage,
  }),
  defineCommand({
    legacy: "billing-webhooks" as CliCommand["command"],
    parse: (rest) => parseBillingWebhooksFlags("verify", rest),
    path: ["billing", "webhooks", "verify"],
    run: (ctx: CommandContext, parsed: CliCommand) =>
      run(ctx, parsed as BillingWebhooksCommand),
    usage,
  }),
  defineCommand({
    legacy: "billing-ingress-replay" as CliCommand["command"],
    parse: parseBillingIngressReplay,
    path: ["billing", "ingress", "replay"],
    run: (ctx: CommandContext, parsed: CliCommand) =>
      run(ctx, parsed as BillingIngressReplayCommand),
    usage,
  }),
];
