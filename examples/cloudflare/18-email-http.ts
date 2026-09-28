/**
 * EXAMPLE: Cloudflare Worker — HTTP/Resend email, no SMTP.
 */

import { resend } from "@xylex-group/athena";
import { createCloudflareClient } from "@xylex-group/athena/cloudflare";
import type { ExampleEnv } from "./shared/env.ts";

export default {
  async fetch(
    _request: Request,
    env: ExampleEnv & { RESEND_API_KEY?: string }
  ): Promise<Response> {
    if (!env.DB) {
      return Response.json({ error: "DB required" }, { status: 500 });
    }
    const athena = createCloudflareClient({
      d1: env.DB,
      email: env.RESEND_API_KEY
        ? {
            defaults: { from: "no-reply@example.com" },
            provider: resend({ apiKey: env.RESEND_API_KEY }),
          }
        : undefined,
      key: env.ATHENA_API_KEY,
    });
    return Response.json({
      emailConfigured: athena.email.configured,
      example: "18-email-http",
    });
  },
};
