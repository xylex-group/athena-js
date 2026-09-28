import type { AthenaTransportDomain } from "../domain.ts";

export type AthenaDirectRuntimeKind =
  | "postgres"
  | "embedded-auth"
  | "storage-provider"
  | "billing-provider";

export type AthenaDirectTransportIR = {
  readonly domain: AthenaTransportDomain;
  readonly kind: "direct";
  readonly runtime: AthenaDirectRuntimeKind;
};
