#!/usr/bin/env node
/**
 * Docs consistency for Athena 5 Finality.
 * README + docs-athena-js snippets must teach the same composition model.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const pkgReadme = readFileSync(join(repoRoot, "packages/athena-js/README.md"), "utf8");
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
  errors.push("README.md still documents Athena JS 3 experimental-bag language");
}

const snippetPath = (id) => join(examplesRoot, ...id.split(".")) + ".ts";

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

if (errors.length > 0) {
  console.error("check-docs-consistency:\n" + errors.map((row) => `  - ${row}`).join("\n"));
  process.exit(1);
}

console.log("check-docs-consistency: ok");
