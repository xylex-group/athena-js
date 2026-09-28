import {
  canonicalizeDocument,
  coverageAthenaPolicy,
  explainAthenaPolicy,
  fingerprintDocument,
  lintAthenaPolicy,
  simulateAthenaPolicy,
} from "../../../policy/index.ts";
import { validatePolicyDefinition } from "../../../policy/validate-ir.ts";
import type { CommandContext } from "../../command-context.ts";
import { formatCatalogTopicUsage } from "../../commands-catalog.ts";
import { unknownOptionError } from "../../parse-helpers.ts";
import {
  encodeCliJsonSuccess,
  stringifyCliJson,
} from "../../platform/index.ts";
import type { CliCommand, PolicyDxCommand } from "../../types.ts";
import { loadPolicyDocument } from "./load.ts";

export { policyCatalog, policyCatalog as catalog } from "./catalog.ts";

export const names: readonly string[] = ["policy"];

const POLICY_ACTIONS = [
  "list",
  "show",
  "validate",
  "lint",
  "coverage",
  "explain",
  "simulate",
  "fingerprint",
  "export",
] as const;

type PolicyAction = (typeof POLICY_ACTIONS)[number];

function isPolicyAction(value: string): value is PolicyAction {
  return (POLICY_ACTIONS as readonly string[]).includes(value);
}

function commandId(
  action: PolicyAction | undefined
): PolicyDxCommand["command"] {
  if (!action || action === "list") {
    return action === "list" ? "policy-list" : "policy";
  }
  return `policy-${action}` as PolicyDxCommand["command"];
}

export function parse(rest: string[]): CliCommand {
  const head = rest[0];
  if (
    head === undefined ||
    head === "help" ||
    head === "--help" ||
    head === "-h"
  ) {
    if (head === "help" || head === "--help" || head === "-h") {
      return { command: "help", topic: "policy" };
    }
    return { command: "policy" };
  }
  if (!isPolicyAction(head)) {
    throw unknownOptionError(head, "policy");
  }
  return parseFlags(head, rest.slice(1));
}

function parseFlags(
  action: PolicyAction,
  rest: readonly string[]
): PolicyDxCommand {
  let configPath: string | undefined;
  let format: "ir" | undefined;
  let id: string | undefined;
  let json = false;
  let policyAction: string | undefined;
  let resource: string | undefined;
  let row: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "policy" } as never;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--config") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --config option.");
      }
      configPath = nextValue;
      index += 1;
      continue;
    }
    if (token === "--format") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --format option.");
      }
      if (nextValue !== "ir") {
        throw unknownOptionError(`--format ${nextValue}`, "policy export");
      }
      format = "ir";
      index += 1;
      continue;
    }
    if (token === "--id") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --id option.");
      }
      id = nextValue;
      index += 1;
      continue;
    }
    if (token === "--action") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --action option.");
      }
      policyAction = nextValue;
      index += 1;
      continue;
    }
    if (token === "--resource") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --resource option.");
      }
      resource = nextValue;
      index += 1;
      continue;
    }
    if (token === "--row") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --row option.");
      }
      row = nextValue;
      index += 1;
      continue;
    }
    throw unknownOptionError(token ?? "", `policy ${action}`);
  }

  if (action === "export") {
    return {
      action: policyAction,
      command: "policy-export",
      configPath,
      format: format ?? "ir",
      id,
      json,
      resource,
      row,
    };
  }

  return {
    action: policyAction,
    command: commandId(action),
    configPath,
    format,
    id,
    json,
    resource,
    row,
  };
}

export function usage(): string {
  return formatCatalogTopicUsage("policy");
}

function wantsJson(ctx: CommandContext, parsed: PolicyDxCommand): boolean {
  return ctx.output === "json" || parsed.json === true;
}

function parseRow(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--row must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export async function run(
  ctx: CommandContext,
  parsed: PolicyDxCommand
): Promise<void> {
  const loaded = await loadPolicyDocument({
    configPath: parsed.configPath,
    cwd: ctx.cwd,
  });
  const document = loaded.document;
  const json = wantsJson(ctx, parsed);
  const verb =
    parsed.command === "policy" || parsed.command === "policy-list"
      ? "list"
      : parsed.command.replace("policy-", "");

  if (verb === "list") {
    const rows = document.policies.map((item) => ({
      actions: item.actions,
      id: item.id,
      resource: item.resource,
    }));
    if (json) {
      ctx.log(
        stringifyCliJson(
          encodeCliJsonSuccess("policy.list", { policies: rows })
        )
      );
      return;
    }
    ctx.logRaw(rows.map((item) => item.id).join("\n") || "(no policies)");
    return;
  }

  if (verb === "show") {
    const match = document.policies.find((item) => item.id === parsed.id);
    if (json) {
      ctx.log(
        stringifyCliJson(
          encodeCliJsonSuccess("policy.show", { policy: match ?? null })
        )
      );
      return;
    }
    ctx.logRaw(JSON.stringify(match ?? null, null, 2));
    return;
  }

  if (verb === "validate") {
    for (const policy of document.policies) {
      validatePolicyDefinition(policy);
    }
    if (json) {
      ctx.log(
        stringifyCliJson(
          encodeCliJsonSuccess("policy.validate", {
            count: document.policies.length,
            ok: true,
          })
        )
      );
      return;
    }
    ctx.logRaw(`ok (${document.policies.length} policies)`);
    return;
  }

  if (verb === "lint") {
    const report = lintAthenaPolicy(document);
    if (json) {
      ctx.log(stringifyCliJson(encodeCliJsonSuccess("policy.lint", report)));
      return;
    }
    ctx.logRaw(JSON.stringify(report.findings, null, 2));
    return;
  }

  if (verb === "coverage") {
    const report = coverageAthenaPolicy(document);
    if (json) {
      ctx.log(
        stringifyCliJson(encodeCliJsonSuccess("policy.coverage", report))
      );
      return;
    }
    ctx.logRaw(JSON.stringify(report.cells, null, 2));
    return;
  }

  if (verb === "explain") {
    const explained = explainAthenaPolicy({
      action: (parsed.action as "select") ?? "select",
      document,
      resource: parsed.resource ?? "",
    });
    if (json) {
      ctx.log(
        stringifyCliJson(encodeCliJsonSuccess("policy.explain", explained))
      );
      return;
    }
    ctx.logRaw(JSON.stringify(explained, null, 2));
    return;
  }

  if (verb === "simulate") {
    const simulated = simulateAthenaPolicy({
      action: (parsed.action as "select") ?? "select",
      document,
      resource: parsed.resource ?? "",
      row: parseRow(parsed.row),
    });
    if (json) {
      ctx.log(
        stringifyCliJson(encodeCliJsonSuccess("policy.simulate", simulated))
      );
      return;
    }
    ctx.logRaw(JSON.stringify(simulated, null, 2));
    return;
  }

  if (verb === "fingerprint") {
    const fingerprint = fingerprintDocument(document);
    if (json) {
      ctx.log(
        stringifyCliJson(
          encodeCliJsonSuccess("policy.fingerprint", { fingerprint })
        )
      );
      return;
    }
    ctx.logRaw(fingerprint);
    return;
  }

  if (verb === "export") {
    const canonical = canonicalizeDocument(document);
    const bytes = JSON.stringify(canonical);
    ctx.logRaw(bytes);
  }
}
