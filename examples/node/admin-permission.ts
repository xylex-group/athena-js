/**
 * EXAMPLE: Admin permission helper (`@xylex-group/athena/admin`).
 *
 *   ATHENA_URL=https://… ATHENA_API_KEY=… pnpm example:admin
 */

import { createClient } from "@xylex-group/athena";
import { resolveAdminPermissionClient } from "@xylex-group/athena/admin";

const url = process.env.ATHENA_URL ?? process.env.ATHENA_GATEWAY_URL;
const key = process.env.ATHENA_API_KEY ?? process.env.ATHENA_GATEWAY_API_KEY;

if (!url) {
  console.error("Set ATHENA_URL");
  process.exit(1);
}

const athena = createClient({
  auth: { url: process.env.ATHENA_AUTH_URL ?? url },
  key,
  url,
});

async function main() {
  const adminClient = resolveAdminPermissionClient(athena);
  if (!adminClient) {
    console.log(
      "resolveAdminPermissionClient: no auth.admin binding on client"
    );
    return;
  }

  try {
    const result = await adminClient.auth.admin.hasPermission({
      permission: "users:read",
    });
    console.log("hasPermission", result);
  } catch (error) {
    console.log(
      "hasPermission error (expected without a privileged session)",
      error instanceof Error ? error.message : error
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
