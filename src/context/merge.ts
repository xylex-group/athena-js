import type { AthenaRequestContext } from "../v3-client-core.ts";

/**
 * Merge two request contexts with override precedence.
 * Nested headers are shallow-merged; later headers win on key collision.
 */
export function mergeAthenaRequestContexts(
	base: AthenaRequestContext | undefined,
	override: AthenaRequestContext | undefined,
): AthenaRequestContext | undefined {
	if (!(base || override)) {
		return;
	}

	return {
		...base,
		...override,
		headers:
			base?.headers || override?.headers
				? {
						...(base?.headers ?? {}),
						...(override?.headers ?? {}),
					}
				: undefined,
	};
}
