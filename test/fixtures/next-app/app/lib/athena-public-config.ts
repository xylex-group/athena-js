/**
 * Public browser config for the Next fixture.
 * Values must be inlined by the Next bundler from NEXT_PUBLIC_* refs.
 */
import type { AthenaBrowserClientConfig } from "@xylex-group/athena/next/client";

export const athenaPublicConfig = {
  auth: {
    routing: "same-origin" as const,
    // Optional: process.env.ATHENA_AUTH_UPSTREAM_URL is server-only; set via
    // createAthenaServerClient env or advanced proxy handlers when needed.
  },
  client: process.env.NEXT_PUBLIC_ATHENA_CLIENT,
  key: process.env.NEXT_PUBLIC_ATHENA_PUBLISHABLE_KEY!,
  url: process.env.NEXT_PUBLIC_ATHENA_URL!,
} satisfies AthenaBrowserClientConfig;
