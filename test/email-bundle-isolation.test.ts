import { strict as assert } from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const srcRoot = join(pkgRoot, "src");
const require = createRequire(import.meta.url);
const pkg = require(join(pkgRoot, "package.json")) as {
  exports: Record<
    string,
    {
      browser?: unknown;
      import?: { default?: string; types?: string };
      require?: { default?: string; types?: string };
    }
  >;
};

const IMPORT_FROM_RE =
  /^[ \t]*import[ \t]+(type[ \t]+)?[^;]*?[ \t]from[ \t]*["']([^"']+)["']/gm;
const EXPORT_FROM_RE =
  /^[ \t]*export[ \t]+(?:type[ \t]+)?(?:\*|[^{]*\{[^;]*\})[ \t]*from[ \t]*["']([^"']+)["']/gm;

function collectSpecifiers(source: string): string[] {
  const cleaned = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  const specifiers: string[] = [];
  for (const match of cleaned.matchAll(IMPORT_FROM_RE)) {
    if (!match[1] && match[2]) {
      specifiers.push(match[2]);
    }
  }
  for (const match of cleaned.matchAll(EXPORT_FROM_RE)) {
    if (match[1]) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function resolveRelative(
  fromFile: string,
  specifier: string
): string | undefined {
  if (!specifier.startsWith(".")) {
    return;
  }
  const resolved = fileURLToPath(
    new URL(specifier, pathToFileURL(`${dirname(fromFile)}/`))
  );
  const candidates = specifier.endsWith(".ts")
    ? [resolved]
    : [`${resolved}.ts`, join(resolved, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate));
}

async function walk(entries: string[]): Promise<Set<string>> {
  const visited = new Set<string>();
  const queue = entries.map((entry) => join(srcRoot, entry));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    const normalized = file.replaceAll("\\", "/");
    if (visited.has(normalized) || !existsSync(file)) {
      continue;
    }
    visited.add(normalized);
    const source = await readFile(file, "utf8");
    for (const specifier of collectSpecifiers(source)) {
      const resolved = resolveRelative(normalized, specifier);
      if (resolved) {
        queue.push(resolved);
      }
    }
  }
  return visited;
}

test("email/node is a Node-only published export without a browser condition", () => {
  const nodeExport = pkg.exports["./email/node"];
  assert.ok(nodeExport);
  assert.equal(nodeExport.import?.types, "./dist/email/node.d.ts");
  assert.equal(nodeExport.import?.default, "./dist/email/node.js");
  assert.equal(nodeExport.require?.types, "./dist/email/node.d.cts");
  assert.equal("browser" in nodeExport, false);
  const emailExport = pkg.exports["./email"];
  assert.ok(emailExport);
  assert.equal(emailExport.import?.default, "./dist/email.js");
});

test("browser and Cloudflare graphs cannot reach SMTP or Node net/tls", async () => {
  const visited = await walk([
    "browser.ts",
    "cloudflare/index.ts",
    "next/client.ts",
    "email/public.ts",
    "email/index.ts",
  ]);
  const smtpFiles = [...visited].filter(
    (file) =>
      file.includes("/src/email-node/") || file.endsWith("/email-node/smtp.ts")
  );
  assert.deepEqual(smtpFiles, []);

  for (const file of visited) {
    const source = await readFile(file, "utf8");
    assert.equal(
      /from\s+["']node:(?:net|tls)["']/.test(source),
      false,
      `${file} must not import node:net or node:tls`
    );
    assert.equal(
      /from\s+["']nodemailer["']/.test(source),
      false,
      `${file} must not import nodemailer`
    );
  }
});
