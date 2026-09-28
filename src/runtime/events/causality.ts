import type { AthenaIngressIR } from "../ingress/ir.ts";
import type { CanonicalEventCausality } from "./ir.ts";

export function causalityFromIngress(
  ingress: AthenaIngressIR,
  causationId?: string
): CanonicalEventCausality {
  return {
    ...(ingress.correlationId ? { correlationId: ingress.correlationId } : {}),
    ...(causationId ? { causationId } : { causationId: ingress.id }),
  };
}
