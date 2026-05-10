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

test('query client dedupes inflight requests for the same key', async () => {
  const client = createAthenaQueryClient()
  const key = client.getQueryKeyToken(['products'])
  const deferred = createDeferred<Array<{ id: number }>>()
  let calls = 0

  const run = () =>
    client.executeQuery({
      queryKey: ['products'],
      queryKeyToken: key,
      queryFn: async () => {
        calls += 1
        return deferred.promise
      },
      dedupe: true,
      force: true,
    })

  const first = run()
  const second = run()

  assert.equal(calls, 1, 'queryFn should only execute once while inflight')

  deferred.resolve([{ id: 1 }])

  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.deepEqual(firstResult.data, [{ id: 1 }])
  assert.deepEqual(secondResult.data, [{ id: 1 }])
  assert.equal(firstResult.error, null)
  assert.equal(secondResult.error, null)
})

test('query client keeps newest request result when slow older request finishes later', async () => {
  const client = createAthenaQueryClient()
  const key = client.getQueryKeyToken(['users'])
  const slow = createDeferred<Array<{ id: string }>>()
  const fast = createDeferred<Array<{ id: string }>>()

  const slowRun = client.executeQuery({
    queryKey: ['users'],
    queryKeyToken: key,
    queryFn: async () => slow.promise,
    dedupe: false,
    force: true,
  })

  const fastRun = client.executeQuery({
    queryKey: ['users'],
    queryKeyToken: key,
    queryFn: async () => fast.promise,
    dedupe: false,
    force: true,
  })

  fast.resolve([{ id: 'new' }])
  const fastResult = await fastRun
  assert.deepEqual(fastResult.data, [{ id: 'new' }])

  slow.resolve([{ id: 'old' }])
  await slowRun

  const state = client.getQueryState<Array<{ id: string }>>(key)
  assert.equal(state.status, 'success')
  assert.deepEqual(state.data, [{ id: 'new' }])
})

test('query client emits adapter and event bus updates', async () => {
  const client = createAthenaQueryClient()
  const key = client.getQueryKeyToken(['audit'])

  const eventBus: AthenaRuntimeEvent[] = []
  const queryEvents: AthenaRuntimeEvent[] = []

  const detachEvents = client.subscribeEvents(event => {
    eventBus.push(event)
  })

  const detachAdapter = client.attachAdapter({
    onEvent(event) {
      queryEvents.push(event)
    },
  })

  const result = await client.executeQuery({
    queryKey: ['audit'],
    queryKeyToken: key,
    queryFn: async () => ({ data: [{ id: 99 }], error: null, status: 200, raw: { ok: true } }),
    force: true,
    dedupe: true,
  })

  assert.equal(result.error, null)
  assert.equal(eventBus.some(event => event.type === 'query_updated'), true)
  assert.equal(queryEvents.some(event => event.type === 'query_updated'), true)

  client.resetQuery(['audit'])
  assert.equal(eventBus.some(event => event.type === 'query_reset'), true)

  detachEvents()
  detachAdapter()
})

test('mutation client keeps newest mutation state (last invocation wins)', async () => {
  const client = createAthenaQueryClient()
  const key = client.getMutationKeyToken(['create-user'])
  const slow = createDeferred<{ id: string }>()
  const fast = createDeferred<{ id: string }>()

  const slowRun = client.executeMutation({
    mutationKey: ['create-user'],
    mutationKeyToken: key,
    variables: { name: 'slow' },
    mutationFn: async () => slow.promise,
  })

  const fastRun = client.executeMutation({
    mutationKey: ['create-user'],
    mutationKeyToken: key,
    variables: { name: 'fast' },
    mutationFn: async () => fast.promise,
  })

  fast.resolve({ id: 'new' })
  await fastRun

  slow.resolve({ id: 'old' })
  await slowRun

  const state = client.getMutationState<{ name: string }, { id: string }>(key)
  assert.equal(state.status, 'success')
  assert.deepEqual(state.data, { id: 'new' })
  assert.deepEqual(state.lastVariables, { name: 'fast' })
})
