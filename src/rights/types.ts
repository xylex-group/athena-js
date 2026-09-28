import type { AthenaRightKey } from "./key.ts";

export const ATHENA_RIGHTS_IR_KIND = "athena.rights" as const;
export const ATHENA_RIGHTS_IR_VERSION = 1 as const;

export type AthenaRightScopeKind = "self" | "organization" | "platform";

export type AthenaRightRiskLevel = "low" | "elevated" | "critical";

export interface AthenaRightDefinition {
  assignable: boolean;
  description: string;
  displayName: string;
  domain: string;
  key: AthenaRightKey;
  riskLevel: AthenaRightRiskLevel;
  scopeKind: AthenaRightScopeKind;
}

export interface AthenaRightsMetadata {
  provenance?: readonly string[];
}

export interface AthenaRightsIr {
  kind: typeof ATHENA_RIGHTS_IR_KIND;
  irVersion: typeof ATHENA_RIGHTS_IR_VERSION;
  metadata: AthenaRightsMetadata;
  rights: readonly AthenaRightDefinition[];
}
