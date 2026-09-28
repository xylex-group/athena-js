import type { AthenaAuthCapabilitiesResult } from "../auth/capabilities.ts";
import { authCapabilitiesToContributions } from "../auth/capability-contributions.ts";
import type { AthenaClientCapabilities } from "../cloudflare/types.ts";
import type { AthenaChatCapabilities } from "../chat/types.ts";
import { chatCapabilitiesToContributions } from "../chat/capability-contributions.ts";
import { transactionCapabilitiesToContributions } from "../db/transaction/capability-contributions.ts";
import type { BillingCapabilities } from "../billing/runtime/capabilities.ts";
import {
  billingCapabilitiesToContributions,
  billingRuntimeUnknownContributions,
} from "../billing/runtime/capability-contributions.ts";
import {
  capabilityContribution,
  unconfiguredCapabilityContribution,
  unsupportedCapabilityContribution,
} from "./contribution.ts";
import type { AthenaCapabilitiesIr } from "./types.ts";
import type { AthenaCapabilityContribution } from "./resolver.ts";
import { resolveAthenaCapabilities } from "./resolver.ts";
import type { AthenaQueryCapabilityMatrix } from "../query/engine/capabilities.ts";
import { queryCapabilitiesToContributions } from "../query/engine/capability-contributions.ts";
import type { AthenaStorageCapabilityFacts } from "../storage/runtime/capability-contributions.ts";
import { storageCapabilitiesToContributions } from "../storage/runtime/capability-contributions.ts";

function knownRuntimeFact(
  key: string,
  domain: "data" | "storage",
  enabled: boolean,
  source: { kind: "runtime"; source: string },
  onFalse: "unsupported" | "unconfigured" = "unsupported"
): AthenaCapabilityContribution {
  const input = { key, domain, kind: "operation" as const };
  if (enabled) return capabilityContribution(input, source);
  return onFalse === "unconfigured"
    ? unconfiguredCapabilityContribution(input, source)
    : unsupportedCapabilityContribution(input, source);
}

export interface ResolveAthenaClientCapabilitiesInput {
  base: AthenaClientCapabilities;
  query: AthenaQueryCapabilityMatrix;
  auth?: AthenaAuthCapabilitiesResult;
  billing?: BillingCapabilities;
  billingProvider?: string;
  chat?: AthenaChatCapabilities;
  storage?: AthenaStorageCapabilityFacts;
}

export function resolveAthenaClientCapabilitiesIr(
  input: ResolveAthenaClientCapabilitiesInput
): AthenaCapabilitiesIr {
  const source = { kind: "runtime" as const, source: "client-construction" };
  const contributions: AthenaCapabilityContribution[] = [
    ...(["fetch", "insert", "update", "delete"] as const).map((operation) =>
      knownRuntimeFact(
        `data.operation.${operation}`,
        "data",
        input.base.db.layers.flatCrud,
        source
      )
    ),
    knownRuntimeFact(
      "data.operation.rpc",
      "data",
      input.base.db.layers.rpc,
      source
    ),
    ...transactionCapabilitiesToContributions(input.base.db.transactions),
    ...queryCapabilitiesToContributions(input.query),
    ...(input.storage
      ? storageCapabilitiesToContributions(input.storage)
      : [
          ...(["get", "put", "list", "delete"] as const).map((operation) =>
            knownRuntimeFact(
              `storage.object.${operation}`,
              "storage",
              input.base.storage.objects,
              source,
              "unconfigured"
            )
          ),
          knownRuntimeFact(
            "storage.catalog.read",
            "storage",
            input.base.storage.catalogs,
            source,
            "unconfigured"
          ),
          knownRuntimeFact(
            "storage.backup.create",
            "storage",
            input.base.storage.backups,
            source,
            "unconfigured"
          ),
        ]),
    ...(input.auth ? authCapabilitiesToContributions(input.auth) : []),
    ...(input.billing
      ? billingCapabilitiesToContributions(input.billing)
      : input.billingProvider
        ? billingRuntimeUnknownContributions(input.billingProvider)
        : []),
    ...(input.chat ? chatCapabilitiesToContributions(input.chat) : []),
  ];
  return resolveAthenaCapabilities(contributions);
}
