/**
 * Shared Env shape used by the Cloudflare examples.
 * Copy into your Worker or import when bundling these snippets together.
 *
 * Matches bindings in wrangler.example.jsonc + createAthenaFromWorkerEnv defaults.
 * Uses package structural types (no hard dependency on @cloudflare/workers-types).
 */
import type {
  AthenaWorkerEnv,
  D1DatabaseLike,
  R2BucketLike,
} from "@xylex-group/athena/cloudflare";

export type ExampleEnv = AthenaWorkerEnv & {
  DB?: D1DatabaseLike | null;
  FILES?: R2BucketLike | null;
};

export interface UserRow {
  active: number;
  email: string;
  id: string;
  name: string | null;
  resource_id?: string | null;
  role: string;
}

export type { D1DatabaseLike, R2BucketLike };
