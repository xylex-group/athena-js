#!/usr/bin/env node
/**
 * Static scan of a consumer repo for Athena JS usage.
 * Usage: node scripts/audit-consumer-athena-usage.mjs <consumer-root>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("Usage: node scripts/audit-consumer-athena-usage.mjs <consumer-root>");
  process.exit(1);
}

const METHODS = [
  [".from(", "from"],
  [".select(", "select"],
  [".eq(", "eq"],
  [".or(", "or"],
  [".single(", "single"],
  [".maybeSingle(", "maybeSingle"],
  [".findMany(", "findMany"],
  [".insert(", "insert"],
  [".update(", "update"],
  [".delete(", "delete"],
  [".rpc(", "rpc"],
  [".request(", "request"],
  ["auth.", "auth"],
  ["storage.", "storage"],
  ["billing.", "billing"],
  ["chat.", "chat"],
];

const SKIP = new Set(["node_modules", "dist", ".git", ".next", "coverage"]);
const FILES = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if ([".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(extname(entry))) {
      FILES.push(full);
    }
  }
}

walk(root);

const counts = Object.fromEntries(METHODS.map(([, name]) => [name, 0]));
const gatewayDb = [];

for (const file of FILES) {
  const text = readFileSync(file, "utf8");
  for (const [needle, name] of METHODS) {
    let from = 0;
    while (true) {
      const idx = text.indexOf(needle, from);
      if (idx === -1) {
        break;
      }
      counts[name] += 1;
      from = idx + needle.length;
    }
  }
  if (text.includes("/gateway/update") || text.includes("/gateway/insert") || text.includes("/gateway/delete") || text.includes("/gateway/fetch")) {
    gatewayDb.push(relative(root, file).replaceAll("\\", "/"));
  }
}

console.log("ATHENA CONSUMER COMPATIBILITY");
console.log(`Consumer: ${relative(process.cwd(), root) || root}`);
console.log("");
console.log("Database methods:");
for (const [, name] of METHODS) {
  console.log(`  ${name.padEnd(16)} ${counts[name]}`);
}
console.log("");
console.log("Raw Gateway DB paths:");
if (gatewayDb.length === 0) {
  console.log("  (none)");
} else {
  for (const file of gatewayDb) {
    console.log(`  ${file}`);
  }
}
