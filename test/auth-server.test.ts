import { strict as assert } from 'assert'
import { test } from 'node:test'
import {
  athenaAuth,
  defineAthenaAuthConfig,
} from '../src/index.ts'
import { parseSetCookieHeader } from '../src/cookies/index.ts'

function createCookieAfterPlugin() {
  return {
    id: 'cookie-after-plugin',
    version: 'test',
    hooks: {
      after: [
        {
          matcher: () => true,
          async handler(ctx: { auth: ReturnType<typeof athenaAuth>; headers?: Headers; context: Record<string, unknown> }) {
            await ctx.auth.applyResponseCookies({
              headers: ctx.headers,
              context: ctx.context,
            })
          },
        },
      ],
    },
  }
}

test('defineAthenaAuthConfig keeps auth bootstrap config typed', () => {
  const db = { kind: 'd1' }
  const config = defineAthenaAuthConfig({
    baseURL: 'https://app.example.com',
    secret: 'secret',
    database: db,
    socialProviders: {
      github: {
        clientId: 'github-client-id',
        clientSecret: 'github-client-secret',
        scope: ['repo', 'read:org', 'user:email'],
      },
    },
    plugins: [createCookieAfterPlugin()],
  })

  assert.equal(config.database.kind, 'd1')
  assert.equal(config.socialProviders.github.scope?.[0], 'repo')
})

test('athenaAuth resolves database factories and secure cookie defaults from baseURL', () => {
  const db = { binding: 'DB' }
  const auth = athenaAuth({
    baseURL: 'https://app.example.com',
    secret: 'secret',
    database: () => db,
  })

  assert.equal(auth.database, db)
  assert.equal(auth.cookies.sessionToken.name, '__Secure-athena-auth.session_token')
})

test('athenaAuth exposes the Better Auth-style top-level contract', () => {
  const database = { binding: 'DB' }
  const auth = athenaAuth({
    baseURL: 'https://app.example.com',
    secret: 'secret',
    database,
    plugins: [createCookieAfterPlugin()],
  })

  assert.equal(auth.database, database)
  assert.equal(auth.options, auth.config)
  assert.equal(typeof auth.handler, 'function')
  assert.equal(typeof auth.api.setSession, 'function')
  assert.equal(auth.plugins[0]?.id, 'cookie-after-plugin')
  assert.equal(auth.cookies.sessionToken.name, '__Secure-athena-auth.session_token')
  assert.equal(auth.$ERROR_CODES.HANDLER_NOT_CONFIGURED, 'HANDLER_NOT_CONFIGURED')
})

test('athenaAuth context resolves trusted origins/providers', async () => {
  const auth = athenaAuth({
    baseURL: 'https://app.example.com',
    secret: 'secret',
    database: { binding: 'DB' },
    socialProviders: {
      github: {
        clientId: 'github-client-id',
        clientSecret: 'github-client-secret',
      },
    },
    trustedOrigins: ['https://frontend.example.com'],
    trustedProviders: ['google'],
  })

  const context = await auth.$context

  assert.equal(context.baseURL, 'https://app.example.com')
  assert.deepEqual(context.trustedOrigins, [
    'https://app.example.com',
    'https://frontend.example.com',
  ])
  assert.deepEqual(context.trustedProviders, ['github', 'google'])
})

test('athenaAuth handler resolves dynamic baseURL and applies cookie hooks to handler results', async () => {
  const auth = athenaAuth({
    baseURL: {
      protocol: 'https',
      allowedHosts: ['app.example.com'],
    },
    secret: 'secret',
    database: { binding: 'DB' },
    trustedOrigins: async request => [request?.headers.get('origin') ?? 'https://frontend.example.com'],
    plugins: [createCookieAfterPlugin()],
    handler: async ctx => {
      assert.equal(ctx.baseURL, 'https://app.example.com')
      assert.deepEqual(ctx.trustedOrigins, ['https://app.example.com', 'https://frontend.example.com'])
      return {
        response: new Response('ok'),
        setSession: {
          session: {
            id: 'session_1',
            token: 'session_token_value',
          },
          user: {
            id: 'user_1',
            email: 'demo@example.com',
          },
        },
      }
    },
  })

  const response = await auth.handler(new Request('https://app.example.com/api/auth/session', {
    headers: {
      origin: 'https://frontend.example.com',
    },
  }))

  assert.equal(await response.text(), 'ok')
  const parsed = parseSetCookieHeader(response.headers.get('set-cookie') ?? '')
  assert.equal(parsed.get('__Secure-athena-auth.session_token')?.value, 'session_token_value')
})

test('athenaAuth applyResponseCookies sets session cookies using native cookie helpers', async () => {
  const auth = athenaAuth({
    baseURL: 'https://app.example.com',
    secret: 'secret',
    database: { binding: 'DB' },
    session: {
      cookieCache: {
        enabled: true,
      },
    },
  })
  const responseHeaders = new Headers()

  await auth.applyResponseCookies({
    headers: new Headers(),
    context: {
      responseHeaders,
      setSession: {
        session: {
          id: 'session_1',
          token: 'session_token_value',
        },
        user: {
          id: 'user_1',
          email: 'demo@example.com',
        },
      },
    },
  })

  const parsed = parseSetCookieHeader(responseHeaders.get('set-cookie') ?? '')
  const sessionCookie = parsed.get('__Secure-athena-auth.session_token')
  assert.equal(sessionCookie?.value, 'session_token_value')
  assert.equal(parsed.has('__Secure-athena-auth.session_data'), true)
})

test('custom after plugin can apply auth response cookies through after hooks', async () => {
  const auth = athenaAuth({
    baseURL: 'https://app.example.com',
    secret: 'secret',
    database: { binding: 'DB' },
    plugins: [createCookieAfterPlugin()],
  })
  const responseHeaders = new Headers()

  await auth.runAfterHooks({
    headers: new Headers(),
    context: {
      responseHeaders,
      setSession: {
        session: {
          id: 'session_1',
          token: 'session_token_value',
        },
        user: {
          id: 'user_1',
          email: 'demo@example.com',
        },
      },
    },
  })

  const parsed = parseSetCookieHeader(responseHeaders.get('set-cookie') ?? '')
  assert.equal(parsed.get('__Secure-athena-auth.session_token')?.value, 'session_token_value')
})

test('custom after plugin can clear auth cookies through after hooks', async () => {
  const auth = athenaAuth({
    baseURL: 'https://app.example.com',
    secret: 'secret',
    database: { binding: 'DB' },
    plugins: [createCookieAfterPlugin()],
  })
  const responseHeaders = new Headers()

  await auth.runAfterHooks({
    headers: new Headers({
      cookie: '__Secure-athena-auth.session_token=session_token_value',
    }),
    context: {
      responseHeaders,
      clearSession: true,
    },
  })

  const parsed = parseSetCookieHeader(responseHeaders.get('set-cookie') ?? '')
  assert.equal(parsed.get('__Secure-athena-auth.session_token')?.['max-age'], 0)
  assert.equal(parsed.get('__Secure-athena-auth.session_data')?.['max-age'], 0)
})
