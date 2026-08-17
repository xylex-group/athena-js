import { resolveCliCapabilities } from "./capabilities.ts";
import type { ResolveCliCapabilitiesOptions } from "./capabilities.ts";
import { createClackUi } from "./clack.ts";
import { createJsonUi } from "./json.ts";
import { createPlainUi } from "./plain.ts";
import type { AthenaCliUI, CliCapabilities } from "./types.ts";

export type { ResolveCliCapabilitiesOptions } from "./capabilities.ts";
export {
  resolveCliCapabilities,
  resolveCliOutputMode,
} from "./capabilities.ts";
export type {
  AthenaCliUI,
  CliCapabilities,
  CliOutputMode,
  Diagnostic,
  MigrationDisplayStatus,
  MigrationReportView,
  MigrationRowView,
  MigrationSectionView,
} from "./types.ts";

export function createCliUi(
  options: ResolveCliCapabilitiesOptions & {
    write?: (message: string) => void;
    capabilities?: CliCapabilities;
  } = {}
): AthenaCliUI {
  const capabilities =
    options.capabilities ?? resolveCliCapabilities(options);
  const write = options.write;

  if (capabilities.mode === "json") {
    return createJsonUi(capabilities, write);
  }
  if (capabilities.mode === "interactive") {
    return createClackUi(capabilities, write);
  }
  return createPlainUi(capabilities, write);
}
