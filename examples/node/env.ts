/**
 * EXAMPLE: Env helpers (`@xylex-group/athena/env` + root requireEnv patterns).
 *
 *   pnpm example:env
 */
import { requireEnv } from "@xylex-group/athena/utils";

function main() {
  // Safe demo: require optional-with-fallback style so the script works offline.
  const url =
    process.env.ATHENA_URL ??
    process.env.ATHENA_GATEWAY_URL ??
    "https://athena.example.com";

  console.log("resolved url candidate", url);

  try {
    // Fails closed when the key is missing — mirrors production config guards.
    const key = requireEnv(["ATHENA_API_KEY"], process.env);
    console.log("ATHENA_API_KEY present", Boolean(key));
  } catch (error) {
    console.log(
      "requireEnv(ATHENA_API_KEY)",
      error instanceof Error ? error.message : error
    );
  }

  console.log(
    "Tip: wire real process.env in Workers via createAthenaFromWorkerEnv(env) — see examples/cloudflare/"
  );
}

main();
