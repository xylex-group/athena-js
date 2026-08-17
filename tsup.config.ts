const ignoreDeprecations = process.env.ATHENA_TSUP_IGNORE_DEPRECATIONS;

export default {
  clean: true,
  // Declaration emit only: keep null-check discriminants, skip implicit-return noise
  // that is already tolerated at runtime for optional fallbacks.
  dts: {
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
    env: "src/env/index.ts",
    index: "src/index.ts",
    "next/client": "src/next/client.ts",
    "next/server": "src/next/server.ts",
    runtime: "src/runtime/data/index.ts",
    organization: "src/organization/index.ts",
    policy: "src/policy/index.ts",
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
