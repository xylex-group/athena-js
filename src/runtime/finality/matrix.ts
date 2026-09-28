/**
 * Machine-readable cross-domain runtime finality.
 * Not a public package export.
 */

export type AthenaRuntimeFinalityDomain =
  | "data"
  | "auth"
  | "storage-r2"
  | "storage-s3"
  | "billing-mollie";

export interface AthenaRuntimeFinalityRow {
  browserSecrets: "none";
  browserTransport: string;
  constructor: "createClient";
  domain: AthenaRuntimeFinalityDomain;
  httpAdapter: string;
  principal: "AthenaPrincipal";
  rights: "AthenaRightKey";
  runtime: string;
  serverTransport: string;
}

export const ATHENA_CROSS_DOMAIN_RUNTIME_FINALITY: readonly AthenaRuntimeFinalityRow[] =
  Object.freeze([
    {
      browserSecrets: "none",
      browserTransport: "/api/athena",
      constructor: "createClient",
      domain: "data",
      httpAdapter: "createAthenaDataHandlers",
      principal: "AthenaPrincipal",
      rights: "AthenaRightKey",
      runtime: "AthenaServerRuntime",
      serverTransport: "postgres-direct",
    },
    {
      browserSecrets: "none",
      browserTransport: "/api/auth",
      constructor: "createClient",
      domain: "auth",
      httpAdapter: "createAthenaAuthHandlers",
      principal: "AthenaPrincipal",
      rights: "AthenaRightKey",
      runtime: "createAthenaAuthRuntime",
      serverTransport: "embedded-auth",
    },
    {
      browserSecrets: "none",
      browserTransport: "/api/athena/storage",
      constructor: "createClient",
      domain: "storage-r2",
      httpAdapter: "createAthenaStorageHandlers",
      principal: "AthenaPrincipal",
      rights: "AthenaRightKey",
      runtime: "StorageRuntime",
      serverTransport: "r2",
    },
    {
      browserSecrets: "none",
      browserTransport: "/api/athena/storage",
      constructor: "createClient",
      domain: "storage-s3",
      httpAdapter: "createAthenaStorageHandlers",
      principal: "AthenaPrincipal",
      rights: "AthenaRightKey",
      runtime: "StorageRuntime",
      serverTransport: "s3",
    },
    {
      browserSecrets: "none",
      browserTransport: "/api/athena/billing",
      constructor: "createClient",
      domain: "billing-mollie",
      httpAdapter: "createAthenaBillingHandlers",
      principal: "AthenaPrincipal",
      rights: "AthenaRightKey",
      runtime: "AthenaBillingRuntime",
      serverTransport: "mollie",
    },
  ]);

export const ATHENA_RUNTIME_FINALITY_DEFERRED = Object.freeze([
  {
    domain: "chat",
    reason: "embedded-chat-exists-without-http-rights-finality",
  },
] as const);

export const HTTP_HANDLER_RELATIVE_PATHS = [
  "next/storage-handlers.ts",
  "next/billing-handlers.ts",
  "gateway/server/adapter.ts",
] as const;

export const TRANSPORT_RELATIVE_PATHS = [
  "billing/runtime/browser-transport.ts",
  "storage/runtime/browser-transport.ts",
  "next/client.ts",
  "browser.ts",
  "react-native/client.ts",
] as const;
