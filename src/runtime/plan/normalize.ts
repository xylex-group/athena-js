/**
 * Browser-safe config fold: aliases, env, execution mode, edge bindings.
 * Does not materialize Node backends.
 */

import {
	type AthenaClientConfig,
	normalizeUniversalCreateClientConfig,
} from "../../v3-client-core.ts";
import type { AthenaClientModelsInput } from "../../schema/types.ts";

export function normalizeUniversalConfig<
	TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
	return normalizeUniversalCreateClientConfig(config);
}
