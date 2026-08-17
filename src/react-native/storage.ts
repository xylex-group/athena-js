import type { AthenaUploadAdapter } from "./types.ts";

/** Empty upload adapter placeholder — core storage paths stay in shared runtime. */
export function createDefaultUploadAdapter(): AthenaUploadAdapter {
  return {};
}

export type { AthenaUploadAdapter };