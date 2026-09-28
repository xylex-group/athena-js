import type {
  QueryOperationV1,
  QueryRequestV1,
  QueryValueV1,
} from "../query/contract-v1.ts";
import type { AthenaSqliteBindValue } from "./contracts.ts";

export type AthenaCompiledQueryTarget = "sqlite-local";

export type AthenaCompiledOperation =
  | "select"
  | "insert"
  | "update"
  | "delete"
  | "raw"
  | "rpc";

export type AthenaCompiledMutability = "read" | "write";

export type AthenaCompiledResultShape =
  | "rows"
  | "affected_only"
  | "opaque"
  | "http_body";

export type AthenaCompiledCardinality =
  | "zero_or_more"
  | "at_most_one"
  | "exactly_one"
  | "affected_count"
  | "opaque";

export type AthenaCompiledBackendProfile =
  | "postgres_native"
  | "postgres_neon"
  | "postgres_supabase"
  | "sqlite_local"
  | "cloudflare_d1"
  | "scylla"
  | "postgrest";

export interface AthenaCompiledQuery {
  readonly version: 1;
  readonly sql: string;
  readonly params: readonly QueryValueV1[];
  readonly operation: AthenaCompiledOperation;
  readonly mutability: AthenaCompiledMutability;
  readonly result_shape: AthenaCompiledResultShape;
  readonly expected_cardinality: AthenaCompiledCardinality;
  readonly returning: "none" | "star" | { columns: string[] };
  readonly backend_profile: AthenaCompiledBackendProfile;
  readonly validation: {
    readonly level: "full" | "syntax_only";
    readonly warnings?: readonly string[];
  };
  readonly compiler: {
    readonly crate_name: string;
    readonly profile: AthenaCompiledBackendProfile;
  };
}

export interface AthenaCanonicalQueryCompiler {
  compile(
    request: QueryRequestV1<QueryOperationV1>,
    target: AthenaCompiledQueryTarget,
  ): Promise<AthenaCompiledQuery>;
}

export function createHostCanonicalQueryCompiler(
  compile: AthenaCanonicalQueryCompiler["compile"],
): AthenaCanonicalQueryCompiler {
  return { compile };
}

const RUNTIME_FIELDS = [
  "credentials",
  "uri",
  "url",
  "pool",
  "cookie",
  "timeout_ms",
  "signal",
  "transaction",
  "executor",
] as const;

export function assertCompiledQueryV1(value: unknown): AthenaCompiledQuery {
  if (!value || typeof value !== "object") {
    throw new Error("canonical compiler returned a non-object compiled query");
  }
  const compiled = value as Record<string, unknown>;
  for (const field of RUNTIME_FIELDS) {
    if (field in compiled) {
      throw new Error(`CompiledQueryV1 must not carry runtime field ${field}`);
    }
  }
  if (compiled.version !== 1 || typeof compiled.sql !== "string") {
    throw new Error("canonical compiler returned an invalid CompiledQueryV1");
  }
  if (compiled.compiler && typeof compiled.compiler === "object") {
    const crateName = (compiled.compiler as { crate_name?: unknown }).crate_name;
    if (crateName !== "athena-query") {
      throw new Error("canonical compiler identity must be athena-query");
    }
  }
  return compiled as unknown as AthenaCompiledQuery;
}

export function compiledQueryParamToBind(value: QueryValueV1): AthenaSqliteBindValue {
  if ("null" in value) return null;
  if ("bool" in value) return value.bool;
  if ("integer" in value) return value.integer;
  if ("number" in value) return value.number;
  if ("float" in value) return Number(value.float);
  if ("text" in value) return value.text;
  if ("bytes" in value) return Uint8Array.from(value.bytes);
  return JSON.stringify(value.json);
}
