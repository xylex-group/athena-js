/**
 * EXAMPLE: Billing module surface (gateway).
 *
 *   ATHENA_URL=https://… ATHENA_API_KEY=… pnpm example:billing
 *
 * Prints configured routes / a safe catalog call when available.
 */
import { createClient } from "@xylex-group/athena";

const url = process.env.ATHENA_URL ?? process.env.ATHENA_GATEWAY_URL;
const key = process.env.ATHENA_API_KEY ?? process.env.ATHENA_GATEWAY_API_KEY;

if (!url) {
  console.error("Set ATHENA_URL (and ATHENA_API_KEY when required)");
  process.exit(1);
}

const athena = createClient({ key, url });

async function main() {
  const billing = athena.billing;
  console.log("billing module", {
    keys: billing && typeof billing === "object" ? Object.keys(billing) : [],
    type: typeof billing,
  });

  // Prefer a read-only helper when present (shape varies by server version).
  const maybeList = (
    billing as { listPlans?: () => Promise<unknown> } | undefined
  )?.listPlans;
  if (typeof maybeList === "function") {
    try {
      const plans = await maybeList.call(billing);
      console.log("listPlans", plans);
    } catch (error) {
      console.log(
        "listPlans error",
        error instanceof Error ? error.message : error
      );
    }
  } else {
    console.log(
      "No listPlans helper on this SDK build — use athena.billing.* methods from the method reference"
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
