/**
 * Canonical same-origin auth proxy for the Next fixture.
 *
 * Prefer:
 *   createAthenaAuthProxyHandlers({ client: athena })
 * when the app owns one static createClient / createAthenaBrowserClient.
 */
import { createAthenaAuthProxyHandlers } from "@xylex-group/athena/next/server";

export const { DELETE, GET, HEAD, PATCH, POST, PUT } =
  createAthenaAuthProxyHandlers({
    rewriteSetCookiesToRequestOrigin: true,
  });
