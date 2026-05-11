import {
  createClient,
  type AthenaResult,
  type AthenaSdkClient,
} from '@xylex-group/athena'
import { createAthenaQueryClient } from '@xylex-group/athena/react'

export type DemoProduct = {
  id: string
  name: string
  price: number
}

export type DemoProductRow = {
  id?: string
  name: string
  price: number
  organization_id?: string
}

export type DemoProductInput = {
  name: string
  price: number
}

export type AthenaExampleClientConfig = {
  athenaUrl: string
  apiKey: string
  client?: string
}

export function createExampleQueryClient() {
  return createAthenaQueryClient({
    cache: { mode: 'none' },
    defaultQueryOptions: { retry: 0 },
    defaultMutationOptions: { retry: 0 },
  })
}

export function createExampleAthenaClient(
  config: AthenaExampleClientConfig,
): AthenaSdkClient {
  return createClient(config.athenaUrl, config.apiKey, {
    client: config.client ?? 'athena_logging',
    backend: { type: 'athena' },
  })
}

export function assertAthenaSuccess<T>(
  result: AthenaResult<T>,
  operation: string,
): T {
  if (result.error) {
    throw new Error(`[${result.status}] ${operation}: ${result.error}`)
  }
  if (result.data == null) {
    throw new Error(`${operation}: Athena returned null data`)
  }
  return result.data
}

export function toDemoProducts(rows: DemoProductRow[] | null | undefined): DemoProduct[] {
  return (rows ?? []).filter((row): row is DemoProduct => Boolean(row.id))
}

export function toDemoProduct(row: DemoProductRow | null | undefined): DemoProduct {
  if (!row?.id) {
    throw new Error('Athena row did not include id')
  }
  return row
}
