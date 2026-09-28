#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractDocsApi, stableStringify, type DocsExemptions } from "./extract-api.mts";
import { readPackageJson } from "./extract-exports.mts";
import { renderMethodReference } from "./render-reference.mts";
import { formatCoverage, validateDocsApi } from "./validate-api.mts";

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const generatedDir = join(packageRoot, "docs", "generated");
const manifestPath = join(generatedDir, "manifest.json");
const coveragePath = join(generatedDir, "coverage.json");
const methodPath = join(generatedDir, "api", "complete-method-reference.md");

const check = process.argv.includes("--check");
const coverageOnly = process.argv.includes("--coverage");

const ir = extractDocsApi(packageRoot);
const schemaVersion = ir.schema.split("/").at(-1);
if (!schemaVersion) {
  throw new Error(`Docs API schema "${ir.schema}" has no version`);
}
const apiArtifact = `api.${schemaVersion}.json`;
const apiPath = join(generatedDir, apiArtifact);
const pkg = readPackageJson(packageRoot);
const exemptionsPath = join(packageRoot, "docs", "api.exemptions.json");
const exemptions = JSON.parse(
  existsSync(exemptionsPath) ? readFileSync(exemptionsPath, "utf8") : "{}"
) as DocsExemptions;
const coverage = validateDocsApi(ir, {
  packageRoot,
  exports: pkg.exports,
  exemptions,
});

mkdirSync(join(generatedDir, "api"), { recursive: true });
const apiJson = stableStringify(ir);
const manifestJson = stableStringify({
  schema: ir.schema,
  artifact: apiArtifact,
});
const coverageJson = stableStringify(coverage);
const methodMarkdown = renderMethodReference(ir);

if (check) {
  const currentApi = readFileSync(apiPath, "utf8");
  const currentManifest = readFileSync(manifestPath, "utf8");
  const currentCoverage = readFileSync(coveragePath, "utf8");
  const currentMethod = readFileSync(methodPath, "utf8");
  const drift = [];
  if (currentApi !== apiJson) {
    drift.push(`docs/generated/${apiArtifact}`);
  }
  if (currentManifest !== manifestJson) {
    drift.push("docs/generated/manifest.json");
  }
  if (currentCoverage !== coverageJson) {
    drift.push("docs/generated/coverage.json");
  }
  if (currentMethod !== methodMarkdown) {
    drift.push("docs/generated/api/complete-method-reference.md");
  }
  if (drift.length > 0) {
    console.error(`docs:check drift:\n${drift.map((row) => `  - ${row}`).join("\n")}`);
    process.exit(1);
  }
  if (coverage.errors.length > 0) {
    console.error(`docs:check coverage:\n${coverage.errors.map((row) => `  - ${row}`).join("\n")}`);
    process.exit(1);
  }
  console.log("docs:check: ok");
  process.exit(0);
}

if (!coverageOnly) {
  writeFileSync(apiPath, apiJson);
  writeFileSync(manifestPath, manifestJson);
  writeFileSync(coveragePath, coverageJson);
  writeFileSync(methodPath, methodMarkdown);
  console.log(`Wrote ${apiPath}`);
  console.log(`Wrote ${methodPath}`);
}

console.log(formatCoverage(coverage));
if (coverage.errors.length > 0) {
  console.error(coverage.errors.map((row) => `  - ${row}`).join("\n"));
  process.exit(1);
}
