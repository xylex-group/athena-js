import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import type { ReactTestRenderer } from 'react-test-renderer'
import {
  AthenaQueryClientProvider,
  createAthenaQueryClient,
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '../src/react/index.ts'

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

type BrowserEventName = 'focus' | 'online'

function installMockBrowserTarget() {
  const root = globalThis as { window?: unknown }
  const originalWindow = root.window
  const listeners = new Map<BrowserEventName, Set<() => void>>([
    ['focus', new Set()],
    ['online', new Set()],
  ])

  const mockWindow = {
    addEventListener(event: BrowserEventName, listener: () => void) {
      listeners.get(event)?.add(listener)
    },
    removeEventListener(event: BrowserEventName, listener: () => void) {
      listeners.get(event)?.delete(listener)
    },
    emit(event: BrowserEventName) {
      for (const listener of listeners.get(event) ?? []) {
        listener()
      }
    },
  }

  root.window = mockWindow

  return {
    emit(event: BrowserEventName) {
      mockWindow.emit(event)
    },
    restore() {
      if (originalWindow === undefined) {
        delete root.window
        return
      }
      root.window = originalWindow
    },
  }
}

test('useQuery supports initialData without immediate execution when disabled', async () => {
  const client = createAthenaQueryClient()
  let calls = 0
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
              queryKey: ['initial-data'],
              enabled: false,
              initialData: [{ id: 10 }],
              queryFn: async () => {
                calls += 1
                return [{ id: 99 }]
              },
            }),
        }),
      ),
    )
    await flush()
  })

  assert.equal(calls, 0)
  assert(latest)
  assert.equal(latest.status, 'success')
  assert.equal(latest.isLoading, false)
  assert.deepEqual(latest.data, [{ id: 10 }])
})

test('useQuery applies select transform', async () => {
  const client = createAthenaQueryClient()
  let latest: UseQueryResult<string[]> | undefined

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
              queryKey: ['select-transform'],
              queryFn: async () => ({ data: [{ id: 'a' }, { id: 'b' }], error: null, status: 200, raw: null }),
              select: rows => rows.map(item => item.id),
            }),
        }),
      ),
    )
    await flush()
  })

  assert(latest)
  assert.equal(latest.status, 'success')
  assert.deepEqual(latest.data, ['a', 'b'])
})

test('useQuery success callbacks fire with normalized result', async () => {
  const client = createAthenaQueryClient()
  const calls: string[] = []

  await act(async () => {
    create(
      createElement(
        AthenaQueryClientProvider,
        { client },
        createElement(QueryProbe, {
          onChange: () => undefined,
          hook: () =>
            useQuery({
              queryKey: ['query-callback-success'],
              queryFn: async () => [{ id: 1 }],
              onSuccess: () => calls.push('onSuccess'),
              onSettled: (data, error) => {
                calls.push(`onSettled:${Array.isArray(data)}:${error === null}`)
              },
            }),
        }),
      ),
    )
    await flush()
  })

  assert.deepEqual(calls, ['onSuccess', 'onSettled:true:true'])
})

test('useQuery error callbacks fire with normalized error', async () => {
  const client = createAthenaQueryClient()
  const calls: string[] = []

  await act(async () => {
    create(
      createElement(
        AthenaQueryClientProvider,
        { client },
        createElement(QueryProbe, {
          onChange: () => undefined,
          hook: () =>
            useQuery({
              queryKey: ['query-callback-error'],
              queryFn: async () => {
                throw new Error('query-failed')
              },
              onError: error => {
                calls.push(`onError:${error.message}`)
              },
              onSettled: (data, error) => {
                calls.push(`onSettled:${data === undefined}:${error?.message}`)
              },
            }),
        }),
      ),
    )
    await flush()
  })

  assert.deepEqual(calls, ['onError:query-failed', 'onSettled:true:query-failed'])
})

