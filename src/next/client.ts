import type {
  AthenaSdkClientWithAuth,
  AthenaSdkClientWithStorage,
} from '../client.ts'
import {
  createAdapterClient,
  type AthenaAdapterExperimentalOptions,
  type AthenaAdapterBaseOptions,
} from './shared.ts'

export interface AthenaBrowserClientOptions extends AthenaAdapterBaseOptions {}

type AthenaBrowserClientOptionsWithStorage = AthenaBrowserClientOptions & {
  storage: true
}

type AthenaBrowserClientOptionsWithTypecheckedColumns =
  AthenaBrowserClientOptions & {
    experimental: AthenaAdapterExperimentalOptions & {
      typecheckColumns: true
    }
  }

type AthenaBrowserClientOptionsWithStorageAndTypecheckedColumns =
  AthenaBrowserClientOptionsWithStorage & {
    experimental: AthenaAdapterExperimentalOptions & {
      typecheckColumns: true
    }
  }

let cachedBrowserClient: AthenaSdkClientWithAuth<false> | null = null

export function createAthenaBrowserClient(
  options: AthenaBrowserClientOptionsWithStorageAndTypecheckedColumns,
): AthenaSdkClientWithStorage<true>
export function createAthenaBrowserClient(
  options: AthenaBrowserClientOptionsWithStorage,
): AthenaSdkClientWithStorage<false>
export function createAthenaBrowserClient(
  options: AthenaBrowserClientOptionsWithTypecheckedColumns,
): AthenaSdkClientWithAuth<true>
export function createAthenaBrowserClient(
  options?: AthenaBrowserClientOptions,
): AthenaSdkClientWithAuth<false>
export function createAthenaBrowserClient(
  options?: AthenaBrowserClientOptions,
): AthenaSdkClientWithAuth<false> | AthenaSdkClientWithStorage<false> | AthenaSdkClientWithStorage<true> {
  if (!options) {
    if (cachedBrowserClient) {
      return cachedBrowserClient
    }

    cachedBrowserClient = createAdapterClient()
    return cachedBrowserClient
  }

  return createAdapterClient(options)
}
