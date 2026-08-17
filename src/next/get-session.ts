import {
  type GetServerSessionOptions,
  getServerSession,
  type ServerSessionClientLike,
} from "./get-server-session.ts";

/**
 * Happy-path Next.js session read against the root Athena client.
 * Infers request cookies/headers via {@link getServerSession}; apps should not
 * assemble cookie names manually.
 *
 * @deprecated Prefer `athena.auth.session.get()` as the canonical identity read.
 *
 * @example
 * ```ts
 * const session = await getSession(athena)
 * ```
 */
export async function getSession(
  client: ServerSessionClientLike,
  options: Omit<GetServerSessionOptions, "client"> = {}
) {
  return getServerSession({ ...options, client });
}
