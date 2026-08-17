import type { AthenaGatewayClient } from "../../gateway/client.ts";
import type { AthenaGatewayResponse } from "../../gateway/types.ts";
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
}

export interface AthenaRuntimeRequestContext {
  headers?: Record<string, string>;
  request?: Request;
  requestId?: string;
  resolvedPrincipal?: AthenaResolvedPrincipal;
  policyDecision?: AthenaPolicyDecision;
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
  backend?: AthenaRuntimeCapabilities["transport"] | string;
  compileMs?: number;
  decision?: string;
  errorKind?: string;
  executeMs?: number;
  operation: string;
  policyIds?: string[];
  principalAuthority?: string;
  requestId: string;
  resource?: string;
  runtime: "embedded";
}

export interface AthenaServerRuntime {
  readonly allowsUnauthenticatedHttp: boolean;
  /** Server-side Auth material. Not a public client API. */
  readonly authMaterial: AthenaRuntimeAuthMaterial;
  readonly policyRegistry?: AthenaPolicyRegistry;
  readonly httpProfile: AthenaRuntimeHttpProfile;
  readonly capabilities: AthenaRuntimeCapabilities;
  execute(
    request: AthenaRuntimeRequest,
    context?: AthenaRuntimeRequestContext
  ): Promise<AthenaGatewayResponse<unknown>>;
  readonly modelIndex?: {
    readonly enforcement: AthenaRuntimeModelEnforcement;
    get(resource: string):
      | {
          canonicalResource: string;
          columns: ReadonlySet<string>;
          relations: ReadonlyMap<string, { kind: string }>;
        }
      | undefined;
  };
  readonly transport: AthenaGatewayClient;
  readonly rpcExpose?: ReadonlySet<string>;
  readonly onExecutionEvent?: (event: AthenaRuntimeExecutionEvent) => void;
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
  onExecutionEvent?: (event: AthenaRuntimeExecutionEvent) => void;
  security: {
    http?: AthenaRuntimeHttpSecurity;
    mode: AthenaRuntimeSecurityMode;
  };
  transport?: AthenaGatewayClient;
  unsafeAllowUnauthenticated?: boolean;
  /** Enable browser HTTP profile (CSRF, CORS, limits). Data handlers set this. */
  http?: boolean;
}
