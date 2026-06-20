import type { AthenaClientSessionLike } from '../client.ts'
import type {
  AthenaSdkClientWithAuth,
  AthenaSdkClientWithStorage,
} from '../client.ts'
import type { AthenaAuthSessionResponse } from '../auth/types.ts'
import {
  buildSessionClientOptions,
  createAdapterClient,
  resolveServerRequestContext,
  type AthenaAdapterExperimentalOptions,
  type AthenaAdapterBaseOptions,
  type AthenaServerRequestOptions,
} from './shared.ts'

export interface AthenaServerClientOptions
  extends AthenaAdapterBaseOptions,
    AthenaServerRequestOptions {
  session?: AthenaClientSessionLike | AthenaAuthSessionResponse | null
}

export interface AthenaServerContextOptions
  extends AthenaAdapterBaseOptions,
    AthenaServerRequestOptions {
  session?: AthenaAuthSessionResponse | null
}

export interface AthenaResolvedServerContext<TClient> {
  client: TClient
  session: AthenaAuthSessionResponse | null
  userId: string | null
  organizationId: string | null
}

type AthenaServerClientOptionsWithStorage = AthenaServerClientOptions & {
  storage: true
}

type AthenaServerClientOptionsWithTypecheckedColumns =
  AthenaServerClientOptions & {
    experimental: AthenaAdapterExperimentalOptions & {
      typecheckColumns: true
    }
  }

type AthenaServerClientOptionsWithStorageAndTypecheckedColumns =
  AthenaServerClientOptionsWithStorage & {
    experimental: AthenaAdapterExperimentalOptions & {
      typecheckColumns: true
    }
  }

type AthenaServerContextOptionsWithStorage = AthenaServerContextOptions & {
  storage: true
}

type AthenaServerContextOptionsWithTypecheckedColumns =
  AthenaServerContextOptions & {
    experimental: AthenaAdapterExperimentalOptions & {
      typecheckColumns: true
    }
  }

type AthenaServerContextOptionsWithStorageAndTypecheckedColumns =
  AthenaServerContextOptionsWithStorage & {
    experimental: AthenaAdapterExperimentalOptions & {
      typecheckColumns: true
    }
  }

function resolveUserId(
  session: AthenaAuthSessionResponse | AthenaClientSessionLike | null | undefined,
): string | null {
  return session?.user?.id ?? null
}

function resolveOrganizationId(
  session: AthenaAuthSessionResponse | AthenaClientSessionLike | null | undefined,
): string | null {
  return session?.session?.activeOrganizationId ?? null
}

export async function createAthenaServerClient(
  options: AthenaServerClientOptionsWithStorageAndTypecheckedColumns,
): Promise<AthenaSdkClientWithStorage<true>>
export async function createAthenaServerClient(
  options: AthenaServerClientOptionsWithStorage,
): Promise<AthenaSdkClientWithStorage<false>>
export async function createAthenaServerClient(
  options: AthenaServerClientOptionsWithTypecheckedColumns,
): Promise<AthenaSdkClientWithAuth<true>>
export async function createAthenaServerClient(
  options?: AthenaServerClientOptions,
): Promise<AthenaSdkClientWithAuth<false>>
export async function createAthenaServerClient(
  options?: AthenaServerClientOptions,
): Promise<AthenaSdkClientWithAuth<false> | AthenaSdkClientWithStorage<false> | AthenaSdkClientWithStorage<true>> {
  const requestContext = await resolveServerRequestContext(options)
  const client = createAdapterClient(options, requestContext)

  if (!options?.session) {
    return client
  }

  return client.withSession(
    options.session,
    buildSessionClientOptions(requestContext, options),
  )
}

export async function resolveAthenaServerContext(
  options: AthenaServerContextOptionsWithStorageAndTypecheckedColumns,
): Promise<AthenaResolvedServerContext<AthenaSdkClientWithStorage<true>>>
export async function resolveAthenaServerContext(
  options: AthenaServerContextOptionsWithStorage,
): Promise<AthenaResolvedServerContext<AthenaSdkClientWithStorage<false>>>
export async function resolveAthenaServerContext(
  options: AthenaServerContextOptionsWithTypecheckedColumns,
): Promise<AthenaResolvedServerContext<AthenaSdkClientWithAuth<true>>>
export async function resolveAthenaServerContext(
  options?: AthenaServerContextOptions,
): Promise<AthenaResolvedServerContext<AthenaSdkClientWithAuth<false>>>
export async function resolveAthenaServerContext(
  options?: AthenaServerContextOptions,
): Promise<
  | AthenaResolvedServerContext<AthenaSdkClientWithAuth<false>>
  | AthenaResolvedServerContext<AthenaSdkClientWithStorage<false>>
  | AthenaResolvedServerContext<AthenaSdkClientWithStorage<true>>
> {
  const requestContext = await resolveServerRequestContext(options)
  const client = createAdapterClient(options, requestContext)

  let session = options?.session ?? null
  if (!session) {
    const sessionResult = await client.auth.getSession()
    session = sessionResult.ok ? sessionResult.data : null
  }

  const scopedClient = session
    ? client.withSession(
        session,
        buildSessionClientOptions(requestContext, options ?? {}),
      )
    : client

  return {
    client: scopedClient,
    session,
    userId: resolveUserId(session),
    organizationId: resolveOrganizationId(session),
  }
}
