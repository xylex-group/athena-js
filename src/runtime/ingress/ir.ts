export const ATHENA_INGRESS_OPERATION_HEADER = "x-athena-ingress-operation";

export type AthenaIngressTransportKind = "http" | "direct";

export type AthenaIngressStatus =
  | "received"
  | "resolving"
  | "processed"
  | "ignored"
  | "retryable_failure"
  | "terminal_failure";

export interface AthenaIngressIR {
  readonly body: Uint8Array;
  readonly connectionId?: string;
  readonly correlationId?: string;
  readonly domain: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly id: string;
  readonly operation: string;
  readonly receivedAt: Date;
  readonly traceId?: string;
  readonly transport: {
    readonly kind: AthenaIngressTransportKind;
  };
}
