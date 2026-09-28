/**
 * Public Athena JS client façade.
 *
 * Construction and the internal composition root live under `src/client/`.
 * Fluent builders remain in `client-fluent.ts` (query pipeline extraction is
 * a later phase). This file re-exports the public types and the browser-safe
 * universal `createClient`. Do not re-export Node `v3-client.ts` (INV-RUNTIME-004).
 */

export type {
  AthenaClientAdminModule,
  AthenaClientRuntimeContext,
  AthenaClientSystemModule,
  InternalAthenaClient,
  InternalAthenaClientCore,
  InternalClientAuthOptions,
  InternalClientChatOptions,
  InternalClientConfig,
  InternalClientContextResolver,
  InternalClientRequestContext,
} from "./client/context.ts";
export {
  createInternalClientCore,
  createInternalClientView,
} from "./client/context.ts";
export { createClient } from "./client/create-client.ts";

export type {
  AthenaFromOptions,
  AthenaQueryTraceCallsite,
  AthenaQueryTraceEvent,
  AthenaQueryTraceOptions,
  InternalClientBehaviorOptions,
  MutationQuery,
  OrderOptions,
  RpcOrderOptions,
  RpcQueryBuilder,
  SelectChain,
  TableQueryBuilder,
  UpdateChain,
} from "./client-fluent.ts";
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
