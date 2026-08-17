/**
 * EXAMPLE: Next / server session resolution (canonical AthenaSessionData).
 *
 * Prefer {@link createServerSessionResolver} so get / orNull / require share one
 * detailed-result authority. Or call {@link getServerSession} directly.
 *
 * ```ts
 * // app/lib/session.ts
 * import { createExampleServerSessionResolver } from './server-session'
 * export const session = createExampleServerSessionResolver(athena)
 *
 * // RSC / route handler
 * const data = await session.requireSession() // throws typed Athena session errors
 * ```
 */

import {
  type CreateServerSessionResolverConfig,
  createServerSessionResolver,
  type GetServerSessionOptions,
  type GetServerSessionResult,
  getServerSession,
  type ServerSessionResolver,
} from "@xylex-group/athena/next/server";
import type { AthenaSessionData } from "@xylex-group/athena/react";

/**
 * Build a request-scoped resolver bound to a createClient (or auth) surface.
 * `client` must expose `auth.getSession` when header-based bootstrap is absent.
 */
export function createExampleServerSessionResolver(
  client: CreateServerSessionResolverConfig["client"],
  defaults: Omit<CreateServerSessionResolverConfig, "client"> = {}
): ServerSessionResolver {
  return createServerSessionResolver({
    ...defaults,
    client,
  });
}

/**
 * One-shot detailed session read (header short-circuit or get-session fetch).
 * Returns the full result envelope — map with requireSession / orNull as needed.
 */
export async function exampleGetServerSession(
  options: GetServerSessionOptions
): Promise<GetServerSessionResult> {
  return getServerSession(options);
}

/**
 * Product-style organization repair hook used with getServerSession options.
 * Copy this pattern when the UI must force a tenant after login.
 */
export function exampleResolveActiveOrganizationId(args: {
  rawActiveOrganizationId: string | null;
  userId: string;
}): string | null {
  // Demo: prefer transport raw id; products often map membership tables here.
  return args.rawActiveOrganizationId;
}

/**
 * Gate a server action / RSC with requireSession() and return AthenaSessionData.
 */
export async function exampleRequireServerSessionData(
  resolver: ServerSessionResolver
): Promise<AthenaSessionData> {
  return resolver.requireSession();
}

/**
 * Soft path: null when anonymous (never throws for unauthenticated).
 */
export async function exampleGetServerSessionDataOrNull(
  resolver: ServerSessionResolver
): Promise<AthenaSessionData | null> {
  return resolver.getSessionOrNull();
}
