/**
 * Browser-safe config fold: aliases, env, execution mode, edge bindings.
 * Does not materialize Node backends.
 */

import type { AthenaClientModelsInput } from "../../schema/types.ts";
import type { AthenaClientConfig } from "../../client/contracts.ts";
import {
  normalizeUniversalConfig as normalizeUniversalConfigImpl,
} from "../../client/config/normalize.ts";

export function normalizeUniversalConfig<
  TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
  return normalizeUniversalConfigImpl(config);
}
