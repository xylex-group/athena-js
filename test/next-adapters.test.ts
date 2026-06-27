import { strict as assert } from 'assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createAthenaBrowserClient } from '../src/next/client.ts'
import {
  createAthenaServerClient,
  resolveAthenaServerContext,
} from '../src/next/server.ts'

type Captured = {
  url: string
  init?: RequestInit
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const calls: Captured[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const stringUrl = String(url)
    calls.push({ url: stringUrl, init })
    return await handler(stringUrl, init)
  }

  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

test('createAthenaServerClient forwards request cookie and bearer context', async () => {
  const { calls, restore } = mockFetch(url => {
    if (url.endsWith('/get-session')) {
      return new Response(JSON.stringify({
        session: { id: 's_1' },
        user: { id: 'u_1', email: 'u@example.com' },
      }), { status: 200 })
    }

    return new Response(JSON.stringify([{ id: 'user_1' }]), { status: 200 })
  })

  try {
    const client = await createAthenaServerClient({
      gatewayUrl: 'https://gateway.example.com/rest/v1',
      authUrl: 'https://auth.example.com/api/auth',
      key: 'gateway-key',
      forceNoCache: true,
      requestHeaders: {
        authorization: 'Bearer bearer_1',
      },
      requestCookies:
        'athena-auth.session_token=session_cookie; theme=dark',
    })

    await client.auth.getSession()
    await client.from('users').select()

    const authHeaders = calls[0].init?.headers as Record<string, string>
    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/get-session')
    assert.equal(authHeaders.Authorization, 'Bearer bearer_1')
    assert.equal(
      authHeaders.Cookie,
      'athena-auth.session_token=session_cookie; theme=dark',
    )
    assert.equal(authHeaders['Cache-Control'], 'no-cache')

    const gatewayHeaders = calls[1].init?.headers as Record<string, string>
    assert.equal(
      calls[1].url,
      'https://gateway.example.com/rest/v1/gateway/fetch',
    )
    assert.equal(
      gatewayHeaders.Cookie,
      'athena-auth.session_token=session_cookie; theme=dark',
    )
    assert.equal(
      gatewayHeaders['X-Athena-Auth-Session-Token'],
      'session_cookie',
    )
    assert.equal(gatewayHeaders['X-Athena-Auth-Bearer-Token'], 'bearer_1')
    assert.equal(gatewayHeaders['Cache-Control'], 'no-cache')
  } finally {
    restore()
  }
})

test('createAthenaServerClient scopes user and organization from the provided session', async () => {
  const { calls, restore } = mockFetch(() =>
    new Response(JSON.stringify([{ id: 'project_1' }]), { status: 200 }),
  )

  try {
    const client = await createAthenaServerClient({
      gatewayUrl: 'https://gateway.example.com/rest/v1',
      authUrl: 'https://auth.example.com/api/auth',
      key: 'gateway-key',
      requestHeaders: {
        authorization: 'Bearer bearer_should_not_forward',
      },
      requestCookies: 'athena-auth.session_token=request_cookie',
      session: {
        user: { id: 'u_scoped' },
        session: {
          token: 'session_scoped',
          activeOrganizationId: 'org_scoped',
        },
      },
    })

    await client.from('projects').select()

    const gatewayHeaders = calls[0].init?.headers as Record<string, string>
    assert.equal(gatewayHeaders['X-User-Id'], 'u_scoped')
    assert.equal(gatewayHeaders['X-Organization-Id'], 'org_scoped')
    assert.equal(
      gatewayHeaders['X-Athena-Auth-Session-Token'],
      'session_scoped',
    )
    assert.equal(
      Object.hasOwn(gatewayHeaders, 'X-Athena-Auth-Bearer-Token'),
      false,
    )
  } finally {
    restore()
  }
})

test('createAthenaServerClient can opt into the storage module', async () => {
  const client = await createAthenaServerClient({
    gatewayUrl: 'https://gateway.example.com/rest/v1',
    authUrl: 'https://auth.example.com/api/auth',
    storageUrl: 'https://storage.example.com/storage/v1',
    key: 'gateway-key',
    requestCookies: 'athena-auth.session_token=session_cookie',
    storage: true,
  })

  assert.equal(typeof client.storage.listStorageCatalogs, 'function')
})

test('resolveAthenaServerContext resolves the current organization and returns a session-scoped client', async () => {
  const { calls, restore } = mockFetch(url => {
    if (url.endsWith('/get-session')) {
      return new Response(JSON.stringify({
        session: {
          id: 's_ctx',
          token: 'session_ctx',
          activeOrganizationId: 'org_ctx',
        },
        user: {
          id: 'u_ctx',
          email: 'ctx@example.com',
        },
      }), { status: 200 })
    }

    return new Response(JSON.stringify([{ id: 'team_1' }]), { status: 200 })
  })

  try {
    const context = await resolveAthenaServerContext({
      gatewayUrl: 'https://gateway.example.com/rest/v1',
      authUrl: 'https://auth.example.com/api/auth',
      key: 'gateway-key',
      requestCookies: 'athena-auth.session_token=session_ctx',
    })

    assert.equal(context.session?.session.activeOrganizationId, 'org_ctx')
    assert.equal(context.userId, 'u_ctx')
    assert.equal(context.organizationId, 'org_ctx')

    await context.client.from('teams').select()

    const gatewayHeaders = calls[1].init?.headers as Record<string, string>
    assert.equal(gatewayHeaders['X-User-Id'], 'u_ctx')
    assert.equal(gatewayHeaders['X-Organization-Id'], 'org_ctx')
    assert.equal(
      gatewayHeaders['X-Athena-Auth-Session-Token'],
      'session_ctx',
    )
  } finally {
    restore()
  }
})

test('createAthenaBrowserClient resolves public env aliases and defaults auth credentials to include', async () => {
  const { calls, restore } = mockFetch(() =>
    new Response(JSON.stringify({
      session: { id: 's_browser' },
      user: { id: 'u_browser', email: 'browser@example.com' },
    }), { status: 200 }),
  )

  try {
    const client = createAthenaBrowserClient({
      env: {
        NEXT_PUBLIC_ATHENA_API_KEY: 'public-key',
        NEXT_PUBLIC_ATHENA_DB_API_URL: 'https://gateway.example.com/rest/v1',
        NEXT_PUBLIC_ATHENA_AUTH_URL: 'https://auth.example.com/api/auth',
        NEXT_PUBLIC_ATHENA_CLIENT: 'browser_client',
      },
    })

    await client.auth.getSession()

    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/get-session')
    assert.equal(calls[0].init?.credentials, 'include')
  } finally {
    restore()
  }
})

test('createAthenaBrowserClient memoizes the zero-override singleton client', () => {
  const originalEnv = {
    NEXT_PUBLIC_ATHENA_API_KEY: process.env.NEXT_PUBLIC_ATHENA_API_KEY,
    NEXT_PUBLIC_ATHENA_DB_API_URL: process.env.NEXT_PUBLIC_ATHENA_DB_API_URL,
  }

  process.env.NEXT_PUBLIC_ATHENA_API_KEY = 'public-key'
  process.env.NEXT_PUBLIC_ATHENA_DB_API_URL =
    'https://gateway.example.com/rest/v1'

  try {
    const first = createAthenaBrowserClient()
    const second = createAthenaBrowserClient()

    assert.equal(first, second)
  } finally {
    process.env.NEXT_PUBLIC_ATHENA_API_KEY =
      originalEnv.NEXT_PUBLIC_ATHENA_API_KEY
    process.env.NEXT_PUBLIC_ATHENA_DB_API_URL =
      originalEnv.NEXT_PUBLIC_ATHENA_DB_API_URL
  }
})

test('package exports include the Next adapter subpaths', async () => {
  const pkg = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports: Record<
      string,
      | string
      | {
          types?: string
          import?: string
          require?: string
          default?: string
        }
    >
    typesVersions: Record<string, Record<string, string[]>>
  }

  assert.deepEqual(pkg.exports['./next/client'], {
    types: './dist/next/client.d.ts',
    import: './dist/next/client.js',
    require: './dist/next/client.cjs',
    default: './dist/next/client.js',
  })
  assert.deepEqual(pkg.exports['./next/server'], {
    types: './dist/next/server.d.ts',
    import: './dist/next/server.js',
    require: './dist/next/server.cjs',
    default: './dist/next/server.js',
  })
  assert.deepEqual(pkg.typesVersions['*']['next/client'], [
    'dist/next/client.d.ts',
  ])
  assert.deepEqual(pkg.typesVersions['*']['next/server'], [
    'dist/next/server.d.ts',
  ])
})
