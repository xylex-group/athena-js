#!/usr/bin/env node
/**
 * Bounded HTTP health poll. Usage: node wait-for-http.mjs <url> [timeoutMs]
 * Never prints response bodies (may contain secrets).
 */
const url = process.argv[2];
const timeoutMs = Number(process.argv[3] ?? 90_000);
const intervalMs = 1_000;

if (!url) {
  console.error("wait-for-http: url required");
  process.exit(2);
}

const started = Date.now();
while (Date.now() - started < timeoutMs) {
  try {
    const response = await fetch(url, { method: "GET" });
    if (response.status >= 200 && response.status < 500) {
      console.log(`wait-for-http: ${url} status=${response.status}`);
      process.exit(0);
    }
  } catch {
    // keep polling
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

console.error(`wait-for-http: timed out after ${timeoutMs}ms waiting for ${url}`);
process.exit(1);
