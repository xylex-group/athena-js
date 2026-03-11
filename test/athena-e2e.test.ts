import { strict as assert } from 'assert'
import { test } from 'node:test'
import crypto from 'crypto'
import { createClient } from '../src/supabase.ts'

const ATHENA_URL = process.env.ATHENA_URL ?? 'https://mirror3.athena-db.com'
const ATHENA_API_KEY = process.env.ATHENA_API_KEY ?? 'x'
const ATHENA_CLIENT = process.env.ATHENA_CLIENT ?? 'athena_logging'

if (!ATHENA_URL || !ATHENA_API_KEY) {
  throw new Error('ATHENA_URL and ATHENA_API_KEY are required for E2E tests')
}

test('e2e: insert, filter, and delete rows in test table (athena_logging client)', async () => {
  const client = createClient(ATHENA_URL, ATHENA_API_KEY, { client: ATHENA_CLIENT })
  const runId = `e2e-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const uuid = crypto.randomUUID()
  const payload = {
    test_bool: true,
    test_text: runId,
    test_number: 42,
    test_json: { runId, ok: true },
    test_time: null, // optional: avoid type mismatch against time column
    test_uuid: uuid,
  }

  let insertedId: number | undefined

  try {
    const insertResult = await client
      .from('test')
      .insert(payload)
      .single('id,test_bool,test_text,test_number,test_json,test_time,test_uuid')

    assert.ok(
      insertResult.status >= 200 && insertResult.status < 300,
      `unexpected insert status: ${insertResult.status}`,
    )
    if (insertResult.error && insertResult.error !== 'Data inserted successfully') {
      assert.fail(`insert failed: ${insertResult.error}`)
    }
    const insertedData = insertResult.data as { id?: number } | { id?: number }[] | null
    if (Array.isArray(insertedData)) {
      insertedId = insertedData[0]?.id
    } else {
      insertedId = insertedData?.id
    }

    const fetchResult = await client
      .from('test')
      .select('id,test_bool,test_text,test_number,test_json,test_time,test_uuid')
      .eq('test_text', runId)

    assert.equal(fetchResult.error, null, `fetch failed: ${fetchResult.error ?? ''}`)
    assert.ok(Array.isArray(fetchResult.data), 'fetch should return an array')
    assert.equal(fetchResult.data?.length, 1, 'fetch should return one matching row')
    const row = fetchResult.data?.[0] as Record<string, unknown>
    insertedId = insertedId ?? (row?.id as number | undefined)
    assert.ok(insertedId, 'expected to resolve inserted id')
    assert.equal(row?.test_uuid, uuid)
    assert.equal(row?.test_text, runId)
    assert.equal(row?.test_bool, true)
    assert.equal(row?.test_number, 42)
    assert.ok(row?.test_json)

    const expectOne = async (builder: ReturnType<typeof client.from>) => {
      const res = await builder
      assert.equal(res.error, null, `filter failed: ${res.error ?? ''}`)
      assert.ok(Array.isArray(res.data), 'filter should return an array')
      assert.equal(res.data?.length, 1, 'filter should return one matching row')
      const r = res.data?.[0] as Record<string, unknown>
      assert.equal(r?.id, insertedId)
    }

    await expectOne(
      client
        .from('test')
        .select('id')
        .eq('id', insertedId!)
        .eq('test_text', runId),
    )

    await expectOne(
      client
        .from('test')
        .select('id')
        .eq('id', insertedId!)
        .neq('test_text', 'other'),
    )

    await expectOne(
      client
        .from('test')
        .select('id')
        .eq('id', insertedId!)
        .gt('test_number', 40),
    )

    await expectOne(
      client
        .from('test')
        .select('id')
        .eq('id', insertedId!)
        .gte('test_number', 42),
    )

    await expectOne(
      client
        .from('test')
        .select('id')
        .eq('id', insertedId!)
        .lt('test_number', 100),
    )

    await expectOne(
      client
        .from('test')
        .select('id')
        .eq('id', insertedId!)
        .lte('test_number', 42),
    )

    await expectOne(
      client
        .from('test')
        .select('id')
        .eq('id', insertedId!)
        .like('test_text', `%${runId}%`),
    )

    await expectOne(
      client
        .from('test')
        .select('id')
        .eq('id', insertedId!)
        .ilike('test_text', `%${runId.toUpperCase()}%`),
    )

    await expectOne(
      client
        .from('test')
        .select('id')
        .eq('id', insertedId!)
        .is('test_time', null),
    )

    await expectOne(
      client
        .from('test')
        .select('id')
        .eq('id', insertedId!)
        .in('test_text', [runId, 'other']),
    )

    await expectOne(
      client
        .from('test')
        .select('id')
        .eq('id', insertedId!)
        .not('test_text', 'eq', 'other'),
    )

    await expectOne(
      client
        .from('test')
        .select('id')
        .eq('id', insertedId!)
        .or(`test_text.eq.${runId}`),
    )
  } finally {
    if (insertedId) {
      await client.from('test').eq('id', insertedId).delete()
    }
  }
})
