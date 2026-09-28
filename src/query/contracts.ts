import type {
  AthenaConditionCastType,
  AthenaGatewayCallOptions,
  AthenaGatewayCondition,
  AthenaGatewayErrorDetails,
  AthenaRpcCallOptions,
  AthenaSortBy,
} from "../gateway/types.ts";
import type { AthenaQueryDebugAst } from "../query-debug-ast.ts";
import type { AthenaResult, AthenaResultError } from "../result/types.ts";
import type {
  AthenaCacheContextDescriptor,
  AthenaRelationDescriptor,
} from "./descriptor.ts";
import type { AthenaExecutable } from "./descriptor.ts";
import type { AthenaModelTarget } from "../schema/types.ts";
import type {
  AthenaProjectedMutationResult,
  AthenaSelectInput,
  AthenaSelectResult,
  AthenaValidatedSelectInput,
} from "../select-column-types.ts";

export interface ConditionCastHints {
  columnCast?: AthenaConditionCastType;
  valueCast?: AthenaConditionCastType;
}

export interface TableBuilderState {
  cacheContext?: AthenaCacheContextDescriptor;
  conditions: AthenaGatewayCondition[];
  currentPage?: number;
  limit?: number;
  model?: AthenaModelTarget;
  offset?: number;
  order?: AthenaSortBy;
  pageSize?: number;
  relations?: AthenaRelationDescriptor[];
  totalPages?: number;
}

type MutationSingleResult<Result> =
  Result extends Array<infer Item> ? Item | null : Result | null;
type MutationSelectedResult<
  Result,
  Row,
  TOverride,
  TColumns extends AthenaSelectInput,
> = AthenaProjectedMutationResult<
  Result,
  AthenaSelectResult<Row, TOverride, TColumns>
>;
type MutationSingleSelectedResult<
  Result,
  Row,
  TOverride,
  TColumns extends AthenaSelectInput,
> = AthenaProjectedMutationResult<
  MutationSingleResult<Result>,
  AthenaSelectResult<Row, TOverride, TColumns>
>;
type MutationColumns<Row, TColumns extends AthenaSelectInput> =
  AthenaValidatedSelectInput<Row, TColumns>;

export interface MutationQuery<Result, Row = MutationSingleResult<Result>>
  extends PromiseLike<AthenaResult<Result>>,
    AthenaExecutable<AthenaResult<Result>> {
  catch: <TResult = never>(
    onrejected?:
      | ((reason: unknown) => TResult | PromiseLike<TResult>)
      | undefined
      | null
  ) => Promise<AthenaResult<Result> | TResult>;
  finally: (
    onfinally?: (() => void) | undefined | null
  ) => Promise<AthenaResult<Result>>;
  maybeSingle: <
    TOverride = never,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: MutationColumns<Row, TColumns>,
    options?: AthenaGatewayCallOptions
  ) => Promise<
    AthenaResult<MutationSingleSelectedResult<Result, Row, TOverride, TColumns>>
  >;
  requireAffected: (options?: {
    min?: number;
  }) => Promise<AthenaResult<Result>>;
  returning: <
    TOverride = never,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: MutationColumns<Row, TColumns>,
    options?: AthenaGatewayCallOptions
  ) => Promise<
    AthenaResult<MutationSelectedResult<Result, Row, TOverride, TColumns>>
  >;
  select: <
    TOverride = never,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: MutationColumns<Row, TColumns>,
    options?: AthenaGatewayCallOptions
  ) => Promise<
    AthenaResult<MutationSelectedResult<Result, Row, TOverride, TColumns>>
  >;
  single: <
    TOverride = never,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: MutationColumns<Row, TColumns>,
    options?: AthenaGatewayCallOptions
  ) => Promise<
    AthenaResult<MutationSingleSelectedResult<Result, Row, TOverride, TColumns>>
  >;
  then: <TResult1 = AthenaResult<Result>, TResult2 = never>(
    onfulfilled?:
      | ((value: AthenaResult<Result>) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ) => Promise<TResult1 | TResult2>;
}

export interface AthenaQueryTraceCallsite {
  column: number;
  fileName: string;
  filePath: string;
  frame?: string;
  functionName?: string;
  line: number;
}

export interface AthenaQueryTraceEvent {
  ast?: AthenaQueryDebugAst;
  callsite: AthenaQueryTraceCallsite | null;
  durationMs: number;
  endpoint:
    | "/gateway/fetch"
    | "/gateway/insert"
    | "/gateway/update"
    | "/gateway/delete"
    | "/gateway/rpc"
    | "/gateway/query"
    | `/rpc/${string}`;
  functionName?: string;
  operation:
    | "select"
    | "insert"
    | "upsert"
    | "update"
    | "delete"
    | "rpc"
    | "query";
  options?: AthenaGatewayCallOptions | AthenaRpcCallOptions;
  outcome?: {
    status: number;
    error: AthenaResultError | null;
    errorDetails?: AthenaGatewayErrorDetails | null;
    count?: number | null;
    data: unknown;
    raw: unknown;
  };
  payload: unknown;
  sql: string;
  table?: string;
  thrownError?: unknown;
  timestamp: string;
}

export interface AthenaQueryTraceOptions {
  enabled?: boolean;
  logger?: (event: AthenaQueryTraceEvent) => void;
}

export interface InternalClientBehaviorOptions {
  /**
   * Lift supported fluent reads through the canonical query AST before
   * selecting a transport. Legacy expressions retain the compatibility path.
   */
  canonicalQueries?: boolean;
  debugAst?: boolean;
  findManyAst?: boolean;
  findManyAstRelationSchema?: boolean;
  rawQueryDiagnostics?: boolean | "auto";
  retryReads?: boolean;
  traceQueries?: boolean | AthenaQueryTraceOptions;
}
