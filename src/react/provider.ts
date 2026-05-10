import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
import type { AthenaQueryClientConfig } from './types.ts'
import { AthenaQueryClient, createAthenaQueryClient } from './query-client.ts'

const AthenaQueryClientContext = createContext<AthenaQueryClient | null>(null)

export interface AthenaQueryClientProviderProps {
  client?: AthenaQueryClient
  config?: AthenaQueryClientConfig
  children: ReactNode
}

export function AthenaQueryClientProvider(props: AthenaQueryClientProviderProps) {
  const memoizedClient = useMemo(() => {
    if (props.client) {
      return props.client
    }
    return createAthenaQueryClient(props.config)
  }, [props.client, props.config])

  return createElement(
    AthenaQueryClientContext.Provider,
    { value: memoizedClient },
    props.children,
  )
}

export function useAthenaQueryClient(): AthenaQueryClient {
  const client = useContext(AthenaQueryClientContext)
  if (!client) {
    throw new Error(
      'No AthenaQueryClient found. Wrap your component tree with AthenaQueryClientProvider.',
    )
  }
  return client
}

export { AthenaQueryClientContext }
