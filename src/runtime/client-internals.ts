/**
 * Root-client internals. Frozen public clients cannot grow properties.
 * Request views from withContext do not share this map — pass the root.
 */

import type { BillingSchedulerHandle } from "../billing/reconciliation/scheduler.ts";
import type {
  AthenaBillingDiagnostics,
  AthenaBillingInspectedConnection,
} from "../billing/runtime/diagnostics.ts";
import type { AthenaBillingRuntimeDispatch } from "../billing/runtime/dispatch.ts";
import type { BillingProviderRegistry } from "../billing/runtime/local/providers/registry.ts";
import type { AthenaCapabilitiesIr } from "../capabilities/types.ts";
import type { AthenaGatewayClient } from "../gateway/client.ts";
import type { AthenaPostgresRuntime } from "../postgres/owned-runtime.ts";
import type { PostgresPoolManager } from "../postgres/pool/manager.ts";
import type { AthenaRightsAuthority } from "../rights/authority.ts";
import type { AthenaRightsIr } from "../rights/types.ts";
import type { AthenaRolesIr } from "../roles/types.ts";
import type { NormalizedAthenaAuthorizationConfig } from "./authorization/config.ts";
import type { AthenaAuthorizationModelIndex } from "./authorization/model-index.ts";
import { PACKAGE_VERSION } from "../sdk-version.ts";
import type { StorageRuntime } from "../storage/runtime/types.ts";
import type { AthenaClientConfig } from "../client/contracts.ts";
import { resolveAthenaAuthorizationIrState } from "./authorization/state.ts";
import type { AthenaRuntimeAuthSessionStore } from "./data/principal.ts";
import {
  ATHENA_CLIENT_INTERNAL_PROTOCOL,
  type AthenaClientLifecycle,
  type AthenaClientOwnership,
  type AthenaRuntimeDiagnostics,
  AthenaRuntimeOwnershipError,
  type AthenaRuntimeResourceOwnership,
  createAthenaClientLifecycle,
  describeAthenaRuntime,
} from "./ownership.ts";
import type { AthenaRuntimeReadiness } from "./readiness/index.ts";
import type { ResolvedAthenaRuntime } from "./resolve.ts";

export const ATHENA_HANDLER_ROOT_CLIENT_REQUIRED_MESSAGE = [
  "createAthenaNextHandlers({ client }) requires the process-wide Athena root.",
  "",
  "Received a request-scoped Athena client created by withContext() or",
  "createAthenaServerClient({ client }).",
  "",
  "Next.js local runtime pattern:",
  "",
  '  const root = createClient({ databaseUrl, auth: { mode: "local" } });',
  "",
  "Pass `root` directly to createAthenaNextHandlers().",
  "",
  "Use request-scoped clients only for application queries.",
].join("\n");

export const ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH_MESSAGE = [
  "This object is not an Athena root from this package instance.",
  "",
  "Typical causes:",
  "  - a request view (withContext / createAthenaServerClient)",
  "  - a client created by another copy of @xylex-group/athena",
  "  - a mocked object without root internals",
  "",
  "Install one Athena version and pass the process-wide createClient() root.",
].join("\n");

export interface AthenaClientAuthRuntime {
  close(): Promise<void>;
  getStores(): Promise<unknown>;
  getOAuthRuntimeJwtVerifier?: (
    resource: string
  ) => Promise<import("./data/principal.ts").AthenaRuntimeJwtVerifier>;
}

export interface AthenaClientOwnedRuntime {
  close(): Promise<void>;
  getPool(): Promise<unknown>;
  getPoolManager(): Promise<PostgresPoolManager>;
  readonly ownership: "owned" | "borrowed";
  query: AthenaPostgresRuntime["query"];
  transaction: AthenaPostgresRuntime["transaction"];
}

