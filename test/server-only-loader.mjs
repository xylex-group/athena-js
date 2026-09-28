/**
 * Node test loader: replace `server-only` with an empty module.
 * Next.js bundlers empty this package on the server and error on the client;
 * the published package always throws under plain Node.
 *
 * Also remap `@xylex-group/athena/*` to `src/` so examples can import the
 * published package names without a prior `dist/` build.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = "@xylex-group/athena";

const EXPORT_TO_SRC = {
  "": "src/index.ts",
  "/admin": "src/admin.ts",
  "/auth/server": "src/auth/server.ts",
  "/billing": "src/billing.ts",
  "/browser": "src/browser.ts",
  "/cloudflare": "src/cloudflare.ts",
  "/contracts": "src/contracts.ts",
  "/contracts/v1": "src/contracts/v1.ts",
  "/cookies": "src/cookies.ts",
  "/email": "src/email.ts",
  "/email/node": "src/email/node.ts",
  "/env": "src/env.ts",
  "/migrations": "src/migrations.ts",
  "/next/client": "src/next/client.ts",
  "/next/server": "src/next/server.ts",
  "/organization": "src/organization.ts",
  "/policy": "src/policy.ts",
  "/react": "src/react/index.ts",
  "/react-native": "src/react-native.ts",
  "/runtime": "src/runtime.ts",
  "/schema": "src/schema.ts",
  "/server": "src/server.ts",
  "/social-providers": "src/social-providers.ts",
  "/utils": "src/utils.ts",
};

function resolvePackageToSrc(specifier) {
  if (specifier !== PACKAGE_NAME && !specifier.startsWith(`${PACKAGE_NAME}/`)) {
    return null;
  }
  const rest =
    specifier === PACKAGE_NAME ? "" : specifier.slice(PACKAGE_NAME.length);
  const mapped = EXPORT_TO_SRC[rest];
  const candidates = mapped
    ? [join(pkgRoot, mapped)]
    : [
        join(pkgRoot, "src", `${rest.slice(1)}.ts`),
        join(pkgRoot, "src", rest.slice(1), "index.ts"),
      ];
  for (const file of candidates) {
    if (existsSync(file)) {
      return pathToFileURL(file).href;
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export {}",
    };
  }
  const remapped = resolvePackageToSrc(specifier);
  if (remapped) {
    return {
      shortCircuit: true,
      url: remapped,
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const pathname = url.split("?")[0] ?? url;
  if (pathname.endsWith(".sql")) {
    const source = readFileSync(new URL(url), "utf8");
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(source)};`,
    };
  }
  return nextLoad(url, context);
}
