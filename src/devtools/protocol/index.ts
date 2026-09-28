/**
 * Public Athena DevTools protocol types (snapshot, events, panels, provenance, drift).
 *
 * Settings record configured vs inferred vs effective + source.
 * Provenance stages: source → normalization → inference → runtime.
 */

import type { AthenaDevtoolsAuthorizationInspector } from "./authorization.ts";
import type { AthenaDevtoolsBillingInspector } from "./billing.ts";
import type { AthenaDevtoolsCapabilitiesInspector } from "./capabilities.ts";
export type {
  AthenaDevtoolsCapabilitiesInspector,
  AthenaDevtoolsCapabilityEntry,
  AthenaDevtoolsCapabilitySource,
} from "./capabilities.ts";

export const ATHENA_DEVTOOLS_PROTOCOL_VERSION = 3 as const;

export const ATHENA_DEVTOOLS_REQUEST_HEADER = "x-athena-devtools";
export const ATHENA_DEVTOOLS_TRACE_HEADER = "x-athena-trace-id";
export const ATHENA_DEVTOOLS_REQUEST_ID_HEADER = "x-athena-request-id";
/** Retired bulky transport. Mutation responses must not set this header. */
export const ATHENA_DEVTOOLS_DATA_HEADER = "x-athena-data-nucleus";

export const ATHENA_DEVTOOLS_EVENTS_PATH = "/api/athena/devtools/v1/events";
export const ATHENA_DEVTOOLS_STREAM_PATH = "/api/athena/devtools/v1/stream";

export const ATHENA_DEVTOOLS_PANEL_IDS = [
  "overview",
  "runtime",
  "configuration",
  "models",
  "migrations",
  "data",
  "queries",
  "policy",
  "auth",
  "authorization",
  "storage",
  "billing",
  "network",
  "traces",
  "packages",
  "diagnostics",
] as const;

export type AthenaDevtoolsPanelId = (typeof ATHENA_DEVTOOLS_PANEL_IDS)[number];

export type AthenaDevtoolsPanelPhase = "P0" | "P1" | "P2";

export type AthenaDevtoolsPanelStatus = "ready" | "stub";

export type AthenaDevtoolsPanelEntry = {
  panelId: AthenaDevtoolsPanelId;
  phase: AthenaDevtoolsPanelPhase;
  status: AthenaDevtoolsPanelStatus;
};

export type AthenaDevtoolsDriftKind =
  | "model-drift"
  | "missing-table"
  | "missing-column"
  | "type-mismatch"
  | "unapplied-migration"
  | "orphan-column";

export type AthenaDevtoolsMigrationGeneratedBy =
  | "Manual"
  | "Auth"
  | "Billing"
  | "Storage";

export type AthenaDevtoolsPresence = "set" | "unset";

export type AthenaDevtoolsInferredPresence =
  | AthenaDevtoolsPresence
  | "not-applicable";

export type AthenaDevtoolsSettingSource =
  | "athena.config.ts"
  | "createClient"
  | "env"
  | "trustedOrigins"
  | "localhost-dev-default"
  | "runtime-plan"
  | "unset";

export type AthenaDevtoolsRedactedFact =
  | { kind: "structural"; value: string | boolean | number | null }
  | { kind: "secret"; configured: boolean }
  | { kind: "unset" };

export type AthenaDevtoolsSettingProvenance = {
  path: string;
  configured: AthenaDevtoolsPresence;
  inferred: AthenaDevtoolsInferredPresence;
  effective: AthenaDevtoolsPresence;
  source: AthenaDevtoolsSettingSource;
  stages: {
    source: AthenaDevtoolsRedactedFact;
    normalization: AthenaDevtoolsRedactedFact;
    inference: AthenaDevtoolsRedactedFact;
    runtime: AthenaDevtoolsRedactedFact;
  };
};

export type AthenaDevtoolsDataTimings = {
  afterHooksMs: number | null;
  authorizeMs: number | null;
  beforeHooksMs: number | null;
  billing?: {
    phaseTimings: {
      checkpointMs?: number;
      projectionMs?: number;
      providerMs?: number;
      resolveMs?: number;
      transactionMs?: number;
    };
    providerResourceId?: string;
    resourceId?: string;
    resourceKind?: string;
  };
  executeMs: number | null;
  prepareMs: number | null;
  totalMs: number | null;
};

export type AthenaDevtoolsDataEvent = {
  affectedRows: number | null;
  connectionId?: string | null;
  correlationId?: string | null;
  domain?: "auth" | "billing" | "chat" | "data" | "storage" | null;
  errorPhase: string | null;
  event: string;
  eventId: string | null;
  organizationId?: string | null;
  operation: string;
  outcome?: string | null;
  policyIds: string[] | null;
  policyOutcome: string | null;
  principal: {
    authority: string | null;
  };
  provider?: string | null;
  requestId: string | null;
  resource: string | null;
  roomId?: string | null;
  roomSeq?: number | null;
  timings: AthenaDevtoolsDataTimings;
  traceId: string | null;
  transactionSemantics: "atomic" | "backend-managed" | "unknown" | null;
};

