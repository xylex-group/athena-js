import type { AthenaTransportIR } from "./ir.ts";

export type AthenaRuntimeTopologyTransports = {
  readonly auth?: AthenaTransportIR;
  readonly billing?: AthenaTransportIR;
  readonly data?: AthenaTransportIR;
  readonly storage?: AthenaTransportIR;
};

export type AthenaRuntimeTopologyIR = {
  readonly protocol: { major: number; minor: number };
  readonly transports: AthenaRuntimeTopologyTransports;
  readonly version: 1;
};
