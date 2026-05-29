import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import type { ReactTestRenderer } from 'react-test-renderer'
import {
  AthenaQueryClientProvider,
  createAthenaQueryClient,
  useSession,
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseSessionResult,
  type UseQueryResult,
} from '../src/react/index.ts'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

function QueryProbe<TData>(props: {
  onChange: (value: UseQueryResult<TData>) => void
  hook: () => UseQueryResult<TData>
}) {
  props.onChange(props.hook())
  return null
}

function MutationProbe<TVariables, TData>(props: {
  onChange: (value: UseMutationResult<TVariables, TData>) => void
  hook: () => UseMutationResult<TVariables, TData>
}) {
  props.onChange(props.hook())
  return null
}

function SessionProbe(props: {
  onChange: (value: UseSessionResult) => void
  hook: () => UseSessionResult
}) {
  props.onChange(props.hook())
  return null
}

test('useQuery loads then succeeds', async () => {
  const client = createAthenaQueryClient()
  const deferred = createDeferred<Array<{ id: number }>>()

  let latest: UseQueryResult<Array<{ id: number }>> | undefined
  let renderer: ReactTestRenderer | undefined

  await act(async () => {
    renderer = create(
      createElement(
        AthenaQueryClientProvider,
        { client },
        createElement(QueryProbe, {
          onChange: value => {
            latest = value
          },
          hook: () =>
            useQuery({
              queryKey: ['products'],
              queryFn: async () => deferred.promise,
            }),
        }),
      ),
    )
    await flush()
  })

  assert(latest)
  assert.equal(latest.isFetching, true)

  await act(async () => {
    deferred.resolve([{ id: 1 }])
    await flush()
  })

  assert(latest)
  assert.equal(latest.status, 'success')
  assert.deepEqual(latest.data, [{ id: 1 }])
  renderer?.unmount()
})

test('useQuery disabled does not run until refetch', async () => {
  const client = createAthenaQueryClient()
  let calls = 0

  let latest: UseQueryResult<Array<{ id: number }>> | undefined
  let renderer: ReactTestRenderer | undefined

  await act(async () => {
    renderer = create(
      createElement(
        AthenaQueryClientProvider,
        { client },
        createElement(QueryProbe, {
          onChange: value => {
            latest = value
          },
          hook: () =>
            useQuery({
              queryKey: ['disabled'],
              enabled: false,
              queryFn: async () => {
                calls += 1
                return [{ id: 2 }]
              },
            }),
        }),
      ),
    )
    await flush()
  })

  assert.equal(calls, 0)
  assert(latest)
  assert.equal(latest.status, 'idle')

  await act(async () => {
    await latest!.refetch()
    await flush()
  })

  assert.equal(calls, 1)
  assert(latest)
  assert.equal(latest.status, 'success')
  assert.deepEqual(latest.data, [{ id: 2 }])
  renderer?.unmount()
})

test('useQuery normalizes Athena envelope response shape', async () => {
  const client = createAthenaQueryClient()
  let latest: UseQueryResult<Array<{ id: number }>> | undefined

  await act(async () => {
    create(
      createElement(
        AthenaQueryClientProvider,
        { client },
        createElement(QueryProbe, {
          onChange: value => {
            latest = value
          },
          hook: () =>
            useQuery({
              queryKey: ['envelope'],
              queryFn: async () => ({
                data: [{ id: 10 }],
                error: null,
                status: 200,
                raw: { source: 'athena' },
              }),
            }),
        }),
      ),
    )
    await flush()
  })

  assert(latest)
  assert.equal(latest.status, 'success')
  assert.deepEqual(latest.data, [{ id: 10 }])
  assert.deepEqual(latest.lastResponse, {
    data: [{ id: 10 }],
    error: null,
    status: 200,
    raw: { source: 'athena' },
  })
})

test('useQuery handles thrown errors', async () => {
  const client = createAthenaQueryClient()
  let latest: UseQueryResult<Array<{ id: number }>> | undefined

  await act(async () => {
    create(
      createElement(
        AthenaQueryClientProvider,
        { client },
        createElement(QueryProbe, {
          onChange: value => {
            latest = value
          },
          hook: () =>
            useQuery({
              queryKey: ['error'],
              queryFn: async () => {
                throw new Error('boom')
              },
            }),
        }),
      ),
    )
    await flush()
  })

  assert(latest)
  assert.equal(latest.status, 'error')
  assert.equal(latest.error?.message, 'boom')
})

