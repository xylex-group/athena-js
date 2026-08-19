/**
 * Root-client internals. Frozen public clients cannot grow properties.
 * Request views from withContext do not share this map — pass the root.
 */

import { PACKAGE_VERSION } from "../sdk-version.ts";
import type { AthenaGatewayClient } from "../gateway/client.ts";
import type { AthenaClientConfig } from "../v3-client-core.ts";
import type { AthenaRuntimeAuthSessionStore } from "./data/principal.ts";
import type { ResolvedAthenaRuntime } from "./resolve.ts";
import {
  ATHENA_CLIENT_INTERNAL_PROTOCOL,
  type AthenaClientLifecycle,
  type AthenaClientOwnership,
  type AthenaRuntimeDiagnostics,
  type AthenaRuntimeResourceOwnership,
  AthenaRuntimeOwnershipError,
  createAthenaClientLifecycle,
  describeAthenaRuntime,
} from "./ownership.ts";

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
}

export interface AthenaClientOwnedRuntime {
  close(): Promise<void>;
  getPool(): Promise<unknown>;
  readonly ownership: "owned" | "borrowed";
}

export interface AthenaClientInternals {
  authRuntime?: AthenaClientAuthRuntime;
  close?: () => Promise<void>;
  config: AthenaClientConfig;
  gatewayTransport?: AthenaGatewayClient;
  getAuthStores?: () => Promise<AthenaRuntimeAuthSessionStore>;
  internalProtocolVersion: number;
  lifecycle: AthenaClientLifecycle;
  ownership: AthenaClientOwnership;
  parent?: object;
  plan: ResolvedAthenaRuntime;
  postgresRuntime?: AthenaClientOwnedRuntime;
  runtimeOwnership: AthenaRuntimeResourceOwnership;
  sdkVersion: string;
  /**
   * @deprecated Use `ownership`. Kept in sync for older internals readers.
   */
  source?: AthenaClientOwnership;
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
  return {
    ...partial,
    internalProtocolVersion: ATHENA_CLIENT_INTERNAL_PROTOCOL,
    lifecycle,
    ownership: "root",
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
    ownership: "view",
    parent,
    runtimeOwnership: "borrowed",
    source: "view",
  };
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
  if (internals.ownership !== "view" && internals.source !== "view") {
    return internals;
  }
  throw new AthenaRuntimeOwnershipError({
    caller,
    code: "ATHENA_HANDLER_ROOT_CLIENT_REQUIRED",
    message: `${caller} requires the process-wide Athena root.\n\n${ATHENA_HANDLER_ROOT_CLIENT_REQUIRED_MESSAGE}`,
    received: "request-view",
  });
}

/** Test/debug helper — not a product observability API. */
export function getAthenaRuntimeDiagnostics(
  client: object
): AthenaRuntimeDiagnostics | undefined {
  const internals = getAthenaClientInternals(client);
  if (!internals) {
    return undefined;
  }
  return describeAthenaRuntime(
    internals.ownership,
    internals.runtimeOwnership,
    internals.lifecycle
  );
}

export {
  ATHENA_CLIENT_INTERNAL_PROTOCOL,
  AthenaRuntimeOwnershipError,
  createAthenaClientLifecycle,
} from "./ownership.ts";
export type {
  AthenaClientLifecycle,
  AthenaClientOwnership,
  AthenaRuntimeDiagnostics,
  AthenaRuntimeResourceOwnership,
} from "./ownership.ts";
