import type { AthenaCapabilityContribution } from "../../capabilities/resolver.ts";
import {
  capabilityContribution,
  unsupportedCapabilityContribution,
} from "../../capabilities/contribution.ts";
import type { AthenaTransactionCapabilities } from "./types.ts";

export function transactionCapabilitiesToContributions(
  capabilities: AthenaTransactionCapabilities
): AthenaCapabilityContribution[] {
  const source = {
    kind: "catalog" as const,
    source: `transaction:${capabilities.backend}`,
  };
  const facts: readonly (readonly [string, boolean])[] = [
    ["data.transaction.atomic", capabilities.atomic],
    ["data.transaction.interactive", capabilities.interactive],
    ["data.transaction.savepoints", capabilities.savepoints],
    ["data.transaction.read-only", capabilities.readOnly],
    ["data.transaction.deferrable", capabilities.deferrable],
  ];
  return facts.map(([key, enabled]) =>
    enabled
      ? capabilityContribution(
          { key, domain: "data", kind: "semantic" },
          source
        )
      : unsupportedCapabilityContribution(
          { key, domain: "data", kind: "semantic" },
          source
        )
  );
}
