/**
 * EXAMPLE: Auth session lookup (cookie or bearer).
 *
 *   ATHENA_AUTH_URL=https://… pnpm example:auth-session
 *   # optional: ATHENA_SESSION_COOKIE / ATHENA_BEARER_TOKEN
 */
import { createClient } from "@xylex-group/athena";

const authUrl =
  process.env.ATHENA_AUTH_URL ??
  process.env.ATHENA_URL ??
  process.env.ATHENA_GATEWAY_URL;

if (!authUrl) {
  console.error("Set ATHENA_AUTH_URL or ATHENA_URL");
  process.exit(1);
}

const cookie = process.env.ATHENA_SESSION_COOKIE;
const bearer = process.env.ATHENA_BEARER_TOKEN;

const athena = createClient({
  auth: {
    credentials: "include",
    url: authUrl,
  },
  key: process.env.ATHENA_API_KEY,
  url: process.env.ATHENA_URL ?? authUrl,
});

async function main() {
  const client =
    cookie || bearer
      ? athena.withContext({
          ...(bearer ? { bearerToken: bearer } : {}),
          ...(cookie ? { cookie } : {}),
        })
      : athena;

  const session = await client.auth.getSession();
  console.log("getSession", {
    error: session.error ?? null,
    hasSession: Boolean(session.data?.session),
    hasUser: Boolean(session.data?.user),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
