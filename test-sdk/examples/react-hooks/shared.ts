import type { AthenaClient, AthenaResult } from "@xylex-group/athena";
import { createAthenaBrowserClient } from "@xylex-group/athena/next/client";
import { createAthenaQueryClient } from "@xylex-group/athena/react";

export interface DemoProduct {
  id: string;
  name: string;
  price: number;
}

export interface DemoProductRow {
  id?: string;
  name: string;
  organization_id?: string;
  price: number;
}

export interface DemoProductInput {
  name: string;
  price: number;
}

export interface AthenaExampleClientConfig {
  apiKey: string;
  athenaUrl: string;
  client?: string;
}

export function createExampleQueryClient() {
  return createAthenaQueryClient({
    cache: { mode: "none" },
    defaultMutationOptions: { retry: 0 },
    defaultQueryOptions: { retry: 0 },
  });
}

/**
 * Browser / long-lived explicit-credential client via the Next façade.
 * Prefer `createAthenaServerClient` from `@xylex-group/athena/next/server`
 * for request-scoped RSC / Route Handler work.
 */
export function createExampleAthenaClient(
  config: AthenaExampleClientConfig
): AthenaClient {
  return createAthenaBrowserClient({
    backend: { type: "athena" },
    client: config.client ?? "athena_logging",
    key: config.apiKey,
    url: config.athenaUrl,
  });
}

export function assertAthenaSuccess<T>(
  result: AthenaResult<T>,
  operation: string
): T {
  if (result.error) {
    throw new Error(`[${result.status}] ${operation}: ${result.error}`);
  }
  if (result.data === null) {
    throw new Error(`${operation}: Athena returned null data`);
  }
  return result.data;
}

export function toDemoProducts(
  rows: DemoProductRow[] | null | undefined
): DemoProduct[] {
  return (rows ?? []).filter((row): row is DemoProduct => Boolean(row.id));
}

export function toDemoProduct(
  row: DemoProductRow | null | undefined
): DemoProduct {
  if (!row?.id) {
    throw new Error("Athena row did not include id");
  }
  return {
    id: row.id,
    name: row.name,
    price: row.price,
  };
}
