import { strict as assert } from 'assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  getCookieCache,
  getSessionCookie,
  parseSetCookieHeader,
  setCookieToHeader,
  setSessionCookie,
  setRequestCookie,
  splitSetCookieHeader,
} from '../src/cookies/index.ts'
import type { AthenaCookieContextRuntime } from '../src/cookies/index.ts'

type MutableCookieContext = AthenaCookieContextRuntime & {
  __cookies: Map<string, string>
}

function serializeCookieMap(cookies: Map<string, string>): string {
  return Array.from(cookies.entries())
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ')
}

function createCookieContext(secret = 'super-secret-value'): MutableCookieContext {
  const cookies = new Map<string, string>()
  const headers = new Headers()

  const context: MutableCookieContext = {
    __cookies: cookies,
    headers,
    getCookie: (name: string) => cookies.get(name) ?? null,
    setCookie: (name: string, value: string) => {
      cookies.set(name, value)
      headers.set('cookie', serializeCookieMap(cookies))
    },
    context: {
      secret,
      authCookies: {
        sessionToken: {
          name: 'athena-auth.session_token',
          attributes: {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: false,
          },
        },
        sessionData: {
          name: 'athena-auth.session_data',
          attributes: {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: false,
            maxAge: 300,
          },
        },
        dontRememberToken: {
          name: 'athena-auth.dont_remember',
          attributes: {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: false,
          },
        },
        accountData: {
          name: 'athena-auth.account_data',
          attributes: {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: false,
          },
        },
      },
      sessionConfig: {
        expiresIn: 60 * 60 * 24 * 7,
      },
      options: {
        session: {
          cookieCache: {
            enabled: true,
            strategy: 'compact',
            maxAge: 300,
          },
        },
      },
      setNewSession: () => undefined,
    },
  }

  return context
}

test('getSessionCookie resolves athena-auth and secure cookie names by default', () => {
  const headers = new Headers()
  headers.set(
    'cookie',
    '__Secure-athena-auth.session_token=secure-token; athena-auth.session_data=cache-data',
  )

  const token = getSessionCookie(headers)
  assert.equal(token, 'secure-token')
})

test('getSessionCookie supports explicit cookiePrefix override', () => {
  const headers = new Headers()
  headers.set('cookie', 'better-auth.session_token=legacy-token')

  const token = getSessionCookie(headers, {
    cookiePrefix: 'better-auth',
  })
  assert.equal(token, 'legacy-token')
})

test('getSessionCookie does not apply implicit legacy prefix fallback', () => {
  const headers = new Headers()
  headers.set('cookie', 'better-auth.session_token=legacy-token')
  assert.equal(getSessionCookie(headers), null)
})

test('setSessionCookie writes token + compact cache and getCookieCache validates it', async () => {
  const ctx = createCookieContext()
  await setSessionCookie(
    ctx,
    {
      session: {
        token: 'token-123',
        id: 'session-1',
        userId: 'user-1',
      },
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    },
    false,
  )

  const token = getSessionCookie(ctx.headers)
  assert.equal(token, 'token-123')

  const cache = await getCookieCache(ctx.headers, {
    secret: 'super-secret-value',
  })
  assert.ok(cache)
  assert.equal(cache?.session.id, 'session-1')
  assert.equal(cache?.user.email, 'user@example.com')
})

test('setRequestCookie mutates request cookie header without comma-joining', () => {
  const headers = new Headers()
  headers.set('cookie', 'a=1; b=2')

  setRequestCookie(headers, 'b', 'updated')
  setRequestCookie(headers, 'c', 'hello world')

  assert.equal(headers.get('cookie'), 'a=1; b=updated; c=hello%20world')
})

test('splitSetCookieHeader and parseSetCookieHeader handle combined set-cookie values', () => {
  const combined =
    'athena-auth.session_token=abc; Path=/; HttpOnly, athena-auth.session_data=xyz; Max-Age=300; Path=/'

  const split = splitSetCookieHeader(combined)
  assert.equal(split.length, 2)

  const parsed = parseSetCookieHeader(combined)
  assert.equal(parsed.get('athena-auth.session_token')?.value, 'abc')
  assert.equal(parsed.get('athena-auth.session_data')?.['max-age'], 300)
})

test('setCookieToHeader merges response set-cookie into downstream request cookie header', () => {
  const targetHeaders = new Headers()
  targetHeaders.set('cookie', 'existing=1')
  const proxy = setCookieToHeader(targetHeaders)

  const response = new Response(null, {
    headers: {
      'set-cookie': 'athena-auth.session_token=abc; Path=/; HttpOnly',
    },
  })

  proxy({ response })
  const updated = targetHeaders.get('cookie')
  assert.equal(updated, 'existing=1; athena-auth.session_token=abc')
})

test('package exports expose ./cookies entrypoint', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    exports: Record<
      string,
      {
        import?: { default?: string; types?: string }
        require?: { default?: string; types?: string }
      }
    >
  }

  assert.equal(packageJson.exports['./cookies']?.import?.default, './dist/cookies.js')
  assert.equal(packageJson.exports['./cookies']?.import?.types, './dist/cookies.d.ts')
  assert.equal(packageJson.exports['./cookies']?.require?.default, './dist/cookies.cjs')
  assert.equal(packageJson.exports['./cookies']?.require?.types, './dist/cookies.d.cts')
})