test('useQuery older slower request does not overwrite newer request on key change', async () => {
  const client = createAthenaQueryClient()
  const slow = createDeferred<Array<{ id: string }>>()
  const fast = createDeferred<Array<{ id: string }>>()

  let scope = 'slow'
  let latest: UseQueryResult<Array<{ id: string }>> | undefined
  let renderer: ReactTestRenderer | undefined

  const App = () =>
    createElement(QueryProbe, {
      onChange: (value: UseQueryResult<Array<{ id: string }>>) => {
        latest = value
      },
      hook: () =>
        useQuery({
          queryKey: ['users', scope],
          queryFn: async () => (scope === 'slow' ? slow.promise : fast.promise),
        }),
    })

  await act(async () => {
    renderer = create(
      createElement(AthenaQueryClientProvider, { client }, createElement(App)),
    )
    await flush()
  })

  await act(async () => {
    scope = 'fast'
    renderer!.update(
      createElement(AthenaQueryClientProvider, { client }, createElement(App)),
    )
    await flush()
  })

  await act(async () => {
    fast.resolve([{ id: 'new' }])
    await flush()
  })

  assert(latest)
  assert.equal(latest.status, 'success')
  assert.deepEqual(latest.data, [{ id: 'new' }])

  await act(async () => {
    slow.resolve([{ id: 'old' }])
    await flush()
  })

  assert(latest)
  assert.equal(latest.status, 'success')
  assert.deepEqual(latest.data, [{ id: 'new' }])

  renderer?.unmount()
})

test('useMutation mutateAsync success and callbacks', async () => {
  const client = createAthenaQueryClient()
  const callOrder: string[] = []
  let latest: UseMutationResult<{ name: string }, { id: string; name: string }> | undefined

  let renderer: ReactTestRenderer | undefined
  await act(async () => {
    renderer = create(
      createElement(
        AthenaQueryClientProvider,
        { client },
        createElement(MutationProbe, {
          onChange: value => {
            latest = value
          },
          hook: () =>
            useMutation({
              mutationKey: ['create-product'],
              mutationFn: async variables => ({ id: '1', name: variables.name }),
              onMutate: async () => {
                callOrder.push('onMutate')
              },
              onSuccess: () => {
                callOrder.push('onSuccess')
              },
              onSettled: () => {
                callOrder.push('onSettled')
              },
            }),
        }),
      ),
    )
    await flush()
  })

  const data = await act(async () => {
    const result = await latest!.mutateAsync({ name: 'Product' })
    await flush()
    return result
  })

  assert.deepEqual(data, { id: '1', name: 'Product' })
  assert(latest)
  assert.equal(latest.status, 'success')
  assert.deepEqual(latest.data, { id: '1', name: 'Product' })
  assert.deepEqual(callOrder, ['onMutate', 'onSuccess', 'onSettled'])
  renderer?.unmount()
})

test('useMutation mutateAsync error throws normalized error', async () => {
  const client = createAthenaQueryClient()
  let latest: UseMutationResult<{ id: string }, { id: string }> | undefined

  await act(async () => {
    create(
      createElement(
        AthenaQueryClientProvider,
        { client },
        createElement(MutationProbe, {
          onChange: value => {
            latest = value
          },
          hook: () =>
            useMutation({
              mutationFn: async () => {
                throw new Error('mutation failed')
              },
            }),
        }),
      ),
    )
    await flush()
  })

  let thrown: unknown
  await act(async () => {
    try {
      await latest!.mutateAsync({ id: '1' })
    } catch (error) {
      thrown = error
    }
    await flush()
  })

  assert(thrown)
  assert.equal((thrown as { message?: string }).message, 'mutation failed')
  assert(latest)
  assert.equal(latest.status, 'error')
  assert.equal(latest.error?.message, 'mutation failed')
})

