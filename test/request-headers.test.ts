import { strict as assert } from 'assert'
import { test } from 'node:test'
import packageJson from '../package.json' with { type: 'json' }
import {
  applyAthenaApiKeyHeaders,
  buildAthenaRequestHeaders,
} from '../src/utils/athena-request-headers.ts'

const SDK_HEADER_VALUE = `xylex-group/athena ${packageJson.version}`

test('buildAthenaRequestHeaders sets OpenAPI-aligned API key aliases', () => {
  const headers = buildAthenaRequestHeaders({
    profile: 'gateway',
    sdkHeaderValue: SDK_HEADER_VALUE,
    apiKey: 'ath_test_key',
    client: 'railway_direct',
  })

  assert.equal(headers.apikey, 'ath_test_key')
  assert.equal(headers['x-api-key'], 'ath_test_key')
  assert.equal(headers['X-Api-Key'], 'ath_test_key')
  assert.equal(headers['X-Athena-Key'], 'ath_test_key')
  assert.equal(headers['X-Athena-Client'], 'railway_direct')
  assert.equal(headers['X-Athena-Sdk'], SDK_HEADER_VALUE)
})

test('buildAthenaRequestHeaders mirrors lean cookie session auth for gateway and storage', () => {
  const headers = buildAthenaRequestHeaders({
    profile: 'storage',
    sdkHeaderValue: SDK_HEADER_VALUE,
    apiKey: 'secret',
    configHeaders: {
      Cookie: 'athena-auth.session-token=session-from-cookie; theme=dark',
      Authorization: 'Bearer bearer-from-header',
    },
  })

  assert.equal(headers.Cookie, 'athena-auth.session-token=session-from-cookie; theme=dark')
  assert.equal(headers.Authorization, 'Bearer bearer-from-header')
  assert.equal(headers['X-Athena-Auth-Session-Token'], 'session-from-cookie')
  assert.equal(headers['X-Athena-Auth-Bearer-Token'], 'bearer-from-header')
})

test('buildAthenaRequestHeaders forwards pg and jdbc routing headers', () => {
  const headers = buildAthenaRequestHeaders({
    profile: 'gateway',
    sdkHeaderValue: SDK_HEADER_VALUE,
    apiKey: 'secret',
    pgUri: 'postgres://user:pass@db.internal:5432/app',
    jdbcUrl: 'jdbc:postgresql://db.internal:5432/app',
  })

  assert.equal(headers['x-pg-uri'], 'postgres://user:pass@db.internal:5432/app')
  assert.equal(headers['x-athena-jdbc-url'], 'jdbc:postgresql://db.internal:5432/app')
  assert.equal(headers['x-jdbc-url'], 'jdbc:postgresql://db.internal:5432/app')
})

test('buildAthenaRequestHeaders auth profile keeps bearer and session without gateway mirrors', () => {
  const headers = buildAthenaRequestHeaders({
    profile: 'auth',
    sdkHeaderValue: SDK_HEADER_VALUE,
    apiKey: 'auth-key',
    bearerToken: 'bearer_1',
    cookie: 'athena-auth.session_token=session_1',
    sessionToken: 'session_1',
  })

  assert.equal(headers['X-Athena-Key'], 'auth-key')
  assert.equal(headers.Authorization, 'Bearer bearer_1')
  assert.equal(headers.Cookie, 'athena-auth.session_token=session_1')
  assert.equal(headers['X-Athena-Auth-Session-Token'], 'session_1')
  assert.equal(headers['X-Athena-Auth-Bearer-Token'], undefined)
})

test('buildAthenaRequestHeaders chat profile mirrors auth context and accepts prefixed bearer tokens', () => {
  const headers = buildAthenaRequestHeaders({
    profile: 'chat',
    sdkHeaderValue: SDK_HEADER_VALUE,
    apiKey: 'secret',
    client: 'chat_client',
    bearerToken: 'Bearer chat-token',
    cookie: 'athena-auth.session_token=chat-session',
  })

  assert.equal(headers.Accept, 'application/json')
  assert.equal(headers['X-Athena-Client'], 'chat_client')
  assert.equal(headers.Authorization, 'Bearer chat-token')
  assert.equal(headers['X-Athena-Auth-Bearer-Token'], 'chat-token')
  assert.equal(headers['X-Athena-Auth-Session-Token'], 'chat-session')
})

test('applyAthenaApiKeyHeaders does not clobber explicit key headers', () => {
  const headers: Record<string, string> = {
    'X-Athena-Key': 'explicit-key',
  }

  applyAthenaApiKeyHeaders(headers, 'fallback-key')

  assert.equal(headers['X-Athena-Key'], 'explicit-key')
  assert.equal(headers.apikey, 'fallback-key')
  assert.equal(headers['x-api-key'], 'fallback-key')
  assert.equal(headers['X-Api-Key'], 'fallback-key')
})

test('buildAthenaRequestHeaders supports separate apiKey and athenaKey overrides', () => {
  const headers = buildAthenaRequestHeaders({
    profile: 'gateway',
    sdkHeaderValue: SDK_HEADER_VALUE,
    apiKey: 'general-key',
    athenaKey: 'gateway-only-key',
  })

  assert.equal(headers.apikey, 'general-key')
  assert.equal(headers['x-api-key'], 'general-key')
  assert.equal(headers['X-Api-Key'], 'general-key')
  assert.equal(headers['X-Athena-Key'], 'gateway-only-key')
})

test('buildAthenaRequestHeaders resolves X-Api-Key from headers and mirrors X-Athena-Key', () => {
  const headers = buildAthenaRequestHeaders({
    profile: 'gateway',
    sdkHeaderValue: SDK_HEADER_VALUE,
    configHeaders: {
      'X-Api-Key': 'header-only-key',
    },
  })

  assert.equal(headers['X-Api-Key'], 'header-only-key')
  assert.equal(headers['x-api-key'], 'header-only-key')
  assert.equal(headers['X-Athena-Key'], 'header-only-key')
})

test('buildAthenaRequestHeaders call-level athenaKey overrides client config', () => {
  const headers = buildAthenaRequestHeaders({
    profile: 'gateway',
    sdkHeaderValue: SDK_HEADER_VALUE,
    apiKey: 'general-key',
    athenaKey: 'client-athena-key',
    callHeaders: {
      'X-Athena-Key': 'call-athena-key',
    },
  })

  assert.equal(headers['X-Athena-Key'], 'call-athena-key')
})