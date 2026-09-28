/**
 * Client ownership vs resource ownership.
 *
 *   ownership          — is this object a root or a request runtime?
 *   runtimeOwnership   — does this object own / borrow / have no runtime resources?
 *   lifecycle.runtimeId — shared identity across root + views
 */

import { AthenaConfigurationError } from "../config/errors.ts";
import { PACKAGE_VERSION } from "../sdk-version.ts";

export const ATHENA_CLIENT_INTERNAL_PROTOCOL = 1;

/** Process-wide client: owns pools, embedded Auth, migrate, close, handlers. */
export interface AthenaRootRuntime {
  readonly ownership: "root";
}

/** Request-scoped view: borrows root resources and must not own lifecycle. */
export interface AthenaRequestRuntime {
  readonly ownership: "request";
}

export type AthenaClientOwnership = "root" | "request";
export type AthenaRuntimeResourceOwnership = "owned" | "borrowed" | "none";
export type AthenaOwnershipReceived =
  | "request-view"
  | "unknown"
  | "foreign-runtime";

export interface AthenaClientLifecycle {
  closed: boolean;
  requestViewsCreated: number;
  readonly runtimeId: symbol;
}

export interface AthenaRuntimeDiagnostics {
  authRuntimesCreated: number;
  closed: boolean;
  internalProtocolVersion: number;
  ownership: AthenaClientOwnership;
  postgresPoolsCreated: number;
  requestViewsCreated: number;
  runtimeId: string;
  runtimeOwnership: AthenaRuntimeResourceOwnership;
  sdkVersion: string;
}

export class AthenaRuntimeOwnershipError extends AthenaConfigurationError {
  readonly caller: string;
  readonly expected: "root";
  readonly received: AthenaOwnershipReceived;

  constructor(options: {
    caller: string;
    code?:
      | "ATHENA_RUNTIME_OWNERSHIP_INVALID"
      | "ATHENA_HANDLER_ROOT_CLIENT_REQUIRED"
      | "ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH";
    message: string;
    received: AthenaOwnershipReceived;
  }) {
    super(
      options.code ?? "ATHENA_RUNTIME_OWNERSHIP_INVALID",
      options.message,
      "db"
    );
    this.name = "AthenaRuntimeOwnershipError";
    this.caller = options.caller;
    this.expected = "root";
    this.received = options.received;
  }
}

export function createAthenaClientLifecycle(): AthenaClientLifecycle {
  return {
    closed: false,
    requestViewsCreated: 0,
    runtimeId: Symbol("athena.runtime"),
  };
}

const COUNTERS = Symbol.for("@xylex-group/athena.runtimeCounters");

export interface AthenaRuntimeCounters {
  authRuntimesCreated: number;
  postgresPoolsCreated: number;
  runtimePlansMaterialized: number;
}

export function athenaRuntimeCounters(): AthenaRuntimeCounters {
  const holder = globalThis as typeof globalThis & {
    [COUNTERS]?: AthenaRuntimeCounters;
  };
  holder[COUNTERS] ??= {
    authRuntimesCreated: 0,
    postgresPoolsCreated: 0,
    runtimePlansMaterialized: 0,
  };
  return holder[COUNTERS];
}

export function recordPostgresPoolCreated(): void {
  athenaRuntimeCounters().postgresPoolsCreated += 1;
}

export function recordAuthRuntimeCreated(): void {
  athenaRuntimeCounters().authRuntimesCreated += 1;
}

export function recordRuntimePlanMaterialized(): void {
  athenaRuntimeCounters().runtimePlansMaterialized += 1;
}

export function formatRuntimeId(runtimeId: symbol): string {
  return runtimeId.description
    ? `${runtimeId.description}:${String(runtimeId).slice(7, 15)}`
    : String(runtimeId);
}

export function describeAthenaRuntime(
  ownership: AthenaClientOwnership,
  runtimeOwnership: AthenaRuntimeResourceOwnership,
  lifecycle: AthenaClientLifecycle
): AthenaRuntimeDiagnostics {
  const counters = athenaRuntimeCounters();
  return {
    authRuntimesCreated: counters.authRuntimesCreated,
    closed: lifecycle.closed,
    internalProtocolVersion: ATHENA_CLIENT_INTERNAL_PROTOCOL,
    ownership,
    postgresPoolsCreated: counters.postgresPoolsCreated,
    requestViewsCreated: lifecycle.requestViewsCreated,
    runtimeId: formatRuntimeId(lifecycle.runtimeId),
    runtimeOwnership,
    sdkVersion: PACKAGE_VERSION,
  };
}
