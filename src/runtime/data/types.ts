import type { AthenaGatewayClient } from "../../gateway/client.ts";
import type { AthenaRuntimeDiscoveryDocument } from "../../gateway/discovery-types.ts";
import type { AthenaGatewayResponse } from "../../gateway/types.ts";
import type { AthenaDataLifecycleConfig } from "./lifecycle/types.ts";
import type { AthenaPolicyDecision, AthenaPolicyMode } from "../../policy/decision.ts";
import type { AthenaPolicyRegistry } from "../../policy/registry.ts";
import type {
  AthenaResolvedPrincipal,
  AthenaRuntimeAuthConfig,
  AthenaRuntimeAuthMaterial,
} from "./principal.ts";

export type AthenaRuntimeOperation =
  | "fetch"
  | "insert"
  | "update"
  | "delete"
  | "query"
  | "rpc";

export type AthenaRuntimeSecurityMode =
  | "trusted"
  | "authenticated"
  | "policy";

export type AthenaRuntimeAuthMode =
  | false
  | "athena-session"
  | "jwt"
  | "custom"
  | "service";

export type AthenaRuntimeModelEnforcement = "off" | "known-only" | "strict";

export interface AthenaRuntimeRequest {
  operation: AthenaRuntimeOperation;
  payload: unknown;
  /**
   * Non-authoritative client intent. Policy always sees `operation`.
   * Fluent upsert sets `"upsert"` while the wire stays insert.
   */
  semanticOperation?: "insert" | "update" | "delete" | "upsert";
}

export interface AthenaRuntimeRequestContext {
  eventId?: string;
  headers?: Record<string, string>;
  policyDecision?: AthenaPolicyDecision;
  request?: Request;
  requestId?: string;
  resolvedPrincipal?: AthenaResolvedPrincipal;
  traceId?: string;
}

export interface AthenaRuntimeLimits {
  maxBodyBytes?: number;
  maxInItems?: number;
  maxInsertRows?: number;
  maxNestedDepth?: number;
  maxPageSize?: number;
  maxQueryComplexity?: number;
  maxRelations?: number;
}

export interface AthenaRuntimeHttpSecurity {
  allowCrossOrigin?: boolean;
  allowUnboundedMutations?: boolean;
  allowedOrigins?: readonly string[];
  csrf?: "origin" | "disabled";
}

export interface AthenaRuntimeHttpProfile {
  allowUnboundedMutations: boolean;
  allowedOrigins: readonly string[];
  enabled: boolean;
  limits: {
    maxBodyBytes: number;
    maxInItems: number;
    maxInsertRows: number;
    maxNestedDepth?: number;
    maxPageSize: number;
    maxQueryComplexity?: number;
    maxRelations?: number;
  };
  requireCsrfOnCookieMutations: boolean;
  requireSameOrigin: boolean;
}

export interface AthenaRuntimeCapabilities {
  auth: AthenaRuntimeAuthMode;
  modelEnforcement: AthenaRuntimeModelEnforcement;
  nestedRelations: boolean;
  policies: boolean;
  rawSql: boolean;
  rpc: boolean;
  security: AthenaRuntimeSecurityMode;
  transport: "postgres-direct" | "d1" | "injected";
}

export type AthenaRuntimeErrorCode =
  | "ATHENA_RUNTIME_UNAVAILABLE"
  | "ATHENA_RUNTIME_UNSUPPORTED_OPERATION"
  | "ATHENA_RUNTIME_CONFIG_INVALID"
  | "ATHENA_RAW_SQL_FORBIDDEN"
  | "ATHENA_RPC_FORBIDDEN"
  | "ATHENA_RPC_NOT_EXPOSED"
  | "ATHENA_AUTH_REQUIRED"
  | "ATHENA_AUTH_INVALID_SESSION"
  | "ATHENA_AUTH_SESSION_EXPIRED"
  | "ATHENA_AUTH_PRINCIPAL_RESOLUTION_FAILED"
  | "ATHENA_AUTH_ORG_NOT_ALLOWED"
  | "ATHENA_AUTH_CONFIG_INVALID"
  | "ATHENA_POLICY_DENIED"
  | "ATHENA_POLICY_INVALID"
  | "ATHENA_POLICY_UNRESOLVED"
  | "ATHENA_POLICY_UNSUPPORTED_EXPRESSION"
  | "ATHENA_POLICY_WRITE_CONFLICT"
  | "ATHENA_POLICY_SUBJECT_MISSING"
  | "ATHENA_MODEL_NOT_EXPOSED"
  | "ATHENA_MODEL_UNKNOWN_FIELD"
  | "ATHENA_MODEL_UNKNOWN_RELATION"
  | "ATHENA_MODEL_INVALID_REGISTRY"
  | "ATHENA_CSRF_REJECTED"
  | "ATHENA_LIMIT_EXCEEDED"
  | "ATHENA_UNBOUNDED_MUTATION";