export interface AthenaClientInternals {
  authRuntime?: AthenaClientAuthRuntime;
  authorizationConfig?: NormalizedAthenaAuthorizationConfig;
  authorizationModelIndex?: AthenaAuthorizationModelIndex;
  billingBootstrapEvents?: string[];
  billingDiagnostics?: AthenaBillingDiagnostics;
  billingMaterializedConnections?: readonly AthenaBillingInspectedConnection[];
  billingPlanChangeRecoveryScheduler?: BillingSchedulerHandle;
  billingProviderRegistry?: BillingProviderRegistry;
  billingRuntime?: AthenaBillingRuntimeDispatch;
  billingRuntimeGeneration?: number;
  billingRuntimeOwnerKey?: string;
  billingSchedulerHandles?: BillingSchedulerHandle[];
  capabilitiesFingerprint?: string;
  /** Canonical runtime capability snapshot shared by compatibility projections. */
  capabilitiesIr?: AthenaCapabilitiesIr;
  close?: () => Promise<void>;
  config: AthenaClientConfig;
  eventIngressRuntime?: unknown;
  gatewayTransport?: AthenaGatewayClient;
  getAuthStores?: () => Promise<AthenaRuntimeAuthSessionStore>;
  getRolesIr?: () => Promise<AthenaRolesIr | undefined>;
  internalProtocolVersion: number;
  lifecycle: AthenaClientLifecycle;
  ownership: AthenaClientOwnership;
  parent?: object;
  plan: ResolvedAthenaRuntime;
  postgresRuntime?: AthenaClientOwnedRuntime;
  rightsAuthority?: AthenaRightsAuthority;
  rightsFingerprint?: string;
  /** Canonical authorization documents owned by this root application. */
  rightsIr?: AthenaRightsIr;
  rolesFingerprint?: string;
  rolesIr?: AthenaRolesIr;
  runtimeOwnership: AthenaRuntimeResourceOwnership;
  runtimeReadiness?: AthenaRuntimeReadiness;
  sdkVersion: string;
  /**
   * @deprecated Use `ownership`. Kept in sync for older internals readers.
   */
  source?: AthenaClientOwnership;
  storageRuntime?: StorageRuntime;
}

const ROOT_INTERNALS = Symbol.for("@xylex-group/athena.clientInternals");
const ROOT_INTERNALS_MAP = Symbol.for("@xylex-group/athena.clientInternalsMap");

function internalsByClient(): WeakMap<object, AthenaClientInternals> {
  const holder = globalThis as typeof globalThis & {
    [ROOT_INTERNALS_MAP]?: WeakMap<object, AthenaClientInternals>;
  };
  holder[ROOT_INTERNALS_MAP] ??= new WeakMap();
  return holder[ROOT_INTERNALS_MAP];
}

type ClientWithInternals = object & {
  [ROOT_INTERNALS]?: AthenaClientInternals;
};

export function attachAthenaClientInternals(
  client: object,
  internals: AthenaClientInternals
): void {
  internalsByClient().set(client, internals);
  try {
    Object.defineProperty(client, ROOT_INTERNALS, {
      configurable: true,
      enumerable: false,
      value: internals,
      writable: false,
    });
  } catch {
    // Frozen clients keep the WeakMap entry only.
  }
}

export function getAthenaClientInternals(
  client: object
): AthenaClientInternals | undefined {
  return (
    internalsByClient().get(client) ??
    (client as ClientWithInternals)[ROOT_INTERNALS]
  );
}

export function createRootClientInternals(
  partial: Omit<
    AthenaClientInternals,
    | "internalProtocolVersion"
    | "lifecycle"
    | "ownership"
    | "runtimeOwnership"
    | "sdkVersion"
    | "source"
  > & {
    lifecycle?: AthenaClientLifecycle;
    runtimeOwnership?: AthenaRuntimeResourceOwnership;
  }
): AthenaClientInternals {
  const lifecycle = partial.lifecycle ?? createAthenaClientLifecycle();
  const authorization = resolveAthenaAuthorizationIrState({
    rightsIr:
      partial.authorizationConfig?.rightsState.rightsIr ?? partial.rightsIr,
    rolesIr: partial.rolesIr,
  });
  return {
    ...partial,
    getRolesIr: partial.getRolesIr,
    internalProtocolVersion: ATHENA_CLIENT_INTERNAL_PROTOCOL,
    lifecycle,
    ownership: "root",
    rightsAuthority:
      partial.authorizationConfig?.rightsState.rightsAuthority ??
      authorization.rightsAuthority,
    rightsFingerprint:
      partial.rightsFingerprint ?? authorization.rightsFingerprint,
    rightsIr: authorization.rightsIr,
    rolesFingerprint:
      partial.rolesFingerprint ?? authorization.rolesFingerprint,
    rolesIr: authorization.rolesIr,
    runtimeOwnership: partial.runtimeOwnership ?? "owned",
    sdkVersion: PACKAGE_VERSION,
    source: "root",
  };
}

