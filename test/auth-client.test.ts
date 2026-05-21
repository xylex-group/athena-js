import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createAuthClient } from '../src/auth/index.ts'

type Captured = {
  url: string
  init?: RequestInit
}

function mockFetch(responseBody: unknown = { ok: true }, responseInit: ResponseInit = { status: 200 }) {
  const calls: Captured[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const body = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
    return new Response(body, responseInit)
  }
  return {
    calls,
    restore: () => (globalThis.fetch = original),
  }
}

test('signIn.email posts to sign-in endpoint with payload', async () => {
  const { calls, restore } = mockFetch({ redirect: false, token: 't', user: { id: 'u', email: 'u@x.com' } })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth/' })
    const response = await client.signIn.email({
      email: 'u@x.com',
      password: 'secret',
      callbackURL: 'https://app.example.com/callback',
      rememberMe: true,
    })

    assert.equal(response.ok, true)
    assert.equal(response.status, 200)
    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/sign-in/email')
    assert.equal(calls[0].init?.method, 'POST')
    assert.equal(calls[0].init?.credentials, 'include')
    const body = JSON.parse(calls[0].init?.body as string)
    assert.equal(body.email, 'u@x.com')
    assert.equal(body.password, 'secret')
    assert.equal(body.callbackURL, 'https://app.example.com/callback')
    assert.equal(body.rememberMe, true)
  } finally {
    restore()
  }
})

test('signOut and logout send empty object payload to sign-out endpoint', async () => {
  const { calls, restore } = mockFetch({ success: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    await client.signOut()
    await client.logout()

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/sign-out')
    assert.equal(calls[0].init?.method, 'POST')
    assert.equal(calls[0].init?.body, '{}')

    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/sign-out')
    assert.equal(calls[1].init?.method, 'POST')
    assert.equal(calls[1].init?.body, '{}')
  } finally {
    restore()
  }
})

test('getSession and listSessions use GET endpoints', async () => {
  const original = globalThis.fetch
  const calls: Captured[] = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/get-session')) {
      return new Response(JSON.stringify({ session: { id: 's1' }, user: { id: 'u1', email: 'u@example.com' } }), {
        status: 200,
      })
    }
    return new Response(JSON.stringify([{ id: 's1' }, { id: 's2' }]), { status: 200 })
  }

  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    const sessionResponse = await client.getSession()
    const listResponse = await client.listSessions()

    assert.equal(sessionResponse.ok, true)
    assert.equal(sessionResponse.data?.session.id, 's1')
    assert.equal(listResponse.ok, true)
    assert.equal(listResponse.data?.length, 2)

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/get-session')
    assert.equal(calls[0].init?.method, 'GET')
    assert.equal(calls[0].init?.body, undefined)

    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/list-sessions')
    assert.equal(calls[1].init?.method, 'GET')
    assert.equal(calls[1].init?.body, undefined)
  } finally {
    globalThis.fetch = original
  }
})

test('revokeSession and clearSession target revoke-session endpoint', async () => {
  const { calls, restore } = mockFetch({ status: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    await client.revokeSession({ token: 'tok-a' })
    await client.clearSession({ token: 'tok-b' })

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/revoke-session')
    assert.equal(calls[0].init?.method, 'POST')
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), { token: 'tok-a' })

    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/revoke-session')
    assert.equal(calls[1].init?.method, 'POST')
    assert.deepEqual(JSON.parse(calls[1].init?.body as string), { token: 'tok-b' })
  } finally {
    restore()
  }
})

test('revokeSessions and clearSessions target revoke-sessions endpoint', async () => {
  const { calls, restore } = mockFetch({ status: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    await client.revokeSessions()
    await client.clearSessions()

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/revoke-sessions')
    assert.equal(calls[0].init?.method, 'POST')
    assert.equal(calls[0].init?.body, '{}')

    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/revoke-sessions')
    assert.equal(calls[1].init?.method, 'POST')
    assert.equal(calls[1].init?.body, '{}')
  } finally {
    restore()
  }
})

test('supports fetchOptions compatibility input and call overrides', async () => {
  const { calls, restore } = mockFetch({ redirect: false, token: 't', user: { id: 'u', email: 'u@x.com' } })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth', apiKey: 'config-key' })
    await client.signIn.email(
      {
        email: 'u@x.com',
        password: 'secret',
        fetchOptions: {
          bearerToken: 'fetch-token',
          headers: { 'X-Fetch-Only': 'yes' },
        },
      },
      {
        bearerToken: 'call-token',
        headers: { 'X-Call-Only': 'yes' },
        credentials: 'omit',
      },
    )

    const headers = calls[0].init?.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bearer call-token')
    assert.equal(headers.apikey, 'config-key')
    assert.equal(headers['x-api-key'], 'config-key')
    assert.equal(headers['X-Fetch-Only'], 'yes')
    assert.equal(headers['X-Call-Only'], 'yes')
    assert.equal(calls[0].init?.credentials, 'omit')
  } finally {
    restore()
  }
})

test('non-2xx responses are normalized into HTTP_ERROR', async () => {
  const { restore } = mockFetch(
    { message: 'unauthorized' },
    { status: 401, headers: { 'content-type': 'application/json', 'x-request-id': 'auth_req_1' } },
  )
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    const response = await client.getSession()
    assert.equal(response.ok, false)
    assert.equal(response.status, 401)
    assert.equal(response.error, 'unauthorized')
    assert.equal(response.errorDetails?.code, 'HTTP_ERROR')
    assert.equal(response.errorDetails?.requestId, 'auth_req_1')
    assert.equal(response.errorDetails?.endpoint, '/get-session')
    assert.equal(response.errorDetails?.method, 'GET')
  } finally {
    restore()
  }
})

test('invalid JSON responses are normalized into INVALID_JSON', async () => {
  const { restore } = mockFetch('{"broken"', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    const response = await client.getSession()
    assert.equal(response.ok, false)
    assert.equal(response.status, 200)
    assert.equal(response.error, 'Auth server returned malformed JSON')
    assert.equal(response.errorDetails?.code, 'INVALID_JSON')
  } finally {
    restore()
  }
})

test('network failures are normalized into NETWORK_ERROR', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED')
  }
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    const response = await client.listSessions()
    assert.equal(response.ok, false)
    assert.equal(response.status, 0)
    assert.equal(response.errorDetails?.code, 'NETWORK_ERROR')
    assert.equal(response.errorDetails?.endpoint, '/list-sessions')
    assert.equal(response.errorDetails?.method, 'GET')
    assert.match(response.error ?? '', /Network error while calling GET \/list-sessions/)
  } finally {
    globalThis.fetch = original
  }
})