export interface AthenaRuntimeExecutionEvent {
  affectedRows?: number;
  afterHooksMs?: number;
  audit?: boolean;
  authorizeMs?: number;
  backend?: AthenaRuntimeCapabilities["transport"] | string;
  beforeHooksMs?: number;
  compileMs?: number;
  decision?: string;
  errorKind?: string;
  errorPhase?: string;
  eventId?: string;
  executeMs?: number;
  operation: string;
  policyIds?: string[];
  prepareMs?: number;
  principalAuthority?: string;
  requestId: string;
  resource?: string;
  runtime: "embedded";
  semanticOperation?: "insert" | "update" | "delete" | "upsert";
  totalMs?: number;
  traceId?: string;
  transactionSemantics?: "atomic" | "backend-managed" | "unknown";
}

export interface AthenaServerRuntime {
  readonly allowsUnauthenticatedHttp: boolean;
  /** Server-side Auth material. Not a public client API. */
  readonly authMaterial: AthenaRuntimeAuthMaterial;
  readonly policyRegistry?: AthenaPolicyRegistry;
  readonly httpProfile: AthenaRuntimeHttpProfile;
  readonly capabilities: AthenaRuntimeCapabilities;
  /** Optional 1.1 Next runtime-capability overlay. Standalone Data stays 1.0. */
  readonly discoveryDocument?: AthenaRuntimeDiscoveryDocument;
  execute(
    request: AthenaRuntimeRequest,
    context?: AthenaRuntimeRequestContext
  ): Promise<AthenaGatewayResponse<unknown>>;
  readonly lifecycle?: { data?: AthenaDataLifecycleConfig };
  readonly modelIndex?: {
    readonly enforcement: AthenaRuntimeModelEnforcement;
    get(resource: string):
      | {
          canonicalResource: string;
          columns: ReadonlySet<string>;
          database?: string;
          model?: string;
          relations: ReadonlyMap<string, { kind: string }>;
          schema?: string;
          table: string;
        }
      | undefined;
  };
  readonly transport: AthenaGatewayClient;
  readonly rpcExpose?: ReadonlySet<string>;
  readonly onExecutionEvent?: (event: AthenaRuntimeExecutionEvent) => void;
  /** Client-shaped input for DevTools snapshot production (Node/local only). */
  readonly devtoolsProduceInput?: Record<string, unknown>;
}

export interface CreateAthenaServerRuntimeConfig {
  auth?: AthenaRuntimeAuthConfig;
  databaseUrl?: string | null;
  db?: {
    databaseUrl?: string | null;
  };
  modelEnforcement?: AthenaRuntimeModelEnforcement;
  models?: unknown;
  policies?: {
    definitions?: unknown;
    enforce?: boolean;
    mode?: AthenaPolicyMode;
  };
  limits?: AthenaRuntimeLimits;
  rawSql?: boolean | { enabled: boolean };
  rpc?: boolean | { enabled: boolean; expose?: readonly string[] };
  lifecycle?: { data?: AthenaDataLifecycleConfig };
  onExecutionEvent?: (event: AthenaRuntimeExecutionEvent) => void;
  security: {
    http?: AthenaRuntimeHttpSecurity;
    mode: AthenaRuntimeSecurityMode;
  };
  transport?: AthenaGatewayClient;
  unsafeAllowUnauthenticated?: boolean;
  /** Enable browser HTTP profile (CSRF, CORS, limits). Data handlers set this. */
  http?: boolean;
  /** Next handlers pass protocol 1.1 ads; omitted for Data-only 1.0. */
  discoveryDocument?: AthenaRuntimeDiscoveryDocument;
  /** Optional extra facts for GET /api/athena/capabilities DevTools snapshot. */
  devtoolsProduceInput?: Record<string, unknown>;
}