export type AthenaDevtoolsModelField = {
  name: string;
  type: string;
};

export type AthenaDevtoolsModelRelation = {
  kind: string;
  name: string;
  targetModel: string;
};

export type AthenaDevtoolsModelTable = {
  fields: AthenaDevtoolsModelField[];
  identity: string;
  name: string;
  primaryKey: string[];
  relations: AthenaDevtoolsModelRelation[];
  schema: string;
  schemaTable: string;
  table: string;
};

export type AthenaDevtoolsDriftEntry = {
  kind: AthenaDevtoolsDriftKind;
  object: string;
};

export type AthenaDevtoolsModelsInspector = {
  drift: AthenaDevtoolsDriftEntry[];
  liveCatalog: "available" | "unavailable";
  tables: AthenaDevtoolsModelTable[];
};

export type AthenaDevtoolsMigrationRecord = {
  filename?: string;
  generatedBy: AthenaDevtoolsMigrationGeneratedBy;
  name?: string;
  version?: number;
};

export type AthenaDevtoolsMigrationSubsystemStatus = {
  generatedBy: AthenaDevtoolsMigrationGeneratedBy;
  status: "applied" | "pending" | "unknown" | "drift";
};

export type AthenaDevtoolsMigrationsInspector = {
  applied: AthenaDevtoolsMigrationRecord[];
  files: AthenaDevtoolsMigrationRecord[];
  generatedBy: AthenaDevtoolsMigrationGeneratedBy[];
  latestApplied: string | number | null;
  localFileCount: number;
  pending: AthenaDevtoolsMigrationRecord[];
  schemaVersion: number;
  subsystems: {
    auth: AthenaDevtoolsMigrationSubsystemStatus;
    billing: AthenaDevtoolsMigrationSubsystemStatus;
    storage: AthenaDevtoolsMigrationSubsystemStatus;
  };
  version: number;
};

export type AthenaDevtoolsPackageProvenance = {
  buildRevision: string | null;
  buildTimestamp: string;
  dirty: boolean;
  name: string;
  version: string;
};

export type AthenaDevtoolsSnapshot = {
  authorization: AthenaDevtoolsAuthorizationInspector;
  billing: AthenaDevtoolsBillingInspector;
  capabilities: AthenaDevtoolsCapabilitiesInspector;
  configuration: {
    settings: AthenaDevtoolsSettingProvenance[];
  };
  migrations: AthenaDevtoolsMigrationsInspector;
  models: AthenaDevtoolsModelsInspector;
  overview: {
    packages: readonly AthenaDevtoolsPackageProvenance[];
    protocolVersion: typeof ATHENA_DEVTOOLS_PROTOCOL_VERSION;
  };
  packages: readonly AthenaDevtoolsPackageProvenance[];
  panels: AthenaDevtoolsPanelEntry[];
  protocolVersion: typeof ATHENA_DEVTOOLS_PROTOCOL_VERSION;
};

export type {
  AthenaDevtoolsAuthorizationCatalogEntry,
  AthenaDevtoolsAuthorizationDecisionInspector,
  AthenaDevtoolsAuthorizationDiagnostic,
  AthenaDevtoolsAuthorizationGrantInspector,
  AthenaDevtoolsAuthorizationInspector,
  AthenaDevtoolsAuthorizationRightDescriptor,
  AthenaDevtoolsAuthorizationRoleInspector,
  AthenaDevtoolsAuthorizationStatus,
  AthenaDevtoolsResolvedRight,
} from "./authorization.ts";
export type {
  AthenaDevtoolsAuthorizationEvent,
  AthenaDevtoolsAuthorizationEventName,
} from "./authorization-events.ts";
export type {
  AthenaDevtoolsAuthorizationExplainInput,
  AthenaDevtoolsAuthorizationExplainResult,
  AthenaDevtoolsAuthorizationWhatIfInput,
  AthenaDevtoolsAuthorizationWhatIfResult,
} from "./authorization-explain.ts";
export {
  explainAthenaAuthorization,
  simulateAthenaAuthorizationWhatIf,
} from "./authorization-explain.ts";
export type {
  AthenaDevtoolsBillingCapabilityInspector,
  AthenaDevtoolsBillingCheckoutInspector,
  AthenaDevtoolsBillingConnectionInspector,
  AthenaDevtoolsBillingDiagnosticCode,
  AthenaDevtoolsBillingEventTimings,
  AthenaDevtoolsBillingHealthInspector,
  AthenaDevtoolsBillingIdentityConflict,
  AthenaDevtoolsBillingIdentityRoute,
  AthenaDevtoolsBillingIngressInspector,
  AthenaDevtoolsBillingInspector,
  AthenaDevtoolsBillingInspectorStatus,
  AthenaDevtoolsBillingInvoiceInspector,
  AthenaDevtoolsBillingPaymentInspector,
  AthenaDevtoolsBillingReconciliationInspector,
  AthenaDevtoolsBillingRuntimePhase,
  AthenaDevtoolsBillingSubjectBindingInspector,
  AthenaDevtoolsBillingSubscriptionInspector,
  AthenaDevtoolsBillingWebhookInspector,
} from "./billing.ts";
