import type {
  AthenaOperationContext,
  NormalizedAthenaError,
} from "../error/types.ts";
import type {
  AthenaGatewayErrorDetails,
  AthenaGatewayResponse,
} from "../gateway/types.ts";

export interface AthenaResult<T> {
  affectedRows?: number | null;
  count?: number | null;
  data: T | null;
  error: AthenaResultError | null;
  errorDetails?: AthenaGatewayErrorDetails | null;
  raw: unknown;
  status: number;
  statusText?: string | null;
}

export interface AthenaResultError {
  athenaCode: NormalizedAthenaError["code"];
  category: NormalizedAthenaError["category"];
  cause?: string;
  code: string | null;
  constraint?: string;
  details: unknown | null;
  endpoint?: AthenaGatewayErrorDetails["endpoint"];
  gatewayCode?: AthenaGatewayErrorDetails["code"] | null;
  hint: string | null;
  kind: NormalizedAthenaError["kind"];
  message: string;
  method?: AthenaGatewayErrorDetails["method"];
  operation?: string;
  raw: unknown;
  requestId?: string;
  retryable: boolean;
  status: number;
  statusText: string | null;
  table?: string;
}

export type AthenaResultFormatter = <T>(
  response: AthenaGatewayResponse<T>,
  context?: AthenaOperationContext
) => AthenaResult<T>;
