#!/usr/bin/env node
/**
 * Docs consistency: README composition tokens + Docs API IR artifacts.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url))))
);
const pkgRoot = join(repoRoot, "packages/athena-js");
const pkgReadme = readFileSync(join(pkgRoot, "README.md"), "utf8");
const examplesRoot = join(repoRoot, "apps/docs-athena-js/examples");
const createClientDoc = readFileSync(
  join(repoRoot, "apps/docs-athena-js/docs/create-client.mdx"),
  "utf8"
);

const requiredReadme = [
  "createClient({",
  "databaseUrl: process.env.DATABASE_URL",
  "auth: false",
  "url: process.env.ATHENA_URL",
  "ATHENA_API_KEY",
  "ATHENA_AUTH_URL",
  "athena.auth",
];

const requiredSnippets = [
  "create-client.database-url",
  "create-client.auth-false",
  "create-client.remote",
  "create-client.mixed-auth",
];

const errors = [];

for (const token of requiredReadme) {
  if (!pkgReadme.includes(token)) {
    errors.push(`README.md missing required token: ${token}`);
  }
}

if (/Athena JS 3 has no general-purpose/.test(pkgReadme)) {
  errors.push(
    "README.md still documents Athena JS 3 experimental-bag language"
  );
}

const snippetPath = (id) => `${join(examplesRoot, ...id.split("."))}.ts`;

for (const id of requiredSnippets) {
  const path = snippetPath(id);
  if (!existsSync(path)) {
    errors.push(`examples missing snippet ${id} (${path})`);
  }
  if (!createClientDoc.includes(id)) {
    errors.push(`create-client.mdx does not reference snippet ${id}`);
  }
}

const databaseUrlSnippet = readFileSync(
  join(examplesRoot, "create-client", "database-url.ts"),
  "utf8"
);
if (!databaseUrlSnippet.includes("databaseUrl: process.env.DATABASE_URL")) {
  errors.push("create-client/database-url.ts missing databaseUrl golden path");
}

const apiManifest = join(pkgRoot, "docs/generated/manifest.json");
if (!existsSync(apiManifest)) {
  errors.push("docs/generated/manifest.json missing — run pnpm docs:generate");
} else {
  const manifest = JSON.parse(readFileSync(apiManifest, "utf8"));
  if (
    typeof manifest.schema !== "string" ||
    !/^athena\/docs-api\/v\d+$/.test(manifest.schema) ||
    typeof manifest.artifact !== "string" ||
    !/^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.json$/.test(manifest.artifact) ||
    manifest.artifact.split("/").some((part) => part === "." || part === "..")
  ) {
    errors.push("docs/generated/manifest.json is invalid");
  } else {
    const apiIr = join(pkgRoot, "docs/generated", manifest.artifact);
    if (!existsSync(apiIr)) {
      errors.push(`Docs API artifact missing: docs/generated/${manifest.artifact}`);
    } else {
      const ir = JSON.parse(readFileSync(apiIr, "utf8"));
      if (ir.schema !== manifest.schema) {
        errors.push("Docs API artifact schema does not match manifest");
      }
    }
  }
}

const apiExample = join(examplesRoot, "api/create-client/server.ts");
if (!existsSync(apiExample)) {
  errors.push("examples/api/create-client/server.ts missing");
} else if (!readFileSync(apiExample, "utf8").includes("@docs-api createClient")) {
  errors.push("api createClient example missing @docs-api tag");
}

const generator = readFileSync(
  join(pkgRoot, "scripts/generate-sdk-method-reference.mjs"),
  "utf8"
);
if (generator.includes("function exampleForPath")) {
  errors.push("exampleForPath must not remain in generate-sdk-method-reference.mjs");
}

if (errors.length > 0) {
  console.error(
    `check-docs-consistency:\n${errors.map((row) => `  - ${row}`).join("\n")}`
  );
  process.exit(1);
}

console.log("check-docs-consistency: ok");
