/**
 * Compatibility façade for the fluent client surface.
 *
 * Keep this path stable for existing imports while implementations migrate
 * behind client/fluent and query/execution boundaries.
 */
export type {
  AthenaFromOptions,
  AthenaQueryTraceCallsite,
  AthenaQueryTraceEvent,
  AthenaQueryTraceOptions,
  AthenaRowShape,
  ClientTableQueryBuilder,
  InternalClientBehaviorOptions,
  MutationQuery,
  OrderOptions,
  RpcOrderOptions,
  RpcQueryBuilder,
  SelectChain,
  TableQueryBuilder,
  TableQueryIncludeRelations,
  TableQueryIncludeSpec,
  UntypedTableName,
  UpdateChain,
} from "./client/fluent/types.ts";
export {
  createQueryBuilder,
  createRpcBuilder,
  createTableBuilder,
} from "./client/fluent/index.ts";
export type {
  AthenaRequestMethod,
  AthenaRequestOptions,
  AthenaRequestQueryValueMap,
  AthenaRequestResponse,
  AthenaRequestService,
} from "./client-request.ts";
export type { AthenaResult, AthenaResultError } from "./client-result.ts";
export type {
  AthenaColumnKey,
  AthenaColumnKeyWithAutocomplete,
  AthenaResolvedColumnKey,
  AthenaSelectArrayElement,
  AthenaSelectColumnsFor,
  AthenaSelectInput,
  AthenaSelectInputHints,
  AthenaTypecheckedColumnKey,
  AthenaValidatedSelectInput,
  HasKnownSelectColumns,
} from "./select-column-types.ts";
