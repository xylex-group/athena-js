#!/usr/bin/env node
/**
 * Watch overlay skips rollup-plugin-dts (OOM next to Next/Vite).
 * Workspace consumers resolve `@xylex-group/athena/server` types from dist,
 * so a full `pnpm build` must have produced declarations first.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const required = [
  "dist/index.d.ts",
  "dist/server.d.ts",
  "dist/browser.d.ts",
  "dist/next/client.d.ts",
  "dist/next/server.d.ts",
  "dist/next/session.d.ts",
];

const missing = required.filter((rel) => !existsSync(join(root, rel)));
if (missing.length > 0) {
  console.error(
    `assert-published-dts: missing ${missing.join(", ")}. Run \`pnpm build\` before \`pnpm dev\` so workspace consumers (e.g. next-minimal) get constructor IntelliSense from dist/*.d.ts.`
  );
  process.exit(1);
}
