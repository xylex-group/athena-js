import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createAuthClient } from '../src/auth/index.ts'
import { createClient } from '../src/client.ts'

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

test('createClient exposes auth namespace and routes auth calls to configured auth base URL', async () => {
  const { calls, restore } = mockFetch({
    session: { id: 's_1' },
    user: { id: 'u_1', email: 'u@example.com' },
  })
  try {
    const client = createClient('https://gateway.example.com', 'gateway-key', {
      auth: {
        baseUrl: 'https://auth.example.com/api/auth',
      },
    })

    const result = await client.auth.getSession()
    assert.equal(result.ok, true)
    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/get-session')
    assert.equal(calls[0].init?.method, 'GET')
    assert.equal(calls[0].init?.body, undefined)
  } finally {
    restore()
  }
})

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

test('auth namespace exposes session-level bindings', async () => {
  const { calls, restore } = mockFetch({ status: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    await client.auth.getSession()
    await client.auth.signOut()

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/get-session')
    assert.equal(calls[0].init?.method, 'GET')
    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/sign-out')
    assert.equal(calls[1].init?.method, 'POST')
  } finally {
    restore()
  }
})

test('auth namespace user/session/oauth bindings map to expected endpoints', async () => {
  const { calls, restore } = mockFetch({ status: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    await client.auth.setPassword({ newPassword: 'new-pass' })
    await client.auth.changeEmailVerify({ query: { token: 'email-token' } })
    await client.auth.deleteUserVerify({ query: { token: 'delete-token' } })
    await client.auth.user.update({ name: 'Updated' })
    await client.auth.user.delete({ password: 'secret' })
    await client.auth.user.email.list()
    await client.auth.social.link({ provider: 'google' })
    await client.auth.account.list()
    await client.auth.account.unlink({ providerId: 'google', accountId: 'acc_1' })
    await client.auth.deleteUser.callback({ token: 'cb-token' })
    await client.auth.refreshToken({ providerId: 'google', accountId: 'acc_1', userId: 'u_1' })
    await client.auth.getAccessToken({ providerId: 'google', accountId: 'acc_1', userId: 'u_1' })
    await client.auth.health()
    await client.auth.ok()
    await client.auth.error()

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/set-password')
    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/change-email/verify?token=email-token')
    assert.equal(calls[2].url, 'https://auth.example.com/api/auth/delete-user/verify?token=delete-token')
    assert.equal(calls[3].url, 'https://auth.example.com/api/auth/update-user')
    assert.equal(calls[4].url, 'https://auth.example.com/api/auth/delete-user')
    assert.equal(calls[5].url, 'https://auth.example.com/api/auth/email-list')
    assert.equal(calls[6].url, 'https://auth.example.com/api/auth/link-social')
    assert.equal(calls[7].url, 'https://auth.example.com/api/auth/list-accounts')
    assert.equal(calls[8].url, 'https://auth.example.com/api/auth/unlink-account')
    assert.equal(calls[9].url, 'https://auth.example.com/api/auth/delete-user/callback?token=cb-token')
    assert.equal(calls[10].url, 'https://auth.example.com/api/auth/refresh-token')
    assert.equal(calls[11].url, 'https://auth.example.com/api/auth/get-access-token')
    assert.equal(calls[12].url, 'https://auth.example.com/api/auth/health')
    assert.equal(calls[13].url, 'https://auth.example.com/api/auth/ok')
    assert.equal(calls[14].url, 'https://auth.example.com/api/auth/error')
  } finally {
    restore()
  }
})

test('auth.session.revoke collapses single and list payloads to correct endpoints', async () => {
  const { calls, restore } = mockFetch({ status: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })

    await client.auth.session.revoke({ token: 'tok-1' })
    await client.auth.session.revoke([{ token: 'tok-2' }])
    await client.auth.session.revoke([{ token: 'tok-3' }, { token: 'tok-4' }])
    await client.auth.session.revoke({ tokens: ['tok-5', 'tok-6'] })

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/revoke-session')
    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/revoke-session')
    assert.equal(calls[2].url, 'https://auth.example.com/api/auth/revoke-sessions')
    assert.equal(calls[3].url, 'https://auth.example.com/api/auth/revoke-sessions')
    assert.equal(calls[0].init?.body, JSON.stringify({ token: 'tok-1' }))
    assert.equal(calls[1].init?.body, JSON.stringify({ token: 'tok-2' }))
    assert.equal(calls[2].init?.body, JSON.stringify({}))
    assert.equal(calls[3].init?.body, JSON.stringify({}))
  } finally {
    restore()
  }
})

test('auth.twoFactor and auth.passkey bindings map to expected endpoints', async () => {
  const { calls, restore } = mockFetch({ status: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })

    await client.auth.twoFactor.getTotpUri({ password: 'secret' })
    await client.auth.twoFactor.verifyTotp({ code: '123456' })
    await client.auth.twoFactor.sendOtp()
    await client.auth.twoFactor.verifyOtp({ code: '654321' })
    await client.auth.twoFactor.verifyBackupCode({ code: 'backup-code' })
    await client.auth.twoFactor.generateBackupCodes({ password: 'secret' })
    await client.auth.twoFactor.enable({ password: 'secret' })
    await client.auth.twoFactor.disable({ password: 'secret' })

    await client.auth.passkey.generateRegisterOptions()
    await client.auth.passkey.generateAuthenticateOptions()
    await client.auth.passkey.verifyRegistration({ response: 'webauthn-registration-response' })
    await client.auth.passkey.verifyAuthentication({ response: 'webauthn-authentication-response' })
    await client.auth.passkey.listUserPasskeys()
    await client.auth.passkey.deletePasskey({ id: 'pk_1' })
    await client.auth.passkey.updatePasskey({ id: 'pk_1', name: 'Laptop Key' })
    await client.auth.passkey.getRelatedOrigins()

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/two-factor/get-totp-uri')
    assert.equal(calls[7].url, 'https://auth.example.com/api/auth/two-factor/disable')
    assert.equal(calls[8].url, 'https://auth.example.com/api/auth/passkey/generate-register-options')
    assert.equal(calls[12].url, 'https://auth.example.com/api/auth/passkey/list-user-passkeys')
    assert.equal(calls[15].url, 'https://auth.example.com/api/auth/.well-known/webauthn')
  } finally {
    restore()
  }
})

