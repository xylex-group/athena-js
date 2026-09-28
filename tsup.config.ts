import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readGitBuildProvenance } from "./src/devtools/build-provenance.ts";
import { PACKAGE_VERSION } from "./src/sdk-version.ts";

const ignoreDeprecations = process.env.ATHENA_TSUP_IGNORE_DEPRECATIONS;
const isWatch =
  process.env.ATHENA_TSUP_WATCH === "1" || process.argv.includes("--watch");
const packageRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Default JSON import of package.json inlines the whole manifest (exports,
 * typesVersions). Root `dist/index.js` then contains `"next/server"` and fails
 * the runtime-boundary audit. Keep only `version` in bundled output.
 */
function packageVersionOnlyPlugin() {
  const target = resolve(packageRoot, "package.json");
  return {
    name: "athena-package-version-only",
    setup(build: {
      onLoad: (
        options: { filter: RegExp },
        callback: (args: { path: string }) =>
          | { contents: string; loader: "json" }
          | undefined
      ) => void;
    }) {
      build.onLoad({ filter: /(?:^|[\\/])package\.json$/ }, (args) => {
        if (resolve(args.path) !== target) {
          return;
        }
        const pkg = JSON.parse(readFileSync(args.path, "utf8")) as {
          version: string;
        };
        return {
          contents: JSON.stringify({ version: pkg.version }),
          loader: "json" as const,
        };
      });
    },
  };
}

export default {
  // Watch overlay must not wipe dist while Next/Turbopack is holding those files.
  clean: !isWatch,
  // Full `tsup --watch` runs rollup-plugin-dts in a worker. That worker
  // OOMs (`ERR_WORKER_OUT_OF_MEMORY`) next to Vite + Next. Keep existing
  // .d.ts from the last `tsup` build; JS still rebuilds.
  esbuildPlugins: [packageVersionOnlyPlugin()],
  define: {
    __ATHENA_JS_BUILD_PROVENANCE__: JSON.stringify(
      readGitBuildProvenance({
        cwd: packageRoot,
        version: PACKAGE_VERSION,
      })
    ),
  },
  dts: isWatch
    ? false
    : {
      compilerOptions: {
        ...(ignoreDeprecations ? { ignoreDeprecations } : {}),
        noImplicitReturns: false,
        noUnusedLocals: false,
        noUnusedParameters: false,
      },
    },
  entry: {
    admin: "src/admin/index.ts",
    "auth/server": "src/auth/server-entry.ts",
    billing: "src/billing/index.ts",
    capabilities: "src/capabilities/index.ts",
    browser: "src/browser.ts",
    "cli/index": "src/cli/index.ts",
    cloudflare: "src/cloudflare/index.ts",
    config: "src/config/public.ts",
    contracts: "src/contracts/index.ts",
    "contracts/v1": "src/contracts/v1/index.ts",
    "cookies/index": "src/cookies/index.ts",
    "cookies/session": "src/cookies/session-cookie-detection.ts",
    devtools: "src/devtools/index.ts",
    email: "src/email/public.ts",
    "email/node": "src/email-node/index.ts",
    env: "src/env/index.ts",
    index: "src/index.ts",
    migrations: "src/migrations/index.ts",
    local: "src/local/index.ts",
    "next/client": "src/next/client.ts",
    "next/server": "src/next/server.ts",
    "next/session": "src/next/session.ts",
    organization: "src/organization/index.ts",
    policy: "src/policy/index.ts",
    react: "src/react/index.ts",
    "react-native": "src/react-native/index.ts",
    rights: "src/rights/index.ts",
    runtime: "src/runtime/data/index.ts",
    schema: "src/schema/index.ts",
    server: "src/server.ts",
    "social-providers": "src/social-providers/index.ts",
    "cloudflare/d1/statement-classifier":
      "src/cloudflare/d1/statement-classifier.ts",
    utils: "src/utils/index.ts",
  },
  format: ["cjs", "esm"],
  loader: {
    ".sql": "text",
  },
  minify: false,
  sourcemap: true,
  splitting: false,
  treeshake: true,
};
