/**
 * Root-client internals. Frozen public clients cannot grow properties.
 * Request views from withContext do not share this map — pass the root.
 */

import type { AthenaGatewayClient } from "../gateway/client.ts";
import type { AthenaClientConfig } from "../v3-client-core.ts";
import type { AthenaRuntimeAuthSessionStore } from "./data/principal.ts";
import type { ResolvedAthenaRuntime } from "./resolve.ts";

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
  plan: ResolvedAthenaRuntime;
  postgresRuntime?: AthenaClientOwnedRuntime;
  /** Views share runtime resources but are not the root owner. */
  source?: "root" | "view";
}

const internalsByClient = new WeakMap<object, AthenaClientInternals>();

const ROOT_INTERNALS = Symbol.for("@xylex-group/athena.clientInternals");

type ClientWithInternals = object & {
  [ROOT_INTERNALS]?: AthenaClientInternals;
};

export function attachAthenaClientInternals(
  client: object,
  internals: AthenaClientInternals
): void {
  internalsByClient.set(client, internals);
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
    internalsByClient.get(client) ??
    (client as ClientWithInternals)[ROOT_INTERNALS]
  );
}

export function requireAthenaRootClientInternals(
  client: object,
  caller: string
): AthenaClientInternals {
  const internals = getAthenaClientInternals(client);
  if (internals && internals.source !== "view") {
    return internals;
  }
  throw new Error(
    `${caller} requires the root createClient instance. Request views from withContext / createAthenaServerClient({ client }) do not carry handler internals.`
  );
}
