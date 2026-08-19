/**
 * Compile-time ownership: request views are not handler roots.
 * `tsc -p tsconfig.full.json` enforces the @ts-expect-error.
 */
import { createAthenaDataHandlers } from "../src/next/data-handlers.ts";
import { createClient } from "../src/v3-client.ts";

export function ownershipTypeContract(): void {
  const root = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_types",
  });
  const view = root.withContext({ userId: "user-1" });

  createAthenaDataHandlers({
    client: root,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });

  createAthenaDataHandlers({
    // @ts-expect-error AthenaRequestClient is not assignable to AthenaRootClient
    client: view,
  });

  // @ts-expect-error request views do not own close()
  void view.close;
}
