import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createAthenaQueryClient } from '../src/react/query-client.ts'
import type { AthenaRuntimeEvent } from '../src/react/types.ts'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function nextTick() {
  await new Promise(resolve => {
    setTimeout(resolve, 0)
  })
}

test('query client memory cache returns fresh cached data when force=false', async () => {
  const client = createAthenaQueryClient({
    cache: { mode: 'memory', staleTime: 5_000 },
  })
  const key = client.getQueryKeyToken(['cache', 'products'])
  let calls = 0

  const queryFn = async () => {
    calls += 1
    return [{ id: calls }]
  }

  const first = await client.executeQuery({
    queryKey: ['cache', 'products'],
    queryKeyToken: key,
    queryFn,
    force: false,
  })
  const second = await client.executeQuery({
    queryKey: ['cache', 'products'],
    queryKeyToken: key,
    queryFn,
    force: false,
  })

  assert.equal(calls, 1)
  assert.deepEqual(first.data, [{ id: 1 }])
  assert.deepEqual(second.data, [{ id: 1 }])
})

test('query client memory cache bypasses cache when force=true', async () => {
  const client = createAthenaQueryClient({
    cache: { mode: 'memory', staleTime: 5_000 },
  })
  const key = client.getQueryKeyToken(['cache', 'force'])
  let calls = 0

  const queryFn = async () => {
    calls += 1
    return [{ id: calls }]
  }

  await client.executeQuery({
    queryKey: ['cache', 'force'],
    queryKeyToken: key,
    queryFn,
    force: false,
  })

  const forced = await client.executeQuery({
    queryKey: ['cache', 'force'],
    queryKeyToken: key,
    queryFn,
    force: true,
  })

  assert.equal(calls, 2)
  assert.deepEqual(forced.data, [{ id: 2 }])
})

test('query client executes retry policy for query failures', async () => {
  const client = createAthenaQueryClient()
  const key = client.getQueryKeyToken(['retry', 'query'])

  let attempts = 0
  const result = await client.executeQuery({
    queryKey: ['retry', 'query'],
    queryKeyToken: key,
    queryFn: async () => {
      attempts += 1
      if (attempts < 3) {
        throw new Error(`fail-${attempts}`)
      }
      return [{ id: 'ok' }]
    },
    retry: 2,
    retryDelay: 0,
    force: true,
  })

  assert.equal(attempts, 3)
  assert.equal(result.error, null)
  assert.deepEqual(result.data, [{ id: 'ok' }])

  const state = client.getQueryState<Array<{ id: string }>>(key)
  assert.equal(state.lastRequest?.attempt, 3)
})

test('query client normalizes envelope errors and keeps status', async () => {
  const client = createAthenaQueryClient()
  const key = client.getQueryKeyToken(['envelope-error'])

  const result = await client.executeQuery({
    queryKey: ['envelope-error'],
    queryKeyToken: key,
    queryFn: async () => ({
      data: null,
      error: 'forbidden',
      status: 403,
      raw: { reason: 'auth' },
    }),
    force: true,
  })

  assert.equal(result.error?.message, 'forbidden')
  assert.equal(result.status, 403)
  assert.deepEqual(result.raw, { reason: 'auth' })

  const state = client.getQueryState(key)
  assert.equal(state.status, 'error')
  assert.equal(state.error?.status, 403)
})

test('query client resetQuery returns state to idle and emits reset event', async () => {
  const client = createAthenaQueryClient()
  const key = client.getQueryKeyToken(['reset-query'])
  const events: AthenaRuntimeEvent[] = []

  const detach = client.subscribeEvents(event => {
    events.push(event)
  })

  await client.executeQuery({
    queryKey: ['reset-query'],
    queryKeyToken: key,
    queryFn: async () => [1],
    force: true,
  })

  client.resetQuery(['reset-query'])
  detach()

  const state = client.getQueryState<number[]>(key)
  assert.equal(state.status, 'idle')
  assert.equal(state.data, undefined)
  assert.equal(events.some(event => event.type === 'query_reset' && event.key === key), true)
})

test('query client emits mutation reset event and clears mutation state', async () => {
  const client = createAthenaQueryClient()
  const key = client.getMutationKeyToken(['reset-mutation'])
  const events: AthenaRuntimeEvent[] = []

  const detach = client.subscribeEvents(event => {
    events.push(event)
  })

  await client.executeMutation({
    mutationKey: ['reset-mutation'],
    mutationKeyToken: key,
    variables: { name: 'a' },
    mutationFn: async () => ({ id: 1 }),
  })

  client.resetMutation(['reset-mutation'])
  detach()

  const state = client.getMutationState<{ name: string }, { id: number }>(key)
  assert.equal(state.status, 'idle')
  assert.equal(state.data, undefined)
  assert.equal(events.some(event => event.type === 'mutation_reset' && event.key === key), true)
})

