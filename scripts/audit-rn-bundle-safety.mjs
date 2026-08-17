#!/usr/bin/env node

/**
 * Static browser-entry hazard scan for @xylex-group/athena.
 *
 * This is NOT a complete React Native / Hermes / Metro bundle-safety proof.
 * It only text-scans built browser artifacts for obvious Node/server-only
 * dependency hazards.
 *
 * Usage (from packages/athena-js):
 *   pnpm build
 *   node scripts/audit-rn-bundle-safety.mjs
 *
 * Optional:
 *   node scripts/audit-rn-bundle-safety.mjs --build
 *     runs `pnpm build` (or npm run build) in this package first
 *
 * Exit 0: no forbidden Node/server-only/pg/react-dom import patterns found
  *         in dist/browser.js, dist/browser.cjs, and (when present)
  *         dist/react-native.js / dist/react-native.cjs
  * Exit 1: missing dist, stale/missing artifacts, or forbidden patterns
  *
  * A PASS means only:
  *   No obvious Node/server-only imports were detected in the browser/RN artifacts.
  *
  * A PASS does NOT mean:
  *   The artifact is ready for Hermes, Expo, or Metro resolution.
 *
 * Not covered (follow-up PR):
 *   Metro / Expo resolution, package export conditions, Hermes execution,
 *   dynamic runtime access to window/navigator/PublicKeyCredential/XMLHttpRequest,
 *   cookie credentials assumptions, crypto.subtle, FormData compatibility,
 *   WebAuthn, OAuth redirects.
 *
 * See: docs/sdd/xylex/athena-react-native/ELITE-architecture-athena-react-native.md
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
const distDir = join(packageRoot, "dist");

/** Patterns that must not appear in the browser candidate entries. */
const BROWSER_FORBIDDEN = [
  {
    id: "node:fs",
    re: /from\s+["']node:fs(?:\/promises)?["']|require\(["']node:fs/,
  },
  {
    id: "node:path",
    re: /from\s+["']node:path["']|require\(["']node:path/,
  },
  {
    id: "node:url",
    re: /from\s+["']node:url["']|require\(["']node:url/,
  },
  {
    id: "fs (bare)",
    re: /from\s+["']fs(?:\/promises)?["']|require\(["']fs(?:\/promises)?["']/,
  },
  {
    id: "path (bare)",
    re: /from\s+["']path["']|require\(["']path["']/,
  },
  {
    id: "url (bare node)",
    re: /from\s+["']url["']|require\(["']url["']/,
  },
  { id: "server-only", re: /["']server-only["']/ },
  { id: "blessed", re: /["']blessed["']/ },
  { id: "chalk", re: /["']chalk["']/ },
  { id: "react-dom", re: /["']react-dom["']/ },
  { id: "static pg", re: /from\s+["']pg["']|require\(["']pg["']/ },
];

/** Root entry is expected to contain Node imports; we report them. */
const ROOT_EXPECTED_NODE = [
  { id: "fs", re: /from\s+["']fs(?:\/promises)?["']/ },
  { id: "path", re: /from\s+["']path["']/ },
  { id: "dynamic pg", re: /import\(["']pg["']\)/ },
];

function readIfExists(path) {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf8");
}

function matchAll(content, rules) {
  return rules.filter((rule) => rule.re.test(content)).map((rule) => rule.id);
}

function topImportLines(content, limit = 12) {
  return content
    .split("\n")
    .filter(
      (line) =>
        /^\s*import\s+/.test(line) ||
        /^\s*require\(/.test(line) ||
        /\brequire\s*\(/.test(line)
    )
    .slice(0, limit);
}

function collectForbiddenHits(content) {
  const hits = matchAll(content, BROWSER_FORBIDDEN);
  if (/import\(["']pg["']\)/.test(content)) {
    hits.push("dynamic import('pg')");
  }
  return hits;
}

function scanBrowserArtifact(label, path, options = {}) {
  const { expectBrowserUnsupportedStub = false } = options;
  if (!existsSync(path)) {
    console.error(
      `[static browser-entry hazard scan] missing ${label} — run package build first:\n` +
        "  pnpm --dir packages/athena-js build\n" +
        "  or: node scripts/audit-rn-bundle-safety.mjs --build"
    );
    process.exit(1);
  }

  const content = readFileSync(path, "utf8");
  const size = statSync(path).size;
  console.log(`\n--- ${label} (${size} bytes) ---`);
  console.log(`path: ${path}`);

  const imports = topImportLines(content);
  if (imports.length === 0) {
    console.log("top imports: (none matched import/require lines)");
  } else {
    console.log("top imports:");
    for (const line of imports) {
      console.log(`  ${line}`);
    }
  }

  const hits = collectForbiddenHits(content);
  if (hits.length > 0) {
    console.error(`\nFAIL: ${label} contains forbidden patterns:`);
    for (const id of hits) {
      console.error(`  - ${id}`);
    }
    process.exit(1);
  }

  console.log(
    `OK: ${label} — no forbidden Node/server-only/pg/react-dom import patterns (text scan)`
  );

  if (expectBrowserUnsupportedStub) {
    if (/not available in browser bundles/.test(content)) {
      console.log(
        `OK: ${label} stubs Node-only generator/introspection APIs (string marker present)`
      );
    } else {
      console.warn(
        `WARN: expected throwBrowserUnsupported message missing from ${label}`
      );
    }
  }

  return content;
}

function maybeBuild(args) {
  if (!args.includes("--build")) {
    return;
  }

  console.log("=== --build: building package first ===");
  const usePnpm =
    existsSync(join(packageRoot, "pnpm-lock.yaml")) ||
    existsSync(join(packageRoot, "..", "..", "pnpm-lock.yaml"));
  const cmd = usePnpm ? "pnpm" : "npm";
  const cmdArgs = usePnpm ? ["build"] : ["run", "build"];
  const result = spawnSync(cmd, cmdArgs, {
    cwd: packageRoot,
    shell: true,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(
      `[static browser-entry hazard scan] build failed with exit ${result.status}`
    );
    process.exit(result.status ?? 1);
  }
}

function printScopeBanner() {
  console.log("=== Static browser-entry hazard scan ===");
  console.log(
    "Scope: textual import/require pattern scan of dist/browser.{js,cjs}"
  );
  console.log(
    "NOT a complete RN/Hermes/Metro proof (resolution, runtime APIs, cookies, WebAuthn, XHR, etc.)"
  );
  console.log(`package root: ${packageRoot}`);
}

function printPassSemantics() {
  console.log("\n--- PASS semantics ---");
  console.log(
    "PASS means ONLY: no obvious Node/server-only imports were detected in the browser artifacts."
  );
  console.log(
    "PASS does NOT mean: the browser artifact is ready for Hermes, Expo, or Metro."
  );
  console.log("\nNot proven by this script:");
  console.log("  - Metro / Expo package export-condition resolution");
  console.log("  - Hermes execution");
  console.log("  - window / navigator / PublicKeyCredential / XMLHttpRequest");
  console.log('  - credentials: "include" cookie assumptions');
  console.log("  - crypto.subtle / FormData / Blob compatibility");
  console.log("  - WebAuthn, OAuth redirects, storage upload progress");
}

function printGuidance() {
  console.log("\n--- Immediate guidance ---");
  console.log(
    "  Prefer: import { createClient, createReactNativeClient } from '@xylex-group/athena/react-native'"
  );
  console.log(
    "  Interim: import { createClient } from '@xylex-group/athena/browser'"
  );
  console.log(
    "  Avoid:  import { createClient } from '@xylex-group/athena' (Node fs/path)"
  );
  console.log(
    "  Auth:   createReactNativeClient → credentials omit + AthenaTokenStore"
  );
  console.log(
    '  Export condition "react-native" on "." → only after Expo/Metro fixture passes'
  );
  console.log(
    "  CI:     pnpm --dir packages/athena-js build && node packages/athena-js/scripts/audit-rn-bundle-safety.mjs"
  );
  console.log(
    "  See:    docs/sdd/xylex/athena-react-native/ELITE-architecture-athena-react-native.md"
  );
}

function main() {
  const args = process.argv.slice(2);
  maybeBuild(args);
  printScopeBanner();

  // Always scan both ESM and CJS browser artifacts (ARCH-NATIVE-005).
    scanBrowserArtifact("dist/browser.js", join(distDir, "browser.js"), {
      expectBrowserUnsupportedStub: true,
    });
    scanBrowserArtifact("dist/browser.cjs", join(distDir, "browser.cjs"), {
      expectBrowserUnsupportedStub: true,
    });

    // RN thin adapter entry (required once tsup emits react-native).
    const rnJs = join(distDir, "react-native.js");
    const rnCjs = join(distDir, "react-native.cjs");
    if (existsSync(rnJs) || existsSync(rnCjs)) {
      scanBrowserArtifact("dist/react-native.js", rnJs, {
        expectBrowserUnsupportedStub: false,
      });
      scanBrowserArtifact("dist/react-native.cjs", rnCjs, {
        expectBrowserUnsupportedStub: false,
      });
    } else {
      console.error(
        "\nFAIL: dist/react-native.{js,cjs} missing — rebuild after adding react-native entry"
      );
      process.exit(1);
    }

    const index = readIfExists(join(distDir, "index.js"));
    const nextServer = readIfExists(join(distDir, "next", "server.js"));
    const react = readIfExists(join(distDir, "react.js"));

  if (index) {
    console.log("\n--- dist/index.js (root, Node) top imports ---");
    for (const line of topImportLines(index)) {
      console.log(`  ${line}`);
    }
    const rootNode = matchAll(index, ROOT_EXPECTED_NODE);
    console.log(
      rootNode.length > 0
        ? `INFO: root entry Node markers present (expected): ${rootNode.join(", ")}`
        : "WARN: root entry missing expected Node markers — graph may have changed"
    );
    console.log(
      "INFO: root @xylex-group/athena is NOT safe as a default Metro/RN import"
    );
  } else {
    console.warn(
      "WARN: dist/index.js missing — cannot contrast root Node hazards (rebuild recommended)"
    );
  }

  if (nextServer) {
    const hasServerOnly = /["']server-only["']/.test(nextServer);
    console.log(
      hasServerOnly
        ? "\nOK: next/server retains server-only (must not be used from RN)"
        : "\nWARN: next/server missing server-only import"
    );
  }

  if (react) {
    const hasReactDom = /["']react-dom["']/.test(react);
    console.log(
      hasReactDom
        ? "\nWARN: react entry references react-dom"
        : "\nOK: react entry does not import react-dom (text scan)"
    );
  }

  printPassSemantics();
  printGuidance();
  console.log(
    "\nPASS (static browser-entry hazard scan only — not Hermes/Expo readiness)"
  );
}

main();
