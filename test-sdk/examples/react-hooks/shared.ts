import { createAthenaQueryClient } from '@xylex-group/athena/react'

export type DemoProduct = {
  id: string
  name: string
  price: number
}

export type DemoProductInput = {
  name: string
  price: number
}

type DemoApiEnvelope<T> = {
  data: T
  responseTimeMs: number
}

export function createExampleQueryClient() {
  return createAthenaQueryClient({
    cache: { mode: 'none' },
    defaultQueryOptions: { retry: 0 },
    defaultMutationOptions: { retry: 0 },
  })
}

export async function listDemoProducts(baseUrl: string): Promise<DemoProduct[]> {
  const response = await fetch(`${baseUrl}/demo/products`)
  if (!response.ok) {
    throw new Error(`GET /demo/products failed with ${response.status}`)
  }
  const payload = (await response.json()) as DemoApiEnvelope<DemoProduct[]>
  return payload.data
}

export async function createDemoProduct(
  baseUrl: string,
  input: DemoProductInput,
): Promise<DemoProduct> {
  const response = await fetch(`${baseUrl}/demo/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new Error(`POST /demo/products failed with ${response.status}`)
  }
  const payload = (await response.json()) as DemoApiEnvelope<DemoProduct>
  return payload.data
}