test('auth.admin and auth.apiKey bindings map to expected endpoints', async () => {
  const { calls, restore } = mockFetch({ status: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })

    await client.auth.admin.role.set({ userId: 'u_1', role: 'admin' })
    await client.auth.admin.user.list()
    await client.auth.admin.user.create({ email: 'new@example.com', password: 'secret' })
    await client.auth.admin.user.unban({ userId: 'u_1' })
    await client.auth.admin.user.ban({ userId: 'u_2', banReason: 'abuse' })
    await client.auth.admin.user.impersonate({ userId: 'u_3' })
    await client.auth.admin.user.stopImpersonating({ userId: 'u_3' })
    await client.auth.admin.user.session.list({ userId: 'u_3' })
    await client.auth.admin.user.session.revoke({ userId: 'u_3', sessionToken: 's_1' })
    await client.auth.admin.user.session.revoke([
      { userId: 'u_3', sessionToken: 's_2' },
      { userId: 'u_3', sessionToken: 's_3' },
    ])
    await client.auth.admin.user.session.revoke({
      sessions: [{ userId: 'u_3', sessionToken: 's_4' }],
    })
    await client.auth.admin.user.session.revoke({ userId: 'u_3' })
    await client.auth.admin.user.remove({ userId: 'u_4' })
    await client.auth.admin.user.setPassword({ userId: 'u_4', newPassword: 'new-pass' })
    await client.auth.admin.hasPermission({ permissions: { users: ['manage'] } })
    await client.auth.admin.apiKey.create({ name: 'test-key', expiresIn: 3600 })
    await client.auth.admin.athenaClient.create({ clientName: 'demo-client' })
    await client.auth.admin.athenaClient.list()
    await client.auth.admin.auditLog.list()
    await client.auth.admin.email.get({ query: { id: 'email_1' } })
    await client.auth.admin.email.create({
      recipientEmail: 'to@example.com',
      subject: 'Welcome',
      fromAddress: 'no-reply@example.com',
      provider: 'resend',
    })
    await client.auth.admin.email.update({ id: 'email_1', subject: 'Welcome Updated' })
    await client.auth.admin.email.delete({ id: 'email_1' })
    await client.auth.admin.email.failure.list()
    await client.auth.admin.email.failure.get({ query: { id: 'failure_1' } })
    await client.auth.admin.email.failure.create({
      recipientEmail: 'to@example.com',
      flow: 'transactional',
      errorMessage: 'bounce',
    })
    await client.auth.admin.email.failure.update({ id: 'failure_1', resolved: true })
    await client.auth.admin.email.failure.delete({ id: 'failure_1' })
    await client.auth.admin.email.template.create({ templateKey: 'welcome', subjectTemplate: 'Welcome' })
    await client.auth.admin.email.template.delete({ id: 'tmpl_1' })
    await client.auth.admin.email.template.list()
    await client.auth.admin.email.template.update({ id: 'tmpl_1', subjectTemplate: 'Welcome 2' })
    await client.auth.admin.email.list()
    await client.auth.admin.emailTemplate.create({ templateKey: 'legacy', subjectTemplate: 'Legacy' })
    await client.auth.admin.emailTemplate.delete({ id: 'legacy_tmpl_1' })
    await client.auth.admin.emailTemplate.list()
    await client.auth.admin.emailTemplate.update({ id: 'legacy_tmpl_1', subjectTemplate: 'Legacy 2' })

    await client.auth.apiKey.create({ name: 'user-key', expiresIn: '3600', remaining: '1000' })
    await client.auth.apiKey.get({ query: { id: 'key_1' } })
    await client.auth.apiKey.update({ keyId: 'key_1', name: 'updated', expiresIn: '3600', permissions: '{}' })
    await client.auth.apiKey.delete({ keyId: 'key_1' })
    await client.auth.apiKey.list()
    await client.auth.apiKey.verify({ key: 'prefix.secret' })
    await client.auth.apiKey.deleteAllExpired()

    const requestedUrls = calls.map(call => call.url)

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/admin/set-role')
    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/admin/list-users')
    assert.equal(calls[8].url, 'https://auth.example.com/api/auth/admin/revoke-user-session')
    assert.equal(calls[9].url, 'https://auth.example.com/api/auth/admin/revoke-user-sessions')
    assert.equal(calls[10].url, 'https://auth.example.com/api/auth/admin/revoke-user-session')
    assert.equal(calls[11].url, 'https://auth.example.com/api/auth/admin/revoke-user-sessions')
    assert.equal(calls[17].url, 'https://auth.example.com/api/auth/admin/athena-client/list')
    assert.equal(calls[8].init?.body, JSON.stringify({ userId: 'u_3', sessionToken: 's_1' }))
    assert.equal(calls[9].init?.body, JSON.stringify({ userId: 'u_3' }))
    assert.equal(calls[10].init?.body, JSON.stringify({ userId: 'u_3', sessionToken: 's_4' }))
    assert.equal(calls[11].init?.body, JSON.stringify({ userId: 'u_3' }))
    assert.ok(requestedUrls.includes('https://auth.example.com/api/auth/admin/email/get?id=email_1'))
    assert.ok(requestedUrls.includes('https://auth.example.com/api/auth/admin/email/create'))
    assert.ok(requestedUrls.includes('https://auth.example.com/api/auth/admin/email/update'))
    assert.ok(requestedUrls.includes('https://auth.example.com/api/auth/admin/email/delete'))
    assert.ok(requestedUrls.includes('https://auth.example.com/api/auth/admin/email-failure/list'))
    assert.ok(requestedUrls.includes('https://auth.example.com/api/auth/admin/email-failure/get?id=failure_1'))
    assert.ok(requestedUrls.includes('https://auth.example.com/api/auth/admin/email-failure/create'))
    assert.ok(requestedUrls.includes('https://auth.example.com/api/auth/admin/email-failure/update'))
    assert.ok(requestedUrls.includes('https://auth.example.com/api/auth/admin/email-failure/delete'))
    assert.ok(requestedUrls.includes('https://auth.example.com/api/auth/admin/email-template/update'))
    assert.ok(requestedUrls.includes('https://auth.example.com/api/auth/api-key/create'))
    assert.ok(requestedUrls.includes('https://auth.example.com/api/auth/api-key/delete-all-expired-api-keys'))

    assert.equal(calls.find(call => call.url === 'https://auth.example.com/api/auth/admin/email/get?id=email_1')?.init?.method, 'GET')
    assert.equal(calls.find(call => call.url === 'https://auth.example.com/api/auth/admin/email/create')?.init?.method, 'POST')
    assert.equal(calls.find(call => call.url === 'https://auth.example.com/api/auth/admin/email/update')?.init?.method, 'POST')
    assert.equal(calls.find(call => call.url === 'https://auth.example.com/api/auth/admin/email/delete')?.init?.method, 'POST')
    assert.equal(calls.find(call => call.url === 'https://auth.example.com/api/auth/admin/email-failure/list')?.init?.method, 'GET')
    assert.equal(calls.find(call => call.url === 'https://auth.example.com/api/auth/admin/email-failure/get?id=failure_1')?.init?.method, 'GET')
    assert.equal(calls.find(call => call.url === 'https://auth.example.com/api/auth/admin/email-failure/create')?.init?.method, 'POST')
    assert.equal(calls.find(call => call.url === 'https://auth.example.com/api/auth/admin/email-failure/update')?.init?.method, 'POST')
    assert.equal(calls.find(call => call.url === 'https://auth.example.com/api/auth/admin/email-failure/delete')?.init?.method, 'POST')
    assert.equal(calls.find(call => call.url === 'https://auth.example.com/api/auth/admin/email-template/list')?.init?.method, 'GET')
    assert.equal(calls.find(call => call.url === 'https://auth.example.com/api/auth/admin/email-template/create')?.init?.method, 'POST')
    assert.equal(calls.find(call => call.url === 'https://auth.example.com/api/auth/admin/email-template/update')?.init?.method, 'POST')
    assert.equal(calls.find(call => call.url === 'https://auth.example.com/api/auth/admin/email-template/delete')?.init?.method, 'POST')
  } finally {
    restore()
  }
})

