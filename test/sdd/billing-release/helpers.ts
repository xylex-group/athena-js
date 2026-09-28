/**
 * Billing release SDD helpers. RED until PRs B–H land.
 * Frozen out of `pnpm test` via scripts/run-unit-tests.mjs (billing-release/).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const pkgRoot = join(here, "..", "..", "..");
export const srcRoot = join(pkgRoot, "src");
export const billingSqlDir = join(
  srcRoot,
  "migrations",
  "embedded-billing",
  "sql"
);
export const repoRoot = join(pkgRoot, "..", "..");

export function collectTs(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) {
    return files;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTs(path));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(path);
    }
  }
  return files;
}

export function readSrc(...segments: string[]): string {
  return readFileSync(join(srcRoot, ...segments), "utf8");
}

export function billingSqlFilenames(): string[] {
  if (!existsSync(billingSqlDir)) {
    return [];
  }
  return readdirSync(billingSqlDir).filter((name) => name.endsWith(".sql"));
}

export function combinedBillingSql(): string {
  return billingSqlFilenames()
    .map((name) => readFileSync(join(billingSqlDir, name), "utf8"))
    .join("\n");
}
