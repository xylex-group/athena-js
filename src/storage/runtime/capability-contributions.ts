import {
  capabilityContribution,
  unconfiguredCapabilityContribution,
  unsupportedCapabilityContribution,
} from "../../capabilities/contribution.ts";
import type { AthenaCapabilityContribution } from "../../capabilities/resolver.ts";

export interface AthenaStorageCapabilityFacts {
  backups: boolean;
  catalogs: boolean;
  objects: boolean;
  source: string;
}

export function storageCapabilitiesToContributions(
  input: AthenaStorageCapabilityFacts
): AthenaCapabilityContribution[] {
  const source = { kind: "runtime" as const, source: `storage:${input.source}` };
  const factEntries: readonly (readonly [string, boolean])[] = [
    ["storage.object.get", input.objects],
    ["storage.object.put", input.objects],
    ["storage.object.list", input.objects],
    ["storage.object.delete", input.objects],
    ["storage.catalog.read", input.catalogs],
    ["storage.backup.create", input.backups],
  ];
  return factEntries.map(([key, enabled]) => {
    const contribution = {
      key,
      domain: "storage" as const,
      kind: "operation" as const,
    };
    if (enabled) return capabilityContribution(contribution, source);
    return input.source === "none"
      ? unconfiguredCapabilityContribution(contribution, source)
      : unsupportedCapabilityContribution(contribution, source);
  });
}
