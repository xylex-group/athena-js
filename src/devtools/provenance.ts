import { PACKAGE_VERSION } from "../sdk-version.ts";
import type { AthenaBuildProvenance } from "./build-provenance.ts";

export type { AthenaBuildProvenance };

declare const __ATHENA_JS_BUILD_PROVENANCE__: AthenaBuildProvenance | undefined;

export function getAthenaJsBuildProvenance(): AthenaBuildProvenance {
  if (typeof __ATHENA_JS_BUILD_PROVENANCE__ !== "undefined") {
    return __ATHENA_JS_BUILD_PROVENANCE__;
  }

  return {
    buildRevision: null,
    buildTimestamp: new Date().toISOString(),
    dirty: true,
    version: PACKAGE_VERSION,
  };
}
