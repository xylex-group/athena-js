import { strict as assert } from 'assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { applyNamingStyle } from '../src/generator/naming.ts'
import {
  clearAuthCookies,
  isLocalHostname,
  parseBooleanFlag,
  proxyRequestHeaders,
  slugify,
  trimTrailingSlashes,
} from '../src/utils/index.ts'

function withMockDocument(
  initialCookieHeader: string,
  run: (writes: string[]) => void,
) {
  const writes: string[] = []
  const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')

  const documentMock = {
    get cookie() {
      return initialCookieHeader
    },
    set cookie(value: string) {
      writes.push(value)
    },
  }

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: documentMock,
  })

  try {
    run(writes)
  } finally {
    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, 'document', originalDocumentDescriptor)
    } else {
      delete (globalThis as Record<string, unknown>).document
    }
  }
}

test('slugify normalizes and trims values', () => {
  assert.equal(slugify('Hello, World! 2026'), 'hello-world-2026')
  assert.equal(slugify('---A---B---'), 'a-b')

  const longInput = `prefix-${'x'.repeat(100)}`
  const slug = slugify(longInput)
  assert.equal(slug.length, 64)
})

test('trimTrailingSlashes removes one or more trailing slash characters', () => {
  assert.equal(trimTrailingSlashes('https://example.com/'), 'https://example.com')
  assert.equal(trimTrailingSlashes('https://example.com///'), 'https://example.com')
  assert.equal(trimTrailingSlashes('/api/v1///'), '/api/v1')
  assert.equal(trimTrailingSlashes('no-trailing-slash'), 'no-trailing-slash')
  assert.equal(trimTrailingSlashes('////'), '')
})

test('parseBooleanFlag supports common truthy/falsey values with fallback', () => {
  assert.equal(parseBooleanFlag('1', false), true)
  assert.equal(parseBooleanFlag('true', false), true)
  assert.equal(parseBooleanFlag('YES', false), true)
  assert.equal(parseBooleanFlag('on', false), true)

  assert.equal(parseBooleanFlag('0', true), false)
  assert.equal(parseBooleanFlag('false', true), false)
  assert.equal(parseBooleanFlag('NO', true), false)
  assert.equal(parseBooleanFlag('off', true), false)

  assert.equal(parseBooleanFlag(undefined, true), true)
  assert.equal(parseBooleanFlag('maybe', false), false)
  assert.equal(parseBooleanFlag('  ', true), true)
})

test('generator kebab naming uses shared slugify behavior', () => {
  const input = 'Feature Name: Internal Analytics + Growth'
  assert.equal(applyNamingStyle(input, 'kebab'), slugify(input))
})

test('isLocalHostname detects localhost, loopback ipv4 and ipv6', () => {
  assert.equal(isLocalHostname('localhost'), true)
  assert.equal(isLocalHostname('api.localhost'), true)
  assert.equal(isLocalHostname('127.0.0.1'), true)
  assert.equal(isLocalHostname('127.22.1.9'), true)
  assert.equal(isLocalHostname('[::1]'), true)
  assert.equal(isLocalHostname('0:0:0:0:0:0:0:1'), true)
  assert.equal(isLocalHostname('example.com'), false)
})

test('clearAuthCookies is a no-op in non-browser runtimes', () => {
  const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
  if (originalDocumentDescriptor) {
    delete (globalThis as Record<string, unknown>).document
  }

  try {
    assert.deepEqual(clearAuthCookies(), [])
  } finally {
    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, 'document', originalDocumentDescriptor)
    }
  }
})

test('clearAuthCookies clears athena/better-auth cookie prefixes across domain candidates', () => {
  withMockDocument('athena-auth.session=abc; foo=bar; __Secure-better-auth.session=def', writes => {
    const cleared = clearAuthCookies({ hostname: 'app.eu.example.com' })

    assert.deepEqual(cleared, ['athena-auth.session', '__Secure-better-auth.session'])
    assert.equal(writes.length, 14)
    assert.ok(writes.some(entry => entry.includes('domain=.example.com;')))
    assert.ok(writes.some(entry => entry.includes('domain=example.com;')))
  })
})

test('clearAuthCookies avoids domain attributes for local hostnames', () => {
  withMockDocument('__Secure-athena-auth.session=abc; other=value', writes => {
    const cleared = clearAuthCookies({ hostname: 'localhost' })

    assert.deepEqual(cleared, ['__Secure-athena-auth.session'])
    assert.equal(writes.length, 1)
    assert.equal(writes[0].includes('domain='), false)
  })
})

test('package exports expose ./utils entrypoint', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    exports: Record<
      string,
      {
        import?: { default?: string; types?: string }
        require?: { default?: string; types?: string }
      }
    >
  }

  assert.equal(packageJson.exports['./utils']?.import?.default, './dist/utils.js')
  assert.equal(packageJson.exports['./utils']?.import?.types, './dist/utils.d.ts')
  assert.equal(packageJson.exports['./utils']?.require?.default, './dist/utils.cjs')
  assert.equal(packageJson.exports['./utils']?.require?.types, './dist/utils.d.cts')
})

test('proxyRequestHeaders removes host and applies forwarded headers from request URL', () => {
  const request = new Request('https://preview.example.com:8443/auth/callback?flow=pkce', {
    headers: {
      host: 'preview.example.com:8443',
      authorization: 'Bearer token',
      'x-custom': 'value',
    },
  })

  const headers = proxyRequestHeaders(request)
  assert.equal(headers.get('host'), null)
  assert.equal(headers.get('x-forwarded-host'), 'preview.example.com:8443')
  assert.equal(headers.get('x-forwarded-proto'), 'https')
  assert.equal(headers.get('x-forwarded-origin'), 'https://preview.example.com:8443')
  assert.equal(headers.get('x-forwarded-uri'), '/auth/callback?flow=pkce')
  assert.equal(headers.get('x-forwarded-port'), '8443')

  // Non-forwarding headers should remain intact.
  assert.equal(headers.get('authorization'), 'Bearer token')
  assert.equal(headers.get('x-custom'), 'value')
})

test('proxyRequestHeaders removes x-forwarded-port when URL has no explicit port', () => {
  const request = new Request('https://app.example.com/auth/callback', {
    headers: {
      host: 'app.example.com',
      'x-forwarded-port': '3000',
    },
  })

  const headers = proxyRequestHeaders(request)
  assert.equal(headers.get('x-forwarded-host'), 'app.example.com')
  assert.equal(headers.get('x-forwarded-origin'), 'https://app.example.com')
  assert.equal(headers.get('x-forwarded-uri'), '/auth/callback')
  assert.equal(headers.get('x-forwarded-port'), null)
})
