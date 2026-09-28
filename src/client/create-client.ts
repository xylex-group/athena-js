/**
 * Browser-safe universal createClient materializer (Phase 2 extraction).
 *
 * Must not import pg, node:fs, server-only, postgres/*, or v3-client.ts.
 * Node/server close + pg wiring stays in src/v3-client.ts.
 */

import type { R2BucketLike } from "../cloudflare/types.ts";
import type { AthenaClientModelsInput } from "../schema/types.ts";
import {
  type AthenaClient,
  type AthenaClientConfig,
  type AthenaClientConfigWithR2,
  type AthenaClientWithR2Storage,
} from "./contracts.ts";
import {
  createClientWithNormalizer as createClientWithNormalizerImpl,
} from "../v3-client-assembly.ts";
import {
  normalizeUniversalCreateClientConfig,
} from "./config/normalize.ts";
import type { AthenaClientRuntimeBindings } from "./context.ts";

export type {
  AthenaClient,
  AthenaClientConfig,
  AthenaClientConfigWithR2,
  AthenaClientWithR2Storage,
};
export { normalizeUniversalCreateClientConfig };

/**
 * Shared client-construction spine with an injectable normalization pipeline.
 *
 * @internal Not part of the public API surface.
 */
export function createClientWithNormalizer<
  TModels extends AthenaClientModelsInput | undefined,
>(
  config: AthenaClientConfig<TModels>,
  normalize: (input: AthenaClientConfig<TModels>) => AthenaClientConfig<TModels>,
  runtimeBindings?: AthenaClientRuntimeBindings
): AthenaClient<TModels> | AthenaClientWithR2Storage<TModels> {
  // Nuclear casts: forwarding the generic impl re-instantiates AthenaClient
  // (TS2589 during declaration emit). Keep the public return types; erase
  // the body the same way v3-client-core createClient does.
  const factory = createClientWithNormalizerImpl as unknown as (
    input: unknown,
    normalizer: (c: unknown) => unknown,
    runtimeBindings?: AthenaClientRuntimeBindings
  ) => unknown;
  const pipeline = normalize as (c: unknown) => unknown;
  const client: unknown = factory(config, pipeline, runtimeBindings);
  return client as AthenaClient<TModels> | AthenaClientWithR2Storage<TModels>;
}

/**
 * Materialize an Athena client (single public constructor — INV-CLIENT-001).
 */
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
  config:
    | (AthenaClientConfig<TModels> & { r2: R2BucketLike })
    | AthenaClientConfigWithR2<TModels>
): AthenaClientWithR2Storage<TModels>;
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaClientConfig<TModels>): AthenaClient<TModels>;
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
  config: AthenaClientConfig<TModels>
): AthenaClient<TModels> | AthenaClientWithR2Storage<TModels> {
  const factory = createClientWithNormalizer as unknown as (
    input: unknown,
    normalizer: (c: unknown) => unknown
  ) => unknown;
  const normalize = normalizeUniversalCreateClientConfig as unknown as (
    c: unknown
  ) => unknown;
  const client: unknown = factory(config, normalize);
  return client as AthenaClient<TModels> | AthenaClientWithR2Storage<TModels>;
}