test('auth.organization bindings map to expected endpoints', async () => {
  const { calls, restore } = mockFetch({ status: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })

    await client.auth.organization.create({ name: 'Acme', slug: 'acme' })
    await client.auth.organization.update({ organizationId: 'org_1', data: { name: 'Acme 2' } })
    await client.auth.organization.delete({ organizationId: 'org_1' })
    await client.auth.organization.setActive({ organizationId: 'org_1' })
    await client.auth.organization.list()
    await client.auth.organization.getFull({ query: { organizationId: 'org_1' } })
    await client.auth.organization.invitation.cancel({ invitationId: 'inv_1' })
    await client.auth.organization.invitation.accept({ invitationId: 'inv_1' })
    await client.auth.organization.invitation.get({ query: { id: 'inv_1' } })
    await client.auth.organization.invitation.reject({ invitationId: 'inv_1' })
    await client.auth.organization.checkSlug({ slug: 'acme' })
    await client.auth.organization.member.remove({ memberIdOrEmail: 'user@example.com' })
    await client.auth.organization.member.updateRole({ memberId: 'mem_1', role: 'admin' })
    await client.auth.organization.member.invite({ email: 'user@example.com', role: 'member' })
    await client.auth.organization.member.getActive()
    await client.auth.organization.member.list()
    await client.auth.organization.leave({ organizationId: 'org_1' })
    await client.auth.organization.invitation.list()
    await client.auth.organization.listUserInvitations()
    await client.auth.organization.hasPermission({ permissions: ['org:manage'] })

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/organization/create')
    assert.equal(calls[1].url, 'https://auth.example.com/api/auth/organization/update')
    assert.equal(calls[2].url, 'https://auth.example.com/api/auth/organization/delete')
    assert.equal(calls[3].url, 'https://auth.example.com/api/auth/organization/set-active')
    assert.equal(calls[4].url, 'https://auth.example.com/api/auth/organization/list')
    assert.equal(calls[5].url, 'https://auth.example.com/api/auth/organization/get-full-organization?organizationId=org_1')
    assert.equal(calls[6].url, 'https://auth.example.com/api/auth/organization/cancel-invitation')
    assert.equal(calls[7].url, 'https://auth.example.com/api/auth/organization/accept-invitation')
    assert.equal(calls[8].url, 'https://auth.example.com/api/auth/organization/get-invitation?id=inv_1')
    assert.equal(calls[9].url, 'https://auth.example.com/api/auth/organization/reject-invitation')
    assert.equal(calls[10].url, 'https://auth.example.com/api/auth/organization/check-slug')
    assert.equal(calls[11].url, 'https://auth.example.com/api/auth/organization/remove-member')
    assert.equal(calls[12].url, 'https://auth.example.com/api/auth/organization/update-member-role')
    assert.equal(calls[13].url, 'https://auth.example.com/api/auth/organization/invite-member')
    assert.equal(calls[14].url, 'https://auth.example.com/api/auth/organization/get-active-member')
    assert.equal(calls[15].url, 'https://auth.example.com/api/auth/organization/list-members')
    assert.equal(calls[16].url, 'https://auth.example.com/api/auth/organization/leave')
    assert.equal(calls[17].url, 'https://auth.example.com/api/auth/organization/list-invitations')
    assert.equal(calls[18].url, 'https://auth.example.com/api/auth/organization/list-user-invitations')
    assert.equal(calls[19].url, 'https://auth.example.com/api/auth/organization/has-permission')
  } finally {
    restore()
  }
})

test('auth.callback.provider resolves dynamic provider endpoint', async () => {
  const { calls, restore } = mockFetch({ ok: true })
  try {
    const client = createAuthClient({ baseUrl: 'https://auth.example.com/api/auth' })
    await client.auth.callback.provider({ provider: 'github', code: 'oauth-code', state: 'oauth-state' })
    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/callback/github?code=oauth-code&state=oauth-state')
    assert.equal(calls[0].init?.method, 'GET')
  } finally {
    restore()
  }
})
