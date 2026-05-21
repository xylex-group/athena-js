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
    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/sign-in/email')
    assert.equal(calls[0].init?.method, 'POST')
    const body = JSON.parse(calls[0].init?.body as string)
    assert.equal(body.email, 'u@x.com')
    assert.equal(body.password, 'secret')
    assert.equal(body.callbackURL, 'https://app.example.com/callback')
    assert.equal(body.rememberMe, true)
  } finally {
    restore()
  }
})

test('signIn.username and signIn.social target correct endpoints', async () => {
  const { calls, restore } = mockFetch({ token: 't', user: { id: 'u', email: 'u@x.com' } })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    await client.signIn.username({ username: 'demo', password: 'secret', rememberMe: true })
    await client.signIn.social({ provider: 'google', callbackURL: 'https://app.example.com/cb' })

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/sign-in/username')
    assert.equal(calls[0].init?.method, 'POST')
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
      username: 'demo',
      password: 'secret',
      rememberMe: true,
    })

    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/sign-in/social')
    assert.equal(calls[1].init?.method, 'POST')
    assert.deepEqual(JSON.parse(calls[1].init?.body as string), {
      provider: 'google',
      callbackURL: 'https://app.example.com/cb',
    })
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

test('session revoke aliases target proper endpoints', async () => {
  const { calls, restore } = mockFetch({ status: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    await client.revokeSession({ token: 'tok-a' })
    await client.clearSession({ token: 'tok-b' })
    await client.revokeSessions()
    await client.clearSessions()
    await client.revokeOtherSessions()
    await client.clearOtherSessions()

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/revoke-session')
    assert.deepEqual(JSON.parse(calls[0].init?.body as string), { token: 'tok-a' })
    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/revoke-session')
    assert.deepEqual(JSON.parse(calls[1].init?.body as string), { token: 'tok-b' })
    assert.equal(calls[2].url, 'https://auth.example.com/api/auth/revoke-sessions')
    assert.equal(calls[3].url, 'https://auth.example.com/api/auth/revoke-sessions')
    assert.equal(calls[4].url, 'https://auth.example.com/api/auth/revoke-other-sessions')
    assert.equal(calls[5].url, 'https://auth.example.com/api/auth/revoke-other-sessions')
  } finally {
    restore()
  }
})

test('password and email lifecycle methods map to correct endpoints', async () => {
  const { calls, restore } = mockFetch({ status: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    await client.forgetPassword({ email: 'u@example.com', redirectTo: 'https://app/reset' })
    await client.resetPassword({ newPassword: 'new-pass', token: 'rtok' })
    await client.sendVerificationEmail({ email: 'u@example.com', callbackURL: 'https://app/verify' })
    await client.changeEmail({ newEmail: 'new@example.com', callbackURL: 'https://app/callback' })
    await client.changePassword({
      newPassword: 'new-pass',
      currentPassword: 'old-pass',
      revokeOtherSessions: true,
    })

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/forget-password')
    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/reset-password')
    assert.equal(calls[2].url, 'https://auth.example.com/api/auth/send-verification-email')
    assert.equal(calls[3].url, 'https://auth.example.com/api/auth/change-email')
    assert.equal(calls[4].url, 'https://auth.example.com/api/auth/change-password')
  } finally {
    restore()
  }
})

test('user lifecycle methods map to correct endpoints', async () => {
  const { calls, restore } = mockFetch({ success: true, message: 'User deleted' })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    await client.updateUser({ name: 'Updated', image: 'https://img.local/u.png' })
    await client.deleteUser({ password: 'secret' })
    await client.deleteUserCallback({ token: 'cb-token', callbackURL: 'https://app/delete-callback' })

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/update-user')
    assert.equal(calls[0].init?.method, 'POST')
    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/delete-user')
    assert.equal(calls[1].init?.method, 'POST')
    assert.equal(calls[2].url, 'https://auth.example.com/api/auth/delete-user/callback?token=cb-token&callbackURL=https%3A%2F%2Fapp%2Fdelete-callback')
    assert.equal(calls[2].init?.method, 'GET')
  } finally {
    restore()
  }
})

test('verifyEmail and resolveResetPasswordToken use query routes', async () => {
  const { calls, restore } = mockFetch({ status: true, user: { id: 'u', email: 'u@example.com' } })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    await client.verifyEmail({ token: 'email-token', callbackURL: 'https://app/verified' })
    await client.resolveResetPasswordToken({ token: 'resettok', callbackURL: 'https://app/reset-password' })

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/verify-email?token=email-token&callbackURL=https%3A%2F%2Fapp%2Fverified')
    assert.equal(calls[0].init?.method, 'GET')
    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/reset-password/resettok?callbackURL=https%3A%2F%2Fapp%2Freset-password')
    assert.equal(calls[1].init?.method, 'GET')
  } finally {
    restore()
  }
})

test('account linking and token exchange methods map correctly', async () => {
  const { calls, restore } = mockFetch({ status: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    await client.linkSocial({ provider: 'google', callbackURL: 'https://app/callback' })
    await client.listAccounts()
    await client.unlinkAccount({ providerId: 'google', accountId: 'acc_1' })
    await client.refreshToken({ providerId: 'google', accountId: 'acc_1', userId: 'u_1' })
    await client.getAccessToken({ providerId: 'google', accountId: 'acc_1', userId: 'u_1' })

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/link-social')
    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/list-accounts')
    assert.equal(calls[2].url, 'https://auth.example.com/api/auth/unlink-account')
    assert.equal(calls[3].url, 'https://auth.example.com/api/auth/refresh-token')
    assert.equal(calls[4].url, 'https://auth.example.com/api/auth/get-access-token')
  } finally {
    restore()
  }
})

test('generic request infers methods safely and supports query', async () => {
  const { calls, restore } = mockFetch({ ok: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    await client.request({ endpoint: '/ok', query: { ping: 'pong', many: [1, 2] } })
    await client.request({ endpoint: '/revoke-sessions' })
    await client.request({ endpoint: '/reset-password/resettok' })
    await client.request({ endpoint: '/error', body: { message: 'x' } })

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/ok?ping=pong&many=1&many=2')
    assert.equal(calls[0].init?.method, 'GET')
    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/revoke-sessions')
    assert.equal(calls[1].init?.method, 'POST')
    assert.equal(calls[1].init?.body, '{}')
    assert.equal(calls[2].url, 'https://auth.example.com/api/auth/reset-password/resettok')
    assert.equal(calls[2].init?.method, 'GET')
    assert.equal(calls[3].url, 'https://auth.example.com/api/auth/error')
    assert.equal(calls[3].init?.method, 'POST')
    assert.deepEqual(JSON.parse(calls[3].init?.body as string), { message: 'x' })
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
