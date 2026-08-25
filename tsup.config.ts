const ignoreDeprecations = process.env.ATHENA_TSUP_IGNORE_DEPRECATIONS;
const isWatch =
  process.env.ATHENA_TSUP_WATCH === "1" || process.argv.includes("--watch");

export default {
  // Watch overlay must not wipe dist while Next/Turbopack is holding those files.
  clean: !isWatch,
  // Full `tsup --watch` runs rollup-plugin-dts in a worker. That worker
  // OOMs (`ERR_WORKER_OUT_OF_MEMORY`) next to Vite + Next. Keep existing
  // .d.ts from the last `tsup` build; JS still rebuilds.
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
    browser: "src/browser.ts",
    "cli/index": "src/cli/index.ts",
    cloudflare: "src/cloudflare/index.ts",
    migrations: "src/migrations/index.ts",
    contracts: "src/contracts/index.ts",
    "contracts/v1": "src/contracts/v1/index.ts",
    cookies: "src/cookies/index.ts",
    devtools: "src/devtools/index.ts",
    env: "src/env/index.ts",
    email: "src/email/public.ts",
    "email/node": "src/email-node/index.ts",
    index: "src/index.ts",
    "next/client": "src/next/client.ts",
    "next/server": "src/next/server.ts",
    "next/session": "src/next/session.ts",
    server: "src/server.ts",
    runtime: "src/runtime/data/index.ts",
    organization: "src/organization/index.ts",
    policy: "src/policy/index.ts",
    rights: "src/rights/index.ts",
    schema: "src/schema/index.ts",
    react: "src/react/index.ts",
    "react-native": "src/react-native/index.ts",
    "social-providers": "src/social-providers/index.ts",
    utils: "src/utils/index.ts",
  },
  format: ["cjs", "esm"],
  minify: false,
  sourcemap: true,
  splitting: false,
  treeshake: true,
};