test('useMutation mutate updates status and reset clears state', async () => {
  const client = createAthenaQueryClient()
  const deferred = createDeferred<{ id: string }>()

  let latest: UseMutationResult<{ name: string }, { id: string }> | undefined

  await act(async () => {
    create(
      createElement(
        AthenaQueryClientProvider,
        { client },
        createElement(MutationProbe, {
          onChange: value => {
            latest = value
          },
          hook: () =>
            useMutation({
              mutationFn: async () => deferred.promise,
            }),
        }),
      ),
    )
    await flush()
  })

  await act(async () => {
    latest!.mutate({ name: 'A' })
    await flush()
  })

  assert(latest)
  assert.equal(latest.isLoading, true)

  await act(async () => {
    deferred.resolve({ id: '9' })
    await flush()
  })

  assert(latest)
  assert.equal(latest.status, 'success')
  assert.deepEqual(latest.data, { id: '9' })

  await act(async () => {
    latest!.reset()
    await flush()
  })

  assert(latest)
  assert.equal(latest.status, 'idle')
  assert.equal(latest.data, undefined)
  assert.equal(latest.error, null)
})

test('useQuery unmount safety: no setState warning after unmount', async () => {
  const client = createAthenaQueryClient()
  const deferred = createDeferred<Array<{ id: number }>>()

  let renderer: ReactTestRenderer | undefined
  const errors: string[] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    const line = args.map(arg => String(arg)).join(' ')
    errors.push(line)
  }

  try {
    await act(async () => {
      renderer = create(
        createElement(
          AthenaQueryClientProvider,
          { client },
          createElement(QueryProbe, {
            onChange: () => undefined,
            hook: () =>
              useQuery({
                queryKey: ['unmount-safe'],
                queryFn: async () => deferred.promise,
              }),
          }),
        ),
      )
      await flush()
    })

    await act(async () => {
      renderer!.unmount()
      await flush()
    })

    await act(async () => {
      deferred.resolve([{ id: 1 }])
      await flush()
    })

    const unmountedWarnings = errors.filter(line => line.toLowerCase().includes('unmounted'))
    assert.equal(unmountedWarnings.length, 0)
  } finally {
    console.error = originalConsoleError
  }
})

test('useSession returns data and refetch parity fields', async () => {
  const calls: string[] = []
  const authClient = {
    getSession: async () => {
      calls.push('getSession')
      return {
        ok: true,
        status: 200,
        data: {
          session: { id: 's_1' },
          user: { id: 'u_1', email: 'u@example.com' },
        },
        error: null,
        errorDetails: null,
        raw: null,
      }
    },
  }

  let latest: UseSessionResult | undefined

  await act(async () => {
    create(
      createElement(SessionProbe, {
        onChange: value => {
          latest = value
        },
        hook: () => useSession(authClient),
      }),
    )
    await flush()
  })

  assert.equal(calls.length, 1)
  assert(latest)
  assert.equal(latest.isPending, false)
  assert.equal(latest.isRefetching, false)
  assert.equal(latest.data?.session.id, 's_1')

  await act(async () => {
    const refetched = await latest!.refetch()
    assert.equal(refetched?.session.id, 's_1')
    await flush()
  })

  assert.equal(calls.length, 2)
})

test('useSession accepts createClient-style auth namespace input', async () => {
  const calls: string[] = []
  const client = {
    auth: {
      getSession: async () => {
        calls.push('getSession')
        return {
          ok: true,
          status: 200,
          data: {
            session: { id: 's_2' },
            user: { id: 'u_2', email: 'u2@example.com' },
          },
          error: null,
          errorDetails: null,
          raw: null,
        }
      },
    },
  }

  let latest: UseSessionResult | undefined
  await act(async () => {
    create(
      createElement(SessionProbe, {
        onChange: value => {
          latest = value
        },
        hook: () => useSession(client),
      }),
    )
    await flush()
  })

  assert.equal(calls.length, 1)
  assert(latest)
  assert.equal(latest.data?.session.id, 's_2')
})

test('useSession surfaces error details on failed session request', async () => {
  const authClient = {
    getSession: async () => ({
      ok: false,
      status: 401,
      data: null,
      error: 'unauthorized',
      errorDetails: {
        code: 'HTTP_ERROR' as const,
        message: 'unauthorized',
        status: 401,
        endpoint: '/get-session' as const,
        method: 'GET' as const,
      },
      raw: null,
    }),
  }

  let latest: UseSessionResult | undefined
  await act(async () => {
    create(
      createElement(SessionProbe, {
        onChange: value => {
          latest = value
        },
        hook: () => useSession(authClient),
      }),
    )
    await flush()
  })

  assert(latest)
  assert.equal(latest.data, null)
  assert.equal(latest.error?.code, 'HTTP_ERROR')
  assert.equal(latest.isPending, false)
})
