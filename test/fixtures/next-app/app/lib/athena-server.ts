import "server-only";

import { createAthenaServerClient } from "@xylex-group/athena/next/server";

/**
 * Request-scoped server factory. Call once per Server Component / Action / Route Handler.
 */
export function createServerAthena() {
  return createAthenaServerClient({
    client: process.env.ATHENA_CLIENT,
    key: process.env.ATHENA_API_KEY!,
    url: process.env.ATHENA_URL!,
  });
}
