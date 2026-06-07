import { strict as assert } from 'assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { applyNamingStyle } from '../src/generator/naming.ts'
import {
  asBoolean,
  asBooleanOrNull,
  asIdentifier,
  asNumber,
  asRecord,
  asString,
  asStringArray,
  clearAuthCookies,
  escapeLikePatternValue,
  firstString,
  isLocalHostname,
  parseBooleanFlag,
  proxyRequestHeaders,
  quoteSqlStringLiteral,
  readTrimmedString,
  sqlBigInt,
  sqlJsonbLiteral,
  sqlNullableText,
  sqlText,
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

function withMockCrypto(
  fill: (bytes: Uint8Array) => void,
  run: () => void,
) {
  const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

  const cryptoMock = {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (array == null) {
        return array
      }
      fill(array as unknown as Uint8Array)
      return array
    },
  }

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: cryptoMock,
  })

  try {
    run()
  } finally {
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor)
    } else {
      delete (globalThis as Record<string, unknown>).crypto
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

test('asString coerces finite numbers, bigint, and trimmed strings', () => {
  assert.equal(asString(42), '42')
  assert.equal(asString(42n), '42')
  assert.equal(asString('  hello  '), 'hello')
  assert.equal(asString('   '), null)
  assert.equal(asString(Number.POSITIVE_INFINITY), null)
  assert.equal(asString(false), null)
})

test('asBoolean and asBooleanOrNull coerce booleans, numbers, and string tokens', () => {
  assert.equal(asBoolean(true), true)
  assert.equal(asBoolean(1), true)
  assert.equal(asBoolean(0), false)
  assert.equal(asBoolean(' YES '), true)
  assert.equal(asBoolean('n'), false)
  assert.equal(asBoolean('maybe'), false)
  assert.equal(asBoolean(null), false)

  assert.equal(asBooleanOrNull(false), false)
  assert.equal(asBooleanOrNull(3), true)
  assert.equal(asBooleanOrNull('off'), false)
  assert.equal(asBooleanOrNull('y'), true)
  assert.equal(asBooleanOrNull('maybe'), null)
  assert.equal(asBooleanOrNull({}), null)
})

test('asRecord returns plain records and rejects arrays/null/primitives', () => {
  const record = { id: 1, name: 'Athena' }
  assert.deepEqual(asRecord(record), record)
  assert.equal(asRecord(null), null)
  assert.equal(asRecord(['a']), null)
  assert.equal(asRecord('value'), null)
})

test('asIdentifier and firstString expose id-like and first-present string values', () => {
  assert.equal(asIdentifier(7), '7')
  assert.equal(asIdentifier(7n), '7')
  assert.equal(asIdentifier('  abc  '), 'abc')
  assert.equal(asIdentifier(undefined), null)

  assert.equal(
    firstString(
      {
        name: '   ',
        slug: 'athena-js',
        title: 'Athena',
      },
      ['name', 'slug', 'title'],
    ),
    'athena-js',
  )
  assert.equal(firstString(null, ['id']), null)
})

test('readTrimmedString, asNumber, and asStringArray coerce utility payloads safely', () => {
  assert.equal(readTrimmedString('  hello  '), 'hello')
  assert.equal(readTrimmedString(42), null)
  assert.equal(readTrimmedString('   '), null)

  assert.equal(asNumber(12), 12)
  assert.equal(asNumber(' 12.5 '), 12.5)
  assert.equal(asNumber('nope'), null)
  assert.equal(asNumber(Number.NaN), null)

  assert.deepEqual(asStringArray([' a ', 'b', 3, '', '   ', 'c']), ['a', 'b', 'c'])
  assert.deepEqual(asStringArray('not-an-array'), [])
})

test('sqlText wraps values in a deterministic dollar-quoted literal', () => {
  withMockCrypto(
    bytes => {
      bytes.fill(0)
    },
    () => {
      assert.equal(sqlText('hello world'), '$s000000000000$hello world$s000000000000$')
    },
  )
})

test('sqlText preserves payload contents when the initial tag collides with the value', () => {
  withMockCrypto(
    bytes => {
      bytes.fill(0)
    },
    () => {
      const value = 'before $s000000000000$ after'
      const literal = sqlText(value)
      assert.equal(literal, '$s000000000000_$before $s000000000000$ after$s000000000000_$')
      assert.equal(literal.includes(value), true)
    },
  )
})

test('escapeLikePatternValue escapes backslash, percent, and underscore', () => {
  assert.equal(
    escapeLikePatternValue(String.raw`100%\_ready`),
    String.raw`100\%\\\_ready`,
  )
})

test('quoteSqlStringLiteral wraps and escapes apostrophes', () => {
  assert.equal(quoteSqlStringLiteral(`Athena's "SDK"`), `'Athena''s "SDK"'`)
})

test('sqlNullableText returns NULL for nullish values and quotes strings', () => {
  assert.equal(sqlNullableText(null), 'NULL')
  assert.equal(sqlNullableText(undefined), 'NULL')

  withMockCrypto(
    bytes => {
      bytes.fill(0)
    },
    () => {
      assert.equal(sqlNullableText('value'), '$s000000000000$value$s000000000000$')
    },
  )
})

test('sqlJsonbLiteral serializes payloads and casts to jsonb', () => {
  withMockCrypto(
    bytes => {
      bytes.fill(0)
    },
    () => {
      assert.equal(
        sqlJsonbLiteral({ ok: true, count: 2 }),
        '$s000000000000${"ok":true,"count":2}$s000000000000$::jsonb',
      )
    },
  )
})

test('sqlBigInt renders explicit bigint casts for bigint and number inputs', () => {
  assert.equal(sqlBigInt(42n), '42::bigint')
  assert.equal(sqlBigInt(42), '42::bigint')
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