test('mutation client applies select transform and retry on mutation', async () => {
  const client = createAthenaQueryClient()
  const key = client.getMutationKeyToken(['mutation-select'])
  let attempts = 0

  const result = await client.executeMutation({
    mutationKey: ['mutation-select'],
    mutationKeyToken: key,
    variables: { id: '1' },
    mutationFn: async () => {
      attempts += 1
      if (attempts < 2) {
        throw new Error('first-fail')
      }
      return { data: { id: '1', ok: true }, error: null, status: 201, raw: { source: 'mutation' } }
    },
    select: row => row.id,
    retry: 1,
    retryDelay: 0,
  })

  assert.equal(attempts, 2)
  assert.equal(result.error, null)
  assert.equal(result.data, '1')

  const state = client.getMutationState<{ id: string }, string>(key)
  assert.equal(state.lastRequest?.attempt, 2)
  assert.equal(state.status, 'success')
})

test('adapter detach stops receiving subsequent events', async () => {
  const client = createAthenaQueryClient()
  const key = client.getQueryKeyToken(['adapter-detach'])

  let adapterEvents = 0
  const detach = client.attachAdapter({
    onEvent() {
      adapterEvents += 1
    },
  })

  await client.executeQuery({
    queryKey: ['adapter-detach'],
    queryKeyToken: key,
    queryFn: async () => [1],
    force: true,
  })

  const eventsBeforeDetach = adapterEvents
  detach()

  await client.executeQuery({
    queryKey: ['adapter-detach'],
    queryKeyToken: key,
    queryFn: async () => [2],
    force: true,
  })

  assert(eventsBeforeDetach > 0)
  assert.equal(adapterEvents, eventsBeforeDetach)
})

test('query gc event fires after last unsubscribe with gcTime=0', async () => {
  const client = createAthenaQueryClient({
    cache: { mode: 'none', gcTime: 0 },
  })
  const key = client.getQueryKeyToken(['gc'])
  const events: AthenaRuntimeEvent[] = []

  const detachEvents = client.subscribeEvents(event => {
    events.push(event)
  })

  const unsubscribe = client.subscribeQuery(key, () => undefined)
  await client.executeQuery({
    queryKey: ['gc'],
    queryKeyToken: key,
    queryFn: async () => [1],
    force: true,
  })

  unsubscribe()
  await nextTick()
  detachEvents()

  assert.equal(events.some(event => event.type === 'query_gc' && event.key === key), true)
})

test('query client returns default mutation key token when mutation key is omitted', () => {
  const client = createAthenaQueryClient()
  assert.equal(client.getMutationKeyToken(undefined), '__mutation__default__')
})

test('query client keeps success status during background refetch when data already exists', async () => {
  const client = createAthenaQueryClient()
  const key = client.getQueryKeyToken(['background-refetch'])
  const deferred = createDeferred<Array<{ id: number }>>()

  await client.executeQuery({
    queryKey: ['background-refetch'],
    queryKeyToken: key,
    queryFn: async () => [{ id: 1 }],
    force: true,
  })

  const inFlightPromise = client.executeQuery({
    queryKey: ['background-refetch'],
    queryKeyToken: key,
    queryFn: async () => deferred.promise,
    force: true,
    dedupe: false,
  })

  const duringRefetch = client.getQueryState<Array<{ id: number }>>(key)
  assert.equal(duringRefetch.status, 'success')
  assert.equal(duringRefetch.isFetching, true)

  deferred.resolve([{ id: 2 }])
  await inFlightPromise

  const finalState = client.getQueryState<Array<{ id: number }>>(key)
  assert.equal(finalState.status, 'success')
  assert.equal(finalState.isFetching, false)
  assert.deepEqual(finalState.data, [{ id: 2 }])
})

test('query reset invalidates in-flight request completion', async () => {
  const client = createAthenaQueryClient()
  const key = client.getQueryKeyToken(['reset-inflight-query'])
  const deferred = createDeferred<Array<{ id: number }>>()

  const pending = client.executeQuery({
    queryKey: ['reset-inflight-query'],
    queryKeyToken: key,
    queryFn: async () => deferred.promise,
    force: true,
  })

  client.resetQuery(['reset-inflight-query'])
  const resetState = client.getQueryState<Array<{ id: number }>>(key)
  assert.equal(resetState.status, 'idle')

  deferred.resolve([{ id: 1 }])
  await pending

  const afterResolve = client.getQueryState<Array<{ id: number }>>(key)
  assert.equal(afterResolve.status, 'idle')
  assert.equal(afterResolve.data, undefined)
})

test('mutation reset invalidates in-flight mutation completion', async () => {
  const client = createAthenaQueryClient()
  const key = client.getMutationKeyToken(['reset-inflight-mutation'])
  const deferred = createDeferred<{ id: string }>()

  const pending = client.executeMutation({
    mutationKey: ['reset-inflight-mutation'],
    mutationKeyToken: key,
    variables: { name: 'x' },
    mutationFn: async () => deferred.promise,
  })

  client.resetMutation(['reset-inflight-mutation'])
  const resetState = client.getMutationState<{ name: string }, { id: string }>(key)
  assert.equal(resetState.status, 'idle')

  deferred.resolve({ id: 'ok' })
  await pending

  const afterResolve = client.getMutationState<{ name: string }, { id: string }>(key)
  assert.equal(afterResolve.status, 'idle')
  assert.equal(afterResolve.data, undefined)
})
