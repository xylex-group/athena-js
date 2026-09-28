import type { AthenaTransportDomain } from "./domain.ts";

export type AthenaTransportInvocationIR<
  TDomain extends AthenaTransportDomain = AthenaTransportDomain,
  TOperation extends string = string,
  TPayload = unknown,
> = {
  readonly domain: TDomain;
  readonly operation: TOperation;
  readonly payload?: TPayload;
};
