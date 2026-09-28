import type { AthenaTransportDomain } from "../domain.ts";

export type AthenaHttpCredentialsMode = "none" | "same-origin";

export type AthenaHttpOriginMode = "same-origin" | "remote";

export type AthenaHttpTransportIR = {
  readonly basePath: string;
  readonly credentials: AthenaHttpCredentialsMode;
  readonly domain: AthenaTransportDomain;
  readonly encoding: "json";
  readonly kind: "http";
  readonly origin: AthenaHttpOriginMode;
};

export type AthenaHttpMethod =
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT";

export type AthenaHttpRequestIR = {
  readonly body?: string;
  readonly credentials: RequestCredentials;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: AthenaHttpMethod;
  readonly url: string;
};
