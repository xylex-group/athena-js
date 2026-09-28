import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PACKAGE_VERSION } from "../sdk-version.ts";

export function resolveAthenaJsPackageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function formatModuleEnablement(
  modules:
    | {
        auth?: boolean;
        billing?: boolean;
        chat?: boolean;
        eventIngress?: boolean;
      }
    | undefined
): readonly string[] {
  const auth =
    modules == null
      ? "enabled (default)"
      : modules.auth === true
        ? "enabled"
        : "disabled";
  const flag = (value: boolean | undefined): string =>
    value === true ? "enabled" : "disabled";
  return [
    `  Auth            ${auth}`,
    `  Chat            ${flag(modules?.chat)}`,
    `  Event Ingress   ${flag(modules?.eventIngress)}`,
    `  Billing         ${flag(modules?.billing)}`,
  ];
}

export function resolveCliExecutionMode(): "workspace-source" | "packed-dist" {
  const href = import.meta.url.replace(/\\/g, "/");
  return href.includes("/src/cli/") ? "workspace-source" : "packed-dist";
}

export function formatCliIdentity(input: {
  configPath?: string | null;
  modules?: {
    auth?: boolean;
    billing?: boolean;
    chat?: boolean;
    eventIngress?: boolean;
  };
}): string {
  return [
    `CLI version     ${PACKAGE_VERSION}`,
    `CLI source      ${resolveCliExecutionMode()}`,
    `CLI package     ${resolveAthenaJsPackageRoot()}`,
    `Config path     ${input.configPath ?? "(none)"}`,
    "Modules:",
    ...formatModuleEnablement(input.modules),
  ].join("\n");
}
