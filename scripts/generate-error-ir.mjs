#!/usr/bin/env node
/**
 * Project canonical error contracts into browser-safe TypeScript descriptors.
 * The contract JSON is itself generated from the Rust catalog where wired.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.dirname(here);
const repoRoot = path.dirname(path.dirname(packageRoot));
const outputRoot = path.join(
  packageRoot,
  "src",
  "runtime",
  "error",
  "generated"
);
const domains = [
  ["internal", "internal"],
  ["gateway", "gateway"],
  ["storage", "storage"],
  ["billing", "billing"],
  ["chat", "chat"],
  ["webhooks", "webhook"],
  ["policy", "policy"],
  ["auth", "auth"],
  ["notifications", "notifications"],
  ["data", "data"],
];

mkdirSync(outputRoot, { recursive: true });

for (const [directory, domain] of domains) {
  const input = path.join(repoRoot, "contracts", directory, "errors.json");
  try {
    const contract = JSON.parse(readFileSync(input, "utf8"));
    const descriptors = contract.codes.map((entry) => ({
      code: canonicalCode(domain, entry.code),
      description: entry.description,
      domain,
      errorNumber: entry.errorNumber,
      kind: entry.kind ?? inferKind(entry.code, entry.status),
      retry: entry.retry ?? inferRetry(entry.code, entry.status),
      status: entry.status,
    }));
    const constant = `${constantPrefix(domain)}_ERROR_DESCRIPTORS`;
    const output = `/* AUTO-GENERATED from contracts/${directory}/errors.json. Do not hand-edit. */
import type { AthenaErrorIR } from "../ir.ts";

export const ${constant}: readonly AthenaErrorIR<string, "${domain}">[] =
\tObject.freeze(${JSON.stringify(descriptors, null, 2).replaceAll("\n", "\n\t")});
`;
    writeFileSync(path.join(outputRoot, `${domain}.ts`), output);
  } catch (error) {
    if (error?.code === "ENOENT") {
      continue;
    }
    throw error;
  }
}

function canonicalCode(domain, code) {
  const lower = code.toLowerCase();
  const prefix = `${domain}_`;
  if (lower.startsWith(prefix)) {
    return lower;
  }
  return domain === "internal"
    ? lower
    : `${prefix}${lower.replace(`${domain}_`, "")}`;
}

function constantPrefix(domain) {
  return `ATHENA_${domain.toUpperCase()}`;
}

function inferKind(code, status) {
  const lower = code.toLowerCase();
  if (
    /(unauthorized|authorization|forbidden|access_denied|privilege)/.test(lower)
  ) {
    return "authorization";
  }
  if (/(authentication|credential|secret)/.test(lower)) {
    return "authentication";
  }
  if (/(not_found|missing|no_such)/.test(lower)) {
    return "not_found";
  }
  if (/(conflict|duplicate|unique)/.test(lower)) {
    return "conflict";
  }
  if (status === 429 || lower.includes("rate_limit")) {
    return "rate_limited";
  }
  if (status >= 500 && /(unavailable|timeout|connection|network)/.test(lower)) {
    return "unavailable";
  }
  if (lower.includes("unsupported")) {
    return "unsupported";
  }
  if (status >= 400 && status < 500) {
    return "validation";
  }
  return "internal";
}

function inferRetry(code, status) {
  return status >= 500 &&
    /(unavailable|timeout|connection|network)/.test(code.toLowerCase())
    ? "safe"
    : status === 429
      ? "safe"
      : "never";
}
