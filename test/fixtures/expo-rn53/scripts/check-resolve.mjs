#!/usr/bin/env node

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const packagePath = require.resolve("@xylex-group/athena/react-native");
const importPath = fileURLToPath(
  await import.meta.resolve("@xylex-group/athena/react-native")
);
const packageRoot = resolve(dirname(packagePath), "..");
const metroModule = await import(
  pathToFileURL(join(root, "metro.config.js")).href
);
const metroConfig = metroModule.default;
const packageJson = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8")
);

function fail(message) {
  console.error(`[expo-rn53] FAIL: ${message}`);
  process.exit(1);
}

if (!packagePath.includes("node_modules")) {
  fail(`React Native entry did not resolve from node_modules: ${packagePath}`);
}
if (!importPath.includes("node_modules")) {
  fail(`React Native import did not resolve from node_modules: ${importPath}`);
}
if (
  !packageJson.exports?.["./react-native"]?.import?.default ||
  !packageJson.exports?.["./react-native"]?.require?.default
) {
  fail("packed package is missing the React Native import/require exports");
}
if (!metroConfig || typeof metroConfig !== "object") {
  fail("Expo Metro config did not load");
}

const sources = await Promise.all([
  readFile(join(packageRoot, "dist", "react-native.js"), "utf8"),
  readFile(join(packageRoot, "dist", "react-native.cjs"), "utf8"),
]);
const forbidden = [
  /(?:^|["'])node:?(?:fs|path|module|net|tls)(?:["'])/m,
  /from\s+["'](?:fs|path|pg|server-only|react-dom|next)(?:\/|["'])/m,
  /require\(["'](?:fs|path|pg|server-only|react-dom|next)(?:\/|["'])/m,
];
for (const source of sources) {
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      fail(`packed React Native entry matched ${pattern}`);
    }
  }
}

console.log(`[expo-rn53] OK: ${packagePath}`);