test('useQuery retry option retries failed queryFn and eventually succeeds', async () => {
  const client = createAthenaQueryClient()
  let attempts = 0
  let latest: UseQueryResult<Array<{ id: string }>> | undefined

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
              queryKey: ['query-retry'],
              retry: 2,
              retryDelay: 0,
              queryFn: async () => {
                attempts += 1
                if (attempts < 3) {
                  throw new Error(`retry-${attempts}`)
                }
                return [{ id: 'ok' }]
              },
            }),
        }),
      ),
    )
    await flush()
  })

  assert.equal(attempts, 3)
  assert(latest)
  assert.equal(latest.status, 'success')
  assert.deepEqual(latest.data, [{ id: 'ok' }])
  assert.equal(latest.lastRequest?.attempt, 3)
})

test('useQuery refetches on focus and reconnect when enabled', async () => {
  const mockBrowser = installMockBrowserTarget()
  const client = createAthenaQueryClient()
  let calls = 0
  let renderer: ReactTestRenderer | undefined

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
                queryKey: ['browser-refetch'],
                refetchOnWindowFocus: true,
                refetchOnReconnect: true,
                queryFn: async () => {
                  calls += 1
                  return [{ id: calls }]
                },
              }),
          }),
        ),
      )
      await flush()
    })

    assert.equal(calls, 1)

    await act(async () => {
      mockBrowser.emit('focus')
      await flush()
    })

    await act(async () => {
      mockBrowser.emit('online')
      await flush()
    })

    assert.equal(calls, 3)
  } finally {
    renderer?.unmount()
    mockBrowser.restore()
  }
})

test('useMutation applies select transform and returns transformed data', async () => {
  const client = createAthenaQueryClient()
  let latest: UseMutationResult<{ name: string }, string> | undefined

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
              mutationKey: ['mutation-select-transform'],
              mutationFn: async () => ({
                data: { id: 'm1', ok: true },
                error: null,
                status: 201,
                raw: { source: 'mutation' },
              }),
              select: row => row.id,
            }),
        }),
      ),
    )
    await flush()
  })

  const value = await act(async () => {
    const result = await latest!.mutateAsync({ name: 'X' })
    await flush()
    return result
  })

  assert.equal(value, 'm1')
  assert(latest)
  assert.equal(latest.status, 'success')
  assert.equal(latest.data, 'm1')
})

test('useMutation error callbacks fire in correct order', async () => {
  const client = createAthenaQueryClient()
  const calls: string[] = []
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
              mutationFn: async variables => {
                calls.push(`mutationFn:${variables.id}`)
                throw new Error('mutation-boom')
              },
              onMutate: async variables => {
                calls.push(`onMutate:${variables.id}`)
              },
              onError: error => {
                calls.push(`onError:${error.message}`)
              },
              onSettled: (data, error) => {
                calls.push(`onSettled:${data === undefined}:${error?.message}`)
              },
            }),
        }),
      ),
    )
    await flush()
  })

  await act(async () => {
    try {
      await latest!.mutateAsync({ id: '7' })
    } catch {
      // expected
    }
    await flush()
  })

  assert.deepEqual(calls, [
    'onMutate:7',
    'mutationFn:7',
    'onError:mutation-boom',
    'onSettled:true:mutation-boom',
  ])
})

test('useMutation retry re-executes failed mutationFn and succeeds', async () => {
  const client = createAthenaQueryClient()
  let attempts = 0
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
              mutationKey: ['mutation-retry'],
              retry: 1,
              retryDelay: 0,
              mutationFn: async variables => {
                attempts += 1
                if (attempts < 2) {
                  throw new Error('retry-this')
                }
                return { id: variables.id }
              },
            }),
        }),
      ),
    )
    await flush()
  })

  const result = await act(async () => {
    const value = await latest!.mutateAsync({ id: 'ok' })
    await flush()
    return value
  })

  assert.equal(attempts, 2)
  assert.deepEqual(result, { id: 'ok' })
  assert(latest)
  assert.equal(latest.status, 'success')
  assert.equal(latest.lastRequest?.attempt, 2)
})