export function createViewClientInternals(
  parent: object,
  rootInternals: AthenaClientInternals
): AthenaClientInternals {
  rootInternals.lifecycle.requestViewsCreated += 1;
  return {
    ...rootInternals,
    close: undefined,
    ownership: "request",
    parent,
    runtimeOwnership: "borrowed",
    source: "request",
  };
}

export function isAthenaRequestRuntime(
  internals: AthenaClientInternals | undefined
): boolean {
  if (!internals) {
    return false;
  }
  return internals.ownership === "request" || internals.source === "request";
}

export function throwAthenaRuntimeOwnershipInvalid(caller: string): never {
  throw new AthenaRuntimeOwnershipError({
    caller,
    code: "ATHENA_RUNTIME_OWNERSHIP_INVALID",
    message: `${caller} requires the process-wide Athena root.\n\n${ATHENA_HANDLER_ROOT_CLIENT_REQUIRED_MESSAGE}`,
    received: "request-view",
  });
}

export function requireAthenaRootClientInternals(
  client: object,
  caller: string
): AthenaClientInternals {
  const internals = getAthenaClientInternals(client);
  if (!internals) {
    throw new AthenaRuntimeOwnershipError({
      caller,
      code: "ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH",
      message: `${caller} requires the process-wide Athena root.\n\n${ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH_MESSAGE}`,
      received: "foreign-runtime",
    });
  }
  if (internals.internalProtocolVersion !== ATHENA_CLIENT_INTERNAL_PROTOCOL) {
    throw new AthenaRuntimeOwnershipError({
      caller,
      code: "ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH",
      message: `${caller} received an Athena client from an incompatible runtime protocol (${String(internals.internalProtocolVersion)} ≠ ${String(ATHENA_CLIENT_INTERNAL_PROTOCOL)}).`,
      received: "foreign-runtime",
    });
  }
  if (!isAthenaRequestRuntime(internals)) {
    return internals;
  }
  throwAthenaRuntimeOwnershipInvalid(caller);
}

/** Bind request-view Auth so migrate exists but cannot own the root executor. */
export function attachRequestAuthLifecycleGuards(
  view: object,
  parent: object
): void {
  const parentServer = (
    parent as {
      auth?: {
        server?: {
          handle?: (request: Request) => Promise<Response>;
          handlers?: unknown;
          migrate?: () => Promise<void>;
        };
      };
    }
  ).auth?.server;
  if (!parentServer) {
    return;
  }
  const viewAuth = (view as { auth?: object }).auth;
  if (!viewAuth) {
    return;
  }
  Object.assign(viewAuth, {
    server: {
      handle: parentServer.handle,
      handlers: parentServer.handlers,
      migrate: async () => {
        throwAthenaRuntimeOwnershipInvalid("auth.server.migrate");
      },
    },
  });
}

/** Test/debug helper — not a product observability API. Root-only. */
export function getAthenaRuntimeDiagnostics(
  client: object
): AthenaRuntimeDiagnostics | undefined {
  const internals = getAthenaClientInternals(client);
  if (!internals) {
    return;
  }
  if (isAthenaRequestRuntime(internals)) {
    throwAthenaRuntimeOwnershipInvalid("getAthenaRuntimeDiagnostics");
  }
  return describeAthenaRuntime(
    internals.ownership,
    internals.runtimeOwnership,
    internals.lifecycle
  );
}

export type {
  AthenaClientLifecycle,
  AthenaClientOwnership,
  AthenaRequestRuntime,
  AthenaRootRuntime,
  AthenaRuntimeDiagnostics,
  AthenaRuntimeResourceOwnership,
} from "./ownership.ts";
export {
  ATHENA_CLIENT_INTERNAL_PROTOCOL,
  AthenaRuntimeOwnershipError,
  createAthenaClientLifecycle,
} from "./ownership.ts";
