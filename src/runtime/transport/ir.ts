import type { AthenaDirectTransportIR } from "./direct/ir.ts";
import type { AthenaHttpTransportIR } from "./http/ir.ts";

export type AthenaTransportIR = AthenaDirectTransportIR | AthenaHttpTransportIR;
