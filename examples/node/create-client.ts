/**
 * EXAMPLE: Root createClient against an Athena gateway (Node / Bun).
 *
 *   ATHENA_URL=https://… ATHENA_API_KEY=… pnpm example:node
 */
import { createClient } from "@xylex-group/athena";

const url = process.env.ATHENA_URL ?? process.env.ATHENA_GATEWAY_URL;
const key = process.env.ATHENA_API_KEY ?? process.env.ATHENA_GATEWAY_API_KEY;

if (!url) {
  console.error("Set ATHENA_URL (and optionally ATHENA_API_KEY)");
  process.exit(1);
}

const athena = createClient({
  client: process.env.ATHENA_CLIENT ?? "athena-js-examples",
  key,
  url,
});

async function main() {
  const health = await athena.query("select 1 as ok");
  console.log("query", {
    data: health.data,
    error: health.error?.message ?? null,
    status: health.status,
  });

  try {
    const users = await athena.from("users").limit(5).select("id,email");
    console.log("from().select", {
      data: users.data,
      error: users.error?.message ?? null,
    });
  } catch (error) {
    console.log(
      "from().select threw",
      error instanceof Error ? error.message : error
    );
  }

  console.log("namespaces", {
    auth: typeof athena.auth,
    billing: typeof athena.billing,
    chat: typeof athena.chat,
    storage: typeof athena.storage,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
