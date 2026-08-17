/**
 * Next.js adapter examples for Athena client construction.
 *
 * These mirror `test/fixtures/next-app` and the published
 * `@xylex-group/athena/next/client` + `next/server` entrypoints (ADR 0014).
 *
 * - Browser: `createAthenaBrowserClient` (sync, explicit url+key, no env bag)
 * - Server:  `createAthenaServerClient` (async, request-scoped, server-only)
 */

import type { AthenaBrowserClientConfig } from "@xylex-group/athena/next/client";
import { createAthenaBrowserClient } from "@xylex-group/athena/next/client";

/** Public config shape for Client Components (no `env` / `context`). */
export type TestSdkAthenaPublicConfig = AthenaBrowserClientConfig;

export function createTestSdkBrowserClient(config: TestSdkAthenaPublicConfig) {
	return createAthenaBrowserClient(config);
}

/**
 * Server construction must run under a Next server graph (or with the
 * `server-only` stub used by the package test runner). Call once per request.
 *
 * ```ts
 * import { createAthenaServerClient } from '@xylex-group/athena/next/server'
 *
 * export function createServerAthena(session?: { ... } | null) {
 *   return createAthenaServerClient({
 *     url: process.env.ATHENA_URL!,
 *     key: process.env.ATHENA_API_KEY!,
 *     client: process.env.ATHENA_CLIENT,
 *     session,
 *   })
 * }
 * ```
 */
export const NEXT_SERVER_ADAPTER_NOTE =
	"Import createAthenaServerClient from @xylex-group/athena/next/server in server-only modules.";
