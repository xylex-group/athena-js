#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const files = [
  "test/stabilization-finality.test.ts",
  "test/authorization-snapshot-parse.test.ts",
  "test/billing-self-enrollment.test.ts",
  "test/sdd/athena-js-billing-webhook-ingress-observability.target.test.ts",
  "test/sdd/athena-js-postgres-ownership-finality.target.test.ts",
  "test/sdd/athena-js-postgres-pool-control-plane.target.test.ts",
  "test/auth-migration-advisory-lock.test.ts",
];

const result = spawnSync(
  process.execPath,
  [
    "--import",
    "./test/register-server-only.mjs",
    "--import",
    "tsx",
    "--test",
    ...(process.platform === "win32"
      ? ["--import", "./test/windows-defer-force-exit.mjs"]
      : []),
    ...files,
  ],
  { cwd: new URL("..", import.meta.url), stdio: "inherit" }
);

process.exit(result.status ?? 1);
