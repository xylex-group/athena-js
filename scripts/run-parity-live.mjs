/**
 * Release-path Auth parity: Rust origin is required (no skip-as-green).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.ATHENA_AUTH_URL) {
  process.stderr.write(
    "ATHENA_AUTH_URL is required for test:parity:live (Rust Auth must be running).\n"
  );
  process.exit(1);
}

process.env.ATHENA_PARITY_REQUIRE_RUST = "1";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  process.execPath,
  [
    "--import",
    "./test/register-server-only.mjs",
    "--import",
    "tsx",
    "--test",
    "--test-force-exit",
    "test/finality-parity-suite.test.ts",
    "test/finality-password-portability.test.ts",
    "test/finality-portability.test.ts",
    "test/admin-auth-parity.test.ts",
    "test/admin-auth-portability.test.ts",
    "test/auth-route-inventory.test.ts",
    "test/auth-embedded-tier-a.test.ts",
  ],
  {
    cwd: packageRoot,
    env: process.env,
    stdio: "inherit",
  }
);

process.exit(result.status ?? 1);
