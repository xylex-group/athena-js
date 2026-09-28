import type { AthenaErrorKind } from "./kinds.ts";
import type { AthenaRetryDisposition } from "./retry.ts";

export type AthenaErrorDomain =
  | "auth"
  | "billing"
  | "chat"
  | "data"
  | "gateway"
  | "internal"
  | "notifications"
  | "policy"
  | "storage"
  | "webhook";

export interface AthenaErrorIR<
  Code extends string = string,
  Domain extends AthenaErrorDomain = AthenaErrorDomain,
> {
  readonly code: Code;
  readonly description: string;
  readonly domain: Domain;
  readonly errorNumber: number;
  readonly kind: AthenaErrorKind;
  readonly retry: AthenaRetryDisposition;
  readonly status: number;
}
